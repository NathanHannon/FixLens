import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { BadGatewayException, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  entities,
  Measurement,
  Report,
  Capture,
  Problem,
  User,
} from '../dist/database/entities.js';
import { Initial1791900000000 } from '../dist/database/migrations/1791900000000-Initial.js';
import { Calibration1793059200000 } from '../dist/database/migrations/1793059200000-Calibration.js';
import { StorageService } from '../dist/storage/storage.service.js';
import {
  DIAGNOSIS_PROVIDER,
  MockDiagnosisProvider,
} from '../dist/diagnosis/diagnosis.provider.js';
import { JsonErrorFilter } from '../dist/common/errors.js';
import { ConfigService } from '@nestjs/config';
import { SegmentationReceipt } from '../dist/diagnosis/segmentation-receipt.js';
import { MetaModelsService } from '../dist/models/meta-models.service.js';
import { ProblemDeletionService } from '../dist/problems/problem-deletion.service.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'TEST_DATABASE_URL must point to a dedicated empty PostgreSQL 17 test database',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// A developer's managed-DB .env must not force its TLS CA onto the local test DB.
process.env.DB_SSL = 'false';
process.env.DATABASE_SSL = 'false';
process.env.DATABASE_CERT = '';
process.env.DB_SSL_CA = '';
Object.assign(process.env, {
  SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  SPACES_KEY: 'test',
  SPACES_SECRET: 'test',
  SPACES_BUCKET: 'test',
  SEGMENTATION_SECRET: 'integration-secret-for-preview-confirmation-32',
});
const db = new DataSource({
  type: 'postgres',
  url: process.env.TEST_DATABASE_URL,
  entities,
  migrations: [Initial1791900000000, Calibration1793059200000],
  synchronize: false,
  uuidExtension: 'pgcrypto',
});
let app;
const uploads = new Set();
const signedMediaReads = [];
const deletionIntents = new Map();
const cleanupScopes = [];
let failCleanup = false;
let failProvider = false;
let invalidReport = false;
const provider = new MockDiagnosisProvider();
let problemId, captureId;
before(async () => {
  await db.initialize();
  assert.equal(
    await db
      .query("SELECT to_regclass('public.problems') AS name")
      .then((rows) => rows[0].name),
    null,
    'Use an empty dedicated test database',
  );
  await db.runMigrations();
  const { AppModule } = await import('../dist/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue({
      presign: async () => ({
        url: 'https://test.invalid',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        expires_in: 300,
      }),
      exists: async (key) => uploads.has(key),
      deletion: async (id) => deletionIntents.get(id) ?? null,
      beginDeletion: async (intent) =>
        deletionIntents.set(intent.problem_id, { ...intent }),
      pendingDeletions: async () => [...deletionIntents.values()],
      finishDeletion: async (id) => deletionIntents.delete(id),
      problemFiles: async () => ({
        photos: 1,
        outlines: 0,
        previews: 2,
        bytes: 100,
      }),
      clearProblemFiles: async (id, previewsOnly = false) => {
        cleanupScopes.push({ id, previewsOnly });
        if (failCleanup) throw new Error('Synthetic bucket failure');
        if (!previewsOnly)
          for (const key of uploads)
            if (key.startsWith('captures/' + id + '/')) uploads.delete(key);
        return 2;
      },
      presignRead: async (key) => {
        signedMediaReads.push(key);
        return `https://test.invalid/${key}`;
      },
    })
    .overrideProvider(DIAGNOSIS_PROVIDER)
    .useValue({
      segment: (...args) => provider.segment(...args),
      diagnose: async (...args) => {
        if (failProvider) throw new Error('simulated provider failure');
        const result = await provider.diagnose(...args);
        if (invalidReport) result.report.confidence = '1.50';
        return result;
      },
    })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new JsonErrorFilter());
  await app.init();
});
after(async () => {
  if (app) await app.close();
  if (db.isInitialized) {
    // Only revert migrations this test actually applied.
    if (app) {
      await db.undoLastMigration();
      await db.undoLastMigration();
    }
    await db.destroy();
  }
});
const api = () => request(app.getHttpServer());
const receipts = new SegmentationReceipt(new ConfigService(process.env));
function diagnosisBody(body) {
  return {
    ...body,
    segmentation_token: receipts.issue(
      {
        user_id: '00000000-0000-0000-0000-000000000001',
        problem_id: problemId,
        capture_id: body.capture_id,
      },
      {
        selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
        mask_key: null,
        area_px: 1200,
        perimeter_px: 180,
        sam_version: 'mock-sam-3.1',
      },
    ).token,
  };
}
test('database seed, generated column, and view metadata match the schema', async () => {
  const [user] = await db.query(
    "SELECT * FROM users WHERE id='00000000-0000-0000-0000-000000000001'",
  );
  assert.equal(user.clerk_id, 'demo');
  const [generated] = await db.query(
    "SELECT is_generated FROM information_schema.columns WHERE table_name='measurements' AND column_name='area_mm2'",
  );
  assert.equal(generated.is_generated, 'ALWAYS');
  const diff = await db.driver.createSchemaBuilder().log();
  assert.deepEqual(
    diff.upQueries.map((q) => q.query),
    [],
    'No entity drift after reviewed migration',
  );
});
test('validates body and UUID params with consistent errors', async () => {
  const bad = await api()
    .post('/problems')
    .send({ title: '', surprise: true })
    .expect(400);
  assert.equal(bad.body.error.status, 400);
  assert.ok(Array.isArray(bad.body.error.message));
  await api().get('/problems/not-a-uuid').expect(400);
  await api()
    .post('/problems')
    .send({ title: 'Test', category: null })
    .expect(400);
});
test('creates, lists, and reads a demo-owned problem', async () => {
  const created = await api()
    .post('/problems')
    .send({ title: 'Basement crack', category: 'crack' })
    .expect(201);
  problemId = created.body.id;
  assert.equal(created.body.user_id, '00000000-0000-0000-0000-000000000001');
  assert.ok(
    (await api().get('/problems').expect(200)).body.some(
      (p) => p.id === problemId,
    ),
  );
  const detail = await api().get(`/problems/${problemId}`).expect(200);
  assert.equal(detail.body.latest_report, null);
  assert.equal(detail.body.delta_summary, null);
});
test('hides problems owned by another user', async () => {
  const otherId = randomUUID();
  await db.query('INSERT INTO users (id, clerk_id) VALUES ($1,$2)', [
    otherId,
    otherId,
  ]);
  const [other] = await db.query(
    "INSERT INTO problems (user_id,title) VALUES ($1,'Private') RETURNING id",
    [otherId],
  );
  await api().get(`/problems/${other.id}`).expect(404);
  await api().post(`/problems/${other.id}/captures/upload-url`).expect(404);
  await api()
    .post(`/problems/${other.id}/diagnose`)
    .send(diagnosisBody({ capture_id: randomUUID() }))
    .expect(404);
});
test('presigns, verifies upload, and rejects wrong keys and duplicate baselines', async () => {
  const signed = await api()
    .post(`/problems/${problemId}/captures/upload-url`)
    .expect(201);
  captureId = signed.body.capture_id;
  assert.equal(signed.body.photo_key, `captures/${problemId}/${captureId}.jpg`);
  const dto = {
    photo_key: signed.body.photo_key,
    is_baseline: true,
    photo_width_px: 1000,
    photo_height_px: 800,
    taken_at: '2026-10-01T12:00:00Z',
  };
  await api().post(`/problems/${problemId}/captures`).send(dto).expect(400);
  uploads.add(dto.photo_key);
  await api()
    .post(`/problems/${problemId}/captures`)
    .send({ ...dto, alignment_score: 0.9 })
    .expect(400);
  const created = await api()
    .post(`/problems/${problemId}/captures`)
    .send(dto)
    .expect(201);
  assert.equal(created.body.id, captureId);
  const repeated = await api()
    .post(`/problems/${problemId}/captures`)
    .send(dto)
    .expect(201);
  assert.equal(repeated.body.id, captureId);
  const second = `captures/${problemId}/${randomUUID()}.jpg`;
  uploads.add(second);
  await api()
    .post(`/problems/${problemId}/captures`)
    .send({ ...dto, photo_key: second })
    .expect(409);
  await api()
    .post(`/problems/${problemId}/captures`)
    .send({ photo_key: `captures/${randomUUID()}/${randomUUID()}.jpg` })
    .expect(400);
});
test('diagnosis is atomic, safety-gated, and repeated diagnosis conflicts', async () => {
  const result = await api()
    .post(`/problems/${problemId}/diagnose`)
    .send(diagnosisBody({ capture_id: captureId, hazards: ['gas'] }))
    .expect(201);
  assert.equal(result.body.measurement.scale_mm_per_px, null);
  assert.equal(result.body.report.safety_override, true);
  assert.equal(result.body.report.urgency, 'pro_now');
  assert.equal(result.body.report.diy, null);
  await api()
    .post(`/problems/${problemId}/diagnose`)
    .send(diagnosisBody({ capture_id: captureId }))
    .expect(409);
  const detail = await api().get(`/problems/${problemId}`).expect(200);
  assert.equal(detail.body.current_urgency, 'pro_now');
  assert.equal(detail.body.latest_report.id, result.body.report.id);
});
test('provider failures roll back and concurrent diagnosis only writes once', async () => {
  const capture = await db.getRepository(Capture).save({
    problem_id: problemId,
    photo_key: 'test.jpg',
    taken_at: new Date('2026-10-05T12:00:00Z'),
  });
  failProvider = true;
  await api()
    .post(`/problems/${problemId}/diagnose`)
    .send(diagnosisBody({ capture_id: capture.id }))
    .expect(500);
  failProvider = false;
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    0,
  );
  assert.equal(
    await db.getRepository(Report).countBy({ capture_id: capture.id }),
    0,
  );
  const responses = await Promise.all([
    api()
      .post(`/problems/${problemId}/diagnose`)
      .send(diagnosisBody({ capture_id: capture.id })),
    api()
      .post(`/problems/${problemId}/diagnose`)
      .send(diagnosisBody({ capture_id: capture.id })),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    1,
  );
  const deltas = await api().get(`/problems/${problemId}/deltas`).expect(200);
  assert.equal(deltas.body[0].growth, 'unknown');
  assert.equal(deltas.body[0].area_change_pct, null);
});
test('a report insert failure rolls back the already-inserted measurement', async () => {
  const capture = await db.getRepository(Capture).save({
    problem_id: problemId,
    photo_key: 'rollback.jpg',
    taken_at: new Date('2026-10-06T12:00:00Z'),
  });
  invalidReport = true;
  await api()
    .post(`/problems/${problemId}/diagnose`)
    .send(diagnosisBody({ capture_id: capture.id }))
    .expect(500);
  invalidReport = false;
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    0,
  );
  assert.equal(
    await db.getRepository(Report).countBy({ capture_id: capture.id }),
    0,
  );
});
test('scaled deltas use generated mm area and report growth', async () => {
  const captures = await db
    .getRepository(Capture)
    .find({ where: { problem_id: problemId }, order: { taken_at: 'ASC' } });
  await db
    .getRepository(Measurement)
    .update(
      { capture_id: captures[0].id },
      { area_px: 100, scale_mm_per_px: 2, width_mm: 10 },
    );
  await db
    .getRepository(Measurement)
    .update(
      { capture_id: captures[1].id },
      { area_px: 125, scale_mm_per_px: 2, width_mm: 12 },
    );
  const deltas = await api().get(`/problems/${problemId}/deltas`).expect(200);
  assert.equal(deltas.body[0].growth, 'growing');
  assert.equal(deltas.body[0].area_change_pct, 25);
  assert.equal(deltas.body[0].width_change_mm, 2);
  assert.equal(Number(deltas.body[0].days_between), 4);
});

