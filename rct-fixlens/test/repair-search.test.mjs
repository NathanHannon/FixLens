import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repairSearchUrl,
  suggestedRepairTrade,
} from "../src/lib/repair-search.ts";

test("uses the assessment's trade and a category fallback without inventing businesses", () => {
  assert.equal(
    suggestedRepairTrade({
      category: "crack",
      pro: { trade: "  Concrete repair contractor  " },
      red_flags: [],
    }),
    "Concrete repair contractor",
  );
  assert.equal(
    suggestedRepairTrade({
      category: "appliance_error",
      pro: null,
      red_flags: [],
    }),
    "appliance repair technician",
  );
  assert.equal(
    suggestedRepairTrade({
      category: "water_stain",
      pro: { trade: "Qualified professional" },
      red_flags: [],
    }),
    "water damage restoration",
  );
});
test("resolves generic safety-gated trades into the flagged specialty", () => {
  for (const [flag, expected] of [
    ["gas", "licensed gas technician"],
    ["electrical_panel", "licensed electrician"],
    ["flooding_near_electrics", "licensed electrician"],
    ["structural_distress", "structural engineer"],
    ["asbestos", "asbestos abatement contractor"],
  ])
    assert.equal(
      suggestedRepairTrade({
        category: "other",
        pro: { trade: "Qualified professional" },
        red_flags: [flag],
      }),
      expected,
    );
});
test("sends only the explicit trade and area in a fixed-host Maps search", () => {
  const url = new URL(
    repairSearchUrl("  Plumber & heating  ", "  Montréal, QC  "),
  );
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps/search/");
  assert.deepEqual([...url.searchParams.keys()], ["api", "query"]);
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(
    url.searchParams.get("query"),
    "Plumber & heating in Montréal, QC",
  );
  const malicious = new URL(
    repairSearchUrl("Electrician&api=evil", "A?token=secret#b"),
  );
  assert.deepEqual([...malicious.searchParams.keys()], ["api", "query"]);
  assert.equal(
    malicious.searchParams.get("query"),
    "Electrician&api=evil in A?token=secret#b",
  );
});
test("uses Maps nearby search when the area is omitted rather than treating a room note as an address", () => {
  assert.equal(
    new URL(repairSearchUrl("electrician", "")).searchParams.get("query"),
    "electrician near me",
  );
});
test("rejects empty and oversized searches before opening a URL", () => {
  for (const [trade, area] of [
    ["  ", "Boston"],
    ["x".repeat(121), ""],
    ["plumber", "x".repeat(101)],
  ])
    assert.throws(() => repairSearchUrl(trade, area));
});
