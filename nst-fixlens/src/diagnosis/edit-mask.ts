import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import type { MaskStrokeDto } from './diagnosis.dto.js';
import { measureMask } from '../models/sam-measurement.js';
import type { Calibration } from '../measurements/calibration.js';

// Stroke order is significant: paint adds pixels, erase removes them. Both the
// editor and server use round caps/joins in source-photo coordinates.
export async function editMask(
  width: number,
  height: number,
  strokes: MaskStrokeDto[],
  base?: Buffer,
  calibration?: Calibration,
) {
  if (
    !width ||
    !height ||
    width * height > 16_000_000 ||
    strokes.reduce((n, s) => n + s.points.length, 0) > 8192 ||
    strokes.some(
      (s) =>
        s.radius > Math.min(512, Math.max(width, height) / 4) ||
        s.points.some((p) => p.x >= width || p.y >= height),
    )
  )
    throw new BadRequestException(
      'Outline exceeds the supported photo bounds or stroke limit.',
    );
  let background = '';
  if (base) {
    const image = sharp(base, { limitInputPixels: 16_000_000 });
    const meta = await image.metadata();
    if (meta.width !== width || meta.height !== height || !meta.hasAlpha)
      throw new BadRequestException(
        'The highlight dimensions do not match this photo.',
      );
    const alpha = await image.extractChannel('alpha').png().toBuffer();
    background = `<image width="${width}" height="${height}" href="data:image/png;base64,${alpha.toString('base64')}"/>`;
  }
  const paths = strokes
    .map((s) => {
      const first = s.points[0];
      const d =
        `M${first.x},${first.y}` +
        (s.points.length === 1
          ? `L${first.x + 0.01},${first.y}`
          : s.points
              .slice(1)
              .map((p) => `L${p.x},${p.y}`)
              .join(''));
      return `<path d="${d}" stroke="${s.mode === 'paint' ? 'white' : 'black'}" stroke-width="${s.radius * 2}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${background}${paths}</svg>`,
  );
  const pixels = await sharp(svg, { limitInputPixels: 16_000_000 })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer();
  const mask = Uint8Array.from(pixels, (value) => Number(value >= 128));
  if (!mask.some(Boolean))
    throw new BadRequestException(
      'The outline is empty. Paint over the affected area before continuing.',
    );
  let x1 = width - 1,
    y1 = height - 1,
    x2 = 0,
    y2 = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const x = i % width,
        y = Math.floor(i / width);
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
    }
  return {
    ...measureMask(mask, width, height, calibration),
    selection: { x1, y1, x2, y2 },
  };
}
