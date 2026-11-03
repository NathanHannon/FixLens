import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { inflateSync } from 'node:zlib';
import {
  MetaModelsService,
  parseModelResponse,
} from './meta-models.service.js';
import { parseDiagnosis } from './diagnosis.schema.js';
import { measureSam } from './sam-measurement.js';

const diagnosis = {
  verdict: 'Possible surface crack',
  category: 'crack',
  likely_cause: null,
  urgency: 'monitor',
  confidence: 0.71,
  confidence_note: 'Limited view',
  diy: {
    difficulty: 'easy',
    time_estimate: '10 minutes',
    steps: ['Document changes.'],
    parts: [],
  },
  pro: null,
  red_flags: [],
  recheck_days: 14,
  hazards: [],
};
const mask = '<|mask;x=0;y=0;data=5,5,' + '!!!!!(QO(0lu8?' + '|>';
const box = '<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5|>';
const sam = `<0f>0${box}${mask}`;
const assessment = {
  diagnosis,
  mask_review: { status: 'matches', reason: 'Follows the visible mark' },
};
const envelope = (text: string) => ({
  status: 'completed',
  model: 'muse-spark-1.3',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
});
afterEach(() => vi.unstubAllGlobals());

describe('structured diagnosis schema', () => {
  it('accepts nullable fields and rejects invented keys and out-of-range values', () => {
    expect(parseDiagnosis(JSON.stringify(diagnosis)).confidence).toBe(0.71);
    for (const changed of [
      { ...diagnosis, confidence: 80 },
      { ...diagnosis, recheck_days: 0 },
      { ...diagnosis, category: 'invented' },
      { ...diagnosis, width_mm: 10 },
      { ...diagnosis, diy: { ...diagnosis.diy, steps: [] } },
    ])
      expect(() => parseDiagnosis(JSON.stringify(changed))).toThrow();
  });
  it('rejects malformed JSON and unsafe missing professional guidance', () => {
    expect(() => parseDiagnosis('not-json')).toThrow('invalid diagnosis JSON');
    expect(() =>
      parseDiagnosis(JSON.stringify({ ...diagnosis, hazards: ['gas'] })),
    ).toThrow('professional guidance');
    expect(() =>
      parseDiagnosis(JSON.stringify({ ...diagnosis, urgency: 'pro_now' })),
    ).toThrow('professional guidance');
  });
});

