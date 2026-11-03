import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceSize, calibrationLabel } from "../src/lib/reference-size.ts";
test("converts measured rectangle dimensions into canonical millimeters", () => {
  assert.deepEqual(referenceSize("12", "6", "in"), {
    width_mm: 304.8,
    height_mm: 152.4,
  });
  assert.deepEqual(referenceSize("30", "15", "cm"), {
    width_mm: 300,
    height_mm: 150,
  });
  assert.deepEqual(referenceSize("300", "150", "mm"), {
    width_mm: 300,
    height_mm: 150,
  });
  assert.deepEqual(referenceSize("12,5", "6.25", "cm"), {
    width_mm: 125,
    height_mm: 62.5,
  });
});
test("does not infer scale from empty, invalid, non-finite or unsupported measurements", () => {
  for (const value of [
    "",
    "0",
    "-2",
    "1e2",
    "Infinity",
    "NaN",
    "1/2",
    "12 inches",
    "1,234.5",
    "0.5",
    "2001",
  ])
    assert.equal(referenceSize(value, "100", "mm"), null, value);
  assert.equal(referenceSize("12", "", "cm"), null);
  assert.deepEqual(referenceSize("10", "2000", "mm"), {
    width_mm: 10,
    height_mm: 2000,
  });
});
test("describes manual rectangles separately from AR and standard cards", () => {
  assert.equal(calibrationLabel("known_rectangle"), "a measured rectangle");
  assert.equal(calibrationLabel("reference_card"), "a reference card");
  assert.equal(calibrationLabel("arkit_plane"), "phone surface tracking");
  assert.equal(calibrationLabel("unknown"), "the supplied size reference");
});
