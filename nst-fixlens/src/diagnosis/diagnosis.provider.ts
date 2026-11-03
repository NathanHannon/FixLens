import { Injectable } from '@nestjs/common';
import { ProblemCategory, Urgency } from '../database/entities.js';
import type { Capture, Problem, Diy, Pro } from '../database/entities.js';
import type { Hazard, SelectionDto } from './diagnosis.dto.js';
import type { Calibration } from '../measurements/calibration.js';
import type { PixelBox } from '../models/segmentation.schema.js';
import type { MaskQuality } from '../models/segmentation-quality.js';
export interface SegmentationResult {
  segmentation_method?: 'spatial' | 'text';
  method_review?: { model: string; reason: string };
  method_selection?: { model: string; reason: string; fallback: boolean };
  outline_source?: 'sam' | 'user_corrected' | 'user_drawn';
  status?: 'candidate' | 'unavailable';
  reason?: string;
  hazards?: Hazard[];
  target?: {
    description: string | null;
    box: PixelBox | null;
    muse_version: string;
  };
  quality?: MaskQuality | { passed: true; reasons: []; method: 'user_outline' };
  attempts?: number;
  calibration?: Calibration;
  calibrated_area_mm2?: number;
  selection: SelectionDto;
  mask_key: string | null;
  area_px: number | null;
  perimeter_px: number | null;
  sam_version: string;
}
export interface DiagnosisResult {
  measurement: null | {
    calibration?: Calibration | null;
    calibrated_area_mm2?: number | null;
    mask_key: string | null;
    area_px: number;
    perimeter_px: number | null;
    scale_mm_per_px: number | null;
    width_mm: number | null;
    length_mm: number | null;
    sam_version: string;
  };
  report: {
    verdict: string;
    category: ProblemCategory;
    likely_cause: string | null;
    urgency: Urgency;
    confidence: string;
    confidence_note: string | null;
    safety_override: boolean;
    diy: Diy | null;
    pro: Pro | null;
    red_flags: string[];
    recheck_days: number | null;
    spark_version: string;
    sam_version: string;
  };
  hazards: Hazard[];
}
export interface DiagnosisProvider {
  segment(
    problem: Problem,
    capture: Capture,
    selection: SelectionDto,
    calibration?: Calibration,
    context?: { text?: string; hazards?: Hazard[] },
  ): Promise<SegmentationResult>;
  diagnose(
    problem: Problem,
    capture: Capture,
    segmentation: SegmentationResult,
    context?: { text?: string; hazards?: Hazard[] },
  ): Promise<DiagnosisResult>;
}
export const DIAGNOSIS_PROVIDER = Symbol('DIAGNOSIS_PROVIDER');
const findings: Record<
  ProblemCategory,
  { verdict: string; cause: string; trade: string }
> = {
  water_stain: {
    verdict: 'Localized water stain',
    cause: 'Possible moisture seepage from a nearby joint',
    trade: 'Plumber',
  },
  crack: {
    verdict: 'Hairline surface crack in plaster',
    cause: 'Possible seasonal movement of the finish',
    trade: 'Drywall contractor',
  },
  mold_mildew: {
    verdict: 'Possible surface mildew',
    cause: 'Persistent moisture or poor ventilation',
    trade: 'Moisture remediation specialist',
  },
  caulking: {
    verdict: 'Deteriorated caulk at a joint',
    cause: 'Aging sealant and repeated moisture exposure',
    trade: 'Handyperson',
  },
  appliance_error: {
    verdict: 'Appliance diagnostic error',
    cause: 'A fault requiring confirmation against the appliance manual',
    trade: 'Appliance technician',
  },
  other: {
    verdict: 'Localized surface damage',
    cause: 'Undetermined from this demo placeholder',
    trade: 'Home maintenance professional',
  },
};
@Injectable()
export class MockDiagnosisProvider implements DiagnosisProvider {
  segment(
    _problem: Problem,
    _capture: Capture,
    selection: SelectionDto,
  ): Promise<SegmentationResult> {
    return Promise.resolve({
      selection,
      mask_key: null,
      area_px: 1200,
      perimeter_px: 180,
      sam_version: 'mock-sam-3.1',
    });
  }
  diagnose(problem: Problem, _capture: Capture): Promise<DiagnosisResult> {
    const finding = findings[problem.category];
    return Promise.resolve({
      measurement: {
        mask_key: null,
        area_px: 1200,
        perimeter_px: 180,
        scale_mm_per_px: null,
        width_mm: null,
        length_mm: null,
        sam_version: 'mock-sam-3.1',
      },
      report: {
        verdict: `Mock assessment: ${finding.verdict}`,
        category: problem.category,
        likely_cause: `Mock hypothesis: ${finding.cause}`,
        urgency: Urgency.Monitor,
        confidence: '0.65',
        confidence_note: 'Demo placeholder, not a real diagnosis.',
        safety_override: false,
        diy: {
          difficulty: 'easy',
          time_estimate: '30 minutes',
          steps: [
            'Document the affected area and compare at the next capture.',
          ],
          parts: [],
        },
        pro: {
          trade: finding.trade,
          what_to_tell_them:
            'Describe the location and when the issue first appeared.',
        },
        red_flags: [],
        recheck_days: 14,
        spark_version: 'mock-vision-v1',
        sam_version: 'mock-sam-3.1',
      },
      hazards: [],
    });
  }
}
