import { test, expect, type Page } from "@playwright/test";

const problemId = "11111111-1111-4111-8111-111111111111";
const captureId = "22222222-2222-4222-8222-222222222222";
const problem = {
  id: problemId,
  title: "Home check · Basement",
  category: "other",
  location_note: "Basement",
  created_at: "2026-10-26T12:00:00Z",
  current_urgency: null,
  status: "active",
};
const report = {
  id: "report",
  capture_id: captureId,
  verdict: "Mock assessment: surface damage",
  category: "other",
  likely_cause: "Demo finding",
  urgency: "pro_now",
  confidence: "0.65",
  confidence_note: "Simulated",
  safety_override: true,
  diy: null,
  pro: {
    trade: "Qualified professional",
    what_to_tell_them: "Arrange an assessment.",
  },
  red_flags: ["gas"],
  recheck_days: null,
  spark_version: "mock-vision-v1",
  sam_version: "mock-sam-3.1",
  created_at: "2026-10-26T12:00:00Z",
};

async function backend(
  page: Page,
  failDiagnosis = false,
  failList = false,
  unavailable = false,
  rejected = false,
  failEdit = false,
  failDelete = false,
) {
  const counts = {
    creates: 0,
    uploads: 0,
    registrations: 0,
    segments: 0,
    diagnoses: 0,
  };
  let savedReport = false;
  let currentProblem = { ...problem };
  let calibrated = false;
  let deletedJob = false,
    deleteAttempts = 0,
    previewCount = 2;
  let calibrationMethod = "reference_card";
  let edits = 0;
  let confirmationToken = "confirmed-mask";
  await page.route("**/problems**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type",
    };
    const respond = (body: unknown, status = 200) =>
      route.fulfill({ status, headers, json: body });
    if (req.method() === "OPTIONS") return respond({});
    if (url.pathname === "/problems") {
      if (req.method() === "GET")
        return failList
          ? respond({ error: { message: "Database unavailable" } }, 503)
          : respond(counts.creates && !deletedJob ? [currentProblem] : []);
      counts.creates++;
      currentProblem = { ...problem, ...req.postDataJSON() };
      return respond(currentProblem, 201);
    }
    if (url.pathname.endsWith("/upload-url"))
      return respond(
        {
          capture_id: captureId,
          photo_key: `captures/${problemId}/${captureId}.jpg`,
          url: "https://uploads.fixlens.test/photo.jpg",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          expires_in: 300,
        },
        201,
      );
    if (
      url.pathname === "/problems/" + problemId &&
      req.method() === "DELETE"
    ) {
      deleteAttempts++;
      if (failDelete && deleteAttempts === 1)
        return respond(
          { error: { message: "Deletion unavailable. Try again." } },
          503,
        );
      deletedJob = true;
      return respond(
        { id: problemId, status: "deleted", cleanup_pending: true },
        202,
      );
    }
    if (url.pathname.endsWith("/storage"))
      return respond({
        photos: 1,
        outlines: 1,
        previews: previewCount,
        bytes: 1572864,
      });
    if (url.pathname.endsWith("/previews") && req.method() === "DELETE") {
      previewCount = 0;
      return respond({ removed: 2 });
    }
    if (url.pathname.endsWith("/captures")) {
      counts.registrations++;
      return respond({ id: captureId }, 201);
    }
    if (url.pathname.endsWith("/segment")) {
      calibrated = Boolean(req.postDataJSON().calibration);
      calibrationMethod =
        req.postDataJSON().calibration?.method ?? "reference_card";
      counts.segments++;
      const selection = req.postDataJSON().selection;
      expect(selection.x2).toBeGreaterThan(selection.x1);
      expect(selection.y2).toBeGreaterThan(selection.y1);
      expect(selection.points.length).toBeGreaterThan(0);
      expect(selection.points.length).toBeLessThanOrEqual(32);
      return respond(
        {
          token: "confirmed-mask",
          mask_url: unavailable
            ? null
            : "https://uploads.fixlens.test/mask.png",
          outline_url: unavailable
            ? null
            : "https://uploads.fixlens.test/outline.png",
          status: unavailable ? "unavailable" : "candidate",
          reason: unavailable
            ? "The highlight included unaffected ceiling."
            : null,
          expires_at: "2099-01-01T00:00:00Z",
          area_px: unavailable ? null : 10,
          perimeter_px: unavailable ? null : 28,
          sam_version: "sam-3.1",
          is_mock: false,
          calibrated_area_mm2: null,
        },
        201,
      );
    }
    if (url.pathname.endsWith("/mask-edits")) {
      const body = req.postDataJSON();
      calibrated = Boolean(body.calibration);
      calibrationMethod = body.calibration?.method ?? "reference_card";
      expect(body.capture_id).toBe(captureId);
      expect(body.strokes.length).toBeLessThanOrEqual(64);
      if (failEdit && edits++ === 0)
        return respond(
          { error: { message: "Could not save outline. Try again." } },
          503,
        );
      confirmationToken = "corrected-mask";
      return respond(
        {
          token: confirmationToken,
          mask_url: "https://uploads.fixlens.test/mask.png",
          status: "candidate",
          outline_source:
            body.base === "preview" ? "user_corrected" : "user_drawn",
          expires_at: "2099-01-01T00:00:00Z",
          area_px: 8,
          perimeter_px: 20,
          sam_version: counts.segments ? "sam-3.1" : "not-run",
          is_mock: false,
        },
        201,
      );
    }
    if (url.pathname.endsWith("/diagnose")) {
      expect(req.postDataJSON().segmentation_token).toBe(confirmationToken);
      counts.diagnoses++;
      if (failDiagnosis && counts.diagnoses === 1)
        return respond({ error: { message: "Try once more" } }, 503);
      savedReport = true;
      return respond(
        {
          report:
            unavailable || rejected
              ? {
                  ...report,
                  confidence_note:
                    "Photo-based assessment; measurements unavailable: Unaffected ceiling was included.",
                }
              : report,
          measurement: unavailable || rejected ? null : {},
        },
        201,
      );
    }
    if (url.pathname.endsWith("/media"))
      return respond({
        capture_id: captureId,
        expires_in: 300,
        photo: {
          url: "https://uploads.fixlens.test/saved-photo.jpg",
          filename: `fixlens-${captureId}-photo.jpg`,
          content_type: "image/jpeg",
        },
        mask: {
          url: "https://uploads.fixlens.test/saved-mask.png",
          filename: `fixlens-${captureId}-mask.png`,
          content_type: "image/png",
        },
      });
    if (url.pathname.endsWith("/deltas")) return respond([]);
    return respond({
      ...currentProblem,
      current_urgency: savedReport ? "pro_now" : null,
      latest_report: savedReport
        ? unavailable || rejected
          ? {
              ...report,
              confidence_note:
                "Photo-based assessment; measurements unavailable: Unaffected ceiling was included.",
            }
          : report
        : null,
      delta_summary: null,
      ...(calibrated && !unavailable && !rejected
        ? {
            latest_measurement: {
              calibrated_area_mm2: 4500,
              calibration: {
                method: calibrationMethod,
                quality: "approximate",
              },
            },
          }
        : {}),
    });
  });
  await page.route("https://uploads.fixlens.test/**", async (route) => {
    if (route.request().method() === "PUT") counts.uploads++;
    if (route.request().method() === "GET")
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        path: "assets/images/icon.png",
        headers: { "access-control-allow-origin": "*" },
      });
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT",
        "access-control-allow-headers": "Content-Type",
      },
    });
  });
  return counts;
}

