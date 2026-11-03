import { Ajv } from 'ajv';
import { BadGatewayException } from '@nestjs/common';
import { Hazard } from '../diagnosis/diagnosis.dto.js';
import { validConcept } from './concept-prompt.js';
import {
  diagnosisSchema,
  parseDiagnosis,
  type ModelDiagnosis,
} from './diagnosis.schema.js';
export interface PixelPoint {
  x: number;
  y: number;
}
export interface PixelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface TargetPlan {
  concept?: string | null;
  preferred_method?: 'spatial' | 'text';
  routing_reason?: string;
  status: 'clear' | 'unclear';
  description: string | null;
  box: PixelBox | null;
  foreground: PixelPoint[];
  background: PixelPoint[];
  reason: string;
  hazards: Hazard[];
}
export interface NormalizedTargetPlan extends TargetPlan {
  concept: string | null;
  preferred_method: 'spatial' | 'text';
  routing_reason: string;
  coordinate_system: 'normalized_1000';
}
export interface MaskReview {
  status: 'matches' | 'mismatch' | 'unclear' | 'unavailable';
  reason: string;
}
export interface Assessment {
  diagnosis: ModelDiagnosis;
  mask_review: MaskReview;
}
const coordinate = { type: 'integer', minimum: 0, maximum: 1000 };
const point = {
  type: 'object',
  additionalProperties: false,
  properties: { x: coordinate, y: coordinate },
  required: ['x', 'y'],
};
const box = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x1: coordinate,
    y1: coordinate,
    x2: coordinate,
    y2: coordinate,
  },
  required: ['x1', 'y1', 'x2', 'y2'],
};
const text = { type: 'string', minLength: 1, maxLength: 400 };
export const targetingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    coordinate_system: { type: 'string', enum: ['normalized_1000'] },
    concept: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 80 },
        { type: 'null' },
      ],
    },
    preferred_method: { type: 'string', enum: ['spatial', 'text'] },
    routing_reason: text,
    status: { type: 'string', enum: ['clear', 'unclear'] },
    description: { anyOf: [{ ...text, maxLength: 200 }, { type: 'null' }] },
    box: { anyOf: [box, { type: 'null' }] },
    foreground: { type: 'array', items: point, maxItems: 16 },
    background: { type: 'array', items: point, maxItems: 16 },
    reason: text,
    hazards: {
      type: 'array',
      items: { type: 'string', enum: Object.values(Hazard) },
      maxItems: 5,
    },
  },
  required: [
    'coordinate_system',
    'concept',
    'preferred_method',
    'routing_reason',
    'status',
    'description',
    'box',
    'foreground',
    'background',
    'reason',
    'hazards',
  ],
};
export const assessmentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    diagnosis: diagnosisSchema,
    mask_review: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          enum: ['matches', 'mismatch', 'unclear', 'unavailable'],
        },
        reason: text,
      },
      required: ['status', 'reason'],
    },
  },
  required: ['diagnosis', 'mask_review'],
};
const ajv = new Ajv({ strict: true });
const validateTarget = ajv.compile<NormalizedTargetPlan>(targetingSchema);
const validateAssessment = ajv.compile<Assessment>(assessmentSchema);
export function parseTarget(text: string): NormalizedTargetPlan {
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new BadGatewayException('Muse returned invalid targeting JSON');
  }
  if (!validateTarget(result))
    throw new BadGatewayException(
      'Muse returned targeting outside the expected schema',
    );
  if (
    (result.concept !== null && !validConcept(result.concept)) ||
    (result.preferred_method === 'text' && !result.concept)
  )
    throw new BadGatewayException(
      'Muse returned an invalid segmentation route',
    );
  return result;
}
export function parseAssessment(text: string): Assessment {
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new BadGatewayException('Muse returned invalid assessment JSON');
  }
  if (!validateAssessment(result))
    throw new BadGatewayException(
      'Muse returned assessment outside the expected schema',
    );
  parseDiagnosis(JSON.stringify(result.diagnosis));
  return result;
}
