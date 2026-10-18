/* Recorded layout and event semantics: SSHZ.ORG replay reference (MIT).
 * A change in HP/speed is an observation, not proof of a particular cause. */
import { runnerBySlot, type Frame, type Race, type RaceEvent, type Runner, type RunnerSample } from './types';
import type { ReferenceData, SkillReference } from './reference';
import { modeledStatuses } from './status-models';
import { applyRecordedBranchEvidence, evaluateSkillConditions, type SkillConditionEvaluation } from './skill-conditions';
import { alignedSkillLottery, concentrationFailureBound, type SkillLotteryEvidence } from './skill-lottery';
import { populateStatusImpacts, statusImpactTotals, type StatusImpact, type StatusImpactTotal } from './status-impact';
import { referenceEquippedSkillId } from './equipped-skills';
import { statBreakdownFor } from './race-stats';
import { hillImpactsFor, hillTotals } from './hill-impact';
import { populateSkillImpacts } from './skill-impact';
import { resolveSkillTiming, type SkillTiming } from './skill-timing';
import { slowdownFor, emptySlowdown } from './slowdown-impact';
import { proximityPressure } from './movement-context';
import { cornerPathFor, type CornerPathAnalysis } from './corner-path';
import { inferInitialSkills } from './initial-skills';
import { hpDepletionOnset } from './hp-timeline';
import { rankSamples, runnerGap } from '../view-model';
import type { RunnerStatBreakdown, HillImpact, ContributionTotal, SkillImpact, DebuffActivation, SlowdownAnalysis } from './effect-types';

export type Evidence = 'recorded' | 'derived' | 'estimated' | 'simulated' | 'unknown';
export interface TrafficTick {
  start:number; end:number; near:boolean; blocked:boolean; selfLoss:number; finalLoss:number;
}
export interface StatusInterval {
  kind: string; label: string; start: number; end: number | null;
  evidence: Evidence; detail: string; skillId?: number;
  /** Last observed boundary for a censored state; never an invented end. */
  observedUntil?: number;
  estimatedEnd?: number;
  model?: { speedDelta?: number; speedMultiplier?: number; hpDrainMultiplier?: number;
    baselineHpRate?: number; modeledHpRate?: number; observedHpRate?: number; hpRatio?: number;
    integratedSpeedDelta?: number; integratedHpDelta?: number;
    /** Endpoint speed sits on this mode's ceiling, so a one-sample plateau still counts. */
    velocityCeiling?: boolean };
  impact?: StatusImpact;
  /** Display episode, including explicitly clear short gaps; raw ticks stay exact. */
  traffic?: TrafficTick[];
}
export interface AnalyticsSample {
  time: number; distance: number | null; speed: number | null; hp: number | null; lane: number | null;
  leadGap: number | null; rank: number | null; acceleration: number | null;
  hpDelta: number | null; hpRate: number | null;
}
export interface RunnerSummary {
  startDelay: number | null; finishTime: number | null; rawTime: number | null; gap: number | null;
  spurtDistance: number | null; spurtTime: number | null; spurtDelayDistance: number | null;
  /** Speed interpolated at the recorded spurt-distance crossing, in m/s. */
  spurtSpeed: number | null;
  /** Winner distance minus this runner at the winner's raw finish time, in metres. */
  finishGapDistance: number | null;
  rushedDuration: number | null; blockedDuration: number | null;
  hpStart: number | null; hpFinish: number | null; hpUsed: number | null; hpRecovered: number | null;
  maxSpeed: number | null; meanSpeed: number | null; leadTime: number | null;
  finishOrder: number | null; minimumHp: number | null; maximumLeadGap: number | null;
  distanceTravelled: number | null; hpZeroTime: number | null; sampleCount: number;
}
export interface SkillActivation extends SkillTiming {
  skillId: number; start: number; end: number | null; duration: number | null;
  /** recorded: a replay skill event, including a start activation whose duration parameter is -1. estimated: an activation reconstructed without that event. */
  activationEvidence?: 'recorded' | 'estimated' | 'simulated';
  /** Definition variant; the original recorded event ID remains skillId. */
  referenceSkillId?: number | null;
  durationEvidence: Evidence; effectBranch: number | null;
  effects: SkillReference['branches'][number]['effects']; detail: string;
  /** A recorded targeting mask; recipient effect magnitude is not measured. */
  targetRunnerIds: string[];
  /** Effects actually delivered in the matched execution, by recipient. */
  simulatedRecipients?: Record<string,SkillReference['branches'][number]['effects']>;
}
export interface SkillRow {
  simulation?: { checks: import('../simulation/trace').DecisionEvent[]; wit: import('../simulation/trace').DecisionEvent[] };
  skillId: number; equipped: boolean; activationCount: number; activations: SkillActivation[];
  nonProcReason: string; evidence: Evidence;
  activationStatus: 'recorded' | 'simulated' | 'inferred-initial' | 'inferred-passive' | 'conditions-met' | 'conditions-inferred' | 'conditions-unmet' | 'wit-failure-supported' | 'wit-failure-inferred' | 'unknown';
  /** Applied at least once, including conditions-proven guaranteed passive effects.
   * This is not an invented recorded activation or a current-time active flag. */
  effectiveActive: boolean;
  conditionEvaluation: SkillConditionEvaluation | null;
  inferredBranches: number[];
  lottery?: SkillLotteryEvidence;
}
export interface RunnerAnalysis {
  cornerPath: CornerPathAnalysis;
  slowdown:Record<'blocking'|'exhaustion',SlowdownAnalysis>;
  summary: RunnerSummary; intervals: StatusInterval[]; skillActivations: SkillActivation[];
  skillRows: SkillRow[]; samples: AnalyticsSample[];
  statusImpacts: StatusImpactTotal[];
  statBreakdown: RunnerStatBreakdown;
  hillImpacts: HillImpact[];
  hillTotals: Record<'uphill' | 'downhill', ContributionTotal>;
  skillImpacts: SkillImpact[];
  receivedDebuffImpacts: SkillImpact[];
  receivedDebuffTotals: ContributionTotal;
}
export interface RaceAnalysis { source?: 'simulation'; runners: Record<string, RunnerAnalysis>; debuffs: DebuffActivation[]; warnings: string[] }
const unresolvedContribution = (): ContributionTotal => ({ intervals:0,duration:0,assessedDuration:0,observedDistance:null,
  observedHpConsumed:null,observedHpRecovered:null,modeledDistanceDelta:null,modeledTimeDelta:null,modeledHpDelta:null,detail:'Reference contribution analysis is unavailable.' });