test('media downloads sign only owned capture originals and stored masks, with no-store responses', async () => {
  const before = signedMediaReads.length;
  await api()
    .get(`/problems/${problemId}/captures/not-a-uuid/media`)
    .expect(400);
  await api()
    .get(`/problems/${problemId}/captures/${randomUUID()}/media`)
    .expect(404);
  const foreignUser = randomUUID(),
    foreignProblem = randomUUID(),
    foreignCapture = randomUUID();
  await db.query('INSERT INTO users (id,clerk_id) VALUES ($1,$2)', [
    foreignUser,
    foreignUser,
  ]);
  await db.query('INSERT INTO problems (id,user_id,title) VALUES ($1,$2,$3)', [
    foreignProblem,
    foreignUser,
    'Other home',
  ]);
  await db.getRepository(Capture).save({
    id: foreignCapture,
    problem_id: foreignProblem,
    photo_key: 'private-other.jpg',
  });
  await api()
    .get(`/problems/${foreignProblem}/captures/${foreignCapture}/media`)
    .expect(404);
  await api()
    .get(`/problems/${problemId}/captures/${foreignCapture}/media`)
    .expect(404);
  assert.equal(
    signedMediaReads.length,
    before,
    'Unauthorized requests cannot sign any object',
  );
  const original = (
    await api()
      .get(`/problems/${problemId}/captures/${captureId}/media`)
      .expect('Cache-Control', 'no-store')
      .expect(200)
  ).body;
  assert.equal(original.capture_id, captureId);
  assert.equal(original.expires_in, 300);
  assert.equal(original.mask, null);
  assert.equal(original.photo.filename, `fixlens-${captureId}-photo.jpg`);
  assert.equal(original.photo.content_type, 'image/jpeg');
  const key = `masks/${problemId}/${captureId}-${randomUUID()}.png`;
  await db
    .getRepository(Measurement)
    .update({ capture_id: captureId }, { mask_key: key });
  const withMask = (
    await api()
      .get(`/problems/${problemId}/captures/${captureId}/media`)
      .expect(200)
  ).body;
  assert.equal(withMask.mask.url, `https://test.invalid/${key}`);
  assert.equal(withMask.mask.filename, `fixlens-${captureId}-mask.png`);
  assert.equal(withMask.mask.content_type, 'image/png');
});

