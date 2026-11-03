import { Injectable } from '@nestjs/common';
import { Urgency } from '../database/entities.js';
import type { DiagnosisResult } from './diagnosis.provider.js';
import { Hazard } from './diagnosis.dto.js';
const patterns: [Hazard, RegExp][] = [
  [Hazard.Gas, /\b(gas|propane|methane)\b/i],
  [
    Hazard.ElectricalPanel,
    /\b(electrical\s+panel|breaker\s+(panel|box)|fuse\s+box)\b/i,
  ],
  [
    Hazard.StructuralDistress,
    /\b(structural\s+(distress|damage|failure)|load[ -]bearing|foundation\s+(crack|movement)|sagging|buckling)\b/i,
  ],
  [Hazard.Asbestos, /\basbestos\b/i],
  [
    Hazard.FloodingNearElectrics,
    /\b(flood|water|standing water)[\s\S]{0,100}\b(electric\w*|outlet|socket|wiring)\b|\b(electric\w*|outlet|socket|wiring)[\s\S]{0,100}\b(flood|water)\b/i,
  ],
];
export function applySafetyGate(
  result: DiagnosisResult,
  hazards: readonly Hazard[],
  evidence = '',
): DiagnosisResult {
  const text = [
    evidence,
    result.report.verdict,
    result.report.likely_cause,
    ...result.report.red_flags,
  ].join(' ');
  const detected = [
    ...new Set([
      ...hazards,
      ...patterns
        .filter(([, pattern]) => pattern.test(text))
        .map(([hazard]) => hazard),
    ]),
  ];
  if (!detected.length && !result.report.safety_override) return result;
  return {
    ...result,
    report: {
      ...result.report,
      safety_override: true,
      urgency: Urgency.ProNow,
      diy: null,
      recheck_days: null,
      pro: {
        trade: 'Qualified professional',
        what_to_tell_them: `Safety concern: ${detected.join(', ') || 'provider safety override'}. Arrange an urgent assessment.`,
      },
      red_flags: [...new Set([...result.report.red_flags, ...detected])],
    },
  };
}
@Injectable()
export class SafetyGate {
  apply = applySafetyGate;
}
