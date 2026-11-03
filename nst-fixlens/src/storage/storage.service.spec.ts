import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';
describe('Spaces presigning', () => {
  it('signs a JPEG upload to the private origin without a checksum for an empty body', async () => {
    const storage = new StorageService(
      new ConfigService({
        SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
        SPACES_KEY: 'test-key',
        SPACES_SECRET: 'test-secret',
        SPACES_BUCKET: 'fixlens-test',
      }),
    );
    const result = await storage.presign('captures/problem/capture.jpg');
    const url = new URL(result.url);
    expect(url.hostname).toBe('fixlens-test.nyc3.digitaloceanspaces.com');
    expect(url.pathname).toBe('/captures/problem/capture.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    expect(
      [...url.searchParams.keys()].some((key) => key.includes('checksum')),
    ).toBe(false);
    expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(result.method).toBe('PUT');
  });
});