async function drawStroke(page: Page) {
  const canvas = page.getByTestId("photo-selection");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx + box.width * 0.25, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(
      cx + (i / 24 - 0.5) * box.width * 0.4,
      cy + Math.sin((i / 24) * Math.PI * 3) * box.height * 0.15,
    );
  }
  await page.mouse.up();
  await expect(
    page.getByText("Preview highlight", { exact: true }),
  ).toBeEnabled();
}
async function openSavedJob(page: Page) {
  await page.route("**/problems", (route) =>
    route.fulfill({
      json: [problem],
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("link", { name: "Open " + problem.title, exact: true })
    .click();
}
async function choosePhoto(page: Page, details = true) {
  await page.getByText("Check a problem", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Choose from photos", { exact: true }).click();
  await (await chooser).setFiles("assets/images/icon.png");
  await expect(
    page.getByText("Preview highlight", { exact: true }),
  ).toBeDisabled();
  await drawStroke(page);
  if (!details) return;
  await page.getByText("More details (optional)", { exact: true }).click();
  await page.getByPlaceholder("Basement, north wall").fill("Basement");
  await page
    .getByPlaceholder("Thin gray scuff near the light, not the whole ceiling")
    .fill("New damage");
}
async function editStroke(page: Page) {
  const canvas = page.getByTestId("mask-editor");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
}
test("corrects a SAM highlight with Paint, Erase, zoom and Undo; retains edits after a failed save", async ({
  page,
}) => {
  const counts = await backend(page, false, false, false, false, true);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await page.getByText("Edit highlight", { exact: true }).click();
  await page.getByText("2×", { exact: true }).click();
  await editStroke(page);
  await page.getByTestId("mask-tool").selectOption("erase");
  await editStroke(page);
  await page.getByText("Undo edit", { exact: true }).click();
  await editStroke(page);
  await page.getByTestId("mask-tool").selectOption("move");
  await editStroke(page);
  await page.screenshot({
    path: ".tmp/edit-highlight-phone.png",
    fullPage: true,
  });
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/mask-edits") && req.method() === "POST",
  );
  await page.getByText("Use outline and assess", { exact: true }).click();
  const body = (await sent).postDataJSON();
  expect(body.base).toBe("preview");
  expect(body.segmentation_token).toBe("confirmed-mask");
  expect(body.strokes.map((s: { mode: string }) => s.mode)).toEqual([
    "paint",
    "erase",
  ]);
  expect(body.strokes[0].radius).toBeLessThan(20);
  await expect(
    page.getByText("Could not save outline. Try again.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mask-editor")).toBeVisible();
  const retried = page.waitForRequest(
    (req) => req.url().endsWith("/mask-edits") && req.method() === "POST",
  );
  await page.getByText("Use outline and assess", { exact: true }).click();
  expect((await retried).postDataJSON()).toEqual(body);
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  expect(counts.uploads).toBe(1);
  expect(counts.registrations).toBe(1);
  expect(counts.segments).toBe(1);
  expect(counts.diagnoses).toBe(1);
});
test("uses a manual outline without invoking SAM, including clear and cancel", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Use my tracing", { exact: true }).click();
  await page.getByText("Cancel edits", { exact: true }).click();
  expect(counts.uploads).toBe(0);
  await page.getByText("Use my tracing", { exact: true }).click();
  await page.getByText("Clear highlight", { exact: true }).click();
  await expect(
    page.getByText("Use outline and assess", { exact: true }),
  ).toBeDisabled();
  await editStroke(page);
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/mask-edits") && req.method() === "POST",
  );
  await page.getByText("Use outline and assess", { exact: true }).click();
  expect((await sent).postDataJSON().base).toBe("blank");
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  expect(counts.uploads).toBe(1);
  expect(counts.segments).toBe(0);
  expect(counts.diagnoses).toBe(1);
});
test("offers manual correction after automatic isolation fails", async ({
  page,
}) => {
  const counts = await backend(page, false, false, true);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await page.getByText("Draw my own outline", { exact: true }).click();
  await page.getByText("Use outline and assess", { exact: true }).click();
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  expect(counts.uploads).toBe(1);
  expect(counts.segments).toBe(1);
  expect(counts.diagnoses).toBe(1);
});
test("the default path needs only photo, paint, preview and assessment", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page, false);
  await expect(
    page.getByText("Use selected area", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder("Basement, north wall")).toBeHidden();
  await expect(
    page.getByRole("switch", { name: "Gas smell or suspected gas leak" }),
  ).toBeHidden();
  await expect(
    page.getByText("Add size reference", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: ".tmp/streamlined-mark-phone.png",
    fullPage: true,
  });
  await page.getByText("Preview highlight", { exact: true }).click();
  const outline = page.getByRole("img", { name: "Damage outline", exact: true });
  const shade = page.getByRole("switch", { name: "Shade inside the outline" });
  await expect(outline).toBeVisible();
  await expect(page.getByTestId("brush-stroke-0")).toHaveCount(0);
  await expect(page.getByTestId("outline-fill")).toBeVisible();
  await expect(shade).toBeChecked();
  await page.getByText("Shade inside the outline", { exact: true }).click();
  await expect(shade).not.toBeChecked();
  await expect(page.getByTestId("outline-fill")).toHaveCount(0);
  await expect(outline).toBeVisible();
  await page.getByText("Get assessment", { exact: true }).click();
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Simulated", { exact: true })).toBeHidden();
  await expect(
    page.getByText("Call a professional", { exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("img", { name: "Assessment photo", exact: true }),
  ).toBeInViewport();
  await page.getByText("Assessment details", { exact: true }).click();
  await expect(page.getByText("Simulated", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".tmp/streamlined-report-phone.png",
    fullPage: true,
  });
  expect(counts).toEqual({
    creates: 1,
    uploads: 1,
    registrations: 1,
    segments: 1,
    diagnoses: 1,
  });
});
test("a visible description guides targeting and can be refined without another upload", async ({
  page,
}) => {
  const counts = await backend(page);
  const targets: string[] = [],
    assessments: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (req.url().endsWith("/segment"))
      targets.push(req.postDataJSON().context);
    if (req.url().endsWith("/diagnose"))
      assessments.push(req.postDataJSON().context);
  });
  await page.goto("/");
  await choosePhoto(page, false);
  const description = page.getByPlaceholder(
    "Thin gray scuff near the light, not the whole ceiling",
  );
  await expect(description).toBeVisible();
  const help = page.getByText("Describe the mark’s shape, color, and location", {
    exact: false,
  });
  await expect(help).toBeVisible();
  const fieldBox = await description.boundingBox();
  const helpBox = await help.boundingBox();
  expect(fieldBox).not.toBeNull();
  expect(helpBox).not.toBeNull();
  if (fieldBox && helpBox) {
    expect(helpBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
  }
  await expect(page.getByPlaceholder("Basement, north wall")).toBeHidden();
  await description.fill("  Gray mark near the light.  ");
  await page.getByText("Preview highlight", { exact: true }).click();
  await expect(
    page.getByText("Does the highlight cover the problem?", { exact: true }),
  ).toBeVisible();
  expect(targets).toEqual(["Gray mark near the light."]);
  await page.getByText("Adjust description or area", { exact: true }).click();
  await expect(description).toHaveValue("  Gray mark near the light.  ");
  await expect(description).toBeEditable();
  await description.fill(
    "Thin gray scuff near the light; leave out the surrounding ceiling.",
  );
  await page.screenshot({
    path: ".tmp/description-mark-phone.png",
    fullPage: true,
  });
  await page.getByText("Preview highlight", { exact: true }).click();
  await expect(
    page.getByText("Does the highlight cover the problem?", { exact: true }),
  ).toBeVisible();
  expect(targets).toEqual([
    "Gray mark near the light.",
    "Thin gray scuff near the light; leave out the surrounding ceiling.",
  ]);
  expect(counts).toMatchObject({
    creates: 1,
    uploads: 1,
    registrations: 1,
    segments: 2,
    diagnoses: 0,
  });
  await page.getByText("Get assessment", { exact: true }).click();
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  expect(assessments).toEqual([targets[1]]);
});

test("a failed assessment reuses the saved outline when the user retries in the editor", async ({
  page,
}) => {
  const counts = await backend(page, true);
  let editCalls = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/mask-edits") && req.method() === "POST")
      editCalls++;
  });
  await page.goto("/");
  await choosePhoto(page, false);
  await page.getByText("Use my tracing", { exact: true }).click();
  await page.getByText("Use outline and assess", { exact: true }).click();
  await expect(page.getByText("Try once more", { exact: true })).toBeVisible();
  await expect(page.getByTestId("mask-editor")).toBeVisible();
  await page.getByText("Use outline and assess", { exact: true }).click();
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  expect(editCalls).toBe(1);
  expect(counts.uploads).toBe(1);
  expect(counts.diagnoses).toBe(2);
  expect(counts.segments).toBe(0);
});
test("checking again keeps the same problem and registers a non-baseline capture", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page, false);
  await page.getByText("Preview highlight", { exact: true }).click();
  await page.getByText("Get assessment", { exact: true }).click();
  await page.getByText("Check again", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Choose from photos", { exact: true }).click();
  await (await chooser).setFiles("assets/images/icon.png");
  await drawStroke(page);
  const capture = page.waitForRequest(
    (req) => req.url().endsWith("/captures") && req.method() === "POST",
  );
  await page.getByText("Preview highlight", { exact: true }).click();
  expect((await capture).postDataJSON().is_baseline).toBe(false);
  await expect(
    page.getByText("Does the highlight cover the problem?", { exact: true }),
  ).toBeVisible();
  expect(counts.creates).toBe(1);
  expect(counts.registrations).toBe(2);
});

