import { test } from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/lib/capture-session.ts";

const draft = {
  photo: {
    uri: "file://test.jpg",
    width: 1200,
    height: 800,
    takenAt: "2026-10-26T12:00:00Z",
  },
  title: "Basement crack",
  category: "crack",
  location: "Basement",
  context: "New crack",
  hazards: ["gas"],
};
function fixture() {
  const calls = [];
  let failing = "";
  const record =
    (name, result) =>
    async (...args) => {
      calls.push({ name, args });
      if (failing === name) throw new Error(`${name} failed`);
      return result;
    };
  return {
    calls,
    fail: (name) => {
      failing = name;
    },
    api: {
      create: record("create", { id: "problem" }),
      uploadUrl: record("uploadUrl", {
        capture_id: "capture",
        photo_key: "captures/problem/capture.jpg",
        url: "https://test.invalid",
      }),
      register: record("register", { id: "capture" }),
      segment: record("segment", {
        token: "confirmed-mask",
        mask_url: "https://test.invalid/mask.png",
        expires_at: "2099-01-01T00:00:00Z",
        area_px: 10,
        perimeter_px: 28,
        sam_version: "sam-3.1",
        is_mock: false,
      }),
      diagnose: record("diagnose", { report: { capture_id: "capture" } }),
      editMask: record("editMask", {
        token: "edited-mask",
        mask_url: "https://test.invalid/edited.png",
        expires_at: "2099-01-01T00:00:00Z",
        area_px: 8,
        perimeter_px: 20,
        sam_version: "not-run",
        is_mock: false,
      }),
      problem: record("problem", { latest_report: null }),
    },
    put: record("put"),
    phase: record("phase"),
  };
}
const selection = { x1: 10, y1: 20, x2: 300, y2: 400 };
async function run(session, f) {
  if (!session.preview)
    await session.prepare(draft, selection, f.api, f.put, () => {});
  return session.submit(draft, f.api, () => {});
}
test("calibration stays tied to the prepared photo across failed preview retries", async () => {
  const f = fixture();
  const session = new CaptureSession();
  const calibration = {
    method: "reference_card",
    points: [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 70 },
      { x: 10, y: 70 },
    ],
    width_mm: 85.6,
    height_mm: 53.98,
  };
  const calibrated = { ...draft, photo: { ...draft.photo, calibration } };
  f.fail("segment");
  await assert.rejects(
    session.prepare(calibrated, selection, f.api, f.put, () => {}),
  );
  f.fail("");
  await session.prepare(calibrated, selection, f.api, f.put, () => {});
  const segments = f.calls.filter((c) => c.name === "segment");
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].args[3], calibration);
  assert.deepEqual(segments[1].args[3], calibration);
  assert.equal(f.calls.filter((c) => c.name === "put").length, 1);
});

test("new problem: saves, uploads, registers baseline, then diagnoses with safety flags", async () => {
  const f = fixture();
  const session = new CaptureSession();
  assert.equal(await run(session, f), "problem");
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["create", "uploadUrl", "put", "register", "segment", "diagnose"],
  );
  assert.equal(f.calls.find((c) => c.name === "register").args[3], true);
  assert.deepEqual(f.calls.find((c) => c.name === "diagnose").args, [
    "problem",
    "capture",
    "New crack",
    ["gas"],
    "confirmed-mask",
  ]);
});
test("re-capture reuses the existing problem without another baseline", async () => {
  const f = fixture();
  const session = new CaptureSession("existing");
  assert.equal(await run(session, f), "existing");
  assert.equal(
    f.calls.some((c) => c.name === "create"),
    false,
  );
  assert.equal(f.calls.find((c) => c.name === "register").args[3], false);
});
test("failed upload preserves draft/problem and gets a fresh URL on retry", async () => {
  const f = fixture();
  const session = new CaptureSession();
  f.fail("put");
  await assert.rejects(run(session, f));
  f.fail("");
  await run(session, f);
  assert.equal(f.calls.filter((c) => c.name === "create").length, 1);
  assert.equal(f.calls.filter((c) => c.name === "uploadUrl").length, 2);
  assert.equal(f.calls.filter((c) => c.name === "register").length, 1);
});
test("failed diagnosis retries without creating another capture or upload", async () => {
  const f = fixture();
  const session = new CaptureSession();
  f.fail("diagnose");
  await assert.rejects(run(session, f));
  f.fail("");
  await run(session, f);
  for (const name of ["create", "put", "register"])
    assert.equal(f.calls.filter((c) => c.name === name).length, 1);
  assert.equal(f.calls.filter((c) => c.name === "diagnose").length, 2);
});
test("lost registration response retries the same key without uploading twice", async () => {
  const f = fixture();
  const session = new CaptureSession();
  f.fail("register");
  await assert.rejects(run(session, f));
  f.fail("");
  await run(session, f);
  assert.equal(f.calls.filter((c) => c.name === "put").length, 1);
  const registrations = f.calls.filter((c) => c.name === "register");
  assert.equal(registrations.length, 2);
  assert.equal(
    registrations[0].args[1].photo_key,
    registrations[1].args[1].photo_key,
  );
});
test("a lost diagnosis response is recovered from its persisted report", async () => {
  const f = fixture();
  const session = new CaptureSession();
  f.fail("diagnose");
  f.api.problem = async () => ({ latest_report: { capture_id: "capture" } });
  assert.equal(await run(session, f), "problem");
});
test("an older capture report cannot hide a failed diagnosis", async () => {
  const f = fixture();
  const session = new CaptureSession();
  f.fail("diagnose");
  f.api.problem = async () => ({
    latest_report: { capture_id: "old-capture" },
  });
  await assert.rejects(run(session, f), /diagnose failed/);
});

