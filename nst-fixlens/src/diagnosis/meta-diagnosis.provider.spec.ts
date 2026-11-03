import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MetaDiagnosisProvider } from './meta-diagnosis.provider.js';
import { MetaModelsService } from '../models/meta-models.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  Capture,
  Problem,
  ProblemCategory,
  Urgency,
} from '../database/entities.js';
import { Hazard } from './diagnosis.dto.js';
import sharp from 'sharp';
import { measureSam } from '../models/sam-measurement.js';
const sam =
  '<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>';
const selection = { x1: 0, y1: 0, x2: 4, y2: 4, points: [{ x: 0, y: 0 }] };
const source = sharp({
  create: { width: 5, height: 5, channels: 3, background: '#ddd' },
})
  .jpeg()
  .toBuffer();
function setup() {
  const models = {
    samModel: 'sam-3.1',
    suggestConcept: vi.fn().mockResolvedValue({
      concept: 'surface crack',
      reason: 'Visible mark',
      model: 'concept-muse',
    }),
    segmentConcept: vi.fn().mockResolvedValue({ text: sam, model: 'text-sam' }),
    chooseMask: vi.fn().mockResolvedValue({
      winner: 'a',
      reason: 'Candidate A follows the visible mark',
      reviews: {
        a: { status: 'matches', reason: 'Follows damage' },
        b: { status: 'matches', reason: 'Follows damage' },
      },
      hazards: [],
      model: 'selector-muse',
    }),
    target: vi.fn().mockResolvedValue({
      model: 'target-muse',
      plan: {
        status: 'clear',
        description: 'Localized mark',
        concept: 'surface crack',
        preferred_method: 'spatial',
        routing_reason: 'Faint mark benefits from guides',
        box: { x1: 0, y1: 0, x2: 4, y2: 4 },
        foreground: [{ x: 0, y: 0 }],
        background: [{ x: 2, y: 0 }],
        reason: 'Visible',
        hazards: [],
      },
    }),
    segment: vi.fn().mockResolvedValue({ text: sam, model: 'sam-version' }),
    refine: vi.fn().mockResolvedValue({
      mask_review: { status: 'matches', reason: 'Follows the mark' },
      diagnosis: {
        verdict: 'Final finding',
        category: ProblemCategory.Crack,
        likely_cause: null,
        urgency: Urgency.Monitor,
        confidence: 0.8,
        confidence_note: null,
        diy: null,
        pro: null,
        red_flags: [],
        recheck_days: 14,
        hazards: [Hazard.Asbestos],
      },
      model: 'final-muse',
    }),
  };
  const storage = {
    readMask: vi.fn(async () => measureSam(sam, 5, 5).png),
    readPhoto: vi.fn(async () => source),
    putAnalysisPhoto: vi.fn().mockResolvedValue(undefined),
    presignRead: vi.fn(async (key: string) => `https://private.invalid/${key}`),
    putMask: vi.fn().mockResolvedValue(undefined),
    confirmMask: vi.fn().mockResolvedValue(undefined),
    removeMask: vi.fn().mockResolvedValue(undefined),
  };
  const provider = new MetaDiagnosisProvider(
    models as unknown as MetaModelsService,
    storage as unknown as StorageService,
  );
  const problem = Object.assign(new Problem(), {
    id: 'problem',
    title: 'Wall crack',
  });
  const capture = Object.assign(new Capture(), {
    id: 'capture',
    photo_key: 'photo.jpg',
    photo_width_px: 5,
    photo_height_px: 5,
  });
  return { models, storage, provider, problem, capture };
}
describe('user-guided segmentation and assessment', () => {
  it('targets with Muse, segments a crop, then assesses the exact source-aligned mask and promotes it', async () => {
    const { provider, models, storage, problem, capture } = setup();
    const context = {
      text: 'Thin gray scuff near the light; exclude the surrounding ceiling.',
    };
    const preview = await provider.segment(
      problem,
      capture,
      selection,
      undefined,
      context,
    );
    expect(models.refine).not.toHaveBeenCalled();
    expect(models.target).toHaveBeenCalledBefore(models.segment);
    expect(models.suggestConcept).not.toHaveBeenCalled();
    expect(models.segmentConcept).not.toHaveBeenCalled();
    expect(models.chooseMask).not.toHaveBeenCalled();
    expect(preview.segmentation_method).toBe('spatial');
    expect(preview.attempts).toBe(1);
    expect(models.target).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      selection,
      5,
      5,
      expect.objectContaining({ observations: context.text }),
      undefined,
      expect.any(AbortSignal),
    );
    expect(storage.confirmMask).not.toHaveBeenCalled();
    expect(preview.mask_key).toMatch(/^previews\//);
    const result = await provider.diagnose(problem, capture, preview, context);
    expect(models.segment).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^https:\/\/private.invalid\/previews\/.*\.jpg$/),
      selection,
      5,
      5,
      [{ x: 2, y: 0 }],
      expect.any(AbortSignal),
    );
    expect(models.refine).toHaveBeenCalledWith(
      'https://private.invalid/photo.jpg',
      expect.stringMatching(/^https:\/\/private.invalid\/previews\/.*\.jpg$/),
      expect.objectContaining({ observations: context.text }),
      expect.objectContaining({ selection, area_px: 10, perimeter_px: 28 }),
    );
    expect(storage.confirmMask).toHaveBeenCalledExactlyOnceWith(
      preview.mask_key,
      result.measurement!.mask_key,
    );
    expect(result.measurement!.mask_key).toMatch(/^masks\//);
    expect(result.report.verdict).toBe('Final finding');
    expect(result.report.spark_version).toBe('final-muse');
    expect(result.hazards).toEqual([Hazard.Asbestos]);
    expect(result.measurement!.scale_mm_per_px).toBeNull();
  });
  it('retains the preview for retry after Muse fails, without promoting a permanent mask', async () => {
    const { provider, models, storage, problem, capture } = setup();
    const preview = await provider.segment(problem, capture, selection);
    storage.removeMask.mockClear();
    const failure = new BadGatewayException('Assessment failed');
    models.refine.mockRejectedValue(failure);
    await expect(provider.diagnose(problem, capture, preview)).rejects.toBe(
      failure,
    );
    expect(storage.confirmMask).not.toHaveBeenCalled();
    expect(storage.removeMask).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\.jpg$/),
    );
  });
  it('uses one text attempt when the targeting call routes to text, without a separate concept or selection call', async () => {
    const { provider, models, storage, problem, capture } = setup();
    const target = await models.target();
    models.target.mockClear();
    models.target.mockResolvedValue({
      ...target,
      plan: { ...target.plan, preferred_method: 'text' },
    });
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.segmentation_method).toBe('text');
    expect(preview.attempts).toBe(1);
    expect(preview.method_selection).toEqual({
      model: 'target-muse',
      reason: target.plan.routing_reason,
      fallback: false,
    });
    expect(models.target).toHaveBeenCalledTimes(1);
    expect(models.segmentConcept).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\.jpg$/),
      'surface crack',
      expect.any(AbortSignal),
    );
    expect(models.segment).not.toHaveBeenCalled();
    expect(models.chooseMask).not.toHaveBeenCalled();
    expect(models.suggestConcept).not.toHaveBeenCalled();
    expect(storage.putMask).toHaveBeenCalledExactlyOnceWith(
      preview.mask_key,
      measureSam(sam, 5, 5).png,
      'sam',
      expect.any(Buffer),
    );
    expect(storage.confirmMask).not.toHaveBeenCalled();
    const result = await provider.diagnose(problem, capture, preview);
    expect(result.report.confidence_note).toContain('SAM automatic (text)');
  });
  it('falls back to spatial only when the chosen text attempt is empty, without replanning', async () => {
    const { provider, models, problem, capture } = setup();
    const target = await models.target();
    models.target.mockClear();
    models.target.mockResolvedValue({
      ...target,
      plan: { ...target.plan, preferred_method: 'text' },
    });
    models.segmentConcept.mockResolvedValue({ text: '', model: 'text-sam' });
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.segmentation_method).toBe('spatial');
    expect(preview.method_selection?.fallback).toBe(true);
    expect(preview.attempts).toBe(2);
    expect(models.segmentConcept).toHaveBeenCalledBefore(models.segment);
    expect(models.target).toHaveBeenCalledTimes(1);
    expect(models.chooseMask).not.toHaveBeenCalled();
    expect(models.suggestConcept).not.toHaveBeenCalled();
  });
  it('tries text after the spatial candidate fails geometric checks', async () => {
    const { provider, models, problem, capture } = setup();
    const target = await models.target();
    models.target.mockClear();
    models.target.mockResolvedValue({
      ...target,
      plan: {
        ...target.plan,
        foreground: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        background: [],
      },
    });
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.segmentation_method).toBe('text');
    expect(preview.quality?.passed).toBe(true);
    expect(preview.method_selection?.fallback).toBe(true);
    expect(preview.attempts).toBe(2);
    expect(models.segment).toHaveBeenCalledBefore(models.segmentConcept);
    expect(models.target).toHaveBeenCalledTimes(1);
  });
  it('does not request an alternate concept when no valid text route was supplied', async () => {
    const { provider, models, storage, problem, capture } = setup();
    const target = await models.target();
    models.target.mockClear();
    models.target.mockResolvedValue({
      ...target,
      plan: { ...target.plan, concept: null },
    });
    models.segment.mockResolvedValue({ text: '', model: 'sam-version' });
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.status).toBe('unavailable');
    expect(preview.attempts).toBe(1);
    expect(models.suggestConcept).not.toHaveBeenCalled();
    expect(models.segmentConcept).not.toHaveBeenCalled();
    expect(storage.putMask).not.toHaveBeenCalled();
  });
  it('does not spend another SAM call after an upstream busy response', async () => {
    const { provider, models, storage, problem, capture } = setup();
    models.segment.mockRejectedValue(
      new ServiceUnavailableException('Meta is busy'),
    );
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.status).toBe('unavailable');
    expect(preview.attempts).toBe(1);
    expect(models.segmentConcept).not.toHaveBeenCalled();
    expect(storage.putMask).not.toHaveBeenCalled();
    expect(
      storage.putAnalysisPhoto.mock.calls.every(([key]) =>
        storage.removeMask.mock.calls.some(([removed]) => removed === key),
      ),
    ).toBe(true);
  });

  it('cleans only the new permanent object when promotion fails', async () => {
    const { provider, storage, problem, capture } = setup();
    const preview = await provider.segment(problem, capture, selection);
    storage.removeMask.mockClear();
    storage.confirmMask.mockRejectedValue(new Error('Copy failed'));
    await expect(provider.diagnose(problem, capture, preview)).rejects.toThrow(
      'Could not save',
    );
    expect(storage.removeMask).toHaveBeenCalledWith(
      storage.confirmMask.mock.calls[0][1],
    );
    expect(storage.removeMask).not.toHaveBeenCalledWith(preview.mask_key);
  });
  it('falls back after two empty SAM outputs without saving a bad mask', async () => {
    const { provider, models, storage, problem, capture } = setup();
    models.segment.mockResolvedValue({ text: '', model: 'sam-version' });
    models.segmentConcept.mockResolvedValue({ text: '', model: 'text-sam' });
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.status).toBe('unavailable');
    expect(preview.area_px).toBeNull();
    expect(models.segment).toHaveBeenCalledTimes(1);
    expect(models.segmentConcept).toHaveBeenCalledTimes(1);
    expect(models.chooseMask).not.toHaveBeenCalled();
    expect(storage.putMask).not.toHaveBeenCalled();
    expect(models.refine).not.toHaveBeenCalled();
  });
  it('skips SAM for an unclear target and still produces a photo-based assessment', async () => {
    const { provider, models, storage, problem, capture } = setup();
    models.target.mockResolvedValue({
      model: 'target-muse',
      plan: {
        status: 'unclear',
        description: null,
        box: null,
        foreground: [],
        background: [],
        reason: 'Scuff is too faint',
        hazards: [Hazard.Asbestos],
      },
    });
    const preview = await provider.segment(problem, capture, selection);
    expect(models.segment).not.toHaveBeenCalled();
    expect(preview.sam_version).toBe('not-run');
    const result = await provider.diagnose(problem, capture, preview);
    expect(result.measurement).toBeNull();
    expect(result.report.confidence_note).toContain('Photo-based assessment');
    expect(result.hazards).toContain(Hazard.Asbestos);
    expect(storage.confirmMask).not.toHaveBeenCalled();
    expect(models.refine.mock.calls[0][1]).toBeNull();
  });
  it('withholds measurements when final Muse review rejects a geometrically plausible mask', async () => {
    const { provider, models, storage, problem, capture } = setup();
    const preview = await provider.segment(problem, capture, selection);
    const final = await models.refine();
    models.refine.mockResolvedValue({
      ...final,
      mask_review: {
        status: 'mismatch',
        reason: 'Includes unaffected ceiling',
      },
    });
    const result = await provider.diagnose(problem, capture, preview);
    expect(result.measurement).toBeNull();
    expect(storage.confirmMask).not.toHaveBeenCalled();
    expect(result.report.confidence_note).toContain(
      'Includes unaffected ceiling',
    );
  });
  it('rejects both methods when they cover an exclusion point, then withholds measurements', async () => {
    const { provider, models, storage, problem, capture } = setup();
    const target = await models.target();
    models.target.mockClear();
    models.target.mockResolvedValue({
      ...target,
      plan: { ...target.plan, background: [{ x: 3, y: 0 }] },
    });
    const preview = await provider.segment(problem, capture, selection);
    expect(preview.status).toBe('unavailable');
    expect(preview.reason).toContain('unaffected background');
    expect(models.target).toHaveBeenCalledTimes(1);
    expect(models.segment).toHaveBeenCalledTimes(1);
    expect(models.segmentConcept).toHaveBeenCalledTimes(1);
    expect(models.chooseMask).not.toHaveBeenCalled();
    expect(storage.putMask).not.toHaveBeenCalled();
  });
});