function finish(race: Race, runner: Runner): number {
  return Math.min(race.duration, runner.finishTimeRaw ?? (runner.finishTimeRaw === undefined ? runner.finishTime : null) ?? race.duration);
}
function localEvent(race: Race, event: RaceEvent, runnerId: string): boolean {
  return event.runnerId === runnerId || (event.runnerId === null && typeof event.type === 'number' && event.type >= 3 && event.type <= 10 && runnerBySlot(race.runners, event.params[0])?.id === runnerId);
}
function sampleIntervals(race: Race, runnerId: string, kind: string, label: string,
  predicate: (sample: RunnerSample) => boolean | null, evidence: Evidence, detail: string): StatusInterval[] {
  const runner = race.runners.find(r => r.id === runnerId);
  if (!runner) return [];
  const stop = finish(race, runner), intervals: StatusInterval[] = [];
  let start: number | null = null, observedUntil = 0;
  for (const frame of race.frames) {
    if (frame.time > stop) break;
    const sample = frame.runners.find(s => s.runnerId === runnerId);
    const active = sample ? predicate(sample) : null;
    if (active === true && start === null) start = frame.time;
    if (start !== null && active !== true) {
      intervals.push({ kind, label, start, end: active === false ? frame.time : null, observedUntil,
        evidence, detail: detail + (active === null ? ' Recording interrupted; end unknown.' : ' Boundaries are sampled, not exact simulation transitions.') });
      start = null;
    }
    observedUntil = frame.time;
  }
  if (start !== null) intervals.push({ kind, label, start, end: null, observedUntil, evidence,
    detail: detail + ' Still present at the final observed sample; end unknown.' });
  return intervals;
}
export function statusIntervals(race: Race, runnerId: string): StatusInterval[] {
  const intervals = [
    ...sampleIntervals(race, runnerId, 'rushed', 'Rushed', s => s.temptationMode == null ? null : s.temptationMode >= 1 && s.temptationMode <= 4,
      'recorded', 'Recorded temptation mode is nonzero (modes 1–4).'),
    ...sampleIntervals(race, runnerId, 'rushed-boost', 'Rushed boost', s => s.temptationMode == null ? null : s.temptationMode === 4,
      'recorded', 'Recorded temptation mode 4 (BOOST).'),
    ...sampleIntervals(race, runnerId, 'front-block', 'Blocked in front', s => s.blockFrontRunnerIndex == null ? null : s.blockFrontRunnerIndex >= 0,
      'recorded', 'A front blocking runner slot is recorded; lost speed and HP cannot be attributed from this flag alone.'),
    ...sampleIntervals(race, runnerId, 'near-slowdown', 'Near', s => proximityPressure(race, runnerId, s),
      'estimated', 'A horse ahead matches her speed or occupies the front-collision area, without a recorded front-block slot. Chart marks require speed more than 0.15 m/s below the target including active modes, skills and debuffs.'),
    ...sampleIntervals(race, runnerId, 'hp-empty', 'Exhausted', s => s.hp === null ? null : s.hp === 0,
      'recorded', 'Recorded HP is zero.'),
  ];
  for (const interval of intervals) {
    if (interval.kind !== 'hp-empty') continue;
    const onset = hpDepletionOnset(race, runnerId);
    if (onset != null && onset < interval.start - 1e-4) {
      interval.start = onset;
      interval.detail += ' Out-of-HP speed falls at 1.2 m/s², so the empty point is earlier than the first zero sample.';
    }
  }
  for (const interval of intervals) {
    if (interval.kind === 'rushed') {
      interval.model = { hpDrainMultiplier: 1.6, speedMultiplier: 1.04 };
      interval.detail += ' Umalator reference model: isolated rushed HP drain ×1.6; this is not observed causal loss, and competition combinations differ.';
    }
    if (interval.kind === 'rushed-boost') {
      interval.model = { speedMultiplier: 1.04 };
      interval.detail += ' Reference model: base target speed ×1.04; actual observed speed remains separate.';
    }
  }
  const eventLabels: Record<number, [string, string]> = {
    4: ['spot-struggle', 'Spot struggle'], 5: ['dueling', 'Dueling'],
    6: ['release-conserve-power', 'Release conserved power'], 7: ['stamina-limit-break', 'Stamina limit break'],
    8: ['compete-before-spurt', 'Compete before spurt'], 9: ['stamina-keep', 'Stamina keep'], 10: ['secure-lead', 'Secure lead'],
  };
  for (const event of race.events) {
    const label = typeof event.type === 'number' ? eventLabels[event.type] : null;
    if (label && localEvent(race, event, runnerId)) intervals.push({ kind: label[0], label: label[1], start: event.time,
      end: null, observedUntil: event.time, evidence: 'recorded', detail: 'Recorded event start. The replay does not report its end; duration is unknown.' });
  }
  const runner = race.runners.find(r => r.id === runnerId);
  if (runner?.lastSpurtDistance != null && runner.lastSpurtDistance >= 0) {
    const start = crossingTime(race, runnerId, runner.lastSpurtDistance);
    if (start !== null) intervals.push({ kind: 'last-spurt', label: 'Last spurt', start, end: finish(race, runner), evidence: 'derived',
      detail: 'Start time interpolated from the recorded last-spurt distance; end is the recorded finish when available.' });
  }
  return intervals.sort((a, b) => a.start - b.start);
}
/** Forward target bonus while a lane-speed skill is active and recorded lane changes. */
export function laneBonusIntervals(race: Race, runnerId: string, activations: SkillActivation[]): StatusInterval[] {
  const covers = (time: number) => activations.some(activation => activation.effectiveEnd != null && time >= activation.start && time < activation.effectiveEnd
    && activation.effects.some(effect => effect.type === 28 && ((effect.targetType ?? 1) === 1 || activation.targetRunnerIds.includes(runnerId))));
  if (!activations.some(activation => activation.effectiveEnd != null && activation.effects.some(effect => effect.type === 28))) return [];
  const pieces: { start: number; end: number }[] = [];
  for (let i = 1; i < race.frames.length; i++) {
    const left = race.frames[i - 1], right = race.frames[i];
    const before = left.runners.find(sample => sample.runnerId === runnerId), after = right.runners.find(sample => sample.runnerId === runnerId);
    if (before?.lane == null || after?.lane == null || Math.abs(after.lane - before.lane) <= 1e-4) continue;
    const edges = [left.time, right.time];
    for (const activation of activations) {
      if (activation.effectiveEnd == null) continue;
      if (activation.start > left.time && activation.start < right.time) edges.push(activation.start);
      if (activation.effectiveEnd > left.time && activation.effectiveEnd < right.time) edges.push(activation.effectiveEnd);
    }
    edges.sort((a, b) => a - b);
    for (let edge = 1; edge < edges.length; edge++) {
      const start = edges[edge - 1], end = edges[edge];
      if (end > start && covers((start + end) / 2)) pieces.push({ start, end });
    }
  }
  const merged: { start: number; end: number }[] = [];
  for (const piece of pieces.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged.at(-1);
    if (last && piece.start <= last.end + 1e-6) last.end = Math.max(last.end, piece.end);
    else merged.push({ ...piece });
  }
  return merged.map(span => ({ kind: 'lane-bonus', label: 'Lane bonus', start: span.start, end: span.end, observedUntil: span.end, evidence: 'derived' as const,
    detail: 'A lane-speed skill is active and her recorded lane changed. Forward target speed gains sqrt(0.0002×power) for that movement. Sideways speed stays separate.' }));
}
function crossingTime(race: Race, id: string, distance: number): number | null {
  for (let i = 1; i < race.frames.length; i++) {
    const a = race.frames[i - 1], b = race.frames[i];
    const da = a.runners.find(s => s.runnerId === id)?.distance, db = b.runners.find(s => s.runnerId === id)?.distance;
    if (da != null && db != null && distance >= da && distance <= db && db > da)
      return a.time + (b.time - a.time) * (distance - da) / (db - da);
  }
  return null;
}
function sampleAt(race: Race, id: string, time: number): RunnerSample | null {
  const i = race.frames.findIndex(f => f.time >= time);
  if (i < 0) return null;
  const b = race.frames[i], sb = b.runners.find(s => s.runnerId === id);
  if (!sb) return null;
  if (i === 0 || b.time === time) return sb;
  const a = race.frames[i - 1], sa = a.runners.find(s => s.runnerId === id);
  if (!sa) return null;
  const f = (time - a.time) / (b.time - a.time);
  const interpolate = (key: 'distance' | 'speed' | 'hp' | 'lane') => sa[key] === null || sb[key] === null ? null : sa[key]! + (sb[key]! - sa[key]!) * f;
  return { runnerId: id, distance: interpolate('distance'), speed: interpolate('speed'), hp: interpolate('hp'), lane: interpolate('lane') };
}
const frameRankCache = new WeakMap<Race, Map<number, Map<string, number>>>();
function ranksAt(race: Race, frame: Frame): Map<string, number> {
  let frames = frameRankCache.get(race);
  if (!frames) frameRankCache.set(race, frames = new Map());
  let ranks = frames.get(frame.time);
  if (!ranks) { ranks = rankSamples(race, frame.runners, frame.time); frames.set(frame.time, ranks); }
  return ranks;
}
function samplesFor(race: Race, runner: Runner): AnalyticsSample[] {
  const stop = finish(race, runner), result: AnalyticsSample[] = [];
  for (const frame of race.frames) {
    if (frame.time > stop) break;
    const s = frame.runners.find(x => x.runnerId === runner.id);
    if (!s) continue;
    const p = result[result.length - 1], dt = p ? frame.time - p.time : 0;
    const hpDelta = p?.hp != null && s.hp !== null ? s.hp - p.hp : null;
    result.push({ time: frame.time, distance: s.distance, speed: s.speed, hp: s.hp, lane: s.lane,
      leadGap: runnerGap(race,frame.runners,runner.id),
      rank: ranksAt(race, frame).get(runner.id) ?? null,
      acceleration: dt > 0 && p?.speed != null && s.speed !== null ? (s.speed - p.speed) / dt : null,
      hpDelta, hpRate: dt > 0 && hpDelta !== null ? hpDelta / dt : null });
  }
  return result;
}
function summaryFor(race: Race, runner: Runner, samples: AnalyticsSample[], intervals: StatusInterval[]): RunnerSummary {
  const stop = finish(race, runner), first = samples[0], atFinish = sampleAt(race, runner.id, stop);
  const sumState = (kind: string) => {
    const known = kind === 'rushed' ? race.frames.some(f => f.runners.find(s => s.runnerId === runner.id)?.temptationMode != null)
      : race.frames.some(f => f.runners.find(s => s.runnerId === runner.id)?.blockFrontRunnerIndex != null);
    return known ? intervals.filter(i => i.kind === kind).reduce((s, i) => s + Math.max(0, (i.end ?? i.observedUntil ?? i.start) - i.start), 0) : null;
  };
  const hpChanges = samples.flatMap(s => s.hpDelta === null ? [] : [s.hpDelta]);
  const last = samples[samples.length - 1];
  if (last && last.time < stop && last.hp !== null && atFinish?.hp != null) hpChanges.push(atFinish.hp - last.hp);
  const speeds = samples.flatMap(s => s.speed === null ? [] : [s.speed]);
  let area = 0, speedSeconds = 0, leadTime = 0, leadKnown = false;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dt = b.time - a.time;
    if (a.speed !== null && b.speed !== null) { area += (a.speed + b.speed) * dt / 2; speedSeconds += dt; }
    if (a.rank !== null) { leadKnown = true; if (a.rank === 1) leadTime += dt; }
  }
  if (last && last.time < stop && last.speed !== null && atFinish?.speed != null) {
    const dt = stop - last.time;
    area += (last.speed + atFinish.speed) * dt / 2; speedSeconds += dt;
    if (last.rank !== null) { leadKnown = true; if (last.rank === 1) leadTime += dt; }
  }
  const hp = samples.flatMap(s => s.hp === null ? [] : [s.hp]);
  if (atFinish?.hp != null) hp.push(atFinish.hp);
  const gaps = samples.flatMap(s => s.leadGap === null ? [] : [s.leadGap]);
  const spurtDistance = runner.lastSpurtDistance ?? null;
  const spurtTime = spurtDistance !== null && spurtDistance >= 0 ? crossingTime(race, runner.id, spurtDistance) : null;
  const winner = race.runners.find(r => r.finishOrder === 1);
  const winnerTime = winner?.finishTimeRaw;
  const fieldAtWinnerFinish = winnerTime != null && winnerTime > 0 ? race.runners.map(r => sampleAt(race, r.id, winnerTime)) : [];
  const completeFinishField = fieldAtWinnerFinish.length === race.runners.length && fieldAtWinnerFinish.every(s => s?.distance != null);
  const winnerFinish = fieldAtWinnerFinish.find(s => s?.runnerId === winner?.id)?.distance;
  const runnerAtWinnerFinish = fieldAtWinnerFinish.find(s => s?.runnerId === runner.id)?.distance;
  return { startDelay: runner.startDelay ?? null, finishTime: runner.finishTime, rawTime: runner.finishTimeRaw ?? null,
    finishOrder: runner.finishOrder, gap: runner.finishGap ?? null, spurtDistance,
    spurtTime, spurtSpeed: spurtTime !== null ? sampleAt(race, runner.id, spurtTime)?.speed ?? null : null,
    finishGapDistance: completeFinishField && winnerFinish != null && runnerAtWinnerFinish != null ? winnerFinish - runnerAtWinnerFinish : null,
    spurtDelayDistance: race.distance !== null && spurtDistance !== null && spurtDistance >= 0 ? spurtDistance - race.distance * 2 / 3 : null,
    rushedDuration: sumState('rushed'), blockedDuration: sumState('front-block'), hpStart: first?.hp ?? null,
    hpFinish: atFinish?.hp ?? null, hpUsed: hpChanges.length ? hpChanges.reduce((s, d) => s + Math.max(0, -d), 0) : null,
    hpRecovered: hpChanges.length ? hpChanges.reduce((s, d) => s + Math.max(0, d), 0) : null,
    maxSpeed: speeds.length ? Math.max(...speeds) : null, meanSpeed: speedSeconds > 0 ? area / speedSeconds : null,
    leadTime: leadKnown ? leadTime : null, minimumHp: hp.length ? Math.min(...hp) : null,
    maximumLeadGap: gaps.length ? Math.max(0,...gaps) : null,
    distanceTravelled: first?.distance != null && atFinish?.distance != null ? atFinish.distance - first.distance : null,
    hpZeroTime: intervals.find(interval => interval.kind === 'hp-empty')?.start ?? samples.find(s => s.hp === 0)?.time ?? null, sampleCount: samples.length };
}
export function runnerSummary(race: Race, runnerId: string): RunnerSummary {
  const runner = race.runners.find(r => r.id === runnerId);
  if (!runner) throw new Error('Runner not found.');
  return summaryFor(race, runner, samplesFor(race, runner), statusIntervals(race, runnerId));
}
function recordedSkillActivations(race: Race, runnerId: string, reference: ReferenceData | null): SkillActivation[] {
  return race.events.filter(e => (e.type === 3 || e.type === 'skill') && e.skillId !== null && (e.params[2] !== -1 || e.time === 0) && localEvent(race, e, runnerId)).map(e => {
    const runner = race.runners.find(r => r.id === runnerId)!;
    const referenceSkillId = referenceEquippedSkillId(runner, e.skillId!);
    const def = referenceSkillId === null ? undefined : reference?.metadata.skills[referenceSkillId];
    const branchIndex = Number.isInteger(e.params[3]) && e.params[3] >= 0 ? e.params[3] : null;
    const branch = branchIndex === null ? undefined : def?.branches.find((b, i) => (b.branchIndex ?? i) === branchIndex);
    const duration = e.time > 0 && e.params[2] > 0 ? e.params[2] / 10000 : null;
    const mask = e.params[4];
    return { skillId: e.skillId!, referenceSkillId, activationEvidence:'recorded', start: e.time, duration, end: duration === null ? null : e.time + duration,
      ...resolveSkillTiming(race,runner,reference,branch,e.time,duration,def),
      durationEvidence: duration === null ? 'unknown' as const : 'recorded' as const,
      effectBranch: branchIndex, effects: branch?.effects ?? [],
      targetRunnerIds: Number.isInteger(mask) ? race.runners.filter(r => r.index < 32 && r.id !== runnerId && Boolean(mask & (1 << r.index))).map(r => r.id) : [],
      detail: e.params[2] === -1 ? 'Replay records this activation at the start. The event carries no duration; a passive has none, and a timed skill uses the reference duration.'
        : duration === null ? 'Activation recorded; active end is not reported. Reference base duration is not an observed duration.'
        : 'Replay reports duration in param[2]/10000. Effects are reference definitions, not a measured causal speed or HP change.' };
  });
}
function rowsFor(race: Race, runnerId: string, reference: ReferenceData | null, activations:SkillActivation[], courseIdOverride?: number | null): SkillRow[] {
  const runner = race.runners.find(r => r.id === runnerId);
  if (!runner) return [];
  const equippedIds = (runner.skills ?? []).map(s => referenceEquippedSkillId(runner, s.id) ?? s.id);
  const ids = new Set([...equippedIds, ...activations.map(a => a.referenceSkillId ?? a.skillId)]);
  const course = reference?.courses[courseIdOverride ?? race.courseId ?? ''] ?? null;
  return [...ids].map(skillId => {
    const equipped = equippedIds.includes(skillId), applied = activations.filter(a => (a.referenceSkillId ?? a.skillId) === skillId), observed=applied.filter(a=>a.activationEvidence!=='estimated'), initial=applied.some(a=>a.activationEvidence==='estimated');
    const def = reference?.metadata.skills[skillId];
    const conditionEvaluation = def ? applyRecordedBranchEvidence(evaluateSkillConditions(race, runner, course, def, {reference,skillId}), observed, def) : null
    const inferredBranches = !observed.length && equipped && def?.activateLot === 0
      ? (conditionEvaluation?.branches ?? []).filter(b => b.state === 'met' && b.staticOnly && def.branches.find((d, i) => (d.branchIndex ?? i) === b.branchIndex)!.rawDuration < 0).map(b => b.branchIndex) : [];
    const lottery = alignedSkillLottery(race, reference).get(runnerId)?.get(skillId) ?? (!observed.length && skillId === 200431 ? concentrationFailureBound(race, runnerId, reference) : undefined);
    const first=race.frames[0],last=race.frames.at(-1),startDistance=first?.runners.find(s=>s.runnerId===runnerId)?.distance,lastDistance=last?.runners.find(s=>s.runnerId===runnerId)?.distance;
    const completeRecording=first?.time===0&&startDistance!=null&&startDistance<=.5&&race.distance!=null&&lastDistance!=null&&lastDistance>=race.distance-.1&&runner.finishTimeRaw!=null&&race.runners.every(r=>r.skills!==undefined);
    const competingGroup=def?.groupId!=null&&runner.skills?.some(s=>{const id=referenceEquippedSkillId(runner,s.id);return id!==null&&id!==skillId&&reference?.metadata.skills[id]?.groupId===def.groupId;});
    const inferredWit=equipped&&!applied.length&&!competingGroup&&def?.activateLot===1&&lottery?.won!==true&&completeRecording&&conditionEvaluation?.branches.some(b=>b.inferredState==='met'&&(b.state==='met'&&(b.staticOnly||b.definitiveOpportunity)||b.inferenceBasis==='complete-random-region'||b.inferenceBasis==='recorded-conjunction')&&(def.branches.find((d,i)=>(d.branchIndex??i)===b.branchIndex)?.rawDuration??-1)>=0);
    // A random lot that never appears did not pass. A skill with no wit check
    // that never appears did not meet its conditions. Either way the effect is off.
    const lotOnly = !!conditionEvaluation && def?.branches.some(b => /\brandom_lot\b/.test(b.condition ?? '')) && conditionEvaluation.branches.every(b => b.state === 'unmet' || b.missingInputs.length === 0 && b.hiddenState.length > 0 && b.hiddenState.every(item => item.startsWith('random_lot')));
    const conditionalOnly = def?.activateLot === 0 && !inferredBranches.length && conditionEvaluation?.mechanicsState === 'understood' && conditionEvaluation.state !== 'met' && conditionEvaluation.state !== 'unmet';
    const missedConditional = equipped && !observed.length && !initial && completeRecording && (lotOnly || !!conditionalOnly);
    if (missedConditional && lotOnly && conditionEvaluation) for (const branch of conditionEvaluation.branches) for (const predicate of branch.predicates) if (predicate.key === 'random_lot' && predicate.state !== 'met') { predicate.state = 'unmet'; predicate.observed = 'No activation was recorded, so this draw did not pass.'; }
    const activationStatus: SkillRow['activationStatus'] = observed.length ? 'recorded' : initial?'inferred-initial':inferredBranches.length ? 'inferred-passive' : missedConditional ? 'conditions-unmet'
      : conditionEvaluation?.state === 'unmet' ? 'conditions-unmet'
      : conditionEvaluation?.state === 'met' && conditionEvaluation.definitiveOpportunity && lottery?.won === false ? 'wit-failure-supported'
      : inferredWit?'wit-failure-inferred':conditionEvaluation?.state === 'met' ? 'conditions-met' : conditionEvaluation?.inferredState==='met'?'conditions-inferred':'unknown';
    const nonProcReason = activationStatus === 'recorded' ? 'Activation recorded.'
      : activationStatus === 'inferred-initial' ? applied.find(a=>a.activationEvidence==='estimated')!.detail
      : activationStatus === 'inferred-passive' ? 'Equipped guaranteed passive: known race/runner settings satisfy its reference conditions. Effect inferred; no activation time is invented.'
      : activationStatus === 'conditions-unmet' && missedConditional ? (def?.branches.some(b => /\brandom_lot\b/.test(b.condition ?? '')) ? 'No activation is recorded. The random lot is a condition of this skill, so that draw did not pass.' : 'No activation is recorded. This skill has no wit check, so its conditions were not met.')
      : activationStatus === 'conditions-unmet' ? (conditionEvaluation?.branches.some(b => b.inferenceBasis === 'recorded-conjunction') ? 'The recorded race never has these conditions true at the same time.' : 'Known race/runner settings rule out every reference condition branch.')
      : activationStatus === 'wit-failure-supported' ? `Conditions satisfied; reference evidence supports a failed wit lottery. ${lottery!.detail}`
      : activationStatus === 'wit-failure-inferred'?'Failed wit check inferred: equipped non-passive lottery skill, complete recording/inventories, and unconditional/static or reference-guaranteed trigger opportunity. No exact random roll is claimed.'
      : activationStatus === 'conditions-inferred'?`Replay-derived conditions are inferred satisfied. ${competingGroup?'Another equipped skill shares this activation group; activation exclusion remains unresolved.':def?.activateLot===0?'This definition has no wit lottery; internal trigger timing remains uncertain.':'A hidden trigger or wit outcome remains uncertain.'}`
      : activationStatus === 'conditions-met' ? `Supported conditions were met${conditionEvaluation?.branches.some(b => !b.staticOnly) ? ' at replay samples' : ''}. ${competingGroup?'Another equipped skill shares this activation group; activation exclusion remains unresolved.':def?.activateLot === 1 ? lottery?.won ? 'Aligned reference lottery passed; subsequent trigger/timing remains unresolved.' : 'Wit outcome is unresolved: no uniquely aligned lottery evidence.' : 'No wit lottery in this definition; trigger/timing remains unresolved.'}`
      : !def ? 'Skill definition unavailable; activation conditions cannot be evaluated.'
      : `Some activation conditions remain unresolved. ${(conditionEvaluation?.branches ?? []).map(b => b.detail).join(' ')}`;
    return { skillId, equipped, activationCount: observed.length, activations: applied, conditionEvaluation, inferredBranches,
      activationStatus, effectiveActive: applied.length > 0 || inferredBranches.length > 0, nonProcReason,
      ...(lottery ? { lottery } : {}),
      evidence: observed.length ? 'recorded' as const : initial?'estimated' as const:['inferred-passive', 'conditions-unmet', 'conditions-met'].includes(activationStatus) ? 'derived' as const : ['wit-failure-supported','wit-failure-inferred','conditions-inferred'].includes(activationStatus) ? 'estimated' as const : 'unknown' as const };
  });
}
const activationCache=new WeakMap<Race,WeakMap<ReferenceData,Map<string,SkillActivation[]>>>();
export function skillActivations(race:Race,runnerId:string,reference:ReferenceData|null,courseIdOverride?:number|null):SkillActivation[]{
  const recorded=recordedSkillActivations(race,runnerId,reference),runner=race.runners.find(r=>r.id===runnerId),course=reference?.courses[courseIdOverride??race.courseId??'']??null;
  if(!reference||!runner||!course||!race.events.some(e=>e.time===0&&e.params[2]===-1&&localEvent(race,e,runnerId)))return recorded;
  let refs=activationCache.get(race);if(!refs)activationCache.set(race,refs=new WeakMap());let cached=refs.get(reference);if(!cached)refs.set(reference,cached=new Map());const key=`${runnerId}:${course.id}`;
  const found=cached.get(key);if(found)return found;
  const rows=rowsFor(race,runnerId,reference,recorded,course.id),combined=[...recorded,...inferInitialSkills(race,runner,course,reference,rows,recorded)].sort((a,b)=>a.start-b.start||a.skillId-b.skillId);cached.set(key,combined);return combined;
}
export function skillRows(race:Race,runnerId:string,reference:ReferenceData|null,courseIdOverride?:number|null):SkillRow[]{
  return rowsFor(race,runnerId,reference,skillActivations(race,runnerId,reference,courseIdOverride),courseIdOverride);
}
export function* analyzeRaceSteps(race: Race, reference: ReferenceData | null, courseIdOverride?: number | null): Generator<void, RaceAnalysis> {
  const course = reference?.courses[courseIdOverride ?? race.courseId ?? ''] ?? null;
  const runners: Record<string, RunnerAnalysis> = {};
  for (const runner of race.runners) {
    const samples = samplesFor(race, runner), intervals = statusIntervals(race, runner.id);
    if (course) intervals.push(...sampleIntervals(race, runner.id, 'downhill-section', 'Downhill section', s => s.distance === null ? null : course.slopes.some(g => g.slopePercent < 0 && s.distance! >= g.start && s.distance! < g.start + g.length),
      'derived', 'Runner distance intersects a reference downhill grade. This does not establish that downhill mode activated.'));
    const skills = skillActivations(race, runner.id, reference,courseIdOverride), rows = skillRows(race, runner.id, reference, courseIdOverride);
    intervals.push(...modeledStatuses(race, runner, course, reference, skills, intervals, rows));
    const statBreakdown = statBreakdownFor(race, runner, course, reference, rows);
    const laneBonus = laneBonusIntervals(race, runner.id, skills), lanePower = statBreakdown.stats.power.final;
    if (lanePower != null) for (const interval of laneBonus) interval.model = { speedDelta: Math.sqrt(.0002 * lanePower) };
    intervals.push(...laneBonus);
    runners[runner.id] = { summary: summaryFor(race, runner, samples, intervals), samples, intervals, cornerPath: cornerPathFor(race,runner,course),
      skillActivations: skills, skillRows: rows, statusImpacts: statusImpactTotals(intervals),
      statBreakdown,hillImpacts:[],hillTotals:{uphill:unresolvedContribution(),downhill:unresolvedContribution()},
      skillImpacts:[],receivedDebuffImpacts:[],receivedDebuffTotals:unresolvedContribution(),slowdown:{blocking:emptySlowdown(),exhaustion:emptySlowdown()} };
    yield;
  }
  const analysis:RaceAnalysis = { runners, debuffs:[], warnings: [
    'HP changes and acceleration are sampled net changes; overlapping effects and base consumption cannot be separated causally.',
    'Spot struggle/dueling ends, downhill mode, and pace modes are modeled estimates where inputs permit; they are not recorded states or proven HP causes.',
    'Guaranteed passive effects may be inferred from equipped skills and proven static conditions. Recorded activation events remain separate.',
    'Wit failures use a reference RNG model only when one stream matches every recorded start delay and known inventories/procs agree; otherwise the cause remains unresolved.',
  ] };
  for(const runner of race.runners){const detail=runners[runner.id];populateStatusImpacts(race,runner.id,detail.intervals,course,reference,detail.skillRows,analysis);detail.statusImpacts=statusImpactTotals(detail.intervals);yield;}
  populateSkillImpacts(race,reference,course,analysis);
  yield;
  for(const runner of race.runners){const detail=analysis.runners[runner.id];detail.hillImpacts=hillImpactsFor(race,runner,course,detail,analysis);if(course)detail.hillTotals=hillTotals(detail.hillImpacts);detail.slowdown=slowdownFor(race,runner,course,analysis);yield;}
  return analysis;
}
const analysisCache=new WeakMap<Race,{empty:Map<number,RaceAnalysis>;refs:WeakMap<ReferenceData,Map<number,RaceAnalysis>>}>();
/** UI/library races and reference snapshots are immutable. Keep one model result
 * per race/reference/course, shared by telemetry, replay, results and details. */
