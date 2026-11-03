import { Ajv } from 'ajv';
import { BadGatewayException } from '@nestjs/common';
import { ProblemCategory, Urgency } from '../database/entities.js';
import type { Diy, Pro } from '../database/entities.js';
import { Hazard } from '../diagnosis/diagnosis.dto.js';

export interface ModelDiagnosis {
  verdict: string;
  category: ProblemCategory;
  likely_cause: string | null;
  urgency: Urgency;
  confidence: number;
  confidence_note: string | null;
  diy: Diy | null;
  pro: Pro | null;
  red_flags: string[];
  recheck_days: number | null;
  hazards: Hazard[];
}
const text = { type: 'string', minLength: 1, maxLength: 2000 };
const nullableText = { anyOf: [text, { type: 'null' }] };
const strings = { type: 'array', items: text, maxItems: 20 };
// One schema is sent to Meta and compiled locally. No model-generated IDs,
// storage keys, physical dimensions, or model version strings are accepted.
export const diagnosisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { ...text, maxLength: 300 },
    category: { type: 'string', enum: Object.values(ProblemCategory) },
    likely_cause: nullableText,
    urgency: { type: 'string', enum: Object.values(Urgency) },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    confidence_note: nullableText,
    diy: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'moderate', 'hard'] },
            time_estimate: text,
            steps: { ...strings, minItems: 1 },
            parts: strings,
          },
          required: ['difficulty', 'time_estimate', 'steps', 'parts'],
        },
      ],
    },
    pro: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: { trade: text, what_to_tell_them: text },
          required: ['trade', 'what_to_tell_them'],
        },
      ],
    },
    red_flags: strings,
    recheck_days: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 365 }, { type: 'null' }],
    },
    hazards: {
      type: 'array',
      items: { type: 'string', enum: Object.values(Hazard) },
      maxItems: 5,
    },
  },
  required: [
    'verdict',
    'category',
    'likely_cause',
    'urgency',
    'confidence',
    'confidence_note',
    'diy',
    'pro',
    'red_flags',
    'recheck_days',
    'hazards',
  ],
};
const validate = new Ajv({ strict: true }).compile<ModelDiagnosis>(
  diagnosisSchema,
);
export function parseDiagnosis(text: string): ModelDiagnosis {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BadGatewayException('Meta returned invalid diagnosis JSON');
  }
  if (!validate(value))
    throw new BadGatewayException(
      'Meta returned a diagnosis outside the expected schema',
    );
  if ((value.urgency === Urgency.ProNow || value.hazards.length) && !value.pro)
    throw new BadGatewayException(
      'Meta omitted required professional guidance',
    );
  return value;
}
