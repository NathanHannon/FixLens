import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { StorageService } from './storage.service.js';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.restoreAllMocks());
function setup() {
  const objects = new Map<string, number>([
    [`captures/${id}/one.jpg`, 100],
    [`captures/${id}/two.jpg`, 200],
    [`captures/${id}/orphan.jpg`, 300],
    [`masks/${id}/one.png`, 50],
    [`previews/${id}/one.png`, 20],
    [`previews/${id}/crop.jpg`, 30],
    [`captures/${other}/keep.jpg`, 900],
  ]);
  let partial = false,
    badPage = false;
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (
    command: unknown,
  ) => {
    if (command instanceof ListObjectsV2Command) {
      if (badPage) return { Contents: [{ Key: `captures/${other}/keep.jpg` }] };
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(command.input.Prefix!))
        .sort();
      const offset = Number(command.input.ContinuationToken ?? 0),
        page = keys.slice(offset, offset + 2);
      return {
        Contents: page.map((Key) => ({ Key, Size: objects.get(Key) })),
        IsTruncated: offset + 2 < keys.length,
        NextContinuationToken:
          offset + 2 < keys.length ? String(offset + 2) : undefined,
      };
    }
    if (command instanceof DeleteObjectsCommand) {
      const keys = command.input.Delete!.Objects!.map((item) => item.Key!);
      if (partial) {
        objects.delete(keys[0]);
        return { Errors: [{ Key: keys.at(-1), Code: 'AccessDenied' }] };
      }
      keys.forEach((key) => objects.delete(key));
      return {};
    }
    throw new Error('Unexpected storage operation');
  }) as never);
  const storage = new StorageService(
    new ConfigService({
      SPACES_BUCKET: 'test',
      SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
      SPACES_KEY: 'test',
      SPACES_SECRET: 'test',
    }),
  );
  return {
    storage,
    objects,
    send,
    fail: () => {
      partial = true;
    },
    recover: () => {
      partial = false;
    },
    badPage: () => {
      badPage = true;
    },
  };
}
describe('job-scoped bucket cleanup', () => {
  it('reads durable demo-user intents and rejects invalid ownership metadata', async () => {
    const { storage, send } = setup();
    const intent = {
      version: 1,
      problem_id: id,
      user_id: '00000000-0000-0000-0000-000000000001',
      requested_at: Date.now(),
    };
    send.mockImplementation((async (command: unknown) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      return { Body: Readable.from([Buffer.from(JSON.stringify(intent))]) };
    }) as never);
    expect(await storage.deletion(id)).toEqual(intent);
    intent.user_id = 'not-a-user';
    await expect(storage.deletion(id)).rejects.toThrow(
      'Invalid deletion intent',
    );
  });
  it('summarizes paginated photos, outlines, previews, and bytes', async () => {
    const { storage } = setup();
    expect(await storage.problemFiles(id)).toEqual({
      photos: 3,
      outlines: 1,
      previews: 2,
      bytes: 700,
    });
  });
  it('deletes every scoped page, including unregistered uploads, and preserves another job', async () => {
    const { storage, objects } = setup();
    expect(await storage.clearProblemFiles(id)).toBe(6);
    expect([...objects.keys()]).toEqual([`captures/${other}/keep.jpg`]);
  });
  it('clears only temporary previews when requested', async () => {
    const { storage, objects } = setup();
    expect(await storage.clearProblemFiles(id, true)).toBe(2);
    expect(objects.has(`captures/${id}/one.jpg`)).toBe(true);
    expect(objects.has(`masks/${id}/one.png`)).toBe(true);
  });
  it('reports partial failures and permits a retry over remaining files', async () => {
    const f = setup();
    f.fail();
    await expect(f.storage.clearProblemFiles(id)).rejects.toThrow(
      'could not be removed',
    );
    f.recover();
    await f.storage.clearProblemFiles(id);
    expect([...f.objects.keys()]).toEqual([`captures/${other}/keep.jpg`]);
  });
  it('rejects broad/malformed scopes and refuses unexpected out-of-scope keys', async () => {
    const f = setup();
    for (const invalid of ['', '/', '../', 'captures/'])
      await expect(f.storage.clearProblemFiles(invalid)).rejects.toThrow(
        'scope',
      );
    f.badPage();
    await expect(f.storage.clearProblemFiles(id)).rejects.toThrow(
      'out-of-scope',
    );
    expect(
      f.send.mock.calls.some(
        ([command]) => command instanceof DeleteObjectsCommand,
      ),
    ).toBe(false);
  });
});
