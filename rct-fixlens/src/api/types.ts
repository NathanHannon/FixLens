export const categories = {
  other: "Not sure yet",
  water_stain: "Water stain",
  crack: "Crack",
  mold_mildew: "Mold or mildew",
  caulking: "Caulking",
  appliance_error: "Appliance error",
} as const;
export type Category = keyof typeof categories;
export type Urgency = "cosmetic" | "monitor" | "fix_soon" | "pro_now";
export const urgencyLabels: Record<Urgency, string> = {
  cosmetic: "Cosmetic",
  monitor: "Keep an eye on it",
  fix_soon: "Fix soon",
  pro_now: "Professional help now",
};
export const hazards = {
  gas: "Gas smell or suspected gas leak",
  electrical_panel: "Damage at an electrical panel",
  structural_distress: "Sagging, buckling, or structural distress",
  asbestos: "Suspected asbestos",
  flooding_near_electrics: "Flooding near electrical equipment",
} as const;
export type Hazard = keyof typeof hazards;
export interface Problem {
  latest_capture?: { id: string; photo_url: string } | null;
  id: string;
  title: string;
  category: Category;
  location_note: string | null;
  status: "active" | "monitoring" | "resolved" | "archived";
  current_urgency: Urgency | null;
  created_at: string;
}
export interface JobFiles {
  photos: number;
  outlines: number;
  previews: number;
  bytes: number;
}
export interface JobDeletion {
  id: string;
  status: "deleted" | "deleting";
  cleanup_pending: boolean;
}
export interface Report {
  id: string;
  capture_id: string;
  verdict: string;
  category: Category;
  likely_cause: string | null;
  urgency: Urgency;
  confidence: string;
  confidence_note: string | null;
  safety_override: boolean;
  diy: {
    difficulty: string;
    time_estimate: string;
    steps: string[];
    parts: string[];
  } | null;
  pro: { trade: string; what_to_tell_them: string } | null;
  red_flags: string[];
  recheck_days: number | null;
  spark_version: string;
  sam_version: string;
  created_at: string;
}
export interface Delta {
  from_capture_id: string;
  to_capture_id: string;
  days_between: string;
  area_change_pct: number | null;
  width_change_mm: number | null;
  growth: "unknown" | "growing" | "shrinking" | "stable";
}
export interface ProblemDetail extends Problem {
  latest_measurement?: {
    calibrated_area_mm2: number | null;
    calibration: {
      method: CalibrationInput["method"];
      quality: "approximate";
    } | null;
  } | null;
  latest_report: Report | null;
  delta_summary: Delta | null;
}
export interface Capture {
  id: string;
  photo_key: string;
}
export interface UploadUrl {
  capture_id: string;
  photo_key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_in: number;
}
export interface Photo {
  calibration?: CalibrationInput;
  uri: string;
  width: number;
  height: number;
  takenAt: string;
}

// Inclusive pixels in the prepared JPEG, not the on-screen preview.
export interface SelectionPoint {
  x: number;
  y: number;
}
export interface Selection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  points?: SelectionPoint[];
}
export interface SegmentationPreview {
  outline_source?: "sam" | "user_corrected" | "user_drawn";
  status?: "candidate" | "unavailable";
  reason?: string | null;
  target?: {
    description: string | null;
    box: { x1: number; y1: number; x2: number; y2: number } | null;
    muse_version: string;
  } | null;
  attempts?: number;
  calibrated_area_mm2?: number | null;
  calibration?: {
    method: CalibrationInput["method"];
    quality: "approximate";
  } | null;
  token: string;
  mask_url: string | null;
  outline_url?: string | null;
  expires_at: string;
  area_px: number | null;
  perimeter_px: number | null;
  sam_version: string;
  is_mock: boolean;
}

export interface CalibrationInput {
  method: "reference_card" | "known_rectangle" | "arkit_plane" | "arcore_plane";
  points: SelectionPoint[];
  width_mm: number;
  height_mm: number;
}

export interface DownloadMedia {
  url: string;
  filename: string;
  content_type: string;
}
export interface CaptureMedia {
  capture_id: string;
  expires_in: number;
  photo: DownloadMedia;
  mask: DownloadMedia | null;
}
