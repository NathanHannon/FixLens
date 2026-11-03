// Opt-in, billable experiment: <=6 calls/photo, <=2 photos. No database writes,
// bucket uploads, model retries, or changes to the production selection policy.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MetaModelsService } from '../dist/models/meta-models.service.js';
import {
  brushPreview,
  cropPhoto,
  overlayPhoto,
  verifyPhoto,
} from '../dist/models/analysis-images.js';
import { measureSam } from '../dist/models/sam-measurement.js';
import {
  constrainTarget,
  inspectMask,
} from '../dist/models/segmentation-quality.js';

const manifestPath = process.argv[2];
assert.ok(
  manifestPath,
  'Usage: node test/segmentation-comparison.live.mjs <manifest.json> [output-directory]',
);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.ok(
  Array.isArray(manifest) && manifest.length > 0 && manifest.length <= 2,
  'Use one or two photos per run',
);
const out = path.resolve(
  process.argv[3] ?? '.tmp/segmentation-comparison/results',
);
await mkdir(out, { recursive: true });
const models = new MetaModelsService(new ConfigService(process.env));
const uri = (bytes) => `data:image/jpeg;base64,${bytes.toString('base64')}`;
const results = [];
let calls = 0;
const request = async (run) => {
  assert.ok(++calls <= 12, 'Experiment request budget exceeded');
  return run();
};
for (const sample of manifest) {
  assert.match(sample.name, /^[a-z0-9-]{1,40}$/);
  assert.ok(
    typeof sample.description === 'string' && sample.description.length <= 2000,
  );
  const source = await readFile(
    path.resolve(path.dirname(manifestPath), sample.photo),
  );
  const { width, height, selection } = sample;
  await verifyPhoto(source, width, height);
  assert.ok(
    selection.x1 >= 0 &&
      selection.y1 >= 0 &&
      selection.x1 < selection.x2 &&
      selection.y1 < selection.y2 &&
      selection.x2 < width &&
      selection.y2 < height,
  );
  assert.ok(
    selection.points?.length > 0 &&
      selection.points.length <= 32 &&
      selection.points.every(
        (p) =>
          Number.isInteger(p.x) &&
          Number.isInteger(p.y) &&
          p.x >= selection.x1 &&
          p.x <= selection.x2 &&
          p.y >= selection.y1 &&
          p.y <= selection.y2,
      ),
  );
  const directory = path.join(out, sample.name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'source.jpg'), source);
  const guide = await brushPreview(source, width, height, selection);
  await writeFile(path.join(directory, 'guide.jpg'), guide);
  const pad = Math.max(
    4,
    Math.ceil(
      Math.max(
        selection.x2 - selection.x1 + 1,
        selection.y2 - selection.y1 + 1,
      ) * 0.2,
    ),
  );
  const left = Math.max(0, selection.x1 - pad),
    top = Math.max(0, selection.y1 - pad);
  const crop = {
    left,
    top,
    width: Math.min(width, selection.x2 + pad + 1) - left,
    height: Math.min(height, selection.y2 + pad + 1) - top,
  };
  const cropped = await cropPhoto(source, crop);
  const local = {
    x1: selection.x1 - left,
    y1: selection.y1 - top,
    x2: selection.x2 - left,
    y2: selection.y2 - top,
    points: selection.points.map((p) => ({ x: p.x - left, y: p.y - top })),
  };
  const result = {
    name: sample.name,
    description: sample.description,
    width,
    height,
    selection,
    crop,
    recreated_brush: true,
    variants: [],
  };
  results.push(result);
  try {
    result.concept_plan = await request(() =>
      models.suggestConcept(uri(source), sample.description),
    );
  } catch (error) {
    result.concept_error = error.message;
  }
  async function variant(name, run) {
    const start = Date.now();
    const row = { name };
    result.variants.push(row);
    try {
      const { response, projection, target } = await run();
      row.model = response.model;
      if (!response.text.trim()) {
        row.status = 'empty';
        return;
      }
      const inputWidth = projection ? projection.width : width,
        inputHeight = projection ? projection.height : height;
      const measured = measureSam(
        response.text,
        inputWidth,
        inputHeight,
        undefined,
        projection
          ? { left: projection.left, top: projection.top, width, height }
          : undefined,
      );
      row.status = 'candidate';
      row.area_px = measured.area_px;
      row.photo_fraction = measured.area_px / (width * height);
      row.guide_hit_fraction =
        selection.points.filter((p) => measured.mask[p.y * width + p.x])
          .length / selection.points.length;
      let outside = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (
            measured.mask[y * width + x] &&
            (x < selection.x1 ||
              x > selection.x2 ||
              y < selection.y1 ||
              y > selection.y2)
          )
            outside++;
      row.outside_brush_box_fraction = outside / measured.area_px;
      if (target)
        row.quality = inspectMask(
          measured.mask,
          width,
          height,
          selection,
          target,
        );
      await writeFile(path.join(directory, `${name}.png`), measured.png);
      await writeFile(
        path.join(directory, `${name}.jpg`),
        await overlayPhoto(source, measured.png, width, height),
      );
    } catch (error) {
      row.status = 'unavailable';
      row.reason = error.message;
    } finally {
      row.elapsed_ms = Date.now() - start;
      await writeFile(
        path.join(out, 'results.json'),
        JSON.stringify({ model_requests: calls, cases: results }, null, 2),
      );
      console.log(JSON.stringify({ photo: sample.name, ...row }));
    }
  }
  await variant('brush-spatial', async () => ({
    response: await request(() =>
      models.segment(uri(cropped), local, crop.width, crop.height),
    ),
    projection: crop,
  }));
  for (const [name, bytes, projection] of [
    ['description-text', source, undefined],
    ['combined-text-crop', cropped, crop],
  ]) {
    await variant(name, async () => {
      assert.ok(
        result.concept_plan?.concept,
        'Muse could not suggest a visible concept',
      );
      return {
        response: await request(() =>
          models.segmentConcept(uri(bytes), result.concept_plan.concept),
        ),
        projection,
      };
    });
  }
  await variant('current-muse-spatial', async () => {
    const plan = await request(() =>
      models.target(uri(source), uri(guide), selection, width, height, {
        observations: sample.description,
      }),
    );
    result.spatial_plan = plan;
    const target = constrainTarget(plan.plan, selection, width, height);
    assert.ok(target, 'Muse did not produce a valid brush-constrained target');
    const relative = (p) => ({
      x: p.x - target.crop.left,
      y: p.y - target.crop.top,
    });
    const localSelection = {
      x1: target.box.x1 - target.crop.left,
      y1: target.box.y1 - target.crop.top,
      x2: target.box.x2 - target.crop.left,
      y2: target.box.y2 - target.crop.top,
      points: target.foreground.map(relative),
    };
    const targetPhoto = await cropPhoto(source, target.crop);
    return {
      response: await request(() =>
        models.segment(
          uri(targetPhoto),
          localSelection,
          target.crop.width,
          target.crop.height,
          target.background.map(relative),
        ),
      ),
      projection: target.crop,
      target,
    };
  });
}
await writeFile(
  path.join(out, 'results.json'),
  JSON.stringify({ model_requests: calls, cases: results }, null, 2),
);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const labels = {
  'brush-spatial': 'Brush + SAM points',
  'description-text': 'Description → Muse → SAM text',
  'combined-text-crop': 'Text + brush crop',
  'current-muse-spatial': 'Current Muse + brush + points',
};
await writeFile(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FixLens segmentation comparison</title><style>body{font:16px system-ui;background:#f4f7f5;color:#142d27;margin:0;padding:24px}main{max-width:1500px;margin:auto}h1{font-size:30px}p{max-width:100ch;line-height:1.5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}figure{margin:0;background:white;padding:12px;border:1px solid #dfe8e3;border-radius:16px}img{width:100%;max-height:650px;object-fit:contain;background:#e9eeeb}figcaption{padding:10px 0;line-height:1.6}small{display:block;color:#60646c}button{font:inherit;padding:10px;margin:12px 0;border:1px solid #116b5d;background:white;border-radius:8px;color:#116b5d}section{margin-bottom:40px}</style><main><h1>FixLens · prompting comparison</h1><p>Single attempt per method on two real photos. Green pixels are selected. These are candidate masks, not damage measurements. Brushes were recreated from visual inspection, not recovered user strokes. Area and guide coverage are diagnostics, not accuracy. No ground-truth masks or automated winner are supplied.</p><p>${calls} model requests. Existing database records and bucket objects were unchanged. The combined text mode uses a brush crop because Meta's API does not mix noun phrases with spatial tokens in one request.</p>${results.map((c) => `<section><h2>${escape(c.name)}</h2><p>${escape(c.description)}</p><p>Muse concept: <strong>${escape(c.concept_plan?.concept ?? 'unavailable')}</strong></p><button onclick="this.closest('section').querySelectorAll('img[data-overlay]').forEach(i=>{const old=i.src;i.src=i.dataset.other;i.dataset.other=old})">Toggle original / overlay</button><div class="grid"><figure><img src="${c.name}/guide.jpg" alt="Recreated brush guide"><figcaption>Recreated brush guides<small>Cyan box and samples; not an exact outline</small></figcaption></figure>${c.variants.map((v) => `<figure>${v.status === 'candidate' ? `<img data-overlay src="${c.name}/${v.name}.jpg" data-other="${c.name}/source.jpg" alt="${escape(labels[v.name])} result">` : '<p>No candidate mask</p>'}<figcaption><strong>${escape(labels[v.name])}</strong><small>${escape(v.status)}${v.area_px ? ` · ${(v.photo_fraction * 100).toFixed(2)}% of photo · ${(v.guide_hit_fraction * 100).toFixed(0)}% guide hits` : ''}</small>${v.reason ? `<small>${escape(v.reason)}</small>` : ''}${v.quality ? `<small>Current checks: ${v.quality.passed ? 'pass' : escape(v.quality.reasons.join(' '))}</small>` : ''}</figcaption></figure>`).join('')}</div></section>`).join('')}<p>Local experiment only. Household-photo accuracy requires a larger labeled evaluation set before changing the app default.</p></main></html>`,
);
console.log(
  JSON.stringify({
    model_requests: calls,
    artifact: path.join(out, 'index.html'),
    report_persisted: false,
  }),
);
