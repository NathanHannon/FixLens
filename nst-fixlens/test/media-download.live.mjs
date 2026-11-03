import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { buildDataSourceOptions } from '../dist/database/data-source.js';
import { measureSam } from '../dist/models/sam-measurement.js';
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const options = buildDataSourceOptions();
const db = new Client({
  connectionString: options.url,
  ssl: options.ssl,
  connectionTimeoutMillis: 10_000,
});
const endpoint = process.env.SPACES_ENDPOINT;
const s3 = new S3Client({
  endpoint,
  region: new URL(endpoint).hostname.split('.')[0],
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
});
let problemId, photoKey, maskKey;
async function call(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `API request failed: HTTP ${response.status}`);
  return { body: await response.json(), headers: response.headers };
}
try {
  await db.connect();
  problemId = (
    await call('/problems', {
      title: 'Synthetic device-copy test',
      category: 'other',
    })
  ).body.id;
  const upload = (await call(`/problems/${problemId}/captures/upload-url`, {}))
    .body;
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
  assert.ok(put.ok);
  const capture = (
    await call(`/problems/${problemId}/captures`, {
      photo_key: photoKey,
      photo_width_px: 256,
      photo_height_px: 256,
      is_baseline: true,
    })
  ).body;
  const measured = measureSam(
    '<0f>0<|box;x1=0;y1=0;x2=255;y2=255;w=256;h=256|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>',
    256,
    256,
  );
  maskKey = `masks/${problemId}/${capture.id}-${randomUUID()}.png`;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.SPACES_BUCKET,
      Key: maskKey,
      ContentType: 'image/png',
      Body: measured.png,
    }),
  );
  await db.query(
    'INSERT INTO measurements (capture_id,mask_key,area_px,sam_version) VALUES ($1,$2,$3,$4)',
    [capture.id, maskKey, measured.area_px, 'mock-device-copy-test'],
  );
  const media = await call(
    `/problems/${problemId}/captures/${capture.id}/media`,
  );
  assert.equal(media.headers.get('cache-control'), 'no-store');
  assert.equal(media.body.expires_in, 300);
  for (const [file, expected] of [
    [media.body.photo, jpeg],
    [media.body.mask, measured.png],
  ]) {
    const downloaded = await fetch(file.url, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(downloaded.ok, `Download failed: HTTP ${downloaded.status}`);
    assert.equal(downloaded.headers.get('content-type'), file.content_type);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), expected);
  }
  console.log(
    JSON.stringify({
      private_media_downloads: 'passed',
      exact_jpeg_bytes: 'passed',
      exact_transparent_png_bytes: 'passed',
      model_calls: 0,
      data: 'synthetic fixtures only',
    }),
  );
} finally {
  try {
    if (problemId)
      await db.query('DELETE FROM problems WHERE id=$1 AND user_id=$2', [
        problemId,
        '00000000-0000-0000-0000-000000000001',
      ]);
    for (const key of [photoKey, maskKey].filter(Boolean))
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.SPACES_BUCKET,
          Key: key,
        }),
      );
    if (problemId)
      console.log('Synthetic download rows and objects cleaned up');
  } finally {
    await db.end();
    s3.destroy();
  }
}
