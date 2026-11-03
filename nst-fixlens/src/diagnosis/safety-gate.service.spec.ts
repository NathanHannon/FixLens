import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { applySafetyGate } from './safety-gate.service.js';
import { Hazard } from './diagnosis.dto.js';
import { MockDiagnosisProvider } from './diagnosis.provider.js';
import {
  Capture,
  Problem,
  ProblemCategory,
  Urgency,
} from '../database/entities.js';
const base = await new MockDiagnosisProvider().diagnose(
  Object.assign(new Problem(), { category: ProblemCategory.Crack }),
  new Capture(),
);
describe('SafetyGate', () => {
  it.each(Object.values(Hazard))(
    'forces professional handling for %s',
    (hazard) => {
      const result = applySafetyGate(base, [hazard]);
      expect(result.report).toMatchObject({
        safety_override: true,
        urgency: Urgency.ProNow,
        diy: null,
        recheck_days: null,
      });
      expect(result.report.red_flags).toContain(hazard);
      expect(base.report.safety_override).toBe(false);
    },
  );
  it.each([
    'gas smell',
    'electrical panel',
    'structural distress',
    'suspected asbestos',
    'flooding near electrical outlets',
    'wiring submerged in water',
  ])('detects text evidence: %s', (text) => {
    expect(applySafetyGate(base, [], text).report.safety_override).toBe(true);
  });
  it('preserves ordinary findings', () => {
    expect(applySafetyGate(base, [], 'small cosmetic wall crack')).toBe(base);
  });
  it('honors provider override even without a keyword', () => {
    const flagged = {
      ...base,
      report: { ...base.report, safety_override: true },
    };
    expect(applySafetyGate(flagged, []).report.diy).toBeNull();
  });
  it('inspects provider findings', () => {
    const flagged = {
      ...base,
      report: { ...base.report, likely_cause: 'asbestos' },
    };
    expect(applySafetyGate(flagged, []).report.urgency).toBe(Urgency.ProNow);
  });
});
