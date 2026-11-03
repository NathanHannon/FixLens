import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { ProblemStatus } from '../database/entities.js';
import {
  StorageService,
  type DeletionIntent,
} from '../storage/storage.service.js';
import { ProblemDeletionService } from './problem-deletion.service.js';
const id = '11111111-1111-4111-8111-111111111111',
  user = '00000000-0000-0000-0000-000000000001';
afterEach(() => vi.useRealTimers());
function setup(owner = user) {
  const rows = new Map([
    [id, { id, user_id: owner, status: ProblemStatus.Active }],
  ]);
  const intents = new Map<string, DeletionIntent>();
  let failing = false;
  const repo = {
    findOneBy: vi.fn(async ({ id: target, user_id: acting }) => {
      const row = rows.get(target);
      return row && (!acting || row.user_id === acting) ? row : null;
    }),
    delete: vi.fn(async ({ id: target }) => rows.delete(target)),
  };
  const manager = {
    findOne: vi.fn(async (_entity, { where }) => rows.get(where.id) ?? null),
    update: vi.fn(async (_entity, target, values) =>
      Object.assign(rows.get(target)!, values),
    ),
  };
  const db = {
    transaction: async (fn: (manager: unknown) => unknown) => fn(manager),
    getRepository: () => repo,
  } as unknown as DataSource;
  const storage = {
    deletion: vi.fn(async (target) => intents.get(target) ?? null),
    beginDeletion: vi.fn(async (value: DeletionIntent) => {
      intents.set(value.problem_id, { ...value });
    }),
    clearProblemFiles: vi.fn(async () => {
      if (failing) throw new Error('Bucket offline');
      return 3;
    }),
    pendingDeletions: async () => [...intents.values()],
    finishDeletion: vi.fn(async (target) => intents.delete(target)),
    problemFiles: vi.fn(async () => ({
      photos: 1,
      outlines: 1,
      previews: 1,
      bytes: 100,
    })),
  };
  const service = new ProblemDeletionService(
    db,
    storage as unknown as StorageService,
  );
  return {
    rows,
    intents,
    repo,
    storage,
    service,
    db,
    fail: () => {
      failing = true;
    },
    recover: () => {
      failing = false;
    },
  };
}
describe('durable job deletion', () => {
  it('checks ownership before touching cloud files', async () => {
    const f = setup('another-user');
    await expect(f.service.remove(id, user)).rejects.toThrow('Job not found');
    expect(f.storage.deletion).not.toHaveBeenCalled();
    expect(f.storage.clearProblemFiles).not.toHaveBeenCalled();
    expect(f.rows.has(id)).toBe(true);
  });
  it('retains records on partial cloud failure and recovers after a service restart', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.fail();
    expect(await f.service.remove(id, user)).toMatchObject({
      status: 'deleting',
      cleanup_pending: true,
    });
    expect(f.rows.get(id)?.status).toBe(ProblemStatus.Archived);
    expect(f.repo.delete).not.toHaveBeenCalled();
    f.recover();
    vi.setSystemTime(Date.now() + 17 * 60_000);
    await new ProblemDeletionService(
      f.db,
      f.storage as unknown as StorageService,
    ).sweep();
    expect(f.rows.has(id)).toBe(false);
    expect(f.intents.has(id)).toBe(false);
  });
  it('resweeps for late uploads, and does not repeatedly purge during the settling window', async () => {
    vi.useFakeTimers();
    const f = setup();
    expect(await f.service.remove(id, user)).toMatchObject({
      status: 'deleted',
      cleanup_pending: true,
    });
    expect(f.rows.has(id)).toBe(false);
    expect(f.intents.get(id)?.initial_cleanup_complete).toBe(true);
    await f.service.sweep();
    expect(f.storage.clearProblemFiles).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 17 * 60_000);
    await f.service.sweep();
    expect(f.storage.clearProblemFiles).toHaveBeenCalledTimes(2);
    expect(f.intents.size).toBe(0);
  });
  it('makes a lost delete response retryable without resetting the original cleanup deadline', async () => {
    const f = setup();
    await f.service.remove(id, user);
    const requested = f.intents.get(id)!.requested_at;
    expect(await f.service.remove(id, user)).toMatchObject({
      status: 'deleted',
    });
    expect(f.intents.get(id)!.requested_at).toBe(requested);
  });
  it('validates ownership before preview-only cleanup or file inspection', async () => {
    const f = setup();
    await expect(f.service.clearPreviews(id, 'other')).rejects.toThrow();
    expect(f.storage.clearProblemFiles).not.toHaveBeenCalled();
  });
});
