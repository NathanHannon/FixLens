import {
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { formats, decodeMaskToRaster, recordsOfKind } from '@meta-sam/parser';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import {
  calibratedArea,
  type Calibration,
} from '../measurements/calibration.js';

const MAX_PIXELS = 16_000_000;
function dimension(value: string | undefined): number {
  if (
    !value ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw new BadGatewayException('SAM returned invalid dimensions');
  return Number(value);
}
export function measureSam(
  text: string,
  expectedWidth: number | null,
  expectedHeight: number | null,
  calibration?: Calibration,
  projection?: { left: number; top: number; width: number; height: number },
) {
  if (!text.trim())
    throw new UnprocessableEntityException(
      'No affected region could be segmented. Try a closer, clearer photo.',
    );
  if (text.length > 4_000_000)
    throw new BadGatewayException('SAM output exceeds the supported size');
  // Bound dimensions before calling the official decoder, which intentionally
  // imposes no project-level allocation quotas.
  let width = 0,
    height = 0,
    maskPixels = 0,
    masks = 0;
  for (const match of text.matchAll(/<\|(box|mask);([^|]*)\|>/g)) {
    const fields = Object.fromEntries(
      match[2].split(';').map((field) => {
        const split = field.indexOf('=');
        return [field.slice(0, split).trim(), field.slice(split + 1).trim()];
      }),
    );
    if (match[1] === 'box') {
      const w = dimension(fields.w),
        h = dimension(fields.h);
      if (w * h > MAX_PIXELS || (width && (width !== w || height !== h)))
        throw new BadGatewayException(
          'SAM source dimensions are inconsistent or too large',
        );
      width = w;
      height = h;
    } else {
      const [h, w] = (fields.data ?? '').split(',');
      maskPixels += dimension(w) * dimension(h);
      masks++;
      if (maskPixels > 2 * MAX_PIXELS || masks > 32)
        throw new BadGatewayException('SAM masks exceed the supported size');
    }
  }
  if (
    !width ||
    !height ||
    (expectedWidth !== null && expectedWidth !== width) ||
    (expectedHeight !== null && expectedHeight !== height)
  )
    throw new BadGatewayException('SAM dimensions do not match the capture');
  const parser = formats.segmentation.image().createParser();
  parser.push(text);
  const parsed = parser.finish({ status: 'completed' }).result;
  if (
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    parsed.records.some((record) => record.kind === 'text')
  )
    throw new BadGatewayException('SAM returned malformed segmentation');
  const records = recordsOfKind(parsed.records, 'mask');
  if (!records.length)
    throw new UnprocessableEntityException(
      'No affected region could be segmented. Try a clearer photo.',
    );
  const union = new Uint8Array(width * height);
  let mappedPixels = 0;
  for (const record of new Map(
    records.map((record) => [record.identity, record]),
  ).values()) {
    const { left, top, right, bottom } = record.bounds;
    const boxWidth = right - left,
      boxHeight = bottom - top;
    mappedPixels += boxWidth * boxHeight;
    if (mappedPixels > 2 * MAX_PIXELS)
      throw new BadGatewayException(
        'SAM projected masks exceed the supported size',
      );
    const raster = decodeMaskToRaster(record.mask);
    // Mask resolution is independent of source bounds. Nearest-neighbor samples
    // at source-pixel centers preserve binary coverage while projecting it.
    for (let y = 0; y < boxHeight; y++) {
      const row =
        Math.min(
          record.mask.height - 1,
          Math.floor(((y + 0.5) * record.mask.height) / boxHeight),
        ) * record.mask.width;
      for (let x = 0; x < boxWidth; x++) {
        const column = Math.min(
          record.mask.width - 1,
          Math.floor(((x + 0.5) * record.mask.width) / boxWidth),
        );
        if (raster[row + column]) union[(top + y) * width + left + x] = 1;
      }
    }
  }
  let mask = union;
  if (projection) {
    if (
      projection.width * projection.height > MAX_PIXELS ||
      projection.left < 0 ||
      projection.top < 0 ||
      projection.left + width > projection.width ||
      projection.top + height > projection.height
    )
      throw new BadGatewayException('Invalid crop projection');
    mask = new Uint8Array(projection.width * projection.height);
    for (let y = 0; y < height; y++)
      mask.set(
        union.subarray(y * width, (y + 1) * width),
        (projection.top + y) * projection.width + projection.left,
      );
    width = projection.width;
    height = projection.height;
  }
  return measureMask(mask, width, height, calibration);
}
export function measureMask(
  mask: Uint8Array,
  width: number,
  height: number,
  calibration?: Calibration,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS ||
    mask.length !== width * height
  )
    throw new BadGatewayException('Invalid mask dimensions');
  let area_px = 0,
    perimeter_px = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!mask[index]) continue;
      area_px++;
      perimeter_px +=
        Number(x === 0 || !mask[index - 1]) +
        Number(x === width - 1 || !mask[index + 1]) +
        Number(y === 0 || !mask[index - width]) +
        Number(y === height - 1 || !mask[index + width]);
    }
  if (!area_px)
    throw new UnprocessableEntityException(
      'SAM produced an empty affected region. Try a clearer photo.',
    );
  return {
    area_px,
    perimeter_px,
    mask,
    png: maskPng(mask, width, height),
    ...(calibration
      ? {
          calibrated_area_mm2: calibratedArea(mask, width, height, calibration),
          calibration,
        }
      : {}),
  };
}

// Style only the review layer. The original mask still drives editing,
// measurement, persistence and the final model's visual review.
export async function outlinePng(
  mask: Uint8Array,
  width: number,
  height: number,
) {
  // Sharp expands black foreground, so non-boundary pixels start white.
  const edges = Buffer.alloc(mask.length, 255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (
        mask[index] &&
        (x === 0 ||
          x === width - 1 ||
          y === 0 ||
          y === height - 1 ||
          !mask[index - 1] ||
          !mask[index + 1] ||
          !mask[index - width] ||
          !mask[index + width])
      )
        edges[index] = 0;
    }

  // Scale the stroke with the source photo so a 2000px phone image still
  // reads clearly when shown as a small preview. A darker edge adds contrast.
  const stroke = Math.min(
    6,
    Math.max(1, Math.round(Math.max(width, height) / 450)),
  );
  const raster = sharp(edges, { raw: { width, height, channels: 1 } });
  const [inner, outer] = await Promise.all([
    raster.clone().dilate(stroke).greyscale().raw().toBuffer(),
    raster
      .dilate(stroke * 2)
      .greyscale()
      .raw()
      .toBuffer(),
  ]);
  const rgba = Buffer.alloc(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    if (outer[i]) continue;
    const offset = i * 4;
    const bright = inner[i] === 0;
    rgba[offset] = bright ? 130 : 13;
    rgba[offset + 1] = bright ? 250 : 48;
    rgba[offset + 2] = bright ? 211 : 43;
    rgba[offset + 3] = 255;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
function chunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([length, content, checksum]);
}
function maskPng(mask: Uint8Array, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels[offset] = 17;
      pixels[offset + 1] = 107;
      pixels[offset + 2] = 93;
      pixels[offset + 3] = 180;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