test('SAM preview confirmation persists the exact mask and rejects invalid selections and receipts', async () => {
  const { AppModule } = await import('../dist/app.module.js');
  const masks = new Map();
  const maskSources = new Map();
  let failFinal = false;
  let failReport = false;
  let rejectMask = false;
  let unclearTarget = false;
  let calls = 0;
  const modelResult = {
    verdict: 'Selected crack',
    category: 'crack',
    likely_cause: null,
    urgency: 'monitor',
    confidence: 0.82,
    confidence_note: 'Photo only',
    diy: null,
    pro: null,
    red_flags: [],
    recheck_days: 14,
    hazards: [],
  };
  const mask =
    '<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>';
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService({ ...process.env, DIAGNOSIS_PROVIDER: 'meta' }))
    .overrideProvider(StorageService)
    .useValue({
      readPhoto: async () =>
        sharp({
          create: { width: 5, height: 5, channels: 3, background: '#ddd' },
        })
          .jpeg()
          .toBuffer(),
      putAnalysisPhoto: async (key, bytes) => masks.set(key, bytes),
      presignRead: async (key) => `https://private.invalid/${key}`,
      putMask: async (key, png, source = 'sam') => {
        masks.set(key, png);
        maskSources.set(key, source);
      },
      readMask: async (key) => masks.get(key),
      confirmMask: async (from, to) => {
        assert.ok(masks.has(from));
        masks.set(to, masks.get(from));
        maskSources.set(to, maskSources.get(from));
      },
      removeMask: async (key) => masks.delete(key),
    })
    .overrideProvider(MetaModelsService)
    .useValue({
      samModel: 'sam-3.1',
      suggestConcept: async () => ({
        concept: null,
        reason: 'No text concept in this fixture',
        model: 'muse-concept',
      }),
      chooseMask: async () => ({
        winner: 'a',
        reason: 'Follows visible damage',
        reviews: {
          a: { status: 'matches', reason: 'Follows mark' },
          b: { status: 'unavailable', reason: 'No text candidate' },
        },
        hazards: [],
        model: 'muse-selector',
      }),
      target: async () => ({
        model: 'muse-target',
        plan: unclearTarget
          ? {
              status: 'unclear',
              description: null,
              box: null,
              foreground: [],
              background: [],
              reason: 'The mark is too faint to locate',
              hazards: ['gas'],
            }
          : {
              status: 'clear',
              description: 'Small crack',
              concept: null,
              preferred_method: 'spatial',
              routing_reason: 'Visible localized crack',
              box: { x1: 0, y1: 0, x2: 4, y2: 4 },
              foreground: [{ x: 0, y: 0 }],
              background: [{ x: 2, y: 0 }],
              reason: 'Visible mark',
              hazards: [],
            },
      }),
      segment: async (_url, selection, w, h) => {
        calls++;
        assert.deepEqual(JSON.parse(JSON.stringify(selection)), {
          x1: 0,
          y1: 0,
          x2: 4,
          y2: 4,
          points: [{ x: 0, y: 0 }],
        });
        assert.equal(w, 5);
        assert.equal(h, 5);
        return { text: mask, model: 'sam-3.1' };
      },
      refine: async (_url, maskUrl, context, evidence) => {
        if (maskUrl)
          assert.ok(masks.has(maskUrl.replace('https://private.invalid/', '')));
        if (!maskUrl || evidence.outline_source === 'sam')
          assert.equal(evidence.area_px, maskUrl ? 10 : null);
        else assert.ok(evidence.area_px > 0);
        assert.equal(context.observations, 'new crack');
        if (failFinal) throw new BadGatewayException('Assessment failed');
        return {
          diagnosis: { ...modelResult, confidence: failReport ? 1.5 : 0.82 },
          model: 'muse-spark-1.3',
          mask_review: {
            status: maskUrl
              ? rejectMask
                ? 'mismatch'
                : 'matches'
              : 'unavailable',
            reason: rejectMask
              ? 'Includes unaffected ceiling'
              : 'Visible mark follows outline',
          },
        };
      },
    })
    .compile();
  const metaApp = module.createNestApplication();
  metaApp.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  metaApp.useGlobalFilters(new JsonErrorFilter());
  await metaApp.init();
  const client = request(metaApp.getHttpServer());
  try {
    const id = (
      await api()
        .post('/problems')
        .send({ title: 'Selected crack' })
        .expect(201)
    ).body.id;
    const capture = await db.getRepository(Capture).save({
      problem_id: id,
      photo_key: 'test.jpg',
      photo_width_px: 5,
      photo_height_px: 5,
    });
    for (const selection of [
      null,
      [],
      { x1: 0, y1: 0, x2: 4, y2: 4, points: [] },
      { x1: 0, y1: 0, x2: 4, y2: 4, points: [{ x: 5, y: 2 }] },
      { x1: 0, y1: 0, x2: 4, y2: 4, points: [{ x: 1.5, y: 2 }] },
      {
        x1: 0,
        y1: 0,
        x2: 4,
        y2: 4,
        points: Array.from({ length: 33 }, () => ({ x: 1, y: 2 })),
      },
      { x1: -1, y1: 0, x2: 4, y2: 4 },
      { x1: 0.5, y1: 0, x2: 4, y2: 4 },
      { x1: 4, y1: 0, x2: 0, y2: 4 },
      { x1: 0, y1: 0, x2: 5, y2: 4 },
      { x1: 0, y1: 0, x2: 4, y2: 4, injected: true },
    ])
      await client
        .post(`/problems/${id}/segment`)
        .send({ capture_id: capture.id, selection })
        .expect(400);
    assert.equal(calls, 0);
    const preview = (
      await client
        .post(`/problems/${id}/segment`)
        .send({
          capture_id: capture.id,
          selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
        })
        .expect(201)
    ).body;
    assert.ok(preview.mask_url.includes('/previews/'));
    assert.equal(
      preview.outline_url,
      preview.mask_url.replace(/\.png$/, '.outline.png'),
    );
    assert.equal(preview.area_px, 10);
    assert.equal(preview.segmentation_method, 'spatial');
    assert.equal(preview.method_selection.model, 'muse-target');
    assert.equal(preview.method_selection.fallback, false);
    assert.equal(
      await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
      0,
    );
    assert.equal(
      await db.getRepository(Report).countBy({ capture_id: capture.id }),
      0,
    );
    const body = {
      capture_id: capture.id,
      segmentation_token: preview.token,
      context: 'new crack',
      hazards: ['gas'],
    };
    await client
      .post(`/problems/${id}/diagnose`)
      .send({ ...body, segmentation_token: 'tampered' })
      .expect(400);
    await client
      .post(`/problems/${id}/diagnose`)
      .send({ capture_id: capture.id })
      .expect(400);
    failFinal = true;
    await client.post(`/problems/${id}/diagnose`).send(body).expect(502);
    assert.equal(masks.size, 1, 'Retain the preview for retry');
    assert.equal(
      await db.getRepository(Report).countBy({ capture_id: capture.id }),
      0,
    );
    failFinal = false;
    failReport = true;
    await client.post(`/problems/${id}/diagnose`).send(body).expect(500);
    assert.equal(masks.size, 1, 'Remove only the uncommitted permanent mask');
    assert.equal(
      await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
      0,
    );
    failReport = false;
    const result = (
      await client.post(`/problems/${id}/diagnose`).send(body).expect(201)
    ).body;
    assert.equal(
      calls,
      1,
      'Retries use the confirmed preview without rerunning SAM',
    );
    assert.equal(result.measurement.area_px, 10);
    assert.equal(result.measurement.perimeter_px, 28);
    assert.ok(result.measurement.mask_key.startsWith('masks/'));
    assert.equal(result.report.verdict, 'Selected crack');
    assert.equal(result.report.safety_override, true);
    assert.equal(result.report.diy, null);
    assert.equal(result.report.spark_version, 'muse-spark-1.3');
    assert.equal(
      (await api().get(`/problems/${id}`).expect(200)).body.category,
      'crack',
    );
    assert.equal(
      (
        await db
          .getRepository(Measurement)
          .findOneByOrFail({ capture_id: capture.id })
      ).area_mm2,
      null,
    );
    await client.post(`/problems/${id}/diagnose`).send(body).expect(409);
    rejectMask = true;
    const second = await db.getRepository(Capture).save({
      problem_id: id,
      photo_key: 'second.jpg',
      photo_width_px: 5,
      photo_height_px: 5,
    });
    const secondPreview = (
      await client
        .post(`/problems/${id}/segment`)
        .send({
          capture_id: second.id,
          selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
          context: 'new crack',
        })
        .expect(201)
    ).body;
    const secondBody = {
      capture_id: second.id,
      segmentation_token: secondPreview.token,
      context: 'new crack',
    };
    failReport = true;
    await client.post(`/problems/${id}/diagnose`).send(secondBody).expect(500);
    assert.equal(
      await db.getRepository(Measurement).countBy({ capture_id: second.id }),
      0,
    );
    assert.equal(
      await db.getRepository(Report).countBy({ capture_id: second.id }),
      0,
    );
    failReport = false;
    const photoOnly = (
      await client.post(`/problems/${id}/diagnose`).send(secondBody).expect(201)
    ).body;
    assert.equal(photoOnly.measurement, null);
    assert.ok(
      masks.has(
        receipts.verify(secondPreview.token, {
          user_id: '00000000-0000-0000-0000-000000000001',
          problem_id: id,
          capture_id: second.id,
        }).mask_key,
      ),
      'Retain a rejected outline under the temporary-preview lifecycle for inspection',
    );
    assert.match(
      photoOnly.report.confidence_note,
      /Photo-based assessment; measurements unavailable/,
    );
    assert.equal(
      await db.getRepository(Measurement).countBy({ capture_id: second.id }),
      0,
    );
    assert.equal(
      (await api().get(`/problems/${id}`).expect(200)).body.latest_measurement,
      null,
    );
    await client.post(`/problems/${id}/diagnose`).send(secondBody).expect(409);
    unclearTarget = true;
    const third = await db.getRepository(Capture).save({
      problem_id: id,
      photo_key: 'third.jpg',
      photo_width_px: 5,
      photo_height_px: 5,
    });
    const before = calls;
    const noOutline = (
      await client
        .post(`/problems/${id}/segment`)
        .send({
          capture_id: third.id,
          selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
        })
        .expect(201)
    ).body;
    assert.equal(calls, before);
    assert.equal(noOutline.status, 'unavailable');
    assert.equal(noOutline.area_px, null);
    const noMaskReport = (
      await client
        .post(`/problems/${id}/diagnose`)
        .send({
          capture_id: third.id,
          segmentation_token: noOutline.token,
          context: 'new crack',
          hazards: [],
        })
        .expect(201)
    ).body;
    assert.equal(noMaskReport.measurement, null);
    assert.equal(noMaskReport.report.safety_override, true);
    // Manual tracing does not need a successful Muse target or any SAM call.
    rejectMask = false;
    const manual = await db.getRepository(Capture).save({
      problem_id: id,
      photo_key: 'manual.jpg',
      photo_width_px: 5,
      photo_height_px: 5,
    });
    const editBody = {
      capture_id: manual.id,
      base: 'blank',
      selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
      strokes: [{ mode: 'paint', radius: 1, points: [{ x: 2, y: 2 }] }],
      hazards: ['gas'],
    };
    for (const invalid of [
      { ...editBody, mask_key: 'arbitrary.png' },
      { ...editBody, base: 'preview' },
      { ...editBody, segmentation_token: 'forged' },
      {
        ...editBody,
        strokes: [{ mode: 'erase', radius: 1, points: [{ x: 2, y: 2 }] }],
      },
      {
        ...editBody,
        strokes: [{ mode: 'paint', radius: 1, points: [{ x: 6, y: 2 }] }],
      },
      {
        ...editBody,
        strokes: [{ mode: 'paint', radius: 0, points: [{ x: 2, y: 2 }] }],
      },
    ])
      await client.post(`/problems/${id}/mask-edits`).send(invalid).expect(400);
    const manualPreview = (
      await client.post(`/problems/${id}/mask-edits`).send(editBody).expect(201)
    ).body;
    assert.equal(manualPreview.outline_source, 'user_drawn');
    assert.equal(manualPreview.sam_version, 'not-run');
    assert.equal(calls, before);
    assert.ok(manualPreview.area_px > 0);
    const manualResult = (
      await client
        .post(`/problems/${id}/diagnose`)
        .send({
          capture_id: manual.id,
          segmentation_token: manualPreview.token,
          context: 'new crack',
          hazards: [],
        })
        .expect(201)
    ).body;
    assert.equal(manualResult.measurement.area_px, manualPreview.area_px);
    assert.match(manualResult.report.confidence_note, /manually traced/);
    assert.equal(
      manualResult.report.safety_override,
      true,
      'Keep hazards across edits even when omitted from the final request',
    );
    assert.equal(
      maskSources.get(manualResult.measurement.mask_key),
      'user_drawn',
    );
    assert.equal(
      (
        await db
          .getRepository(Measurement)
          .findOneByOrFail({ capture_id: manual.id })
      ).area_px,
      manualPreview.area_px,
    );
    await client.post(`/problems/${id}/mask-edits`).send(editBody).expect(409);
    unclearTarget = false;
    const corrected = await db.getRepository(Capture).save({
      problem_id: id,
      photo_key: 'corrected.jpg',
      photo_width_px: 5,
      photo_height_px: 5,
    });
    const automatic = (
      await client
        .post(`/problems/${id}/segment`)
        .send({ capture_id: corrected.id, selection: editBody.selection })
        .expect(201)
    ).body;
    const correctedPreview = (
      await client
        .post(`/problems/${id}/mask-edits`)
        .send({
          ...editBody,
          capture_id: corrected.id,
          base: 'preview',
          segmentation_token: automatic.token,
          strokes: [{ mode: 'erase', radius: 1.2, points: [{ x: 0, y: 0 }] }],
        })
        .expect(201)
    ).body;
    assert.equal(correctedPreview.outline_source, 'user_corrected');
    assert.equal(correctedPreview.segmentation_method, null);
    assert.equal(correctedPreview.method_selection, null);
    assert.ok(correctedPreview.area_px < automatic.area_px);
    const callsAfterPreview = calls;
    const correctedResult = (
      await client
        .post(`/problems/${id}/diagnose`)
        .send({
          capture_id: corrected.id,
          segmentation_token: correctedPreview.token,
          context: 'new crack',
        })
        .expect(201)
    ).body;
    assert.equal(correctedResult.measurement.area_px, correctedPreview.area_px);
    assert.match(correctedResult.report.confidence_note, /manually corrected/);
    assert.equal(
      maskSources.get(correctedResult.measurement.mask_key),
      'user_corrected',
    );
    assert.equal(calls, callsAfterPreview);
  } finally {
    await metaApp.close();
  }
});

