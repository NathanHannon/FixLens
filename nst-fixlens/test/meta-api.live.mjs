import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { buildDataSourceOptions } from '../dist/database/data-source.js';

const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const manual = process.env.META_TEST_MANUAL_OUTLINE === 'true';
const options = buildDataSourceOptions();
const db = new Client({
  connectionString: options.url,
  ssl: options.ssl,
  connectionTimeoutMillis: 10_000,
});
const endpoint = process.env.SPACES_ENDPOINT;
const storage = new S3Client({
  endpoint,
  region: new URL(endpoint).hostname.split('.')[0],
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
let problemId, photoKey, maskKey, previewKey;
async function call(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path.endsWith('/segment') ? 210_000 : 120_000),
  });
  const result = await response.json();
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return result;
}
try {
  const health = await call('/health');
  assert.equal(
    health.diagnosis_provider,
    'meta',
    'Start the API with DIAGNOSIS_PROVIDER=meta',
  );
  await db.connect();
  const problem = await call('/problems', {
    title: 'Synthetic Meta integration check',
    category: 'other',
    location_note: 'Generated red-square fixture only',
  });
  problemId = problem.id;
  const upload = await call(`/problems/${problemId}/captures/upload-url`, {});
  photoKey = upload.photo_key;
  const jpeg = readFileSync(
    new URL('./fixtures/red-square.jpg', import.meta.url),
  );
  const put = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: jpeg,
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(put.ok, `Spaces PUT: HTTP ${put.status}`);
  const capture = await call(`/problems/${problemId}/captures`, {
    photo_key: photoKey,
    photo_width_px: 256,
    photo_height_px: 256,
    is_baseline: true,
  });
  const preview = await call(
    `/problems/${problemId}/${manual ? 'mask-edits' : 'segment'}`,
    {
      context:
        'Synthetic software test: the selected red square is the intended mark; no real household issue is reported.',
      capture_id: capture.id,
      ...(manual
        ? {
            base: 'blank',
            strokes: Array.from({ length: 8 }, (_, i) => ({
              mode: 'paint',
              radius: 8,
              points: [
                { x: 72, y: 72 + 16 * i },
                { x: 184, y: 72 + 16 * i },
              ],
            })),
          }
        : {}),
      selection: {
        x1: 60,
        y1: 60,
        x2: 195,
        y2: 195,
        points: [{ x: 128, y: 128 }],
      },
    },
  );
  previewKey = JSON.parse(
    Buffer.from(preview.token.split('.')[0], 'base64url').toString(),
  ).segmentation.mask_key;
  assert.ok(
    ['candidate', 'unavailable'].includes(preview.status),
    'Use the revised capture API',
  );
  if (preview.mask_url) {
    if (manual) {
      assert.equal(preview.outline_source, 'user_drawn');
      const head = await storage.send(
        new HeadObjectCommand({
          Bucket: process.env.SPACES_BUCKET,
          Key: previewKey,
        }),
      );
      assert.equal(head.Metadata?.['outline-source'], 'user_drawn');
    }
    const previewResponse = await fetch(preview.mask_url, {
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(previewResponse.ok);
    assert.equal(previewResponse.headers.get('content-type'), 'image/png');
    await previewResponse.body?.cancel();
  }
  const result = await call(`/problems/${problemId}/diagnose`, {
    capture_id: capture.id,
    segmentation_token: preview.token,
    context:
      'Synthetic integration test. The visible region of interest is the red square; no real household issue is reported.',
  });
  maskKey = result.measurement?.mask_key;
  if (manual) {
    assert.ok(
      result.measurement,
      'The synthetic manual outline should pass the final mask review',
    );
    assert.equal(result.measurement.area_px, preview.area_px);
    assert.match(result.report.confidence_note, /manually traced/);
  }
  assert.equal(result.report.spark_version, 'muse-spark-1.3');
  assert.ok(['sam-3.1', 'not-run'].includes(result.report.sam_version));
  if (result.measurement) {
    assert.ok(result.measurement.area_px > 0);
    assert.equal(result.measurement.scale_mm_per_px, null);
    const head = await storage.send(
      new HeadObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: maskKey,
      }),
    );
    assert.equal(head.ContentType, 'image/png');
    if (manual)
      assert.equal(
        head.Metadata?.['outline-source'],
        'user_drawn',
        'COPY preserves outline provenance',
      );
    const measurement = (
      await db.query('SELECT area_mm2 FROM measurements WHERE capture_id=$1', [
        capture.id,
      ])
    ).rows[0];
    assert.equal(measurement.area_mm2, null);
  } else {
    assert.match(
      result.report.confidence_note,
      /Photo-based assessment; measurements unavailable/,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM measurements WHERE capture_id=$1',
          [capture.id],
        )
      ).rows[0].count,
      0,
    );
  }
  const detail = await call(`/problems/${problemId}`);
  assert.equal(detail.latest_report.id, result.report.id);
  console.log(
    JSON.stringify({
      live_api: 'passed',
      private_photo_access: 'passed',
      strict_report: 'passed',
      decoded_area_px: result.measurement?.area_px ?? null,
      mask_stored: result.measurement ? 'passed' : 'withheld',
      user_selected_preview: 'passed',
      confirmed_mask_copy: result.measurement ? 'passed' : 'withheld',
      segmentation_status: preview.status,
      database_persistence: 'passed',
      physical_scale: null,
      data: 'synthetic JPEG only',
    }),
  );
} finally {
  try {
    // Discover only this test's mask if a committed HTTP response was lost.
    if (problemId) {
      if (!maskKey) {
        const rows = await db.query(
          'SELECT m.mask_key FROM measurements m JOIN captures c ON c.id=m.capture_id WHERE c.problem_id=$1',
          [problemId],
        );
        maskKey = rows.rows[0]?.mask_key;
      }
      await db.query('DELETE FROM problems WHERE id=$1 AND user_id=$2', [
        problemId,
        '00000000-0000-0000-0000-000000000001',
      ]);
    }
    for (const key of [photoKey, previewKey, maskKey].filter(Boolean))
      await storage.send(
        new DeleteObjectCommand({
          Bucket: process.env.SPACES_BUCKET,
          Key: key,
        }),
      );
    if (problemId) console.log('Synthetic test rows and objects cleaned up');
  } finally {
    await db.end();
    storage.destroy();
  }
}