test("optional reference card preserves photo coordinates and shows approximate area after assessment", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Size estimate (optional)", { exact: true }).click();
  await page.getByText("Add size reference", { exact: true }).click();
  const use = page.getByText("Use reference card", { exact: true });
  await expect(use).toBeDisabled();
  const canvas = page.getByTestId("photo-calibration");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  for (const [x, y] of [
    [0.2, 0.2],
    [0.7, 0.2],
    [0.7, 0.5],
    [0.2, 0.5],
  ]) {
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  }
  await expect(page.getByText("4 / 4 corners selected")).toBeVisible();
  await page.getByText("Undo corner", { exact: true }).click();
  await expect(page.getByText("3 / 4 corners selected")).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const updated = (await canvas.boundingBox())!;
  await page.mouse.click(
    updated.x + 0.2 * updated.width,
    updated.y + 0.5 * updated.height,
  );
  await expect(use).toBeDisabled();
  await page
    .getByText("Standard card on the same flat surface", { exact: true })
    .click();
  await expect(use).toBeEnabled();
  await page.screenshot({ path: ".tmp/calibration-phone.png", fullPage: true });
  await use.click();
  expect(counts.uploads).toBe(0);
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/segment") && req.method() === "POST",
  );
  await page.getByText("Preview highlight", { exact: true }).click();
  const calibration = (await sent).postDataJSON().calibration;
  expect(calibration.method).toBe("reference_card");
  expect(calibration.width_mm).toBe(85.6);
  expect(calibration.height_mm).toBe(53.98);
  expect(calibration.points).toHaveLength(4);
  expect(calibration.points[0].x).toBeGreaterThan(150);
  await expect(
    page.getByText(
      "Size estimates are shown only when the outline and reference are usable.",
    ),
  ).toBeVisible();
  await expect(page.getByText("45 cm²", { exact: false })).toHaveCount(0);
  await page.getByText("Get assessment", { exact: true }).click();
  await expect(
    page.getByText("Approximately 45 cm² of highlighted surface.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(counts.uploads).toBe(1);
  expect(counts.diagnoses).toBe(1);
});

