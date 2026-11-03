import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SegmentationResult } from './diagnosis.provider.js';

interface Receipt {
  user_id: string;
  problem_id: string;
  capture_id: string;
  expires_at: number;
  segmentation: SegmentationResult;
}
@Injectable()
export class SegmentationReceipt {
  private readonly key: string;
  constructor(config: ConfigService) {
    this.key = config.getOrThrow<string>('SEGMENTATION_SECRET');
  }
  issue(
    identity: Pick<Receipt, 'user_id' | 'problem_id' | 'capture_id'>,
    segmentation: SegmentationResult,
  ) {
    const expires_at = Date.now() + 15 * 60_000;
    const payload = Buffer.from(
      JSON.stringify({ ...identity, expires_at, segmentation }),
    ).toString('base64url');
    const token = `${payload}.${this.sign(payload).toString('base64url')}`;
    if (token.length > 8192)
      throw new BadRequestException(
        'The confirmation is too large. Paint a smaller region and retry.',
      );
    return {
      token,
      expires_at: new Date(expires_at).toISOString(),
    };
  }
  verify(
    token: string,
    identity: Pick<Receipt, 'user_id' | 'problem_id' | 'capture_id'>,
  ): SegmentationResult {
    let receipt: Receipt;
    try {
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra || token.length > 8192)
        throw new Error();
      const actual = Buffer.from(signature, 'base64url');
      const expected = this.sign(payload);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      receipt = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Receipt;
      if (
        receipt.user_id !== identity.user_id ||
        receipt.problem_id !== identity.problem_id ||
        receipt.capture_id !== identity.capture_id ||
        !Number.isFinite(receipt.expires_at)
      )
        throw new Error();
    } catch {
      throw new BadRequestException(
        'Invalid segmentation confirmation. Select the area again.',
      );
    }
    if (receipt.expires_at <= Date.now())
      throw new GoneException(
        'The highlight expired. Preview the area again before continuing.',
      );
    return receipt.segmentation;
  }
  private sign(payload: string) {
    return createHmac('sha256', this.key)
      .update(`fixlens-segmentation-v1:${payload}`)
      .digest();
  }
}