export function analyzeRace(race:Race,reference:ReferenceData|null,courseIdOverride?:number|null):RaceAnalysis {
  let entry=analysisCache.get(race);if(!entry)analysisCache.set(race,entry={empty:new Map(),refs:new WeakMap()});
  let values=reference?entry.refs.get(reference):entry.empty;if(!values){values=new Map();entry.refs.set(reference!,values);}
  const key=courseIdOverride??race.courseId??-1,prior=values.get(key);if(prior)return prior;
  const steps=analyzeRaceSteps(race,reference,courseIdOverride);let step=steps.next();while(!step.done)step=steps.next();
  values.set(key,step.value);return step.value;
}
/** Install a worker/cache result under the exact immutable UI inputs. */
export function rememberAnalysis(race:Race,reference:ReferenceData,analysis:RaceAnalysis) {
  let entry=analysisCache.get(race);if(!entry)analysisCache.set(race,entry={empty:new Map(),refs:new WeakMap()});
  let values=entry.refs.get(reference);if(!values)entry.refs.set(reference,values=new Map());
  values.set(race.courseId??-1,analysis);
}
export function analyticsAt(analysis: RaceAnalysis, runnerId: string, time: number): { statuses: StatusInterval[]; skills: SkillActivation[]; sample: AnalyticsSample | null } {
  const data = analysis.runners[runnerId];
  if (!data) return { statuses: [], skills: [], sample: null };
  let sample: AnalyticsSample | null = null;
  for (const s of data.samples) { if (s.time > time) break; sample = s; }
  return { statuses: data.intervals.filter(i => time >= i.start && (i.end === null ? time <= (i.observedUntil ?? i.start) : time < i.end)),
    skills: data.skillActivations.filter(a => a.end !== null && time >= a.start && time < a.end), sample };
}
