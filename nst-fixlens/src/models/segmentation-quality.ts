import type { SelectionDto } from '../diagnosis/diagnosis.dto.js';
import type {
  TargetPlan,
  PixelBox,
  PixelPoint,
} from './segmentation.schema.js';
export interface AnalysisTarget {
  box: PixelBox;
  crop: { left: number; top: number; width: number; height: number };
  foreground: PixelPoint[];
  background: PixelPoint[];
}
export interface MaskQuality {
  method?: 'spatial' | 'text';
  passed: boolean;
  reasons: string[];
  outside_selection_fraction: number;
  crop_coverage: number;
  foreground_coverage: number;
  background_coverage: number;
}
const inside = (p: PixelPoint, b: PixelBox) =>
  p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
const boxArea = (b: PixelBox) => (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1);
export function constrainTarget(
  plan: TargetPlan,
  selection: SelectionDto,
  width: number,
  height: number,
): AnalysisTarget | null {
  const b = plan.box;
  if (
    plan.status !== 'clear' ||
    !b ||
    !plan.description ||
    b.x1 >= b.x2 ||
    b.y1 >= b.y2 ||
    b.x2 >= width ||
    b.y2 >= height
  )
    return null;
  const overlap =
    Math.max(
      0,
      Math.min(b.x2, selection.x2) - Math.max(b.x1, selection.x1) + 1,
    ) *
    Math.max(
      0,
      Math.min(b.y2, selection.y2) - Math.max(b.y1, selection.y1) + 1,
    );
  if (overlap / boxArea(b) < 0.5 || boxArea(b) > 4 * boxArea(selection))
    return null;
  const userPoints = selection.points ?? [];
  if (
    userPoints.length &&
    userPoints.filter((p) => inside(p, b)).length / userPoints.length < 0.5
  )
    return null;
  const validPoint = (p: PixelPoint) =>
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x < width &&
    p.y < height;
  if ([...plan.foreground, ...plan.background].some((p) => !validPoint(p)))
    return null;
  const foreground = [
    ...new Map(
      [...userPoints, ...plan.foreground]
        .filter((p) => inside(p, b))
        .map((p) => [`${p.x},${p.y}`, p]),
    ).values(),
  ].slice(0, 32);
  if (!foreground.length) return null;
  const padding = Math.max(
    4,
    Math.ceil(Math.max(b.x2 - b.x1 + 1, b.y2 - b.y1 + 1) * 0.2),
  );
  const left = Math.max(0, b.x1 - padding),
    top = Math.max(0, b.y1 - padding);
  const right = Math.min(width, b.x2 + 1 + padding),
    bottom = Math.min(height, b.y2 + 1 + padding);
  const background = plan.background.filter(
    (p) => p.x >= left && p.x < right && p.y >= top && p.y < bottom,
  );
  if (
    background.some((p) =>
      foreground.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 2),
    )
  )
    return null;
  return {
    box: b,
    crop: { left, top, width: right - left, height: bottom - top },
    foreground,
    background,
  };
}
export function inspectMask(
  mask: Uint8Array,
  width: number,
  height: number,
  selection: SelectionDto,
  target: AnalysisTarget,
  method: 'spatial' | 'text' = 'spatial',
): MaskQuality {
  let area = 0,
    outside = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x]) {
        area++;
        if (!inside({ x, y }, selection)) outside++;
      }
  const covered = (p: PixelPoint) => Boolean(mask[p.y * width + p.x]);
  const foreground_coverage =
    target.foreground.filter(covered).length / target.foreground.length;
  const background_coverage = target.background.length
    ? target.background.filter(covered).length / target.background.length
    : 0;
  const outside_selection_fraction = area ? outside / area : 0;
  const crop_coverage = area / (target.crop.width * target.crop.height);
  const reasons: string[] = [];
  if (!area) reasons.push('SAM returned no marked area.');
  if (outside_selection_fraction > 0.25)
    reasons.push('The highlight expanded too far beyond your selected region.');
  if (crop_coverage > 0.85)
    reasons.push('The highlight covers almost the entire analysis crop.');
  // Text does not consume the spatial points. Require an intent anchor, not
  // coverage of a rough brush as though it were a verified damage boundary.
  // Every surviving text mask still requires explicit visual selection review.
  if (
    method === 'spatial' ? foreground_coverage < 0.6 : foreground_coverage === 0
  )
    reasons.push('The highlight misses too many foreground guide points.');
  if (background_coverage > 0)
    reasons.push(
      'The highlight includes a point identified as unaffected background.',
    );
  return {
    ...(method === 'text' ? { method } : {}),
    passed: reasons.length === 0,
    reasons,
    outside_selection_fraction,
    crop_coverage,
    foreground_coverage,
    background_coverage,
  };
}
