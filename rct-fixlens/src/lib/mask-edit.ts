import type { SelectionPoint } from "../api/types";
import type { BrushStroke } from "./selection";
export interface MaskStroke extends BrushStroke {
  mode: "paint" | "erase";
}
export interface MaskEdit {
  base: "preview" | "blank";
  strokes: MaskStroke[];
}
export interface PhotoWindow {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function sourcePoint(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  window: PhotoWindow,
  photoWidth: number,
  photoHeight: number,
): SelectionPoint {
  "worklet";
  return {
    x: Math.max(
      0,
      Math.min(
        photoWidth - 1,
        Math.round(window.left + (x * window.width) / screenWidth),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        photoHeight - 1,
        Math.round(window.top + (y * window.height) / screenHeight),
      ),
    ),
  };
}
export function zoomWindow(
  window: PhotoWindow,
  zoom: number,
  photoWidth: number,
  photoHeight: number,
): PhotoWindow {
  const width = photoWidth / zoom,
    height = photoHeight / zoom;
  return {
    left: Math.max(
      0,
      Math.min(photoWidth - width, window.left + window.width / 2 - width / 2),
    ),
    top: Math.max(
      0,
      Math.min(
        photoHeight - height,
        window.top + window.height / 2 - height / 2,
      ),
    ),
    width,
    height,
  };
}
export function tracingStrokes(strokes: BrushStroke[]): MaskStroke[] {
  return strokes
    .map((s) => ({
      mode: "paint",
      radius: Math.max(0.5, Math.min(512, s.radius)),
      points:
        s.points.length > 256
          ? Array.from(
              { length: 256 },
              (_, i) => s.points[Math.round((i * (s.points.length - 1)) / 255)],
            )
          : s.points,
    }))
    .map((s) => ({
      ...s,
      mode: "paint" as const,
      points: s.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    }));
}
