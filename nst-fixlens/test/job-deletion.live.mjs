// Opt-in: running API, configured database and Spaces. Creates only synthetic
// fixtures, makes no model calls, and removes only IDs created by this run.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { StorageService } from '../dist/storage/storage.service.js';
import { buildDataSourceOptions } from '../dist/database/data-source.js';
const db = new DataSource(buildDataSourceOptions());
const storage = new StorageService(new ConfigService(process.env));
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const created = [];
let stage = 'database connection';
const call = async (path, method = 'GET', body) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  assert.ok(response.ok, `API ${method} failed: ${response.status}`);
  return response.json();
};
try {
  await db.initialize();
  stage = 'API health';
  assert.equal((await call('/health')).job_deletion, 'scoped-cleanup-v1');
  const jpeg = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer();
  const png = await sharp(jpeg).png().toBuffer();
  for (const label of ['target', 'control']) {
    stage = `create synthetic ${label}`;
    const job = await call('/problems', 'POST', {
      title: `Deletion smoke ${label}`,
      category: 'crack',
    });
    created.push(job.id);
    stage = `upload synthetic ${label}`;
    const upload = await call(
      `/problems/${job.id}/captures/upload-url`,
      'POST',
      {},
    );
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: jpeg,
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok(put.ok, 'Synthetic photo upload failed');
    await call(`/problems/${job.id}/captures`, 'POST', {
      photo_key: upload.photo_key,
      photo_width_px: 64,
      photo_height_px: 64,
      is_baseline: true,
    });
    stage = `write synthetic ${label} masks`;
    await storage.putMask(`masks/${job.id}/${randomUUID()}.png`, png);
    await storage.putMask(
      `previews/${job.id}/${randomUUID()}-${randomUUID()}.png`,
      png,
    );
  }
  const [target, control] = created;
  stage = 'list target files';
  assert.deepEqual(
    await call(`/problems/${target}/storage`).then(
      ({ bytes: _bytes, ...counts }) => counts,
    ),
    { photos: 1, outlines: 1, previews: 1 },
  );
  stage = 'delete synthetic previews';
  assert.equal(
    (await call(`/problems/${target}/previews`, 'DELETE')).removed,
    1,
  );
  const files = await call(`/problems/${target}/storage`);
  assert.equal(files.photos, 1);
  assert.equal(files.outlines, 1);
  assert.equal(files.previews, 0);
  stage = 'delete synthetic job';
  assert.equal((await call(`/problems/${target}`, 'DELETE')).status, 'deleted');
  stage = 'verify deleted files';
  assert.equal((await storage.problemFiles(target)).bytes, 0);
  stage = 'verify durable deletion intent';
  assert.ok(
    await storage.deletion(target),
    'Durable final-sweep marker must remain',
  );
  for (const table of ['problems', 'captures', 'reports']) {
    const column = table === 'problems' ? 'id' : 'problem_id';
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`,
          [target],
        )
      )[0].count,
      0,
    );
  }
  const kept = await call(`/problems/${control}/storage`);
  assert.equal(kept.photos, 1);
  assert.equal(kept.outlines, 1);
  assert.equal(kept.previews, 1);
  console.log(
    'PASS: real Spaces listing, bulk deletion, preview-only cleanup, database cascade, durable intent, and control-job isolation',
  );
} catch (error) {
  console.error(
    'FAIL:',
    stage,
    error.name,
    error.code ?? '',
    error.cause?.code ?? '',
    String(error.message)
      .replace(/https?:\/\/\S+/g, '[URL]')
      .slice(0, 300),
  );
  process.exitCode = 1;
} finally {
  for (const id of created) {
    try {
      await storage.clearProblemFiles(id);
      await db.query('DELETE FROM problems WHERE id=$1 AND user_id=$2', [
        id,
        '00000000-0000-0000-0000-000000000001',
      ]);
      // This test owns every issued upload URL and will never use it again.
      await storage.finishDeletion(id);
    } catch (error) {
      console.error('Fixture cleanup failed:', id, error.name);
      process.exitCode = 1;
    }
  }
  if (db.isInitialized) await db.destroy();
}
