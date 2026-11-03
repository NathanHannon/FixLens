import { BadGatewayException } from '@nestjs/common';
import { Ajv } from 'ajv';

export interface ConceptSuggestion {
  concept: string | null;
  reason: string;
}
export const conceptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    concept: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 80 },
        { type: 'null' },
      ],
    },
    reason: { type: 'string', minLength: 1, maxLength: 400 },
  },
  required: ['concept', 'reason'],
};
const validate = new Ajv().compile<ConceptSuggestion>(conceptSchema);
export function validConcept(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 80 &&
    value.split(/\s+/).length <= 12 &&
    !/[\r\n,;+<>|]/.test(value) &&
    !/\b(and|or|not)\b/i.test(value)
  );
}
export function parseConcept(text: string): ConceptSuggestion {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BadGatewayException('Muse returned invalid concept JSON');
  }
  if (
    !validate(value) ||
    (value.concept !== null && !validConcept(value.concept))
  )
    throw new BadGatewayException(
      'Muse returned an invalid segmentation concept',
    );
  return value;
}
