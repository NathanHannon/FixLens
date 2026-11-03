import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SegmentationReceipt } from './segmentation-receipt.js';
const receipts = new SegmentationReceipt(
  new ConfigService({
    SEGMENTATION_SECRET: 'test-secret-for-preview-receipts-at-least-32',
  }),
);
const identity = {
  user_id: 'owner',
  problem_id: 'problem',
  capture_id: 'capture',
};
const preview = {
  segmentation_method: 'text' as const,
  method_selection: {
    model: 'target-muse',
    reason: 'Distinct visible crack',
    fallback: false,
  },
  selection: { x1: 1, y1: 2, x2: 5, y2: 6 },
  mask_key: 'previews/test.png',
  area_px: 10,
  perimeter_px: 28,
  sam_version: 'sam',
};
afterEach(() => vi.useRealTimers());
it('binds exact mask and measurements to the user, problem and capture', () => {
  const { token } = receipts.issue(identity, preview);
  expect(receipts.verify(token, identity)).toEqual(preview);
  for (const key of ['user_id', 'problem_id', 'capture_id'])
    expect(() =>
      receipts.verify(token, { ...identity, [key]: 'other' }),
    ).toThrow('Invalid segmentation');
  const [payload, signature] = token.split('.');
  const edited = JSON.parse(Buffer.from(payload, 'base64url').toString());
  edited.segmentation.area_px = 999;
  expect(() =>
    receipts.verify(
      `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${signature}`,
      identity,
    ),
  ).toThrow('Invalid segmentation');
});
it('rejects expired, malformed and oversized confirmations', () => {
  vi.useFakeTimers();
  const { token } = receipts.issue(identity, preview);
  vi.advanceTimersByTime(15 * 60_000);
  expect(() => receipts.verify(token, identity)).toThrow('expired');
  for (const invalid of ['', 'bad.signature', 'x'.repeat(8193)])
    expect(() => receipts.verify(invalid, identity)).toThrow(
      'Invalid segmentation',
    );
});
