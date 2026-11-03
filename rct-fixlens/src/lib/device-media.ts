import { File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import type { DownloadMedia } from "@/api/types";
export async function requestSavePermission() {
  return requestPermissionsAsync(true, []);
}
export async function saveMedia(file: DownloadMedia): Promise<void> {
  const destination = new File(Paths.cache, file.filename);
  try {
    await File.downloadFileAsync(file.url, destination, { idempotent: true });
    await Asset.create(destination.uri);
  } catch {
    // Native download errors may embed private signed URLs. Never surface them.
    throw new Error(
      "Could not save this image. Check your connection and available storage, then retry.",
    );
  } finally {
    try {
      if (destination.exists) destination.delete();
    } catch {
      /* OS cache cleanup can remove it later. */
    }
  }
}
