import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Urgency } from '../database/entities.js';
import type { Capture, Problem } from '../database/entities.js';
import type {
  DiagnosisProvider,
  DiagnosisResult,
  SegmentationResult,
} from './diagnosis.provider.js';
import type { Hazard, SelectionDto } from './diagnosis.dto.js';
import { MetaModelsService } from '../models/meta-models.service.js';
import { measureSam, outlinePng } from '../models/sam-measurement.js';
import { StorageService } from '../storage/storage.service.js';
import type { Calibration } from '../measurements/calibration.js';
import {
  brushPreview,
  cropPhoto,
  overlayPhoto,
} from '../models/analysis-images.js';
import {
  constrainTarget,
  inspectMask,
} from '../models/segmentation-quality.js';

@Injectable()
export class MetaDiagnosisProvider implements DiagnosisProvider {
  // Route once during Muse targeting; try the alternative only on failure.
  // Routing is a hypothesis, not visual acceptance of a returned mask.
  // Producing a candidate never bypasses the final visual mask review.
  private readonly logger = new Logger(MetaDiagnosisProvider.name);
  constructor(
    private readonly models: MetaModelsService,
    private readonly storage: StorageService,
  ) {}
  async segment(
    problem: Problem,
    capture: Capture,
    selection: SelectionDto,
    calibration?: Calibration,
    context?: { text?: string; hazards?: Hazard[] },
  ): Promise<SegmentationResult> {
    const width = capture.photo_width_px!,
      height = capture.photo_height_px!;
    const imageUrl = await this.storage.presignRead(capture.photo_key);
    const source = await this.storage.readPhoto(capture.photo_key).catch(() => {
      throw new BadGatewayException(
        'Could not read the uploaded photo for analysis. Please retry.',
      );
    });
    const annotated = await brushPreview(source, width, height, selection);
    const key = (extension: string) =>
      `previews/${problem.id}/${capture.id}-${randomUUID()}.${extension}`;
    const brushKey = key('jpg'),
      cropKey = key('jpg');
    const deadline = AbortSignal.timeout(180_000);
    const hazards = new Set(context?.hazards ?? []);
    let attempts = 0,
      sam_version = 'not-run';
    let targetInfo: SegmentationResult['target'];
    let quality: SegmentationResult['quality'];
    let reason =
      'No reliable outline could be prepared. Adjust or draw the outline, or continue without measurements.';
    const unavailable = (): SegmentationResult => ({
      selection,
      status: 'unavailable',
      reason,
      mask_key: null,
      area_px: null,
      perimeter_px: null,
      sam_version,
      attempts,
      target: targetInfo,
      quality,
      hazards: [...hazards],
      ...(calibration ? { calibration } : {}),
    });
    try {
      await this.storage.putAnalysisPhoto(brushKey, annotated);
      const result = await this.models.target(
        imageUrl,
        await this.storage.presignRead(brushKey),
        selection,
        width,
        height,
        {
          title: problem.title,
          category_hint: problem.category,
          location: problem.location_note,
          observations: context?.text ?? '',
          reported_hazards: context?.hazards ?? [],
        },
        undefined,
        deadline,
      );
      result.plan.hazards.forEach((h) => hazards.add(h));
      targetInfo = {
        description: result.plan.description,
        box: result.plan.box,
        muse_version: result.model,
      };
      const target = constrainTarget(result.plan, selection, width, height);
      if (!target) {
        reason =
          result.plan.status === 'unclear'
            ? result.plan.reason
            : 'Muse could not identify a tight region consistent with your brush.';
        return unavailable();
      }
      const { crop } = target;
      await this.storage.putAnalysisPhoto(
        cropKey,
        await cropPhoto(source, crop),
      );
      const cropUrl = await this.storage.presignRead(cropKey);
      const relative = (p: { x: number; y: number }) => ({
        x: p.x - crop.left,
        y: p.y - crop.top,
      });
      const concept = result.plan.concept;
      const preferred =
        result.plan.preferred_method === 'text' && concept ? 'text' : 'spatial';
      const methods: ('spatial' | 'text')[] =
        preferred === 'text'
          ? ['text', 'spatial']
          : concept
            ? ['spatial', 'text']
            : ['spatial'];
      // The targeting call already supplied both routes. Run the alternate only
      // for an empty/invalid result or failed geometric checks, never routinely.
      for (const method of methods) {
        if (deadline.aborted) break;
        let measured: ReturnType<typeof measureSam>;
        let inspected: ReturnType<typeof inspectMask>;
        let model: string;
        try {
          attempts++;
          sam_version = this.models.samModel;
          const sam =
            method === 'text'
              ? await this.models.segmentConcept(cropUrl, concept!, deadline)
              : await this.models.segment(
                  cropUrl,
                  {
                    x1: target.box.x1 - crop.left,
                    y1: target.box.y1 - crop.top,
                    x2: target.box.x2 - crop.left,
                    y2: target.box.y2 - crop.top,
                    points: target.foreground.map(relative),
                  },
                  crop.width,
                  crop.height,
                  target.background.map(relative),
                  deadline,
                );
          model = sam.model;
          sam_version = model;
          measured = measureSam(
            sam.text,
            crop.width,
            crop.height,
            calibration,
            { left: crop.left, top: crop.top, width, height },
          );
          inspected = inspectMask(
            measured.mask,
            width,
            height,
            selection,
            target,
            method,
          );
          if (!inspected.passed) {
            quality = inspected;
            reason = inspected.reasons.join(' ');
            continue;
          }
        } catch (error) {
          if (
            !(error instanceof HttpException) ||
            ![422, 502, 503, 504].includes(error.getStatus())
          )
            throw error;
          if ([503, 504].includes(error.getStatus())) break;
          continue;
        }
        const maskKey = key('png');
        try {
          await this.storage.putMask(
            maskKey,
            measured.png,
            'sam',
            await outlinePng(measured.mask, width, height),
          );
        } catch {
          await this.cleanup(maskKey);
          throw new BadGatewayException(
            'Could not store the highlight. Please retry.',
          );
        }
        return {
          outline_source: 'sam',
          segmentation_method: method,
          method_selection: {
            model: result.model,
            reason:
              result.plan.routing_reason ?? 'Muse-guided spatial targeting',
            fallback: method !== preferred,
          },
          selection,
          status: 'candidate',
          reason: 'Review the highlight before the final assessment.',
          mask_key: maskKey,
          area_px: measured.area_px,
          perimeter_px: measured.perimeter_px,
          sam_version: model,
          quality: inspected,
          target: targetInfo,
          hazards: [...hazards],
          attempts,
          ...(measured.calibration
            ? {
                calibration: measured.calibration,
                calibrated_area_mm2: measured.calibrated_area_mm2,
              }
            : {}),
        };
      }
      return unavailable();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException(
        'Could not prepare the outline. Your photo is saved; please retry.',
      );
    } finally {
      await this.cleanup(cropKey);
      await this.cleanup(brushKey);
    }
  }