test('reference calibration is validated before inference, signed, saved atomically, and compared in physical area', async () => {
  const { AppModule } = await import('../dist/app.module.js');
  let calls = 0;
  const masks = new Map();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService({ ...process.env, DIAGNOSIS_PROVIDER: 'meta' }))
    .overrideProvider(StorageService)
    .useValue({
      readPhoto: async () =>
        sharp({
          create: { width: 100, height: 100, channels: 3, background: '#ddd' },
        })
          .jpeg()
          .toBuffer(),
      putAnalysisPhoto: async (key, bytes) => masks.set(key, bytes),
      presignRead: async (key) => `https://private.invalid/${key}`,
      putMask: async (key, bytes) => masks.set(key, bytes),
      readMask: async (key) => masks.get(key),
      confirmMask: async (from, to) => masks.set(to, masks.get(from)),
      removeMask: async (key) => masks.delete(key),
    })
    .overrideProvider(MetaModelsService)
    .useValue({
      samModel: 'sam-3.1',
      suggestConcept: async () => ({
        concept: null,
        reason: 'No text concept in this fixture',
        model: 'muse-concept',
      }),
      chooseMask: async () => ({
        winner: 'a',
        reason: 'Follows visible damage',
        reviews: {
          a: { status: 'matches', reason: 'Follows mark' },
          b: { status: 'unavailable', reason: 'No text candidate' },
        },
        hazards: [],
        model: 'muse-selector',
      }),
      target: async () => ({
        model: 'muse-target',
        plan: {
          status: 'clear',
          description: 'Surface stain',
          concept: null,
          preferred_method: 'spatial',
          routing_reason: 'Visible localized stain',
          box: { x1: 0, y1: 0, x2: 99, y2: 99 },
          foreground: [{ x: 10, y: 10 }],
          background: [{ x: 25, y: 10 }],
          reason: 'Visible stain',
          hazards: [],
        },
      }),
      segment: async () => {
        calls++;
        return {
          text: '<0f>0<|box;x1=0;y1=0;x2=99;y2=99;w=100;h=100|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>',
          model: 'sam-3.1',
        };
      },
      refine: async (_a, _b, _c, evidence) => {
        assert.ok(evidence.calibrated_area_mm2 > 0);
        return {
          model: 'muse-test',
          mask_review: { status: 'matches', reason: 'Follows the stain' },
          diagnosis: {
            verdict: 'Surface stain',
            category: 'water_stain',
            likely_cause: null,
            urgency: 'monitor',
            confidence: 0.8,
            confidence_note: 'Approximate area',
            diy: null,
            pro: null,
            red_flags: [],
            recheck_days: 14,
            hazards: [],
          },
        };
      },
    })
    .compile();
  const calibrationApp = module.createNestApplication();
  calibrationApp.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  calibrationApp.useGlobalFilters(new JsonErrorFilter());
  await calibrationApp.init();
  const client = request(calibrationApp.getHttpServer());
  const id = (
    await api()
      .post('/problems')
      .send({ title: 'Calibrated surface' })
      .expect(201)
  ).body.id;
  const calibration = {
    method: 'known_rectangle',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    width_mm: 100,
    height_mm: 100,
  };
  const selection = {
    x1: 0,
    y1: 0,
    x2: 99,
    y2: 99,
    points: [{ x: 10, y: 10 }],
  };
  try {
    for (let i = 0; i < 2; i++) {
      const capture = await db.getRepository(Capture).save({
        problem_id: id,
        photo_key: `test-${i}.jpg`,
        photo_width_px: 100,
        photo_height_px: 100,
        taken_at: new Date(`2026-10-${20 + i}T12:00:00Z`),
      });
      const body = {
        capture_id: capture.id,
        selection,
        calibration: { ...calibration, width_mm: 100 + i * 20 },
      };
      if (i === 0) {
        for (const invalid of [
          null,
          [],
          { ...calibration, points: [] },
          { ...calibration, width_mm: 0 },
          { ...calibration, method: 'guessed' },
          { ...calibration, quality: 'perfect' },
          {
            ...calibration,
            points: [
              calibration.points[0],
              calibration.points[2],
              calibration.points[1],
              calibration.points[3],
            ],
          },
        ]) {
          // null explicitly means optional/no calibration; malformed supplied objects fail.
          if (invalid === null) continue;
          await client
            .post(`/problems/${id}/segment`)
            .send({ ...body, calibration: invalid })
            .expect(400);
        }
        assert.equal(calls, 0);
      }
      const preview = (
        await client.post(`/problems/${id}/segment`).send(body).expect(201)
      ).body;
      assert.ok(preview.token.length <= 8192);
      assert.equal(
        preview.calibrated_area_mm2,
        null,
        'Only show physical area after the final mask review',
      );
      assert.equal(
        await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
        0,
      );
      const saved = (
        await client
          .post(`/problems/${id}/diagnose`)
          .send({ capture_id: capture.id, segmentation_token: preview.token })
          .expect(201)
      ).body;
      assert.equal(saved.measurement.area_px, 4000);
      assert.equal(saved.measurement.scale_mm_per_px, null);
      assert.equal(saved.measurement.area_mm2, null);
      assert.equal(saved.measurement.calibration.quality, 'approximate');
      assert.equal(saved.measurement.calibration.method, 'known_rectangle');
      assert.equal(saved.measurement.calibration.image_width, 100);
      assert.ok(
        Math.abs(saved.measurement.calibrated_area_mm2 - (4000 + i * 800)) <
          0.001,
      );
      const detail = (await api().get(`/problems/${id}`).expect(200)).body;
      assert.equal(detail.latest_measurement.capture_id, capture.id);
    }
    const delta = (await api().get(`/problems/${id}/deltas`).expect(200))
      .body[0];
    assert.equal(delta.growth, 'growing');
    assert.ok(Math.abs(delta.area_change_pct - 20) < 0.001);
    const last = (
      await db
        .getRepository(Capture)
        .find({ where: { problem_id: id }, order: { taken_at: 'DESC' } })
    )[0];
    await db.query(
      "UPDATE measurements SET calibration=jsonb_set(calibration,'{method}','\"arkit_plane\"') WHERE capture_id=$1",
      [last.id],
    );
    const mixed = (await api().get(`/problems/${id}/deltas`).expect(200))
      .body[0];
    assert.equal(mixed.growth, 'unknown');
    assert.equal(mixed.area_change_pct, null);
  } finally {
    await calibrationApp.close();
  }
});

