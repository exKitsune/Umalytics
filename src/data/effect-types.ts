import type { Evidence } from './analytics';
import type { SkillReference } from './reference';
import type { SkillTimingKind } from './skill-timing';
export interface SkillCarryover {
  entrySpeedDelta:number|null; distanceDelta:number|null; timeDelta:number|null;
  distanceDeltaMin:number|null;distanceDeltaMax:number|null;timeDeltaMin:number|null;timeDeltaMax:number|null;
  start:number|null;end:number|null;duration:number|null;reason:string;detail:string;
}
export interface RecoveryTiming {
  referenceMaxSpurtHpCost:number|null;referenceBudgetBefore:number|null;referenceBudgetAfter:number|null;
  referenceBudgetOutcome:'unlocked'|'already-covered'|'still-short'|'not-late'|'unknown';benefitReason:string;
  modeledHpRestored:number|null;modeledOvercapHp:number|null;hpEfficiency:number|null;
  eventDistance:number|null;remainingDistance:number|null;latePhaseStartTime:number|null;recordedSpurtStartTime:number|null;
  secondsBeforeRecordedSpurt:number|null;recordedSpurtDelayDistance:number|null;
  spurtState:'before-late'|'before-recorded-spurt'|'during-recorded-spurt'|'no-recorded-spurt'|'unknown';
  recalculationOpportunity:boolean|null;sampleTimeBefore:number|null;sampleTimeAfter:number|null;
  observedSelfSpeedBefore:number|null;observedSelfSpeedAfter:number|null;observedAccelerationBefore:number|null;observedAccelerationAfter:number|null;detail:string;
}
export interface SlowdownInterval {
  start:number;end:number;duration:number;assessedDuration:number;
  distanceLossMin:number|null;distanceLossMax:number|null;timeLossMin:number|null;timeLossMax:number|null;detail:string;
}
export interface SlowdownAnalysis {
  duration:number;assessedDuration:number;coverageRate:number|null;distanceLoss:number|null;
  distanceLossMin:number|null;distanceLossMax:number|null;assessedDistanceLossMin:number|null;assessedDistanceLossMax:number|null;
  timeLossMin:number|null;timeLossMax:number|null;intervals:SlowdownInterval[];unavailableReasons:string[];detail:string;
}

export type StatKey = 'speed' | 'stamina' | 'power' | 'guts' | 'wisdom';
export interface StatBreakdown {
  raw: number | null; overcap: number | null; base: number | null;
  moodMultiplier: number | null; moodGain: number | null;
  baseCapGain: number | null; capGain: number | null;
  courseMultiplier: number | null; courseGain: number | null;
  strategyMultiplier: number | null; strategyGain: number | null;
  groundGain: number | null; careerGain: number | null; passiveGain: number | null;
  final: number | null; detail: string;
}
export interface StartingHpContext {
  observed: number | null; modeled: number | null; difference: number | null;
  staminaContribution: number | null; distanceContribution: number | null;
  strategyCoefficient: number | null; detail: string;
}
export interface RunnerStatBreakdown {
  stats: Record<StatKey, StatBreakdown>; startingHp: StartingHpContext;
  evidence: Evidence; detail: string;
}
/** Signed model deltas: positive distance helps the recipient; positive time/HP
 * means more time/HP consumed. Observed fields include every concurrent effect. */
