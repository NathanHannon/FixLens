import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { overlayPhoto } from './analysis-images.js';
import { measureMask, outlinePng } from './sam-measurement.js';
describe('local mask review visualization', () => {
  it('shows selected pixels on the source without filling the enclosing rectangle', async () => {
    const source = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer();
    const mask = new Uint8Array(10000);
    for (let x = 10; x < 90; x++)
      for (let y = 10; y < 15; y++) mask[y * 100 + x] = 1;
    for (let x = 85; x < 90; x++)
      for (let y = 10; y < 90; y++) mask[y * 100 + x] = 1;
    const overlay = await overlayPhoto(
      source,
      measureMask(mask, 100, 100).png,
      100,
      100,
    );
    const { data, info } = await sharp(overlay)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number, c: number) =>
      data[(y * info.width + x) * info.channels + c];
    expect(at(50, 12, 1)).toBeGreaterThan(at(50, 12, 0) + 35);
    expect(Math.abs(at(50, 50, 1) - at(50, 50, 0))).toBeLessThan(5);
    expect([info.width, info.height]).toEqual([100, 100]);
  });

  it('keeps the review outline on the mask boundary, including thin isolated damage', async () => {
    const width = 120;
    const height = 100;
    const mask = new Uint8Array(width * height);
    for (let y = 10; y < 70; y++) mask.fill(1, y * width + 10, y * width + 70);
    for (let y = 20; y < 90; y++) mask[y * width + 100] = 1;
    const { data, info } = await sharp(await outlinePng(mask, width, height))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
    expect([info.width, info.height, info.channels]).toEqual([
      width,
      height,
      4,
    ]);
    expect(alpha(10, 40)).toBe(255);
    expect(alpha(100, 40)).toBe(255);
    expect(alpha(45, 40)).toBe(0);
    expect(alpha(85, 40)).toBe(0);
  });
});
