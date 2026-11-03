import { fetch } from "expo/fetch";
import { File } from "expo-file-system";
import type { Photo, UploadUrl } from "@/api/types";
export async function uploadPhoto(photo: Photo, upload: UploadUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: new File(photo.uri),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Photo upload failed (${response.status}). Please try again.`,
      );
  } finally {
    clearTimeout(timeout);
  }
}