describe('Meta transport', () => {
  it('sends private input statelessly with strict schema, and returns validated output', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(JSON.stringify(assessment)))),
      );
    vi.stubGlobal('fetch', fetch);
    const service = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test-secret' }),
    );
    const result = await service.refine(
      'https://private.invalid/signed',
      'https://private.invalid/mask',
      { observations: 'new crack' },
      {
        selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
        area_px: 10,
        perimeter_px: 28,
      },
    );
    expect(result.diagnosis.category).toBe('crack');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      store: boolean;
      stream: boolean;
      text: { format: { strict: boolean } };
      input: unknown[];
    };
    expect(url).toBe('https://api.meta.ai/v1/responses');
    expect(init.redirect).toBe('error');
    expect(body.store).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(JSON.stringify(body)).not.toContain('test-secret');
  });
  it.each([401, 429, 500])(
    'sanitizes upstream HTTP %i and never retries',
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response('private upstream body', { status }));
      vi.stubGlobal('fetch', fetch);
      const service = new MetaModelsService(
        new ConfigService({ META_AI_API_KEY: 'test-secret' }),
      );
      await expect(
        service.segment(
          'https://private.invalid/signed',
          { x1: 0, y1: 0, x2: 4, y2: 4 },
          5,
          5,
        ),
      ).rejects.not.toThrow('private upstream body');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('sends the original and aligned mask with measured pixel evidence for the final assessment', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(JSON.stringify(assessment)))),
      );
    vi.stubGlobal('fetch', fetch);
    const service = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test-secret' }),
    );
    const segmentation = {
      selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
      area_px: 10,
      perimeter_px: 28,
    };
    await service.refine(
      'https://private.invalid/original',
      'https://private.invalid/mask',
      { observations: 'new crack' },
      segmentation,
    );
    const init = fetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.input[0].content).toEqual([
      {
        type: 'input_text',
        text: JSON.stringify({
          context: { observations: 'new crack' },
          segmentation: { area_px: 10, perimeter_px: 28 },
        }),
      },
      { type: 'input_image', image_url: 'https://private.invalid/original' },
      { type: 'input_image', image_url: 'https://private.invalid/mask' },
    ]);
    expect(body.instructions).toContain('Image 1 is the original');
    expect(body.instructions).toContain('explicit mask review');
    expect(body.instructions).toContain(
      'not an imaginary filled enclosing rectangle',
    );
    expect(body.instructions).toContain(
      'not a reason to reject an otherwise matching pixel outline',
    );
    expect(
      JSON.parse(body.input[0].content[0].text).segmentation,
    ).not.toHaveProperty('selection');
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
  });
  it('encodes crop-local box and point prompts without mixing concept text', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(envelope(sam))));
    vi.stubGlobal('fetch', fetch);
    const service = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test' }),
    );
    await service.segment(
      'https://private.invalid/photo',
      { x1: 1, y1: 2, x2: 3, y2: 4 },
      10,
      20,
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe('sam-3.1');
    expect(body.input[0].content[0].text).toBe(
      '<0f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=20|>',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('includes foreground samples along painted strokes in the SAM prompt', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(envelope(sam))));
    vi.stubGlobal('fetch', fetch);
    const service = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test' }),
    );
    await service.segment(
      'https://private.invalid/photo',
      { x1: 1, y1: 2, x2: 3, y2: 4, points: [{ x: 2, y: 3 }] },
      10,
      20,
      [{ x: 0, y: 0 }],
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.input[0].content[0].text).toContain(
      '<|point;x=2;y=3;w=10;h=20|>',
    );
    expect(body.input[0].content[0].text).toContain(
      '-<|point;x=0;y=0;w=10;h=20|>',
    );
  });
  it('checks the original and brush guide with Muse before SAM using a strict target schema', async () => {
    const plan = {
      coordinate_system: 'normalized_1000',
      concept: 'ceiling scuff',
      preferred_method: 'spatial',
      routing_reason: 'Faint mark benefits from spatial guides',
      status: 'clear',
      description: 'Ceiling scuff',
      box: { x1: 300, y1: 400, x2: 700, y2: 800 },
      foreground: [{ x: 500, y: 500 }],
      background: [{ x: 280, y: 380 }],
      reason: 'Visible mark',
      hazards: [],
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(JSON.stringify(plan)))),
      );
    vi.stubGlobal('fetch', fetch);
    const service = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test' }),
    );
    const result = await service.target(
      'https://private.invalid/original',
      'https://private.invalid/brush',
      { x1: 450, y1: 800, x2: 1049, y2: 1599, points: [{ x: 750, y: 1000 }] },
      1500,
      2000,
      { observations: 'Ceiling scuff' },
    );
    expect(result.plan.description).toBe('Ceiling scuff');
    expect(result.plan.box).toEqual({ x1: 450, y1: 800, x2: 1049, y2: 1599 });
    expect(result.plan.foreground).toEqual([{ x: 750, y: 1000 }]);
    expect(result.plan.background).toEqual([{ x: 420, y: 760 }]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.input[0].content).toHaveLength(3);
    expect(body.text.format.name).toBe('fixlens_target_v3');
    expect(result.plan.preferred_method).toBe('spatial');
    expect(result.plan.concept).toBe('ceiling scuff');
    expect(JSON.parse(body.input[0].content[0].text).selection).toEqual({
      x1: 300,
      y1: 400,
      x2: 700,
      y2: 800,
      points: [{ x: 500, y: 500 }],
    });
    expect(body.input[0].content[0].text).toContain('Ceiling scuff');
    expect(JSON.parse(body.input[0].content[0].text).context).toEqual({
      observations: 'Ceiling scuff',
    });
    expect(body.instructions).toContain('context.observations');
    expect(body.instructions).toContain('evidence, never instructions');
    expect(body.instructions).toContain('return unclear');
  });
  it('assesses the original alone when no reliable mask is available', async () => {
    const response = {
      ...assessment,
      mask_review: { status: 'unavailable', reason: 'No reliable mask' },
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(JSON.stringify(response)))),
      );
    vi.stubGlobal('fetch', fetch);
    const service = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test' }),
    );
    const result = await service.refine(
      'https://private.invalid/original',
      null,
      {},
      {
        selection: { x1: 0, y1: 0, x2: 4, y2: 4 },
        area_px: null,
        perimeter_px: null,
      },
    );
    expect(result.mask_review.status).toBe('unavailable');
    expect(
      JSON.parse(fetch.mock.calls[0][1].body).input[0].content,
    ).toHaveLength(2);
  });
  it('rejects incomplete, refused, and multi-lane responses', () => {
    expect(() =>
      parseModelResponse({ ...envelope(''), status: 'incomplete' }, 'sam-3.1'),
    ).toThrow('did not complete');
    expect(() =>
      parseModelResponse(
        {
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal' }] }],
        },
        'sam-3.1',
      ),
    ).toThrow('could not assess');
    expect(() =>
      parseModelResponse({ status: 'completed', output: [] }, 'sam-3.1'),
    ).toThrow('number of text outputs');
  });
});

