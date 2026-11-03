import type { SelectionDto } from '../diagnosis/diagnosis.dto.js';
import type {
  NormalizedTargetPlan,
  TargetPlan,
  PixelPoint,
} from './segmentation.schema.js';

// Muse grounding uses a 0–1000 grid. SAM and all stored geometry use pixels.
// Boxes describe image edges; points describe pixel locations. Convert once at
// the model boundary, before brush overlap checks or crop offsets are applied.
export function targetToPixels(
  plan: NormalizedTargetPlan,
  width: number,
  height: number,
): TargetPlan {
  const point = (p: PixelPoint) => ({
    x: Math.min(width - 1, Math.max(0, Math.round((p.x * width) / 1000))),
    y: Math.min(height - 1, Math.max(0, Math.round((p.y * height) / 1000))),
  });
  return {
    concept: plan.concept,
    preferred_method: plan.preferred_method,
    routing_reason: plan.routing_reason,
    status: plan.status,
    description: plan.description,
    reason: plan.reason,
    hazards: plan.hazards,
    box: plan.box
      ? {
          x1: Math.min(width - 1, Math.floor((plan.box.x1 * width) / 1000)),
          y1: Math.min(height - 1, Math.floor((plan.box.y1 * height) / 1000)),
          x2: Math.min(width - 1, Math.ceil((plan.box.x2 * width) / 1000) - 1),
          y2: Math.min(
            height - 1,
            Math.ceil((plan.box.y2 * height) / 1000) - 1,
          ),
        }
      : null,
    foreground: plan.foreground.map(point),
    background: plan.background.map(point),
  };
}
export function normalizedSelection(
  selection: SelectionDto,
  width: number,
  height: number,
) {
  return {
    x1: Math.round((selection.x1 * 1000) / width),
    y1: Math.round((selection.y1 * 1000) / height),
    x2: Math.round(((selection.x2 + 1) * 1000) / width),
    y2: Math.round(((selection.y2 + 1) * 1000) / height),
    ...(selection.points
      ? {
          points: selection.points.map((p) => ({
            x: Math.round((p.x * 1000) / width),
            y: Math.round((p.y * 1000) / height),
          })),
        }
      : {}),
  };
}
