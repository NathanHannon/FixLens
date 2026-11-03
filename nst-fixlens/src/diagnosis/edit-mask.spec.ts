import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { editMask } from './edit-mask.js';
import type { MaskStrokeDto } from './diagnosis.dto.js';
import { calibrate } from '../measurements/calibration.js';
const paint: MaskStrokeDto = {
  mode: 'paint',
  radius: 3,
  points: [
    { x: 20, y: 15 },
    { x: 80, y: 15 },
  ],
};
const erase: MaskStrokeDto = {
  mode: 'erase',
  radius: 5,
  points: [{ x: 50, y: 15 }],
};
describe('source-aligned outline editing', () => {
  it('recomputes calibrated area after erasing, using the same planar reference', async () => {
    const calibration = calibrate(
      {
        method: 'reference_card',
        width_mm: 80,
        height_mm: 40,
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 50 },
          { x: 10, y: 50 },
        ],
      },
      100,
      60,
    );
    const original = await editMask(100, 60, [paint], undefined, calibration);
    const edited = await editMask(100, 60, [erase], original.png, calibration);
    expect(edited.calibrated_area_mm2).toBeCloseTo(edited.area_px);
    expect(edited.calibrated_area_mm2).toBeLessThan(
      original.calibrated_area_mm2!,
    );
    expect(edited.calibration).toEqual(calibration);
  });
  it('paints at the original photo pixels and exports a transparent full-size PNG', async () => {
    const result = await editMask(100, 60, [paint]);
    expect(result.mask[15 * 100 + 50]).toBe(1);
    expect(result.mask[50 * 100 + 15]).toBe(0);
    expect(result.mask[0]).toBe(0);
    expect(result.area_px).toBeGreaterThan(300);
    const meta = await sharp(result.png).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([100, 60, true]);
  });
  it('removes pixels from a SAM-style base while retaining unaffected pixels', async () => {
    const original = await editMask(100, 60, [paint]);
    const edited = await editMask(100, 60, [erase], original.png);
    expect(edited.mask[15 * 100 + 50]).toBe(0);
    expect(edited.mask[15 * 100 + 25]).toBe(1);
    expect(edited.area_px).toBeLessThan(original.area_px);
    const unchanged = await editMask(100, 60, [], original.png);
    expect(unchanged.area_px).toBe(original.area_px);
  });
  it('honors paint/erase ordering and undo without replacing paths by enclosing boxes', async () => {
    const removed = await editMask(100, 60, [paint, erase]);
    const restored = await editMask(100, 60, [
      paint,
      erase,
      { ...erase, mode: 'paint', radius: 2 },
    ]);
    expect(removed.mask[1550]).toBe(0);
    expect(restored.mask[1550]).toBe(1);
    expect(restored.mask[20 * 100 + 50]).toBe(0);
  });
  it('rejects erased-empty outlines, out-of-bounds points, and excessive work', async () => {
    await expect(editMask(100, 60, [erase])).rejects.toThrow('empty');
    await expect(
      editMask(100, 60, [{ ...paint, points: [{ x: 100, y: 0 }] }]),
    ).rejects.toThrow('bounds');
    await expect(
      editMask(
        100,
        60,
        Array.from({ length: 64 }, () => ({
          ...paint,
          points: Array.from({ length: 256 }, () => ({ x: 20, y: 20 })),
        })),
      ),
    ).rejects.toThrow('limit');
  });
  it('rejects base masks from a different image size', async () => {
    const original = await editMask(100, 60, [paint]);
    await expect(editMask(60, 100, [], original.png)).rejects.toThrow(
      'dimensions',
    );
  });
});
