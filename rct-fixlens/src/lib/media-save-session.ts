import type { CaptureMedia, DownloadMedia } from "../api/types";
// Remember successful writes during this screen visit. Retrying a failed mask
// must not add another copy of a photo that already reached the library.
export class MediaSaveSession {
  photo = false;
  mask = false;
  async save(
    media: CaptureMedia,
    write: (file: DownloadMedia) => Promise<void>,
  ) {
    if (!this.photo) {
      await write(media.photo);
      this.photo = true;
    }
    if (media.mask && !this.mask) {
      await write(media.mask);
      this.mask = true;
    }
    return media.mask
      ? "Photo and mask saved."
      : "Photo saved. No segmentation mask is available for this capture.";
  }
}
