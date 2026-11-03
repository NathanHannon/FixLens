// Opt-in, billable: <=3 calls/photo, <=2 photos. Local files and Meta only;
// no database/Spaces writes, no retries, no persisted reports or measurements.
import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { MetaModelsService } from '../dist/models/meta-models.service.js';
import { MetaDiagnosisProvider } from '../dist/diagnosis/meta-diagnosis.provider.js';
import { overlayPhoto } from '../dist/models/analysis-images.js';

const manifestPath = process.argv[2];
assert.ok(
  manifestPath,
  'Usage: node test/dynamic-segmentation.live.mjs <manifest.json> [output-directory]',
);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.ok(
  Array.isArray(manifest) && manifest.length > 0 && manifest.length <= 2,
);
const out = path.resolve(process.argv[3] ?? '.tmp/dynamic-segmentation');
const results = [];
let totalCalls = 0;
for (const sample of manifest) {
  assert.match(sample.name, /^[a-z0-9-]{1,40}$/);
  assert.ok(
    typeof sample.description === 'string' &&
      sample.description.trim().length > 0 &&
      sample.description.length <= 2000,
  );
  const { width, height, selection } = sample;
  assert.ok(
    Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0 &&
      width * height <= 16_000_000,
  );
  assert.ok(
    [selection.x1, selection.y1, selection.x2, selection.y2].every(
      Number.isInteger,
    ),
  );
  assert.ok(
    selection.x1 >= 0 &&
      selection.y1 >= 0 &&
      selection.x1 < selection.x2 &&
      selection.y1 < selection.y2 &&
      selection.x2 < width &&
      selection.y2 < height,
  );
  assert.ok(
    selection.points?.length > 0 &&
      selection.points.length <= 32 &&
      selection.points.every(
        (p) =>
          Number.isInteger(p.x) &&
          Number.isInteger(p.y) &&
          p.x >= selection.x1 &&
          p.x <= selection.x2 &&
          p.y >= selection.y1 &&
          p.y <= selection.y2,
      ),
  );
  const directory = path.join(out, sample.name);
  await mkdir(directory, { recursive: true });
  const source = await readFile(
    path.resolve(path.dirname(manifestPath), sample.photo),
  );
  const objects = new Map([['source', { bytes: source, type: 'image/jpeg' }]]);
  const models = new MetaModelsService(new ConfigService(process.env));
  let calls = 0;
  for (const name of [
    'target',
    'suggestConcept',
    'segment',
    'segmentConcept',
    'chooseMask',
  ]) {
    const original = models[name].bind(models);
    models[name] = async (...args) => {
      assert.ok(
        !['suggestConcept', 'chooseMask'].includes(name) &&
          ++calls <= 3 &&
          ++totalCalls <= 6,
        'Model request budget exceeded',
      );
      return original(...args);
    };
  }
  const storage = {
    readPhoto: async () => source,
    putAnalysisPhoto: async (key, bytes) =>
      objects.set(key, { bytes, type: 'image/jpeg' }),
    putMask: async (key, bytes) =>
      objects.set(key, { bytes, type: 'image/png' }),
    presignRead: async (key) => {
      const object = objects.get(key);
      assert.ok(object);
      return `data:${object.type};base64,${object.bytes.toString('base64')}`;
    },
    removeMask: async (key) => objects.delete(key),
  };
  try {
    const provider = new MetaDiagnosisProvider(models, storage);
    const preview = await provider.segment(
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: sample.name,
        category: 'other',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        photo_key: 'source',
        photo_width_px: width,
        photo_height_px: height,
      },
      selection,
      undefined,
      { text: sample.description },
    );
    await writeFile(path.join(directory, 'source.jpg'), source);
    if (preview.mask_key) {
      const mask = objects.get(preview.mask_key).bytes;
      await writeFile(path.join(directory, 'selected.png'), mask);
      await writeFile(
        path.join(directory, 'selected.jpg'),
        await overlayPhoto(source, mask, width, height),
      );
    }
    assert.equal(
      [...objects.keys()].filter((k) => k !== 'source').length,
      preview.mask_key ? 1 : 0,
      'Only selected mask may remain after temporary cleanup',
    );
    const row = {
      name: sample.name,
      status: preview.status,
      method: preview.segmentation_method ?? null,
      method_selection: preview.method_selection ?? null,
      reason: preview.reason,
      area_px: preview.area_px,
      quality: preview.quality,
      model_requests: calls,
      sam_attempts: preview.attempts,
    };
    results.push(row);
    console.log(JSON.stringify(row));
    await writeFile(
      path.join(out, 'results.json'),
      JSON.stringify({ model_requests: totalCalls, cases: results }, null, 2),
    );
  } finally {
    objects.clear();
  }
}
