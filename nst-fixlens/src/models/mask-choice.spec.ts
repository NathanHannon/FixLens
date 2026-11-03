import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MetaModelsService } from './meta-models.service.js';
import { parseMaskChoice } from './mask-choice.js';

const choice = {
  winner: 'b',
  reason: 'B follows the narrow crack without concrete spill',
  reviews: {
    a: { status: 'mismatch', reason: 'Includes intact concrete' },
    b: { status: 'matches', reason: 'Follows all visible branches' },
  },
  hazards: [],
};
afterEach(() => vi.unstubAllGlobals());
describe('candidate outline selection', () => {
  it('accepts a reviewed candidate or neither, rejecting missing, unreviewed and malformed winners', () => {
    expect(parseMaskChoice(JSON.stringify(choice), ['a', 'b']).winner).toBe(
      'b',
    );
    expect(
      parseMaskChoice(JSON.stringify({ ...choice, winner: 'none' }), ['a', 'b'])
        .winner,
    ).toBe('none');
    expect(
      parseMaskChoice(
        JSON.stringify({
          ...choice,
          reviews: {
            ...choice.reviews,
            a: { status: 'unavailable', reason: 'No spatial candidate' },
          },
        }),
        ['b'],
      ).winner,
    ).toBe('b');
    for (const bad of [
      { ...choice, winner: 'a' },
      { ...choice, winner: 'c' },
      {
        ...choice,
        reviews: {
          ...choice.reviews,
          b: { status: 'unclear', reason: 'Faint boundary' },
        },
      },
      { ...choice, extra: true },
    ])
      expect(() => parseMaskChoice(JSON.stringify(bad), ['a', 'b'])).toThrow();
    expect(() => parseMaskChoice(JSON.stringify(choice), ['a'])).toThrow();
    expect(() => parseMaskChoice('not JSON', ['a'])).toThrow();
  });
  it('sends the original, brush, and labeled pixel overlays with a strict review schema', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          model: 'muse-spark-1.3',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(choice) }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const models = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test-secret' }),
    );
    const result = await models.chooseMask(
      'https://private.invalid/original',
      'https://private.invalid/brush',
      [
        { id: 'a', url: 'https://private.invalid/a' },
        { id: 'b', url: 'https://private.invalid/b' },
      ],
      { observations: 'Y-shaped garage crack' },
    );
    expect(result.winner).toBe('b');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(
      body.input[0].content
        .slice(1)
        .map((i: { image_url: string }) => i.image_url),
    ).toEqual([
      'https://private.invalid/original',
      'https://private.invalid/brush',
      'https://private.invalid/a',
      'https://private.invalid/b',
    ]);
    expect(JSON.parse(body.input[0].content[0].text)).toMatchObject({
      context: { observations: 'Y-shaped garage crack' },
      images: [
        { image: 1, role: 'original' },
        { image: 2, role: 'cyan brush guide' },
        { image: 3, candidate: 'a' },
        { image: 4, candidate: 'b' },
      ],
    });
    expect(body.text.format.strict).toBe(true);
    expect(body.instructions).toContain(
      'A smaller mask is not automatically better',
    );
    expect(body.instructions).toContain('Missing physical scale');
    expect(JSON.stringify(body)).not.toContain('test-secret');
  });
});
