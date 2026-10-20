import type {SkillActivation} from './analytics';
import {getSkillReference,type ReferenceData} from './reference';

/** Hide permanent passives in the chart, preserving gate-delay events and all analysis. */
export function showTelemetrySkill(activation:SkillActivation,reference:ReferenceData|null):boolean {
  const skill=getSkillReference(reference,activation.referenceSkillId??activation.skillId);
  const branches=activation.effectBranch==null?skill?.branches:skill?.branches.filter((_,i)=>i===activation.effectBranch);
  const effects=activation.effects.length?activation.effects:branches?.flatMap(branch=>branch.effects)??[];
  if(effects.some(effect=>effect.type===10||effect.type===14))return true;
  if(activation.timingKind==='passive')return false;
  return !branches?.length||!branches.every(branch=>branch.rawDuration<0);
}

/** A retained passive gate effect uses a short marker without changing its mechanics. */
export function telemetrySkillEnd(activation:SkillActivation):number|null {
  return activation.timingKind==='passive'?activation.start+3:activation.effectiveEnd??activation.end;
}