export interface EffectContribution {
  observedDistance: number | null; observedHpConsumed: number | null; observedHpRecovered: number | null;
  modeledDistanceDelta: number | null; modeledTimeDelta: number | null; modeledHpDelta: number | null;
  detail: string;
}
export interface ContributionTotal extends EffectContribution { intervals: number; duration: number; assessedDuration: number }
export interface HillImpact extends EffectContribution {
  kind: 'uphill' | 'downhill'; start: number | null; end: number | null;
  distanceStart: number; distanceEnd: number; slopePercent: number; duration: number | null;
  assessedDuration: number;
  evidence: Evidence; modeledSpeedDelta: number | null; powerMitigationSpeed: number | null;
  powerReference: number; powerTimeDelta: number | null;
  modeledHpSaved: number | null; modeDuration: number | null;
}
export interface SkillImpact extends EffectContribution {
  scheduledDuration:number|null;finishClippedDuration:number;effectUtilization:EffectUtilization[];
  skillId: number; sourceRunnerId: string; targetRunnerId: string;
  start: number; end: number | null; activeDuration: number | null; durationEvidence: Evidence;
  observationStart: number | null; observationEnd: number | null;
  assessableDuration: number; usefulDuration: number | null;
  /** Fraction of active duration useful; null unless the whole active window is assessable. */
  usefulRate: number | null;
  /** Fraction of the known active duration that could be assessed. */
  coverageRate: number | null;
  /** Fraction useful among assessable samples, independent of whole-window coverage. */
  usefulAmongAssessed: number | null;
  effectiveness: 'useful' | 'partial' | 'not-useful' | 'unresolved'; evidence: Evidence;
  /** Direct current-speed components are additive at a fixed trajectory. */
  additiveDistance: boolean;
  assessedModeledDistanceDelta: number | null; assessedModeledTimeDelta: number | null; assessedModeledHpDelta: number | null;
  utilization:number|null;unavailableReasons:string[];carryover:SkillCarryover;
  utilizationKind:'movement-active-time'|'hp-capacity'|'lane'|'unknown';recovery:RecoveryTiming|null;
  blockingDuration:number;blockingAssessedDuration:number;blockingDistanceLoss:number|null;assessedBlockingDistanceLoss:number|null;
}
export interface SkillImpactSummary extends EffectContribution {
  scheduledDuration:number|null;finishClippedDuration:number;effectUtilization:EffectUtilization[];
  skillId: number; activations: number; activeDuration: number | null;
  assessableDuration: number; usefulDuration: number | null; usefulRate: number | null;
  coverageRate: number | null; usefulAmongAssessed: number | null;
  assessedModeledDistanceDelta: number | null; assessedModeledTimeDelta: number | null; assessedModeledHpDelta: number | null;
  utilization:number|null;unavailableReasons:string[];carryover:SkillCarryover;
  utilizationKind:'movement-active-time'|'hp-capacity'|'lane'|'unknown';recovery:RecoveryTiming|null;
  blockingDuration:number;blockingAssessedDuration:number;blockingDistanceLoss:number|null;assessedBlockingDistanceLoss:number|null;
}
export interface EffectUtilization {
  kind:'target-speed'|'acceleration'|'current-speed';activeDuration:number|null;assessedDuration:number;afterFinishDuration:number;
  usefulDuration:number|null;cappedDuration:number|null;blockedDuration:number|null;
  /** User-selected scoring convention, separate from conditional distance gain. */
  scoringConvention?:'target-speed-half-credit';acceleratingDuration?:number;deceleratingEffectiveDuration?:number;fullyEffectiveDuration?:number;belowBaselineDuration?:number;wastedDuration?:number;
  /** Legacy local-model carryover. Paired movement uses MotionBenefit instead. */
  carryoverEfficiency?: number | null;
  /** Meters and seconds saved by reaching the next target sooner. */
  carryoverDistance?: number | null; carryoverTime?: number | null;
  utilization:number|null;coverageRate:number|null;usefulAmongAssessed:number|null;
    /** Credited seconds / full scheduled duration for conditional target scenarios;
     * unassessed seconds are not assigned a score. Not a statistical confidence interval. */
    scenarioUtilization?:{min:number;mid:number;max:number};
}
export interface DebuffActivation {
  sourceRunnerId: string; skillId: number; start: number; end: number | null;
  targetRunnerIds: string[]; recipientsKnown: boolean;
  effects: SkillReference['branches'][number]['effects']; detail: string;
  /** Delivered effects, including each recipient's actual application/expiry. Absent for inference. */
  simulatedRecipients?:Record<string,SkillReference['branches'][number]['effects']>;
  effectiveEnd:number|null;effectiveDuration:number|null;timingKind:SkillTimingKind;timingReason:string;
}
