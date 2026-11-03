import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sourcePoint,
  zoomWindow,
  tracingStrokes,
} from "../src/lib/mask-edit.ts";
test("zoomed portrait drawing maps back to source pixels and clamps image edges", () => {
  const window = { left: 300, top: 500, width: 750, height: 1000 };
  assert.deepEqual(sourcePoint(150, 200, 300, 400, window, 1500, 2000), {
    x: 675,
    y: 1000,
  });
  assert.deepEqual(sourcePoint(-100, 9999, 300, 400, window, 1500, 2000), {
    x: 50,
    y: 1999,
  });
});
test("zoom preserves the viewed center and returns to the complete photo at 1x", () => {
  const zoomed = zoomWindow(
    { left: 0, top: 0, width: 1500, height: 2000 },
    2,
    1500,
    2000,
  );
  assert.deepEqual(zoomed, { left: 375, top: 500, width: 750, height: 1000 });
  assert.deepEqual(zoomWindow(zoomed, 1, 1500, 2000), {
    left: 0,
    top: 0,
    width: 1500,
    height: 2000,
  });
});
test("the initial tracing keeps endpoints and bounded source-pixel strokes", () => {
  const points = Array.from({ length: 1024 }, (_, i) => ({
    x: i + 0.3,
    y: 30.6,
  }));
  const [stroke] = tracingStrokes([{ points, radius: 8 }]);
  assert.equal(stroke.mode, "paint");
  assert.equal(stroke.points.length, 256);
  assert.deepEqual(stroke.points[0], { x: 0, y: 31 });
  assert.deepEqual(stroke.points.at(-1), { x: 1023, y: 31 });
});
