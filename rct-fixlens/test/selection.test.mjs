import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionFromStrokes, strokePath } from "../src/lib/selection.ts";
test("preserves freehand path geometry instead of replacing it with an oval", () => {
  assert.equal(
    strokePath([
      { x: 10, y: 20 },
      { x: 25, y: 40 },
      { x: 30, y: 15 },
    ]),
    "M10,20L25,40L30,15",
  );
  assert.ok(strokePath([{ x: 10, y: 20 }]).startsWith("M10,20L"));
});
test("brush bounds include radius, clamp to image edges, and retain foreground points", () => {
  assert.deepEqual(
    selectionFromStrokes(
      [
        {
          points: [
            { x: 10.2, y: 20.8 },
            { x: 50, y: 90 },
          ],
          radius: 15,
        },
      ],
      100,
      100,
    ),
    {
      x1: 0,
      y1: 5,
      x2: 65,
      y2: 99,
      points: [
        { x: 10, y: 20 },
        { x: 50, y: 90 },
      ],
    },
  );
  assert.equal(selectionFromStrokes([], 100, 100), null);
});
test("sampling stays bounded and includes every painted stroke", () => {
  const strokes = Array.from({ length: 16 }, (_, i) => ({
    points: Array.from({ length: 100 }, (_, j) => ({
      x: i * 50 + j / 10,
      y: i * 40 + j / 10,
    })),
    radius: 5,
  }));
  const selection = selectionFromStrokes(strokes, 1000, 1000);
  assert.equal(selection.points.length, 32);
  for (let i = 0; i < 16; i++)
    assert.ok(selection.points.some((p) => p.x === i * 50 && p.y === i * 40));
});
