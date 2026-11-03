import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';

const apiKey = process.env.META_AI_API_KEY || process.env.MODEL_API_KEY;
if (!apiKey?.trim()) {
  throw new Error('Set META_AI_API_KEY or MODEL_API_KEY before running live tests');
}

const size = 256;
const squareStart = 64;
const squareEnd = 192;

function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([length, content, checksum]);
}

function syntheticImage() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(size * (1 + size * 3), 255);
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    pixels[row] = 0;
    for (let x = squareStart; y >= squareStart && y < squareEnd && x < squareEnd; x++) {
      pixels[row + 1 + x * 3 + 1] = 0;
      pixels[row + 1 + x * 3 + 2] = 0;
    }
  }
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')}`;
}

const imageUrl = syntheticImage();

async function query(model, prompt, extra = {}) {
  const started = performance.now();
  const response = await fetch('https://api.meta.ai/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageUrl },
        ],
      }],
      stream: false,
      ...extra,
    }),
  });
  // Do not log raw error bodies: upstream services may echo request data.
  assert.equal(response.status, 200, `${model}: HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.status, 'completed', `${model}: response did not complete`);
  assert.ok(Array.isArray(body.output), `${model}: missing output array`);
  const text = body.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content)
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('');
  console.log(`${model}: completed in ${Math.round(performance.now() - started)} ms`);
  return text;
}

test('Muse Spark understands an image and returns strict structured JSON', { timeout: 100_000 }, async () => {
  const text = await query(
    'muse-spark-1.3',
    'Identify the foreground shape and its color. Use lowercase English words.',
    {
      reasoning: { effort: 'minimal' },
      max_output_tokens: 1024,
      text: {
        format: {
          type: 'json_schema',
          name: 'visual_smoke_test',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              color: { type: 'string' },
              shape: { type: 'string' },
            },
            required: ['color', 'shape'],
            additionalProperties: false,
          },
        },
      },
    },
  );
  assert.deepEqual(JSON.parse(text), { color: 'red', shape: 'square' });
});

test('SAM returns a source-pixel box and nonempty mask for the red square', { timeout: 100_000 }, async () => {
  const text = await query('sam-3.1', 'red square');
  assert.match(text, /^<0f>/);
  const boxes = [...text.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g)];
  assert.equal(boxes.length, 1, 'Expected exactly one foreground square');
  const [x1, y1, x2, y2, width, height] = boxes[0].slice(1).map(Number);
  assert.equal(width, size);
  assert.equal(height, size);
  assert.ok(x1 >= 0 && y1 >= 0 && x2 < size && y2 < size);
  assert.ok(x1 <= x2 && y1 <= y2);
  const intersection =
    Math.max(0, Math.min(x2 + 1, squareEnd) - Math.max(x1, squareStart)) *
    Math.max(0, Math.min(y2 + 1, squareEnd) - Math.max(y1, squareStart));
  const union = (x2 - x1 + 1) * (y2 - y1 + 1) + (squareEnd - squareStart) ** 2 - intersection;
  assert.ok(intersection / union >= 0.9, 'Box must overlap the known square with IoU >= 0.9');
  assert.match(text, /<\|mask;x=\d+;y=\d+;data=[^|]+\|>/);
});

test('SAM completes with no matches for an absent object', { timeout: 100_000 }, async () => {
  const text = await query('sam-3.1', 'yellow square');
  assert.equal(text.trim(), '', 'An absent object must produce empty output_text');
});
