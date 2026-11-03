import { fetch } from "expo/fetch";
import type { MaskEdit } from "../lib/mask-edit";
import type {
  Capture,
  CaptureMedia,
  Category,
  Delta,
  Hazard,
  Photo,
  Problem,
  ProblemDetail,
  Report,
  UploadUrl,
  Selection,
  SegmentationPreview,
  CalibrationInput,
  JobFiles,
  JobDeletion,
} from "./types";

export const apiUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, "") ?? "";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = 30_000,
  method?: "DELETE",
): Promise<T> {
  if (!apiUrl)
    throw new Error(
      "Set EXPO_PUBLIC_API_URL to your backend address, then reload the app.",
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      const message = result?.error?.message;
      throw new ApiError(
        response.status,
        Array.isArray(message)
          ? message.join("\n")
          : message || `Request failed (${response.status}).`,
      );
    }
    return result as T;
  } catch (error) {
    if (error instanceof ApiError || signal?.aborted) throw error;
    throw new Error(
      controller.signal.aborted
        ? "The request timed out. Your work is still here; try again."
        : `Cannot reach FixLens. Check that your phone and computer share Wi-Fi and the API is running. ${apiUrl}`,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
export const api = {
  deleteProblem: (id: string) =>
    request<JobDeletion>(
      `/problems/${id}`,
      undefined,
      undefined,
      60_000,
      "DELETE",
    ),
  jobFiles: (id: string, signal?: AbortSignal) =>
    request<JobFiles>(`/problems/${id}/storage`, undefined, signal),
  clearPreviews: (id: string) =>
    request<{ removed: number }>(
      `/problems/${id}/previews`,
      undefined,
      undefined,
      30_000,
      "DELETE",
    ),
  problems: (signal?: AbortSignal) =>
    request<Problem[]>("/problems", undefined, signal),
  problem: (id: string, signal?: AbortSignal) =>
    request<ProblemDetail>(`/problems/${id}`, undefined, signal),
  media: (id: string, captureId: string) =>
    request<CaptureMedia>(`/problems/${id}/captures/${captureId}/media`),
  deltas: (id: string, signal?: AbortSignal) =>
    request<Delta[]>(`/problems/${id}/deltas`, undefined, signal),
  create: (body: {
    title: string;
    category: Category;
    location_note?: string;
  }) => request<Problem>("/problems", body),
  uploadUrl: (id: string) =>
    request<UploadUrl>(`/problems/${id}/captures/upload-url`, {}),
  register: (id: string, upload: UploadUrl, photo: Photo, baseline: boolean) =>
    request<Capture>(`/problems/${id}/captures`, {
      photo_key: upload.photo_key,
      photo_width_px: photo.width,
      photo_height_px: photo.height,
      is_baseline: baseline,
      taken_at: photo.takenAt,
    }),
  segment: (
    id: string,
    captureId: string,
    selection: Selection,
    calibration?: CalibrationInput,
    context?: string,
    hazards?: Hazard[],
  ) =>
    request<SegmentationPreview>(
      `/problems/${id}/segment`,
      {
        capture_id: captureId,
        selection,
        calibration,
        context: context || undefined,
        hazards,
      },
      undefined,
      210_000,
    ),
  diagnose: (
    id: string,
    captureId: string,
    context: string,
    hazards: Hazard[],
    segmentationToken: string,
  ) =>
    request<{ report: Report }>(
      `/problems/${id}/diagnose`,
      {
        capture_id: captureId,
        segmentation_token: segmentationToken,
        context: context || undefined,
        hazards,
      },
      undefined,
      120_000,
    ),
  editMask: (
    id: string,
    captureId: string,
    selection: Selection,
    edit: MaskEdit,
    token?: string,
    calibration?: CalibrationInput,
    hazards?: Hazard[],
  ) =>
    request<SegmentationPreview>(
      `/problems/${id}/mask-edits`,
      {
        capture_id: captureId,
        selection,
        ...edit,
        segmentation_token: token,
        calibration,
        hazards,
      },
      undefined,
      60_000,
    ),
};
