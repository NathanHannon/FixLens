import type { Selection, SelectionPoint } from "../api/types";
export interface BrushStroke {
  points: SelectionPoint[];
  radius: number;
}
export function strokePath(points: SelectionPoint[]): string {
  if (!points.length) return "";
  const first = points[0];
  return (
    `M${first.x},${first.y}` +
    (points.length === 1
      ? `L${first.x + 0.01},${first.y}`
      : points
          .slice(1)
          .map((p) => `L${p.x},${p.y}`)
          .join(""))
  );
}
export function selectionFromStrokes(
  strokes: BrushStroke[],
  width: number,
  height: number,
): Selection | null {
  if (!strokes.length || width < 2 || height < 2) return null;
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  const points: SelectionPoint[] = [];
  const perStroke = Math.max(1, Math.floor(32 / strokes.length));
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      left = Math.min(left, p.x - stroke.radius);
      right = Math.max(right, p.x + stroke.radius);
      top = Math.min(top, p.y - stroke.radius);
      bottom = Math.max(bottom, p.y + stroke.radius);
    }
    const count = Math.min(perStroke, stroke.points.length);
    for (let i = 0; i < count; i++) {
      const p =
        stroke.points[
          count === 1
            ? 0
            : Math.round((i * (stroke.points.length - 1)) / (count - 1))
        ];
      points.push({
        x: Math.max(0, Math.min(width - 1, Math.floor(p.x))),
        y: Math.max(0, Math.min(height - 1, Math.floor(p.y))),
      });
    }
  }
  const sampled = [
    ...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values(),
  ];
  if (!sampled.length) return null;
  return {
    x1: Math.max(0, Math.floor(left)),
    y1: Math.max(0, Math.floor(top)),
    x2: Math.min(width - 1, Math.ceil(right)),
    y2: Math.min(height - 1, Math.ceil(bottom)),
    points: sampled.slice(0, 32),
  };
}
