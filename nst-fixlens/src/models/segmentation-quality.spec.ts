import { describe, it, expect } from 'vitest';
import { constrainTarget, inspectMask } from './segmentation-quality.js';
import { measureSam } from './sam-measurement.js';
import { calibrate } from '../measurements/calibration.js';
import { parseTarget, parseAssessment } from './segmentation.schema.js';
const selection = {
  x1: 10,
  y1: 10,
  x2: 29,
  y2: 29,
  points: [{ x: 15, y: 15 }],
};
const plan = {
  status: 'clear' as const,
  description: 'Small scuff',
  box: { x1: 10, y1: 10, x2: 29, y2: 29 },
  foreground: [{ x: 15, y: 15 }],
  background: [{ x: 8, y: 8 }],
  reason: 'Visible',
  hazards: [],
};
describe('segmentation constraints', () => {
  it('requires a text mask to intersect intent guides and pass spill/exclusion checks without treating a rough brush as truth', () => {
    const target = constrainTarget(plan, selection, 100, 100)!;
    target.foreground = [
      { x: 15, y: 15 },
      { x: 20, y: 20 },
      { x: 24, y: 24 },
    ];
    const mask = new Uint8Array(10000);
    mask[15 * 100 + 15] = 1;
    expect(inspectMask(mask, 100, 100, selection, target).passed).toBe(false);
    expect(
      inspectMask(mask, 100, 100, selection, target, 'text'),
    ).toMatchObject({
      passed: true,
      method: 'text',
      foreground_coverage: 1 / 3,
    });
    mask[8 * 100 + 8] = 1;
    expect(inspectMask(mask, 100, 100, selection, target, 'text').passed).toBe(
      false,
    );
    expect(
      inspectMask(new Uint8Array(10000), 100, 100, selection, target, 'text')
        .passed,
    ).toBe(false);
    const offTarget = new Uint8Array(10000);
    offTarget[18 * 100 + 18] = 1;
    expect(
      inspectMask(offTarget, 100, 100, selection, target, 'text').passed,
    ).toBe(false);
  });
  it('keeps a padded crop and exclusion points in source coordinates', () => {
    const target = constrainTarget(plan, selection, 100, 100)!;
    expect(target.crop).toEqual({ left: 6, top: 6, width: 28, height: 28 });
    const mask = new Uint8Array(10000);
    for (let y = 10; y < 30; y++)
      for (let x = 10; x < 30; x++) mask[y * 100 + x] = 1;
    expect(inspectMask(mask, 100, 100, selection, target).passed).toBe(true);
    mask[8 * 100 + 8] = 1;
    expect(
      inspectMask(mask, 100, 100, selection, target).reasons.join(),
    ).toContain('unaffected background');
  });
  it('flags a broad surface mask and a mask missing the foreground', () => {
    const target = constrainTarget(plan, selection, 100, 100)!;
    const broad = new Uint8Array(10000);
    for (let y = 6; y < 34; y++)
      for (let x = 6; x < 34; x++) broad[y * 100 + x] = 1;
    const quality = inspectMask(broad, 100, 100, selection, target);
    expect(quality.passed).toBe(false);
    expect(quality.reasons.join()).toContain('expanded too far');
    expect(quality.reasons.join()).toContain('entire analysis crop');
    expect(
      inspectMask(new Uint8Array(10000), 100, 100, selection, target).passed,
    ).toBe(false);
  });
  it('rejects off-brush boxes, contradictory exclusion points, and unclear targets', () => {
    expect(
      constrainTarget(
        { ...plan, box: { x1: 50, y1: 50, x2: 80, y2: 80 } },
        selection,
        100,
        100,
      ),
    ).toBeNull();
    expect(
      constrainTarget(
        { ...plan, background: [{ x: 15, y: 15 }] },
        selection,
        100,
        100,
      ),
    ).toBeNull();
    expect(
      constrainTarget({ ...plan, status: 'unclear' }, selection, 100, 100),
    ).toBeNull();
  });
  it('projects a cropped mask back to original coordinates before applying physical calibration', () => {
    const sam =
      '<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>';
    const calibration = calibrate(
      {
        method: 'reference_card',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        width_mm: 40,
        height_mm: 40,
      },
      20,
      20,
    );
    const measured = measureSam(sam, 5, 5, calibration, {
      left: 7,
      top: 9,
      width: 20,
      height: 20,
    });
    expect(measured.area_px).toBe(10);
    expect(measured.calibrated_area_mm2).toBeCloseTo(40);
    expect(measured.mask[9 * 20 + 7]).toBe(1);
    expect(measured.mask[9 * 20 + 8]).toBe(0);
    expect(measured.png.readUInt32BE(16)).toBe(20);
  });
  it('requires an explicit structured final mask decision and a bounded targeting schema', () => {
    const normalized = {
      ...plan,
      coordinate_system: 'normalized_1000',
      concept: 'gray scuff',
      preferred_method: 'spatial',
      routing_reason: 'Faint mark benefits from guides',
    };
    expect(parseTarget(JSON.stringify(normalized))).toEqual(normalized);
    for (const route of [
      { concept: null, preferred_method: 'text' },
      { concept: 'crack and stain' },
      { preferred_method: 'invented' },
      { routing_reason: '' },
    ])
      expect(() =>
        parseTarget(JSON.stringify({ ...normalized, ...route })),
      ).toThrow();
    expect(() =>
      parseTarget(
        JSON.stringify({ ...normalized, background: [{ x: NaN, y: 0 }] }),
      ),
    ).toThrow();
    expect(() =>
      parseAssessment(
        JSON.stringify({
          diagnosis: {},
          mask_review: { status: 'yes', reason: 'ok' },
        }),
      ),
    ).toThrow();
  });
});
