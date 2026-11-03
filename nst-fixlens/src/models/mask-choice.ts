import { Ajv } from 'ajv';
import { BadGatewayException } from '@nestjs/common';
import { Hazard } from '../diagnosis/diagnosis.dto.js';

export type CandidateId = 'a' | 'b';
export interface CandidateReview {
  status: 'matches' | 'mismatch' | 'unclear' | 'unavailable';
  reason: string;
}
export interface MaskChoice {
  winner: CandidateId | 'none';
  reason: string;
  reviews: { a: CandidateReview; b: CandidateReview };
  hazards: Hazard[];
}
const reason = { type: 'string', minLength: 1, maxLength: 400 };
const review = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      enum: ['matches', 'mismatch', 'unclear', 'unavailable'],
      type: 'string',
    },
    reason,
  },
  required: ['status', 'reason'],
};
export const maskChoiceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    winner: { type: 'string', enum: ['a', 'b', 'none'] },
    reason,
    reviews: {
      type: 'object',
      additionalProperties: false,
      properties: { a: review, b: review },
      required: ['a', 'b'],
    },
    hazards: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', enum: Object.values(Hazard) },
    },
  },
  required: ['winner', 'reason', 'reviews', 'hazards'],
};
const validate = new Ajv({ strict: true }).compile<MaskChoice>(
  maskChoiceSchema,
);
export function parseMaskChoice(
  text: string,
  available: CandidateId[],
): MaskChoice {
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new BadGatewayException(
      'Muse returned invalid outline selection JSON',
    );
  }
  if (
    !validate(result) ||
    (['a', 'b'] as const).some(
      (id) =>
        !available.includes(id) && result.reviews[id].status !== 'unavailable',
    ) ||
    (result.winner !== 'none' &&
      (!available.includes(result.winner) ||
        result.reviews[result.winner].status !== 'matches'))
  )
    throw new BadGatewayException('Muse returned an invalid outline selection');
  return result;
}
