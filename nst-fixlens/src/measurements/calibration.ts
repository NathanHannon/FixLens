import { BadRequestException } from '@nestjs/common';

export interface Point {
  x: number;
  y: number;
}
export interface CalibrationInput {
  method: 'reference_card' | 'known_rectangle' | 'arkit_plane' | 'arcore_plane';
  points: Point[];
  width_mm: number;
  height_mm: number;
}
export interface Calibration extends CalibrationInput {
  version: 1;
  quality: 'approximate';
  image_width: number;
  image_height: number;
  image_to_plane: number[];
}
const invalid = () =>
  new BadRequestException(
    'Calibration needs four ordered corners of a visible rectangle on the same flat surface. Use a closer, clearer reference or continue without measurements.',
  );

// Four correspondences determine a planar homography. Coordinates describe
// pixel edges: the image extends from (0,0) to (width,height).
export function calibrate(
  input: CalibrationInput,
  width: number,
  height: number,
): Calibration {
  const { points: p, width_mm: w, height_mm: h } = input;
  if (
    p.length !== 4 ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w < 10 ||
    h < 10 ||
    w > 2000 ||
    h > 2000 ||
    p.some(
      (q) =>
        !Number.isFinite(q.x) ||
        !Number.isFinite(q.y) ||
        q.x < 0 ||
        q.y < 0 ||
        q.x > width ||
        q.y > height,
    )
  )
    throw invalid();
  const crosses = p.map((a, i) => {
    const b = p[(i + 1) % 4],
      c = p[(i + 2) % 4];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 10) throw invalid();
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  if (!crosses.every((c) => c > 1) && !crosses.every((c) => c < -1))
    throw invalid();
  const polygonArea =
    Math.abs(
      p.reduce(
        (s, a, i) => s + a.x * p[(i + 1) % 4].y - a.y * p[(i + 1) % 4].x,
        0,
      ),
    ) / 2;
  if (polygonArea < 400) throw invalid();
  // Normalize source coordinates for stable elimination, then convert back.
  const targets = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const rows = p.flatMap((a, i) => {
    const x = a.x / width,
      y = a.y / height,
      [u, v] = targets[i];
    return [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ];
  });
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++)
      if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const divisor = rows[c][c];
    if (Math.abs(divisor) < 1e-10) throw invalid();
    for (let j = c; j <= 8; j++) rows[c][j] /= divisor;
    for (let r = 0; r < 8; r++)
      if (r !== c) {
        const factor = rows[r][c];
        for (let j = c; j <= 8; j++) rows[r][j] -= factor * rows[c][j];
      }
  }
  const t = rows.map((r) => r[8]);
  const transform = [
    t[0] / width,
    t[1] / height,
    t[2],
    t[3] / width,
    t[4] / height,
    t[5],
    t[6] / width,
    t[7] / height,
    1,
  ];
  // Reject horizons and severe perspective amplification anywhere in the image.
  const denominators = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => transform[6] * x + transform[7] * y + 1);
  if (
    !transform.every(Number.isFinite) ||
    denominators.some((d) => d <= 0) ||
    Math.max(...denominators) / Math.min(...denominators) > 5
  )
    throw invalid();
  return {
    ...input,
    version: 1,
    quality: 'approximate',
    image_width: width,
    image_height: height,
    image_to_plane: transform,
  };
}
export function project(t: number[], x: number, y: number): Point {
  const d = t[6] * x + t[7] * y + t[8];
  return {
    x: (t[0] * x + t[1] * y + t[2]) / d,
    y: (t[3] * x + t[4] * y + t[5]) / d,
  };
}
// Integrate each foreground pixel's projected quadrilateral. A global
// mm-per-pixel scalar is incorrect when perspective changes across an image.
export function calibratedArea(
  mask: Uint8Array,
  width: number,
  height: number,
  calibration: Calibration,
): number {
  let area = 0;
  const t = calibration.image_to_plane;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const p = [
        project(t, x, y),
        project(t, x + 1, y),
        project(t, x + 1, y + 1),
        project(t, x, y + 1),
      ];
      // Translate before shoelace to avoid cancellation for distant plane origins.
      const a = p[0];
      area +=
        Math.abs(
          (p[1].x - a.x) * (p[2].y - a.y) -
            (p[1].y - a.y) * (p[2].x - a.x) +
            (p[2].x - a.x) * (p[3].y - a.y) -
            (p[2].y - a.y) * (p[3].x - a.x),
        ) / 2;
    }
  if (!Number.isFinite(area) || area <= 0) throw invalid();
  return area;
}
