import type { Race } from './types';
import type { StatusInterval, SkillRow, RaceAnalysis } from './analytics';
import type { CourseReference, ReferenceData } from './reference';
import { effectiveStrategyCode } from './skill-details';
import { unresolvedPassiveStats } from './passive-inputs';
import { selfSpeedAt } from './mechanics-effects';
import { effectValue } from './effect-value';
export interface StatusImpact {
  observedDistance: number | null; observedHpConsumed: number | null; observedHpRecovered: number | null;
  modeledExtraDistance: number | null; modeledExtraTime: number | null; modeledExtraHp: number | null;
  duration: number; durationEvidence: 'sampled' | 'estimated'; detail: string;
}
export interface StatusImpactTotal extends Omit<StatusImpact, 'detail'> { kind: string; intervals: number; detail: string }
const kind = (value: string) => value.replace(/-model$/, '');
function selected(intervals: StatusInterval[]): StatusInterval[] {
  return intervals.filter(i => i.kind.endsWith('-model') || !intervals.some(m => m.kind.endsWith('-model') && kind(m.kind) === i.kind && m.start === i.start));
}
/** Integrate the observed samples inside each status window. These are concurrent
 * observations, never distance/HP attributed causally to the status. Model gains
 * are reference target-speed integrals; acceleration/caps can reduce realization. */