test("previewing never invokes diagnosis, and redraw reuses the original upload", async () => {
  const f = fixture();
  const session = new CaptureSession();
  await session.prepare(draft, selection, f.api, f.put, () => {});
  assert.equal(f.calls.filter((c) => c.name === "diagnose").length, 0);
  await session.prepare(
    draft,
    { ...selection, x2: 350 },
    f.api,
    f.put,
    () => {},
  );
  assert.equal(f.calls.filter((c) => c.name === "put").length, 1);
  assert.equal(f.calls.filter((c) => c.name === "register").length, 1);
  assert.equal(f.calls.filter((c) => c.name === "segment").length, 2);
});
test("a failed SAM preview can be retried without another upload", async () => {
  const f = fixture();
  const session = new CaptureSession();
  f.fail("segment");
  await assert.rejects(
    session.prepare(draft, selection, f.api, f.put, () => {}),
  );
  assert.equal(session.preview, undefined);
  f.fail("");
  await session.prepare(draft, selection, f.api, f.put, () => {});
  assert.equal(f.calls.filter((c) => c.name === "put").length, 1);
});
test("expired or missing previews require review before assessment", async () => {
  const f = fixture();
  const session = new CaptureSession();
  await assert.rejects(
    session.submit(draft, f.api, () => {}),
    /Preview/,
  );
  await session.prepare(draft, selection, f.api, f.put, () => {});
  session.preview.expires_at = "2000-01-01T00:00:00Z";
  await assert.rejects(
    session.submit(draft, f.api, () => {}),
    /expired/,
  );
  assert.equal(f.calls.filter((c) => c.name === "diagnose").length, 0);
});
const edit = {
  base: "blank",
  strokes: [{ mode: "paint", radius: 4, points: [{ x: 20, y: 30 }] }],
};
test("undo after a failed assessment applies edits to the visible original preview", async () => {
  const f = fixture(),
    session = new CaptureSession();
  await session.prepare(draft, selection, f.api, f.put, () => {});
  const originalToken = session.preview.token;
  const erase = {
    base: "preview",
    strokes: [{ mode: "erase", radius: 4, points: [{ x: 20, y: 30 }] }],
  };
  await session.prepare(
    draft,
    selection,
    f.api,
    f.put,
    () => {},
    erase,
    originalToken,
  );
  assert.equal(session.preview.token, "edited-mask");
  await session.prepare(
    draft,
    selection,
    f.api,
    f.put,
    () => {},
    { ...erase, strokes: [] },
    originalToken,
  );
  const saves = f.calls.filter((c) => c.name === "editMask");
  assert.equal(saves.length, 2);
  assert.equal(saves[1].args[4], originalToken);
});
test("manual outline proceeds to assessment without automatic segmentation", async () => {
  const f = fixture(),
    session = new CaptureSession();
  await session.prepare(draft, selection, f.api, f.put, () => {}, edit);
  assert.equal(await session.submit(draft, f.api, () => {}), "problem");
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["create", "uploadUrl", "put", "register", "editMask", "diagnose"],
  );
  assert.equal(
    f.calls.find((c) => c.name === "diagnose").args[4],
    "edited-mask",
  );
});
test("retry after final assessment failure reuses the saved edited outline", async () => {
  const f = fixture(),
    session = new CaptureSession();
  await session.prepare(draft, selection, f.api, f.put, () => {}, edit);
  f.fail("diagnose");
  await assert.rejects(session.submit(draft, f.api, () => {}));
  f.fail("");
  await session.prepare(draft, selection, f.api, f.put, () => {}, edit);
  await session.submit(draft, f.api, () => {});
  for (const name of ["create", "put", "register", "editMask"])
    assert.equal(f.calls.filter((c) => c.name === name).length, 1);
  assert.equal(f.calls.filter((c) => c.name === "diagnose").length, 2);
});
test("changed strokes and cancellation invalidate the cached edit confirmation", async () => {
  const f = fixture(),
    session = new CaptureSession();
  await session.prepare(draft, selection, f.api, f.put, () => {});
  const automatic = session.preview;
  await session.prepare(draft, selection, f.api, f.put, () => {}, edit);
  session.preview = automatic;
  await session.prepare(draft, selection, f.api, f.put, () => {}, edit);
  await session.prepare(draft, selection, f.api, f.put, () => {}, {
    ...edit,
    strokes: [{ ...edit.strokes[0], radius: 6 }],
  });
  assert.equal(f.calls.filter((c) => c.name === "editMask").length, 3);
  assert.equal(f.calls.filter((c) => c.name === "put").length, 1);
});
