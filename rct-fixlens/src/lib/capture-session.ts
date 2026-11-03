import type {
  Category,
  Hazard,
  Photo,
  Problem,
  ProblemDetail,
  Report,
  UploadUrl,
  Selection,
  SegmentationPreview,
  CalibrationInput,
} from "../api/types";
import type { MaskEdit } from "./mask-edit";

export interface CaptureDraft {
  photo: Photo;
  title: string;
  category: Category;
  location: string;
  context: string;
  hazards: Hazard[];
}
export type Phase =
  | "Saving problem"
  | "Uploading photo"
  | "Saving capture"
  | "Saving outline"
  | "Checking photo and finding the boundary"
  | "Preparing report";
// Keep successful stages when retrying, so a failed diagnosis never creates a second capture.
export class CaptureSession {
  problemId?: string;
  captureId?: string;
  upload?: UploadUrl;
  uploaded = false;
  started = false;
  preview?: SegmentationPreview;
  private outlineKey?: string;
  private outlineToken?: string;
  readonly baseline: boolean;
  constructor(existingProblemId?: string) {
    this.problemId = existingProblemId;
    this.baseline = !existingProblemId;
  }
  async prepare(
    draft: CaptureDraft,
    selection: Selection,
    api: {
      create: (body: {
        title: string;
        category: Category;
        location_note?: string;
      }) => Promise<Problem>;
      uploadUrl: (id: string) => Promise<UploadUrl>;
      register: (
        id: string,
        upload: UploadUrl,
        photo: Photo,
        baseline: boolean,
      ) => Promise<{ id: string }>;
      segment: (
        id: string,
        captureId: string,
        selection: Selection,
        calibration?: CalibrationInput,
        context?: string,
        hazards?: Hazard[],
      ) => Promise<SegmentationPreview>;
      editMask?: (
        id: string,
        captureId: string,
        selection: Selection,
        edit: MaskEdit,
        token?: string,
        calibration?: CalibrationInput,
        hazards?: Hazard[],
      ) => Promise<SegmentationPreview>;
    },
    put: (photo: Photo, upload: UploadUrl) => Promise<void>,
    onPhase: (phase: Phase) => void,
    edit?: MaskEdit,
    baseToken?: string,
  ): Promise<SegmentationPreview> {
    this.started = true;
    if (!this.problemId) {
      onPhase("Saving problem");
      this.problemId = (
        await api.create({
          title: draft.title,
          category: draft.category,
          location_note: draft.location || undefined,
        })
      ).id;
    }
    if (!this.captureId) {
      if (!this.uploaded) {
        onPhase("Uploading photo");
        // Get a fresh URL on each failed PUT attempt; old URLs expire after five minutes.
        this.upload = await api.uploadUrl(this.problemId);
        await put(draft.photo, this.upload);
        this.uploaded = true;
      }
      if (!this.upload)
        throw new Error(
          "Missing upload details. Please select the photo again.",
        );
      onPhase("Saving capture");
      this.captureId = (
        await api.register(
          this.problemId,
          this.upload,
          draft.photo,
          this.baseline,
        )
      ).id;
    }
    if (edit) {
      const key = JSON.stringify({
        edit,
        baseToken,
        calibration: draft.photo.calibration,
        hazards: draft.hazards,
      });
      if (
        key === this.outlineKey &&
        this.preview &&
        this.preview.token === this.outlineToken &&
        Date.parse(this.preview.expires_at) > Date.now()
      )
        return this.preview;
      if (!api.editMask) throw new Error("Outline editing is unavailable.");
      onPhase("Saving outline");
      this.preview = await api.editMask(
        this.problemId,
        this.captureId,
        selection,
        edit,
        baseToken,
        draft.photo.calibration,
        draft.hazards,
      );
      this.outlineKey = key;
      this.outlineToken = this.preview.token;
      return this.preview;
    }
    this.outlineKey = undefined;
    onPhase("Checking photo and finding the boundary");
    this.preview = await api.segment(
      this.problemId,
      this.captureId,
      selection,
      draft.photo.calibration,
      draft.context,
      draft.hazards,
    );
    return this.preview;
  }
  async submit(
    draft: CaptureDraft,
    api: {
      diagnose: (
        id: string,
        captureId: string,
        context: string,
        hazards: Hazard[],
        token: string,
      ) => Promise<{ report: Report }>;
      problem: (id: string) => Promise<ProblemDetail>;
    },
    onPhase: (phase: Phase) => void,
  ): Promise<string> {
    if (!this.problemId || !this.captureId || !this.preview)
      throw new Error("Preview the selected area first.");
    if (Date.parse(this.preview.expires_at) <= Date.now())
      throw new Error("The highlight expired. Preview the area again.");
    onPhase("Preparing report");
    try {
      await api.diagnose(
        this.problemId,
        this.captureId,
        draft.context,
        draft.hazards,
        this.preview.token,
      );
    } catch (error) {
      const saved = await api.problem(this.problemId).catch(() => null);
      if (saved?.latest_report?.capture_id !== this.captureId) throw error;
    }
    return this.problemId;
  }
}