test("photo → context → direct upload → safety report, with recovery from failed diagnosis", async ({
  page,
}) => {
  const counts = await backend(page, true);
  await page.goto("/");
  await expect(page.getByText("Start with one photo.")).toBeVisible();
  await choosePhoto(page);
  await page
    .getByPlaceholder("Ceiling scuff, peeling paint, chipped tile")
    .fill("  Ceiling scuff  ");
  await page.getByText("Safety concerns", { exact: true }).click();
  await page
    .getByText("Gas smell or suspected gas leak", { exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Gas smell or suspected gas leak" }),
  ).toBeChecked();
  const created = page.waitForRequest(
    (req) =>
      new URL(req.url()).pathname === "/problems" && req.method() === "POST",
  );
  const targeted = page.waitForRequest(
    (req) => req.url().endsWith("/segment") && req.method() === "POST",
  );
  await page.getByText("Preview highlight", { exact: true }).click();
  expect((await created).postDataJSON()).toMatchObject({
    title: "Ceiling scuff · Basement",
    category: "other",
  });
  expect((await targeted).postDataJSON()).toMatchObject({
    context: "User-described problem: Ceiling scuff\n\nNew damage",
    hazards: ["gas"],
  });
  await expect(
    page.getByText("Does the highlight cover the problem?", { exact: true }),
  ).toBeVisible();
  expect(counts.diagnoses).toBe(0);
  await page.screenshot({ path: ".tmp/highlight-phone.png", fullPage: true });
  const assessment = page.waitForRequest(
    (req) => req.url().endsWith("/diagnose") && req.method() === "POST",
  );
  await page.getByText("Get assessment", { exact: true }).click();
  expect((await assessment).postDataJSON().context).toBe(
    "User-described problem: Ceiling scuff\n\nNew damage",
  );
  await expect(page.getByText("Try once more", { exact: true })).toBeVisible();
  await page.getByText("Retry assessment", { exact: true }).click();
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("DIY instructions are unavailable.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Your next steps", { exact: true })).toHaveCount(
    0,
  );
  expect(counts).toEqual({
    creates: 1,
    uploads: 1,
    registrations: 1,
    segments: 1,
    diagnoses: 2,
  });
  await page.screenshot({ path: ".tmp/report-phone.png", fullPage: true });
  await page.getByText("Back to my home", { exact: true }).click();
  await expect(
    page.getByText("Ceiling scuff · Basement", { exact: true }),
  ).toBeVisible();
});
test("an existing photo can use an inch-measured rectangle and identifies that reference in the report", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page, false);
  await page.getByText("Size estimate (optional)", { exact: true }).click();
  await page.getByText("Add size reference", { exact: true }).click();
  await page.getByTestId("reference-method").selectOption("known_rectangle");
  await page.getByTestId("reference-unit").selectOption("in");
  await page.getByPlaceholder("Measured width").fill("12");
  await page.getByPlaceholder("Measured height").fill("6");
  const use = page.getByText("Use measured rectangle", { exact: true });
  await expect(use).toBeDisabled();
  const canvas = page.getByTestId("photo-calibration");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  for (const [x, y] of [
    [0.2, 0.2],
    [0.7, 0.25],
    [0.65, 0.65],
    [0.15, 0.6],
  ])
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  await expect(use).toBeDisabled();
  await page
    .getByText("Measured rectangle on the same flat surface", { exact: true })
    .click();
  await page.screenshot({
    path: ".tmp/measured-rectangle-phone.png",
    fullPage: true,
  });
  await use.click();
  expect(counts.uploads).toBe(0);
  await page.getByText("Size reference added", { exact: true }).click();
  await expect(
    page.getByText("Using a measured rectangle.", { exact: true }),
  ).toBeVisible();
  await page.getByText("Change size reference", { exact: true }).click();
  await expect(page.getByPlaceholder("Measured width")).toHaveValue("30.48");
  await expect(page.getByPlaceholder("Measured height")).toHaveValue("15.24");
  await expect(
    page.getByText("4 / 4 corners selected", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Measured rectangle on the same flat surface", { exact: true })
    .click();
  await use.click();
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/segment") && req.method() === "POST",
  );
  await page.getByText("Preview highlight", { exact: true }).click();
  expect((await sent).postDataJSON().calibration).toMatchObject({
    method: "known_rectangle",
    width_mm: 304.8,
    height_mm: 152.4,
  });
  await page.getByText("Get assessment", { exact: true }).click();
  await expect(
    page.getByText("Calibrated using a measured rectangle.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("phone surface tracking", { exact: false }),
  ).toHaveCount(0);
  expect(counts.uploads).toBe(1);
  expect(counts.diagnoses).toBe(1);
});
test("invalid rectangle sizes and crossed corners preserve the draft without uploading", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page, false);
  await page.getByText("Size estimate (optional)", { exact: true }).click();
  await page.getByText("Add size reference", { exact: true }).click();
  await page.getByTestId("reference-method").selectOption("known_rectangle");
  const canvas = page.getByTestId("photo-calibration");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  for (const [x, y] of [
    [0.2, 0.2],
    [0.7, 0.2],
    [0.2, 0.6],
    [0.7, 0.6],
  ])
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  await page
    .getByText("Measured rectangle on the same flat surface", { exact: true })
    .click();
  const use = page.getByText("Use measured rectangle", { exact: true });
  await use.click();
  await expect(
    page.getByText("Enter the actual measured width and height.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByPlaceholder("Measured width").fill("30");
  await page.getByPlaceholder("Measured height").fill("15");
  await use.click();
  await expect(
    page.getByText("Those corners cross or overlap.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Measured width")).toHaveValue("30");
  await page.getByText("Clear corners", { exact: true }).click();
  await expect(
    page.getByText("0 / 4 corners selected", { exact: true }),
  ).toBeVisible();
  await expect(use).toBeDisabled();
  expect(counts.uploads).toBe(0);
  expect(counts.segments).toBe(0);
});

