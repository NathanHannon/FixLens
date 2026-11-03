import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaSaveSession } from "../src/lib/media-save-session.ts";
const media = {
  capture_id: "capture",
  photo: { filename: "photo.jpg" },
  mask: { filename: "mask.png" },
};
test("saves photo then mask, and avoids duplicates during this screen visit", async () => {
  const session = new MediaSaveSession(),
    writes = [];
  const write = async (file) => writes.push(file.filename);
  assert.equal(await session.save(media, write), "Photo and mask saved.");
  await session.save(media, write);
  assert.deepEqual(writes, ["photo.jpg", "mask.png"]);
});
test("retrying a failed mask save does not duplicate the photo already saved", async () => {
  const session = new MediaSaveSession(),
    writes = [];
  let fail = true;
  const write = async (file) => {
    writes.push(file.filename);
    if (file.filename === "mask.png" && fail) throw new Error("storage full");
  };
  await assert.rejects(session.save(media, write), /storage full/);
  assert.equal(session.photo, true);
  assert.equal(session.mask, false);
  fail = false;
  await session.save(media, write);
  assert.deepEqual(writes, ["photo.jpg", "mask.png", "mask.png"]);
});
test("failed photo saves remain retryable and missing masks never create a fake image", async () => {
  const session = new MediaSaveSession();
  await assert.rejects(
    session.save(media, async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(session.photo, false);
  const writes = [];
  const result = await session.save({ ...media, mask: null }, async (file) =>
    writes.push(file.filename),
  );
  assert.deepEqual(writes, ["photo.jpg"]);
  assert.match(result, /No segmentation mask/);
});