  async diagnose(
    problem: Problem,
    capture: Capture,
    segmentation: SegmentationResult,
    context?: { text?: string; hazards?: Hazard[] },
  ): Promise<DiagnosisResult> {
    const candidate =
      segmentation.status === 'candidate' &&
      segmentation.quality?.passed &&
      segmentation.mask_key &&
      segmentation.area_px != null &&
      segmentation.perimeter_px != null;
    const final = await this.assess(
      problem,
      capture,
      candidate ? segmentation.mask_key : null,
      {
        title: problem.title,
        category_hint: problem.category,
        location: problem.location_note,
        observations: context?.text ?? '',
        reported_hazards: context?.hazards ?? [],
      },
      {
        selection: segmentation.selection,
        outline_source: segmentation.outline_source ?? 'sam',
        area_px: candidate ? segmentation.area_px : null,
        perimeter_px: candidate ? segmentation.perimeter_px : null,
        target: segmentation.target,
        quality: segmentation.quality ?? {
          passed: false,
          reasons: [segmentation.reason ?? 'No reliable segmentation'],
        },
        ...(candidate && segmentation.calibrated_area_mm2 != null
          ? {
              calibrated_area_mm2: segmentation.calibrated_area_mm2,
              calibration_method: segmentation.calibration?.method,
            }
          : {}),
      },
    );
    // Only confirmed, successfully assessed masks enter permanent storage.
    const accepted = Boolean(
      candidate && final.mask_review.status === 'matches',
    );
    let maskKey: string | null = null;
    if (accepted) {
      maskKey = `masks/${problem.id}/${capture.id}-${randomUUID()}.png`;
      try {
        await this.storage.confirmMask(segmentation.mask_key!, maskKey);
      } catch {
        await this.cleanup(maskKey);
        throw new BadGatewayException(
          'Could not save the confirmed mask. Please retry.',
        );
      }
    }
    const { hazards, confidence, ...report } = final.diagnosis;
    const outline = {
      sam: segmentation.segmentation_method
        ? `SAM automatic (${segmentation.segmentation_method})`
        : 'SAM automatic',
      user_corrected: 'manually corrected',
      user_drawn: 'manually traced',
    }[segmentation.outline_source ?? 'sam'];
    return {
      measurement: accepted
        ? {
            mask_key: maskKey,
            area_px: segmentation.area_px!,
            perimeter_px: segmentation.perimeter_px,
            scale_mm_per_px: null,
            calibration: segmentation.calibration ?? null,
            calibrated_area_mm2: segmentation.calibrated_area_mm2 ?? null,
            width_mm: null,
            length_mm: null,
            sam_version: segmentation.sam_version,
          }
        : null,
      report: {
        ...report,
        confidence: confidence.toFixed(2),
        confidence_note: accepted
          ? `Outline source: ${outline}. Mask accepted for approximate measurement: ${final.mask_review.reason} ${report.confidence_note ?? ''}`.slice(
              0,
              2000,
            )
          : `Photo-based assessment; measurements unavailable: ${candidate ? final.mask_review.reason : (segmentation.reason ?? final.mask_review.reason)} Outline source: ${outline}. ${report.confidence_note ?? ''}`.slice(
              0,
              2000,
            ),
        safety_override: false,
        diy: report.urgency === Urgency.ProNow ? null : report.diy,
        spark_version: final.model,
        sam_version: segmentation.sam_version,
      },
      hazards: [...new Set([...hazards, ...(segmentation.hazards ?? [])])],
    };
  }
  private async assess(
    problem: Problem,
    capture: Capture,
    maskKey: string | null,
    context: Record<string, unknown>,
    evidence: Parameters<MetaModelsService['refine']>[3],
  ) {
    const original = await this.storage.presignRead(capture.photo_key);
    if (!maskKey) return this.models.refine(original, null, context, evidence);
    const key = `previews/${problem.id}/${capture.id}-${randomUUID()}.jpg`;
    try {
      const [source, mask] = await Promise.all([
        this.storage.readPhoto(capture.photo_key),
        this.storage.readMask(maskKey),
      ]);
      const overlay = await overlayPhoto(
        source,
        mask,
        capture.photo_width_px!,
        capture.photo_height_px!,
      );
      await this.storage.putAnalysisPhoto(key, overlay);
      return await this.models.refine(
        original,
        await this.storage.presignRead(key),
        context,
        { ...evidence, review_visualization: 'photo_overlay' },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException(
        'Could not prepare the outline review. Your photo is saved; please retry.',
      );
    } finally {
      await this.cleanup(key);
    }
  }
  private async cleanup(key: string) {
    await this.storage
      .removeMask(key)
      .catch(() => this.logger.warn('Could not clean up an uncommitted mask'));
  }
}
