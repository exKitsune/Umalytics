import type { DebuffActivation } from '../data/effect-types';

/** Recorded selections and confirmed deliveries must not share an inferred clock. */
export function receivedEffectWindow(activation:DebuffActivation,runnerId:string){
  const confirmed=activation.simulatedRecipients!==undefined;
  const effects=activation.simulatedRecipients?.[runnerId];
  if(confirmed&&!effects?.length)return null;
  const start=effects?Math.min(...effects.map(e=>e.appliedStart??activation.start)):activation.start;
  const ends=effects?.map(e=>e.appliedEnd??activation.effectiveEnd??activation.end);
  const end=ends?ends.some(t=>t===null)?null:Math.max(...ends as number[]):activation.effectiveEnd??activation.end;
  return {start,end,confirmed,passive:activation.timingKind==='passive'};
}
