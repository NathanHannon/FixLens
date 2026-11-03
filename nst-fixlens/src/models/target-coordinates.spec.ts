import { describe, it, expect } from 'vitest';
import { normalizedSelection, targetToPixels } from './target-coordinates.js';
import {
  parseTarget,
  type NormalizedTargetPlan,
} from './segmentation.schema.js';
import { constrainTarget } from './segmentation-quality.js';
const plan: NormalizedTargetPlan = {
  coordinate_system: 'normalized_1000',
  concept: 'gray scuff',
  preferred_method: 'spatial',
  routing_reason: 'Faint mark benefits from spatial guides',
  status: 'clear',
  description: 'Scuff',
  box: { x1: 300, y1: 400, x2: 700, y2: 800 },
  foreground: [{ x: 500, y: 500 }],
  background: [{ x: 280, y: 380 }],
  reason: 'Visible mark',
  hazards: [],
};
describe('Muse coordinate boundary', () => {
  it('maps normalized positions into a 1500 × 2000 portrait without rejecting a correct target', () => {
    const selection = {
      x1: 450,
      y1: 800,
      x2: 1049,
      y2: 1599,
      points: [{ x: 750, y: 1000 }],
    };
    const result = targetToPixels(plan, 1500, 2000);
    expect(result).toMatchObject({
      concept: plan.concept,
      preferred_method: plan.preferred_method,
      routing_reason: plan.routing_reason,
    });
    expect(result.box).toEqual(selectionBox(selection));
    expect(constrainTarget(result, selection, 1500, 2000)).not.toBeNull();
    expect(constrainTarget(plan, selection, 1500, 2000)).toBeNull();
    expect(normalizedSelection(selection, 1500, 2000)).toEqual({
      x1: 300,
      y1: 400,
      x2: 700,
      y2: 800,
      points: [{ x: 500, y: 500 }],
    });
  });
  it('scales x and y independently on landscape images', () => {
    const result = targetToPixels(plan, 2000, 1000);
    expect(result.box).toEqual({ x1: 600, y1: 400, x2: 1399, y2: 799 });
    expect(result.foreground).toEqual([{ x: 1000, y: 500 }]);
  });
  it('handles image-edge boxes and clamps endpoint points to actual pixels', () => {
    const result = targetToPixels(
      {
        ...plan,
        box: { x1: 0, y1: 0, x2: 1000, y2: 1000 },
        foreground: [{ x: 1000, y: 1000 }],
      },
      1500,
      2000,
    );
    expect(result.box).toEqual({ x1: 0, y1: 0, x2: 1499, y2: 1999 });
    expect(result.foreground).toEqual([{ x: 1499, y: 1999 }]);
  });
  it('rejects missing coordinate declarations and raw pixel values in normalized responses', () => {
    const { coordinate_system: omitted, ...untagged } = plan;
    void omitted;
    expect(() => parseTarget(JSON.stringify(untagged))).toThrow();
    expect(() =>
      parseTarget(
        JSON.stringify({ ...plan, foreground: [{ x: 1500, y: 2000 }] }),
      ),
    ).toThrow();
  });
  it('does not fabricate a target when Muse reports uncertainty', () => {
    const result = targetToPixels(
      { ...plan, status: 'unclear', box: null, foreground: [], background: [] },
      1500,
      2000,
    );
    expect(result.status).toBe('unclear');
    expect(result.box).toBeNull();
  });
});
function selectionBox({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return { x1, y1, x2, y2 };
}