test("unreliable segmentation can be assessed without a mask or physical measurements", async ({
  page,
}) => {
  const counts = await backend(page, false, false, true);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await expect(page.getByText("We couldn't isolate the mark.")).toBeVisible();
  await expect(
    page.getByText("The highlight included unaffected ceiling.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Get assessment", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByText("Assess photo without measurements", { exact: true })
    .click();
  await expect(
    page.getByText("Assessment ready · Size unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("size and growth weren’t recorded", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("No physical size estimate is available for this capture."),
  ).toBeVisible();
  await page.getByText("Save a device copy", { exact: true }).click();
  await expect(page.getByText("Save photo", { exact: true })).toBeVisible();
  expect(counts.uploads).toBe(1);
  expect(counts.diagnoses).toBe(1);
});

test("a final mask rejection shows the saved photo-only report after a candidate preview", async ({
  page,
}) => {
  await backend(page, false, false, false, true);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await expect(
    page.getByText("Does the highlight cover the problem?"),
  ).toBeVisible();
  await page.getByText("Get assessment", { exact: true }).click();
  await expect(
    page.getByText("Assessment ready · Size unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No physical size estimate is available for this capture."),
  ).toBeVisible();
});

test("failed first load shows an error and retry, never an empty home", async ({
  page,
}) => {
  await backend(page, false, true);
  await page.goto("/");
  await expect(
    page.getByText("Database unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Start with one photo.")).toHaveCount(0);
  await expect(page.getByText("Try again", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".tmp/error-phone.png", fullPage: true });
});

test("redrawing previews a different region without another photo upload or early diagnosis", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await expect(
    page.getByText("Does the highlight cover the problem?"),
  ).toBeVisible();
  await page.getByText("Adjust description or area", { exact: true }).click();
  await drawStroke(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await expect(
    page.getByText("Does the highlight cover the problem?"),
  ).toBeVisible();
  expect(counts.uploads).toBe(1);
  expect(counts.registrations).toBe(1);
  expect(counts.segments).toBe(2);
  expect(counts.diagnoses).toBe(0);
});

test("freehand strokes persist, undo individually, and clear without uploading", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await page.getByText("Check a problem", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Choose from photos", { exact: true }).click();
  await (await chooser).setFiles("assets/images/icon.png");
  await drawStroke(page);
  await expect(page.getByTestId("brush-stroke-0")).toHaveAttribute("d", /L/);
  const first = await page.getByTestId("brush-stroke-0").getAttribute("d");
  await drawStroke(page);
  await expect(page.getByTestId("brush-stroke-1")).toBeAttached();
  await page.getByText("Undo stroke", { exact: true }).click();
  await expect(page.getByTestId("brush-stroke-1")).toHaveCount(0);
  await expect(page.getByTestId("brush-stroke-0")).toHaveAttribute("d", first!);
  await page.screenshot({ path: ".tmp/brush-phone.png", fullPage: true });
  await page.getByText("Clear selection", { exact: true }).click();
  await expect(page.getByTestId("brush-stroke-0")).toHaveCount(0);
  await expect(
    page.getByText("Preview highlight", { exact: true }),
  ).toBeDisabled();
  expect(counts.uploads).toBe(0);
  expect(counts.segments).toBe(0);
});

test("device copies are optional and retry only the missing image after a failed mask download", async ({
  page,
}) => {
  const counts = await backend(page);
  await page.goto("/");
  await choosePhoto(page);
  await page.getByText("Preview highlight", { exact: true }).click();
  await page.getByText("Get assessment", { exact: true }).click();
  await page.getByText("Save a device copy", { exact: true }).click();
  await expect(
    page.getByText("Keep a device copy", { exact: true }),
  ).toBeVisible();
  let mediaRequests = 0,
    failMask = true;
  page.on("request", (request) => {
    if (request.url().endsWith("/media")) mediaRequests++;
  });
  await page.route(
    "https://uploads.fixlens.test/saved-mask.png",
    async (route) => {
      if (failMask) return route.fulfill({ status: 503 });
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        path: "assets/images/icon.png",
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  expect(mediaRequests).toBe(0);
  const firstDownload = page.waitForEvent("download");
  await page.getByText("Save photo", { exact: true }).click();
  expect((await firstDownload).suggestedFilename()).toBe(
    `fixlens-${captureId}-photo.jpg`,
  );
  await expect(
    page.getByText("The photo download started. The mask is still pending.", {
      exact: false,
    }),
  ).toBeVisible();
  const retryDownloads: string[] = [];
  page.on("download", (download) =>
    retryDownloads.push(download.suggestedFilename()),
  );
  failMask = false;
  const maskDownload = page.waitForEvent("download");
  await page.getByText("Retry saving images", { exact: true }).click();
  expect((await maskDownload).suggestedFilename()).toBe(
    `fixlens-${captureId}-mask.png`,
  );
  await expect(
    page.getByText("Photo and mask downloads started.", { exact: true }),
  ).toBeVisible();
  expect(retryDownloads).toEqual([`fixlens-${captureId}-mask.png`]);
  expect(counts.diagnoses).toBe(1);
  expect(mediaRequests).toBe(2);
  await expect(
    page.getByText("Downloads started", { exact: true }),
  ).toBeDisabled();
});
test("job deletion requires confirmation, keeps failures retryable, and removes the saved job", async ({
  page,
}) => {
  await backend(page, false, false, false, false, false, true);
  let deletes = 0;
  page.on("request", (req) => {
    if (
      req.method() === "DELETE" &&
      req.url().endsWith("/problems/" + problemId)
    )
      deletes++;
  });
  await page.goto("/");
  await choosePhoto(page, false);
  await page.getByText("Preview highlight", { exact: true }).click();
  await page.getByText("Get assessment", { exact: true }).click();
  await page.getByText("Delete job and cloud files", { exact: true }).click();
  await expect(
    page.getByText("Delete this job?", { exact: true }),
  ).toBeVisible();
  expect(deletes).toBe(0);
  await page.getByText("Keep job", { exact: true }).click();
  expect(deletes).toBe(0);
  await page.getByText("Delete job and cloud files", { exact: true }).click();
  await expect(page.getByTestId("confirm-delete-job")).toBeVisible();
  await expect(page.getByTestId("confirm-delete-job")).toBeInViewport();
  await page.screenshot({
    path: ".tmp/delete-job-phone.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByTestId("confirm-delete-job").click();
  await expect(
    page.getByText("Deletion unavailable. Try again.", { exact: true }),
  ).toBeVisible();
  await page.getByText("Retry deletion", { exact: true }).click();
  await expect(
    page.getByText("Start with one photo.", { exact: true }),
  ).toBeVisible();
  expect(deletes).toBe(2);
});
test("cloud files can clear temporary previews without deleting the job or its saved media", async ({
  page,
}) => {
  await backend(page);
  let previewDeletes = 0;
  page.on("request", (req) => {
    if (req.method() === "DELETE" && req.url().endsWith("/previews"))
      previewDeletes++;
  });
  await page.goto("/");
  await choosePhoto(page, false);
  await page.getByText("Preview highlight", { exact: true }).click();
  await page.getByText("Get assessment", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Assessment photo", exact: true }),
  ).toBeVisible();
  await page.getByText("Show damage outline", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Saved damage outline", exact: true }),
  ).toBeVisible();
  await page.getByText("Manage cloud files", { exact: true }).click();
  await expect(
    page.getByText("2 temporary previews", { exact: true }),
  ).toBeVisible();
  await page.getByText("Clear temporary previews", { exact: true }).click();
  await page.getByText("Keep previews", { exact: true }).click();
  expect(previewDeletes).toBe(0);
  await page.getByText("Clear temporary previews", { exact: true }).click();
  await page.getByText("Delete previews", { exact: true }).click();
  await expect(
    page.getByText("0 temporary previews", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 photos · 1 saved outlines", { exact: true }),
  ).toBeVisible();
  expect(previewDeletes).toBe(1);
  await page.getByText("Done", { exact: true }).click();
  await expect(
    page.getByText("Mock assessment: surface damage", { exact: true }),
  ).toBeVisible();
});
test("repair search opens a real Maps query only on tap, without sharing the assessment", async ({
  page,
}) => {
  await backend(page);
  await page.route("**/problems/" + problemId, (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        ...problem,
        latest_measurement: null,
        latest_report: {
          ...report,
          category: "crack",
          safety_override: false,
          urgency: "fix_soon",
          red_flags: [],
          pro: {
            trade: "Concrete repair contractor",
            what_to_tell_them:
              "Private assessment notes should not leave the app.",
          },
        },
        delta_summary: null,
      },
    }),
  );
  const searches: string[] = [];
  await page.route("https://www.google.com/maps/**", async (route) => {
    searches.push(route.request().url());
    await route.fulfill({
      contentType: "text/html",
      body: "<h1>Maps search destination</h1>",
    });
  });
  await openSavedJob(page);
  await page
    .getByRole("button", { name: "Find repair help", exact: true })
    .click();
  await expect(page.getByTestId("repair-trade")).toHaveValue(
    "Concrete repair contractor",
  );
  await expect(page.getByTestId("repair-area")).toHaveValue("");
  await page.getByTestId("repair-area").fill("Cambridge, MA");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(searches).toHaveLength(0);
  await page
    .getByRole("button", { name: "Find repair help", exact: true })
    .click();
  await expect(page.getByTestId("repair-area")).toHaveValue("Cambridge, MA");
  await page.getByTestId("open-repair-maps").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".tmp/repair-help-phone.png", fullPage: true });
  await page.getByTestId("open-repair-maps").click();
  await expect(
    page.getByRole("heading", { name: "Maps search destination" }),
  ).toBeVisible();
  expect(searches).toHaveLength(1);
  const url = new URL(searches[0]);
  expect(url.searchParams.get("query")).toBe(
    "Concrete repair contractor in Cambridge, MA",
  );
  expect([...url.searchParams.keys()]).toEqual(["api", "query"]);
  expect(searches[0]).not.toContain(problemId);
  expect(searches[0]).not.toContain("Private");
  expect(searches[0]).not.toContain("Basement");
});

test("repair search preserves invalid input for correction and can search nearby from a short screen", async ({
  page,
}) => {
  await backend(page);
  await page.route("**/problems/" + problemId, (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        ...problem,
        latest_measurement: null,
        latest_report: {
          ...report,
          category: "appliance_error",
          safety_override: false,
          urgency: "monitor",
          red_flags: [],
          pro: null,
        },
        delta_summary: null,
      },
    }),
  );
  let query = "";
  await page.route("https://www.google.com/maps/**", async (route) => {
    query = new URL(route.request().url()).searchParams.get("query")!;
    await route.fulfill({
      contentType: "text/html",
      body: "<h1>Nearby repair results</h1>",
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 580 });
  await openSavedJob(page);
  await page
    .getByRole("button", { name: "Find repair help", exact: true })
    .click();
  await expect(page.getByTestId("repair-trade")).toHaveValue(
    "appliance repair technician",
  );
  await page.getByTestId("repair-trade").fill("  ");
  await page.getByTestId("open-repair-maps").click();
  await expect(
    page.getByText("Enter the type of repair professional to search for.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(query).toBe("");
  await page.getByTestId("repair-trade").fill("Appliance repair");
  await page.getByTestId("open-repair-maps").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".tmp/repair-help-dark-phone.png",
    fullPage: true,
  });
  await page.getByTestId("open-repair-maps").click();
  await expect(
    page.getByRole("heading", { name: "Nearby repair results" }),
  ).toBeVisible();
  expect(query).toBe("Appliance repair near me");
});

test("saved jobs show thumbnails and support search, status filters, and deletion from the list", async ({
  page,
}) => {
  await backend(page);
  const secondId = "44444444-4444-4444-8444-444444444444";
  let jobs = [
    {
      ...problem,
      title: "Garage floor",
      current_urgency: "monitor",
      latest_capture: {
        id: captureId,
        photo_url: "https://uploads.fixlens.test/thumb.jpg",
      },
    },
    {
      ...problem,
      id: secondId,
      title: "Kitchen water stain",
      category: "water_stain",
      current_urgency: "fix_soon",
    },
  ];
  await page.route("**/problems", (route) =>
    route.fulfill({
      json: jobs,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("**/problems/" + problemId, (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "DELETE",
        },
      });
    jobs = jobs.filter((job) => job.id !== problemId);
    return route.fulfill({
      status: 202,
      json: { id: problemId, status: "deleted", cleanup_pending: true },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "Latest job photo" }),
  ).toBeInViewport();
  await page.screenshot({
    path: ".tmp/jobs-dashboard-phone.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    page.getByText("Your home, in focus.", { exact: true }),
  ).toHaveCSS("color", "rgb(237, 247, 242)");
  await page.screenshot({
    path: ".tmp/jobs-dashboard-dark-phone.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByPlaceholder("Search jobs").fill("garage");
  await expect(
    page.getByRole("link", { name: "Open Garage floor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Kitchen water stain", exact: true }),
  ).toHaveCount(0);
  await page.getByPlaceholder("Search jobs").fill("");
  await page.getByTestId("job-filter").selectOption("attention");
  await expect(
    page.getByRole("link", { name: "Open Garage floor", exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("job-filter").selectOption("all");
  await page.getByTestId("delete-job-" + problemId).click();
  await page.getByTestId("confirm-delete-job").click();
  await expect(
    page.getByRole("link", { name: "Open Garage floor", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open Kitchen water stain", exact: true }),
  ).toBeVisible();
});
