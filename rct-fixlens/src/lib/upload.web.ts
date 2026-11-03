import { fetch } from "expo/fetch";
import type { Photo, UploadUrl } from "@/api/types";
export async function uploadPhoto(photo: Photo, upload: UploadUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const source = await fetch(photo.uri, { signal: controller.signal });
    if (!source.ok)
      throw new Error("Could not read this photo. Please choose it again.");
    const response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: await source.blob(),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Photo upload failed (${response.status}). Check the bucket CORS settings and try again.`,
      );
  } finally {
    clearTimeout(timeout);
  }
}