test('job deletion is owner-scoped, cascades records, and recovers failed bucket cleanup', async () => {
  const owned = (
    await api().post('/problems').send({ title: 'Delete fixture' }).expect(201)
  ).body;
  const keep = (
    await api().post('/problems').send({ title: 'Keep fixture' }).expect(201)
  ).body;
  const owner = await db
    .getRepository(User)
    .save({ clerk_id: 'delete-other-' + randomUUID() });
  const foreign = await db
    .getRepository(Problem)
    .save({ user_id: owner.id, title: 'Foreign fixture' });
  const before = cleanupScopes.length;
  await api()
    .delete('/problems/' + foreign.id)
    .expect(404);
  await api().delete('/problems/not-a-uuid').expect(400);
  await api()
    .get('/problems/' + foreign.id + '/storage')
    .expect(404);
  await api()
    .delete('/problems/' + foreign.id + '/previews')
    .expect(404);
  assert.equal(cleanupScopes.length, before);
  const upload = (
    await api()
      .post('/problems/' + owned.id + '/captures/upload-url')
      .send({})
      .expect(201)
  ).body;
  uploads.add(upload.photo_key);
  const capture = (
    await api()
      .post('/problems/' + owned.id + '/captures')
      .send({
        photo_key: upload.photo_key,
        photo_width_px: 100,
        photo_height_px: 100,
        is_baseline: true,
      })
      .expect(201)
  ).body;
  const preview = (
    await api()
      .post('/problems/' + owned.id + '/segment')
      .send({
        capture_id: capture.id,
        selection: { x1: 0, y1: 0, x2: 99, y2: 99 },
      })
      .expect(201)
  ).body;
  await api()
    .post('/problems/' + owned.id + '/diagnose')
    .send({ capture_id: capture.id, segmentation_token: preview.token })
    .expect(201);
  assert.equal(
    (
      await api()
        .get('/problems/' + owned.id + '/storage')
        .expect(200)
    ).body.previews,
    2,
  );
  await api()
    .delete('/problems/' + owned.id + '/previews')
    .expect(200);
  assert.deepEqual(cleanupScopes.at(-1), { id: owned.id, previewsOnly: true });
  assert.ok(uploads.has(upload.photo_key));
  failCleanup = true;
  const queued = (
    await api()
      .delete('/problems/' + owned.id)
      .expect(202)
  ).body;
  assert.equal(queued.status, 'deleting');
  assert.equal(
    await db.getRepository(Report).countBy({ capture_id: capture.id }),
    1,
  );
  assert.equal(await db.getRepository(Capture).countBy({ id: capture.id }), 1);
  assert.ok(
    !(await api().get('/problems').expect(200)).body.some(
      (p) => p.id === owned.id,
    ),
  );
  await api()
    .post('/problems/' + owned.id + '/captures/upload-url')
    .send({})
    .expect(409);
  failCleanup = false;
  await app.get(ProblemDeletionService).sweep();
  assert.equal(await db.getRepository(Problem).countBy({ id: owned.id }), 0);
  assert.equal(await db.getRepository(Capture).countBy({ id: capture.id }), 0);
  assert.equal(
    await db.getRepository(Report).countBy({ capture_id: capture.id }),
    0,
  );
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    0,
  );
  assert.ok(!uploads.has(upload.photo_key));
  assert.equal(await db.getRepository(Problem).countBy({ id: keep.id }), 1);
  assert.equal(await db.getRepository(Problem).countBy({ id: foreign.id }), 1);
  await api()
    .delete('/problems/' + owned.id)
    .expect(202);
  deletionIntents.set(owned.id, {
    ...deletionIntents.get(owned.id),
    requested_at: Date.now() - 17 * 60_000,
  });
  await app.get(ProblemDeletionService).sweep();
  assert.ok(!deletionIntents.has(owned.id));
});
