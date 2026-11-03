import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { parseConcept, validConcept } from './concept-prompt.js';
import { MetaModelsService } from './meta-models.service.js';
afterEach(() => vi.unstubAllGlobals());
const envelope = (text: string) => ({
  status: 'completed',
  model: 'test',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
});
describe('experimental concept prompting', () => {
  it('accepts a concise concept or an explicit unclear result and rejects mixed prompt syntax', () => {
    expect(
      parseConcept('{"concept":"gray ceiling scuff","reason":"Visible mark"}')
        .concept,
    ).toBe('gray ceiling scuff');
    expect(
      parseConcept('{"concept":null,"reason":"Blurred photo"}').concept,
    ).toBeNull();
    for (const concept of [
      'crack\nceiling',
      'crack, stain',
      'crack or stain',
      'ceiling not wall',
      '<0f>1<|point;x=2|>',
      ' x ',
      'x'.repeat(81),
    ]) {
      expect(validConcept(concept)).toBe(false);
      expect(() =>
        parseConcept(JSON.stringify({ concept, reason: 'test' })),
      ).toThrow();
    }
    expect(() =>
      parseConcept('{"concept":"crack","reason":"test","box":{}}'),
    ).toThrow();
  });
  it('uses the description only for Muse and sends SAM a noun phrase without spatial tokens', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            envelope(
              '{"concept":"concrete crack","reason":"Visible branching crack"}',
            ),
          ),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope(''))));
    vi.stubGlobal('fetch', fetch);
    const models = new MetaModelsService(
      new ConfigService({ META_AI_API_KEY: 'test' }),
    );
    const description = 'The branching garage crack, excluding the leaf.';
    const plan = await models.suggestConcept(
      'https://private.invalid/source',
      description,
    );
    await models.segmentConcept('https://private.invalid/crop', plan.concept!);
    const muse = JSON.parse(fetch.mock.calls[0][1].body),
      sam = JSON.parse(fetch.mock.calls[1][1].body);
    expect(JSON.parse(muse.input[0].content[0].text)).toEqual({
      user_description: description,
    });
    expect(muse.text.format.strict).toBe(true);
    expect(sam.model).toBe('sam-3.1');
    expect(sam.input[0].content[0].text).toBe('concrete crack');
    expect(sam.input[0].content[1].image_url).toBe(
      'https://private.invalid/crop',
    );
    expect(sam.store).toBe(false);
    expect(() =>
      models.segmentConcept('https://private.invalid/crop', 'crack <0f>1'),
    ).toThrow('noun phrase');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