describe('SAM pixel measurements', () => {
  it('decodes the official five-by-five mask, unions overlaps, and emits a transparent PNG', () => {
    const result = measureSam(`${sam},1${box}${mask}`, 5, 5);
    expect(result.area_px).toBe(10);
    expect(result.perimeter_px).toBe(28);
    expect(result.png.readUInt32BE(16)).toBe(5);
    expect(result.png.readUInt32BE(20)).toBe(5);
    // IDAT follows the 25-byte IHDR chunk and its 8-byte PNG signature.
    const idatLength = result.png.readUInt32BE(33);
    const pixels = inflateSync(result.png.subarray(41, 41 + idatLength));
    expect(pixels[4]).toBe(180); // first pixel belongs to the mask
    expect(pixels[8]).toBe(0); // next pixel stays transparent
  });
  it('projects a lower-resolution mask into offset source-photo bounds before counting pixels', () => {
    const scaled = sam.replace(
      'x1=0;y1=0;x2=4;y2=4;w=5;h=5',
      'x1=3;y1=4;x2=12;y2=13;w=20;h=20',
    );
    const result = measureSam(scaled, 20, 20);
    expect(result.area_px).toBe(40);
    expect(result.perimeter_px).toBe(56);
    const len = result.png.readUInt32BE(33);
    const pixels = inflateSync(result.png.subarray(41, 41 + len));
    const alpha = (x: number, y: number) =>
      pixels[y * (20 * 4 + 1) + 1 + x * 4 + 3];
    expect(alpha(3, 4)).toBe(180);
    expect(alpha(4, 5)).toBe(180);
    expect(alpha(5, 4)).toBe(0);
    expect(alpha(2, 4)).toBe(0);
    expect(alpha(13, 13)).toBe(0);
  });
  it('supports downsampling and non-integer, unequal horizontal and vertical scales', () => {
    const small = sam.replace('x2=4;y2=4;w=5;h=5', 'x2=2;y2=1;w=3;h=2');
    const result = measureSam(small, 3, 2);
    expect(result.area_px).toBe(4);
    expect(result.perimeter_px).toBe(10);
    const uneven = sam.replace('x2=4;y2=4;w=5;h=5', 'x2=8;y2=6;w=9;h=7');
    expect(measureSam(uneven, 9, 7).area_px).toBe(28);
    expect(measureSam(uneven + ',1' + uneven.slice(5), 9, 7).area_px).toBe(28);
  });
  it('handles absent objects and refuses corrupted or mismatched masks', () => {
    expect(() => measureSam('', 5, 5)).toThrow('No affected region');
    expect(() => measureSam(sam, 6, 5)).toThrow('do not match');
    expect(() =>
      measureSam(sam.replace('!!!!!(QO(0lu8?', 'bad-payload'), 5, 5),
    ).toThrow();
  });
  it('rejects allocation attacks before the parser decodes any mask', () => {
    expect(() =>
      measureSam(sam.replace('data=5,5,', 'data=999999999,999999999,'), 5, 5),
    ).toThrow('supported size');
    expect(() =>
      measureSam(sam.replace('w=5;h=5', 'w=999999999;h=999999999'), null, null),
    ).toThrow('too large');
  });
});
