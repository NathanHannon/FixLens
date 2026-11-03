import { fetch } from "expo/fetch";
import type { DownloadMedia } from "@/api/types";
export async function requestSavePermission() {
  return { granted: true, canAskAgain: true };
}
export async function saveMedia(file: DownloadMedia): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let url: string | undefined;
  try {
    const response = await fetch(file.url, { signal: controller.signal });
    if (!response.ok) throw new Error();
    url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Let the browser consume the object URL before revoking it.
    const objectUrl = url;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    url = undefined;
  } catch {
    throw new Error(
      "Could not download this image. Check your connection, then retry.",
    );
  } finally {
    clearTimeout(timer);
    if (url) URL.revokeObjectURL(url);
  }
}
