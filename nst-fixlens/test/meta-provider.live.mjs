import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import { MetaModelsService } from '../dist/models/meta-models.service.js';
import { MetaDiagnosisProvider } from '../dist/diagnosis/meta-diagnosis.provider.js';
import { formats, recordsOfKind } from '@meta-sam/parser';
import { SafetyGate } from '../dist/diagnosis/safety-gate.service.js';
import sharp from 'sharp';

function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([length, content, checksum]);
}
const size = Number(process.env.META_TEST_IMAGE_SIZE || 256);
assert.ok(Number.isInteger(size) && size >= 64 && size <= 2000);
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc(size * (1 + size * 3), 255);
for (let y = 0; y < size; y++) {
  const row = y * (1 + size * 3);
  pixels[row] = 0;
  if (y >= size / 4 && y < (size * 3) / 4)
    for (let x = size / 4; x < (size * 3) / 4; x++) {
      pixels[row + 1 + x * 3 + 1] = 0;
      pixels[row + 1 + x * 3 + 2] = 0;
    }
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
const jpeg = await sharp(png).jpeg({ quality: 95 }).toBuffer();
const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
const objects = new Map();
const storage = {
  readMask: async (key) => objects.get(key).bytes,
  readPhoto: async () => jpeg,
  putAnalysisPhoto: async (key, bytes) =>
    objects.set(key, { bytes, type: 'image/jpeg' }),
  presignRead: async (key) => {
    if (key === 'synthetic') return image;
    const object = objects.get(key);
    assert.ok(object);
    return `data:${object.type};base64,${object.bytes.toString('base64')}`;
  },
  putMask: async (key, bytes) => {
    objects.set(key, { bytes, type: 'image/png' });
  },
  confirmMask: async (from, to) => {
    assert.ok(objects.has(from));
    objects.set(to, objects.get(from));
  },
  removeMask: async (key) => {
    objects.delete(key);
  },
};
const models = new MetaModelsService(new ConfigService(process.env));
let geometry;
const actualSegment = models.segment.bind(models);
models.segment = async (...args) => {
  const result = await actualSegment(...args);
  const parser = formats.segmentation.image().createParser();
  parser.push(result.text);
  geometry = recordsOfKind(
    parser.finish({ status: 'completed' }).result.records,
    'mask',
  ).map((record) => ({
    raster: [record.mask.width, record.mask.height],
    bounds: [
      record.bounds.right - record.bounds.left,
      record.bounds.bottom - record.bounds.top,
    ],
  }));
  return result;
};
const provider = new MetaDiagnosisProvider(models, storage);
const problem = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Synthetic red square',
  category: 'other',
  location_note: 'Synthetic integration test',
};
const capture = {
  id: '22222222-2222-4222-8222-222222222222',
  photo_key: 'synthetic',
  photo_width_px: size,
  photo_height_px: size,
};
const preview = await provider.segment(
  problem,
  capture,
  {
    x1: size / 4 - 4,
    y1: size / 4 - 4,
    x2: (size * 3) / 4 + 3,
    y2: (size * 3) / 4 + 3,
    points: [{ x: size / 2, y: size / 2 }],
  },
  undefined,
  {
    text: 'The selected region is a synthetic red square. Localize the red square for this software test, not a real household diagnosis.',
  },
);
const result = await provider.diagnose(problem, capture, preview, {
  text: 'The selected region is a synthetic red square. No real household problem is reported.',
  hazards: [],
});

const mask = result.measurement
  ? objects.get(result.measurement.mask_key)
  : null;
if (result.measurement) {
  assert.ok(
    mask.bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  assert.ok(
    result.measurement.area_px > 0 && result.measurement.area_px <= size * size,
  );
  assert.equal(result.measurement.scale_mm_per_px, null);
  assert.equal(result.measurement.area_mm2, undefined);
} else {
  assert.match(
    result.report.confidence_note,
    /Photo-based assessment; measurements unavailable/,
  );
  assert.equal(
    [...objects.keys()].filter((k) => k.startsWith('masks/')).length,
    0,
  );
}
assert.equal(result.report.spark_version, 'muse-spark-1.3');
assert.ok(['sam-3.1', 'not-run'].includes(result.report.sam_version));
const gated = new SafetyGate().apply(result, ['gas']);
assert.equal(gated.report.safety_override, true);
assert.equal(gated.report.diy, null);
assert.equal(gated.report.urgency, 'pro_now');
console.log(
  JSON.stringify({
    result: 'passed',
    image_size: size,
    geometry,
    spark: result.report.spark_version,
    sam: result.report.sam_version,
    segmentation_status: preview.status,
    sam_attempts: preview.attempts,
    measured: result.measurement !== null,
    area_px: result.measurement?.area_px ?? null,
    perimeter_px: result.measurement?.perimeter_px ?? null,
    mask_png_bytes: mask?.bytes.length ?? 0,
    physical_scale: null,
    safety_gate: 'passed',
    data: 'synthetic JPEG only; no database or Spaces writes',
  }),
);
