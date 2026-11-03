import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Capture, Measurement, Problem, Report } from '../database/entities.js';
import { DIAGNOSIS_PROVIDER } from './diagnosis.provider.js';
import type {
  DiagnosisProvider,
  SegmentationResult,
} from './diagnosis.provider.js';
import { DiagnoseDto, EditMaskDto, SegmentDto } from './diagnosis.dto.js';
import { SafetyGate } from './safety-gate.service.js';
import {
  previewOutlineKey,
  StorageService,
} from '../storage/storage.service.js';
import { SegmentationReceipt } from './segmentation-receipt.js';
import { calibrate } from '../measurements/calibration.js';
import { editMask } from './edit-mask.js';
import { verifyPhoto } from '../models/analysis-images.js';
import { outlinePng } from '../models/sam-measurement.js';
@Injectable()
export class DiagnosisService {
  private readonly logger = new Logger(DiagnosisService.name);
  constructor(
    private readonly db: DataSource,
    @Inject(DIAGNOSIS_PROVIDER) private readonly provider: DiagnosisProvider,
    private readonly safety: SafetyGate,
    private readonly storage: StorageService,
    private readonly receipts: SegmentationReceipt,
  ) {}
  async editMask(id: string, userId: string, dto: EditMaskDto) {
    const { capture } = await this.eligible(id, userId, dto.capture_id);
    const identity = {
      user_id: userId,
      problem_id: id,
      capture_id: capture.id,
    };
    // Even a blank reset must validate a supplied receipt; it preserves hazards
    // and scale without trusting a client-supplied storage key or pixel count.
    const prior = dto.segmentation_token
      ? this.receipts.verify(dto.segmentation_token, identity)
      : undefined;
    if (dto.base === 'preview' && !prior?.mask_key)
      throw new BadRequestException(
        'Preview this highlight before correcting it, or start from a blank outline.',
      );
    const width = capture.photo_width_px,
      height = capture.photo_height_px;
    if (!width || !height || width * height > 16_000_000)
      throw new BadRequestException(
        'A photo with known dimensions is required.',
      );
    if (!prior)
      await verifyPhoto(
        await this.storage.readPhoto(capture.photo_key),
        width,
        height,
      );
    const selection = prior?.selection ?? dto.selection;
    if (
      selection.x1 > selection.x2 ||
      selection.y1 > selection.y2 ||
      selection.x2 >= width ||
      selection.y2 >= height
    )
      throw new BadRequestException('Select a region inside the photo.');
    const calibration =
      prior?.calibration ??
      (dto.calibration ? calibrate(dto.calibration, width, height) : undefined);
    const measured = await editMask(
      width,
      height,
      dto.strokes,
      dto.base === 'preview'
        ? await this.storage.readMask(prior!.mask_key!)
        : undefined,
      calibration,
    );
    const source =
      dto.base === 'preview'
        ? dto.strokes.length
          ? prior?.outline_source === 'user_drawn'
            ? 'user_drawn'
            : 'user_corrected'
          : (prior?.outline_source ?? 'sam')
        : 'user_drawn';
    const key = `previews/${id}/${capture.id}-${randomUUID()}.png`;
    try {
      await this.storage.putMask(
        key,
        measured.png,
        source,
        await outlinePng(measured.mask, width, height),
      );
      return await this.present(id, userId, capture.id, {
        ...prior,
        segmentation_method:
          source === 'sam' ? prior?.segmentation_method : undefined,
        method_review: source === 'sam' ? prior?.method_review : undefined,
        method_selection:
          source === 'sam' ? prior?.method_selection : undefined,
        selection: source === 'sam' ? prior!.selection : measured.selection,
        target: source === 'sam' ? prior?.target : undefined,
        outline_source: source,
        status: 'candidate',
        reason: 'Review your edited outline before assessment.',
        mask_key: key,
        area_px: measured.area_px,
        perimeter_px: measured.perimeter_px,
        sam_version: prior?.sam_version ?? 'not-run',
        hazards: [
          ...new Set([...(prior?.hazards ?? []), ...(dto.hazards ?? [])]),
        ],
        quality:
          source === 'sam'
            ? prior?.quality
            : { passed: true, reasons: [], method: 'user_outline' },
        ...(measured.calibration
          ? {
              calibration: measured.calibration,
              calibrated_area_mm2: measured.calibrated_area_mm2,
            }
          : {}),
      });
    } catch (error) {
      await this.storage
        .removeMask(key)
        .catch(() => this.logger.warn('Could not clean up an edited preview'));
      throw error;
    }
  }
  async segment(id: string, userId: string, dto: SegmentDto) {
    const { problem, capture } = await this.eligible(
      id,
      userId,
      dto.capture_id,
    );
    const { x1, y1, x2, y2 } = dto.selection;
    const w = capture.photo_width_px,
      h = capture.photo_height_px;
    if (
      !w ||
      !h ||
      w * h > 16_000_000 ||
      x1 >= x2 ||
      y1 >= y2 ||
      x2 >= w ||
      y2 >= h ||
      dto.selection.points?.some(
        (p) => p.x < x1 || p.x > x2 || p.y < y1 || p.y > y2,
      )
    )
      throw new BadRequestException(
        'Select a region inside a capture with known dimensions (up to 16 million pixels).',
      );
    const segmentation = await this.provider.segment(
      problem,
      capture,
      dto.selection,
      dto.calibration ? calibrate(dto.calibration, w, h) : undefined,
      { text: dto.context, hazards: dto.hazards },
    );
    return this.present(id, userId, capture.id, segmentation);
  }
  private async present(
    id: string,
    userId: string,
    captureId: string,
    segmentation: SegmentationResult,
  ) {
    try {
      // A deletion may have started while a model/storage request was running.
      await this.eligible(id, userId, captureId);
      const [mask_url, outline_url] = segmentation.mask_key
        ? await Promise.all([
            this.storage.presignRead(segmentation.mask_key),
            this.storage.presignRead(previewOutlineKey(segmentation.mask_key)),
          ])
        : [null, null];
      return {
        ...this.receipts.issue(
          { user_id: userId, problem_id: id, capture_id: captureId },
          segmentation,
        ),
        mask_url,
        outline_url,
        outline_source: segmentation.outline_source ?? 'sam',
        area_px: segmentation.area_px,
        perimeter_px: segmentation.perimeter_px,
        sam_version: segmentation.sam_version,
        is_mock: segmentation.sam_version.startsWith('mock'),
        status: segmentation.status ?? 'candidate',
        reason: segmentation.reason ?? null,
        target: segmentation.target ?? null,
        quality: segmentation.quality ?? null,
        attempts: segmentation.attempts ?? 0,
        segmentation_method: segmentation.segmentation_method ?? null,
        method_selection: segmentation.method_selection ?? null,
        calibration: null,
        calibrated_area_mm2: null,
      };
    } catch (error) {
      if (segmentation.mask_key)
        await this.storage
          .removeMask(segmentation.mask_key)
          .catch(() => this.logger.warn('Could not clean up a preview'));
      throw error;
    }
  }
  private async eligible(id: string, userId: string, captureId: string) {
    const problem = await this.db
      .getRepository(Problem)
      .findOneBy({ id, user_id: userId });
    if (!problem) throw new NotFoundException('Problem not found');
    if (problem.status === 'archived')
      throw new ConflictException('This job is archived or being deleted');
    const capture = await this.db
      .getRepository(Capture)
      .findOneBy({ id: captureId, problem_id: id });
    if (!capture)
      throw new NotFoundException('Capture not found for this problem');
    if (
      (await this.db
        .getRepository(Report)
        .existsBy({ capture_id: capture.id })) ||
      (await this.db
        .getRepository(Measurement)
        .existsBy({ capture_id: capture.id }))
    )
      throw new ConflictException('Capture has already been diagnosed');
    return { problem, capture };
  }
  async diagnose(id: string, userId: string, dto: DiagnoseDto) {
    const { problem, capture } = await this.eligible(
      id,
      userId,
      dto.capture_id,
    );
    const segmentation = this.receipts.verify(dto.segmentation_token, {
      user_id: userId,
      problem_id: id,
      capture_id: capture.id,
    });
    // External inference and object storage cannot be rolled back by PostgreSQL.
    // Keep those calls outside the atomic measurement/report transaction.
    const output = await this.provider.diagnose(
      problem,
      capture,
      segmentation,
      {
        text: dto.context,
        hazards: dto.hazards,
      },
    );
    const result = this.safety.apply(
      output,
      [...(dto.hazards ?? []), ...output.hazards],
      [problem.title, problem.location_note, dto.context].join(' '),
    );
    try {
      const savedResult = await this.db.transaction(async (manager) => {
        const owned = await manager.findOne(Problem, {
          where: { id, user_id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!owned) throw new NotFoundException('Problem not found');
        if (owned.status === 'archived')
          throw new ConflictException('This job is archived or being deleted');
        if (
          (await manager.existsBy(Report, { capture_id: capture.id })) ||
          (await manager.existsBy(Measurement, { capture_id: capture.id }))
        )
          throw new ConflictException('Capture has already been diagnosed');
        const measurement = result.measurement
          ? await manager.save(
              Measurement,
              manager.create(Measurement, {
                ...result.measurement,
                capture_id: capture.id,
              }),
            )
          : null;
        const report = await manager.save(
          Report,
          manager.create(Report, {
            ...result.report,
            problem_id: id,
            capture_id: capture.id,
          }),
        );
        const latest = await manager.findOne(Capture, {
          where: { problem_id: id },
          order: { taken_at: 'DESC', id: 'DESC' },
        });
        if (latest?.id === capture.id)
          await manager.update(Problem, id, {
            current_urgency: report.urgency,
            category: report.category,
          });
        return { measurement, report };
      });
      if (segmentation.mask_key && result.measurement)
        await this.storage
          .removeMask(segmentation.mask_key)
          .catch(() =>
            this.logger.warn('Could not remove a confirmed preview'),
          );
      return savedResult;
    } catch (error) {
      const key = result.measurement?.mask_key;
      if (key) {
        try {
          // An uncertain COMMIT must never delete a mask referenced by a saved row.
          const saved = await this.db
            .getRepository(Measurement)
            .existsBy({ capture_id: capture.id, mask_key: key });
          if (!saved) await this.storage.removeMask(key);
        } catch {
          this.logger.warn('Could not confirm or clean up an uncommitted mask');
        }
      }
      throw error;
    }
  }
}
