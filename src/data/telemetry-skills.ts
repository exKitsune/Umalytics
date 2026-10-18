import type {SkillActivation} from './analytics';
/** A passive stays active mechanically; only its chart marker lasts 3 seconds. */
export function telemetrySkillEnd(activation:SkillActivation):number|null {
  return activation.timingKind==='passive'?activation.start+3:activation.effectiveEnd??activation.end;
}