export function populateStatusImpacts(race: Race, runnerId: string, intervals: StatusInterval[], course: CourseReference | null = null,
  reference: ReferenceData | null = null, rows: SkillRow[] = [], analysis:Pick<RaceAnalysis,'runners'>|null=null): void {
  const runner = race.runners.find(r => r.id === runnerId)!;
  const stop = Math.min(race.duration, runner.finishTimeRaw ?? race.duration);
  const ground = Number(race.conditions?.ground), rawGuts = runner.stats?.guts, mood = runner.mood;
  let guts: number | null = rawGuts != null && rawGuts > 0 && mood != null && mood >= 1 && mood <= 5
    ? (rawGuts > 1200 ? 1200 + (rawGuts - 1200) / 2 : rawGuts) * (1 + .02 * (mood - 3)) + (race.category === 'career' ? 400 : 0) : null;
  if (!['practice', 'team-trials', 'champions-meeting', 'career'].includes(race.category ?? '')) guts = null;
  if (unresolvedPassiveStats(runner, rows, reference).has(4)) guts = null;
  for (const row of rows.filter(r => r.effectiveActive)) {
    const def = reference?.metadata.skills[row.skillId];
    const branches = row.activationStatus === 'inferred-passive' ? row.inferredBranches
      : row.activations.filter(a => a.start === 0).map(a => a.effectBranch ?? (def?.branches.length === 1 ? def.branches[0].branchIndex ?? 0 : -1));
    for (const index of branches) {
      const branch = def?.branches.find((b, i) => (b.branchIndex ?? i) === index);
      if (!branch) { guts = null; continue; }
      for (const effect of branch.effects.filter(e => e.type === 4)) {
        if (effect.valueUsage !== 1 || effect.levelUsage !== 1 || effect.targetType !== undefined && effect.targetType !== 1) guts = null;
        else {const value=effectValue(runner,row.skillId,effect);if(value===null)guts=null;else if(guts!==null)guts+=value;}
      }
    }
  }
  if(analysis)guts=analysis.runners[runnerId].statBreakdown.stats.guts.final;
  const hpCurve = course && race.distance != null && course.distance === race.distance && guts != null && guts > 0 && ground >= 1 && ground <= 4
    ? (speed: number, distance: number) => {
      const groundFactor = ground === 4 ? 1.02 : course.surface === 1 && ground === 3 ? 1.02 : course.surface === 2 && ground === 3 ? 1.01 : 1;
      const late = distance >= race.distance! * 2 / 3 ? 1 + 200 / Math.sqrt(600 * guts!) : 1;
      return 20 * Math.max(0, speed - (20 - (race.distance! - 2000) / 1000) + 12) ** 2 / 144 * groundFactor * late;
    } : null;
  const canonical = selected(intervals), runaway = effectiveStrategyCode(runner, rows) === 5;
  function hpMultiplier(time: number, excluded: string | null): number {
    const active = (name: string) => name !== excluded && canonical.some(i => kind(i.kind) === name && time >= i.start && time < (i.end ?? i.observedUntil ?? i.start));
    const rushed = active('rushed'), spot = active('spot-struggle');
    // These compound factors are not the product of the isolated factors.
    let multiplier = rushed && spot ? runaway ? 7.7 : 3.6 : spot ? runaway ? 3.5 : 1.4 : rushed ? 1.6 : 1;
    if (active('pace-down')) multiplier *= .6;
    if (active('downhill-mode')) multiplier *= .4;
    return multiplier;
  }
  for (const interval of intervals) {
    const end = Math.min(interval.end ?? interval.observedUntil ?? interval.start, stop);
    if (end <= interval.start) continue;
    let distance = 0, hpConsumed = 0, hpRecovered = 0, distanceSeconds = 0, hpSeconds = 0, modeledHp = 0, modeledSeconds = 0, speedSum = 0, speedSeconds = 0;
    const duration = end - interval.start;
    const bonus = interval.model?.integratedSpeedDelta != null ? interval.model.integratedSpeedDelta / duration : interval.model?.speedDelta ?? 0;
    const unresolvedSpeedBonus = interval.model?.speedMultiplier != null && interval.model.speedMultiplier !== 1 && interval.model.speedDelta == null && interval.model.integratedSpeedDelta == null
      || kind(interval.kind) === 'rushed' && interval.model?.integratedSpeedDelta == null && race.frames.some(f => f.time >= interval.start && f.time < end && f.runners.find(s => s.runnerId === runnerId)?.temptationMode === 4);
    for (let i = 1; i < race.frames.length; i++) {
      const fa = race.frames[i - 1], fb = race.frames[i], start = Math.max(fa.time, interval.start), finish = Math.min(fb.time, end);
      if (finish <= start) continue;
      const a = fa.runners.find(s => s.runnerId === runnerId), b = fb.runners.find(s => s.runnerId === runnerId);
      const fraction = (finish - start) / (fb.time - fa.time);
      if (a?.distance != null && b?.distance != null) { distance += (b.distance - a.distance) * fraction; distanceSeconds += finish - start; }
      if (a?.speed != null && b?.speed != null && a.speed > 0 && b.speed > 0) { speedSum += (a.speed + b.speed) / 2 * (finish - start); speedSeconds += finish - start; }
      if (a?.hp != null && b?.hp != null) { const delta = (b.hp - a.hp) * fraction; hpConsumed += Math.max(0, -delta); hpRecovered += Math.max(0, delta); hpSeconds += finish - start; }
      if (hpCurve && interval.model && !unresolvedSpeedBonus && a?.speed != null && b?.speed != null && a.distance != null && b.distance != null && a.hp != null && b.hp != null) {
        const lerp = (x: number, y: number, time: number) => x + (y - x) * (time - fa.time) / (fb.time - fa.time);
        const deltaAt = (time: number) => {
          if (lerp(a.hp!, b.hp!, time) <= 0) return 0;
          const actualSpeed = lerp(a.speed!, b.speed!, time), speed=analysis?selfSpeedAt(race,analysis,runnerId,time,actualSpeed):null, d = lerp(a.distance!, b.distance!, time);
          if(speed===null)return null;
          const full = hpMultiplier((start + finish) / 2, null), without = hpMultiplier((start + finish) / 2, kind(interval.kind));
          return hpCurve(speed, d) * full - hpCurve(Math.max(0, speed - bonus), d) * without;
        };
        const first=deltaAt(start),last=deltaAt(finish);if(first!==null&&last!==null){modeledHp += (first+last)/2*(finish-start);modeledSeconds+=finish-start;}
      }
    }
    const completeDistance = Math.abs(distanceSeconds - duration) < .0001, completeHp = Math.abs(hpSeconds - duration) < .0001, completeSpeed = Math.abs(speedSeconds - duration) < .0001;
    const modeledDistance = interval.model?.integratedSpeedDelta ?? (interval.model?.speedDelta != null ? interval.model.speedDelta * duration : null);
    const meanSpeed = speedSeconds > 0 ? speedSum / speedSeconds : null;
    interval.impact = { observedDistance: completeDistance ? distance : null, observedHpConsumed: completeHp ? hpConsumed : null, observedHpRecovered: completeHp ? hpRecovered : null,
      modeledExtraDistance: modeledDistance,
      modeledExtraTime: unresolvedSpeedBonus || modeledDistance == null || !completeSpeed || meanSpeed == null || meanSpeed <= 0.05 ? null : modeledDistance / meanSpeed,
      modeledExtraHp: unresolvedSpeedBonus ? null : hpCurve && interval.model && Math.abs(modeledSeconds - duration) < .0001 ? modeledHp : interval.model?.integratedHpDelta ?? (interval.model?.baselineHpRate != null && interval.model.modeledHpRate != null ? (interval.model.modeledHpRate - interval.model.baselineHpRate) * duration : null),
      duration, durationEvidence: interval.evidence === 'estimated' ? 'estimated' : 'sampled',
      detail: `Observed travel and gross sampled HP decreases/recoveries during this window include base drain and overlapping effects. ${interval.evidence === 'estimated' ? 'Window endpoints are modeled.' : 'Window endpoints are sampled; censored states stop at their last observation.'} Model distance integrates reference target-speed bonus; acceleration/caps may reduce actual gain. HP model removes resolved current-speed skill modifiers from observed actual speed, then compares the reference self-speed curve with this status removed (time-averaged target bonus), including known ground/late-guts factors and compound rushed + spot factors (Front 3.6, Runaway 7.7). This is a conditional counterfactual, not measured causal cost. Missing reference inputs stay unknown. Overlapping status totals must not be added as independent race gains/losses.` };
  }
}
export function statusImpactTotals(intervals: StatusInterval[]): StatusImpactTotal[] {
  const totals = new Map<string, StatusImpactTotal>();
  const ends = new Map<string, number>();
  for (const interval of selected(intervals).sort((a, b) => a.start - b.start)) {
    if (!interval.impact || !['rushed', 'rushed-boost', 'spot-struggle', 'dueling', 'pace-up', 'pace-down', 'speed-up', 'overtake', 'downhill-mode'].includes(kind(interval.kind))) continue;
    const key = kind(interval.kind), impact = interval.impact, prior = totals.get(key);
    const end = interval.start + impact.duration, overlap = Math.max(0, Math.min(ends.get(key) ?? interval.start, end) - interval.start);
    ends.set(key, Math.max(ends.get(key) ?? end, end));
    if (!prior) totals.set(key, { ...impact, kind: key, intervals: 1 });
    else {
      for (const field of ['observedDistance', 'observedHpConsumed', 'observedHpRecovered', 'modeledExtraDistance', 'modeledExtraTime', 'modeledExtraHp'] as const) prior[field] = overlap > .0001 || prior[field] === null || impact[field] === null ? null : prior[field]! + impact[field]!;
      prior.duration += impact.duration - overlap; prior.intervals++;
      if (overlap > .0001) prior.detail = 'Same-kind status windows overlap. Duration is their union; numeric distance/HP totals are withheld to avoid counting the same samples twice. ' + impact.detail;
      if (impact.durationEvidence === 'estimated') prior.durationEvidence = 'estimated';
    }
  }
  return [...totals.values()];
}
