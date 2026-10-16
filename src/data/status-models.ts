/* Formula/threshold reference: SSHZ.ORG replay reference (MIT), speedCalculations,
 * computeHeuristicEvents, analysisUtils and positionKeepUtils. HP multipliers
 * also checked against kachi-dev/uma-tools HpPolicy; mathematical facts only.
 * Conservative subset: no guessed stats/aptitudes/RNG or unknown skill scaling. */
import { runnerBySlot, type Race, type Runner, type RunnerAptitudes, type RunnerSample, type RunnerStats } from './types';
import type { CourseReference, ReferenceData, SkillReference } from './reference';
import type { SkillActivation, SkillRow, StatusInterval } from './analytics';
import { effectiveStrategyCode } from './skill-details';
import { unresolvedPassiveStats } from './passive-inputs';
import { boundedStat, statBreakdownFor } from './race-stats';
import { referenceEquippedSkillId } from './equipped-skills';
import { effectValue } from './effect-value';
import { resolveSkillTiming } from './skill-timing';
import { referenceDeceleration } from './mechanics-model';
import { neighborhoodConstraintAt } from './race-motion';
import { proximityPressure } from './movement-context';

const styleCoefficients: Record<number, number[]> = { 1: [1, .98, .962], 2: [.978, .991, .975], 3: [.938, .998, .994], 4: [.931, 1, 1], 5: [1.063, .962, .95] };
const styleAptitude = [.1, .2, .4, .6, .75, .85, 1, 1.1];
const distanceAptitude = [.1, .2, .4, .6, .8, .9, 1, 1.05];
const statsKeys = ['speed', 'stamina', 'power', 'guts', 'wisdom'] as const;
type CompleteStats = { [K in keyof RunnerStats]: number };
function rank(value: number | string | null | undefined): number | null {
  const n = typeof value === 'string' ? ({ G: 1, F: 2, E: 3, D: 4, C: 5, B: 6, A: 7, S: 8 } as Record<string, number>)[value] : value;
  return n != null && Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}
function at(frame: Race['frames'][number], id: string): RunnerSample | undefined { return frame.runners.find(s => s.runnerId === id); }
function crossing(race: Race, id: string, distance: number): number | null {
  for (let i = 1; i < race.frames.length; i++) {
    const a = race.frames[i - 1], b = race.frames[i], da = at(a, id)?.distance, db = at(b, id)?.distance;
    if (da != null && db != null && db > da && da <= distance && db >= distance) return a.time + (b.time - a.time) * (distance - da) / (db - da);
  }
  return null;
}
function branch(def: SkillReference | undefined, index: number | null) {
  return index === null ? def?.branches.length === 1 ? def.branches[0] : undefined : def?.branches.find((b, i) => (b.branchIndex ?? i) === index);
}
function baselineHp(speed: number, distance: number): number { return 20 * Math.max(0, speed - (20 - (distance - 2000) / 1000) + 12) ** 2 / 144; }
function modeledInterval(kind: string, label: string, start: number, end: number, detail: string, model: StatusInterval['model']): StatusInterval {
  return { kind, label, start, end, evidence: 'estimated', detail, model };
}
function merge(intervals: StatusInterval[], next: StatusInterval) {
  const duration = (next.end ?? next.start) - next.start;
  if (next.model?.speedDelta != null) next.model.integratedSpeedDelta = next.model.speedDelta * duration;
  if (next.model?.modeledHpRate != null && next.model.baselineHpRate != null) next.model.integratedHpDelta = (next.model.modeledHpRate - next.model.baselineHpRate) * duration;
  const prior = intervals[intervals.length - 1];
  if (prior?.kind === next.kind && prior.model?.speedMultiplier === next.model?.speedMultiplier && prior.end !== null && Math.abs(prior.end - next.start) < .0001) {
    prior.end = next.end;
    if (prior.model && next.model) {
      if (next.model.integratedSpeedDelta != null) prior.model.integratedSpeedDelta = (prior.model.integratedSpeedDelta ?? 0) + next.model.integratedSpeedDelta;
      if (next.model.integratedHpDelta != null) prior.model.integratedHpDelta = (prior.model.integratedHpDelta ?? 0) + next.model.integratedHpDelta;
    }
    if(next.detail.includes('Exit includes')&&!prior.detail.includes('Exit includes'))prior.detail+=' '+next.detail.slice(next.detail.indexOf('Exit includes'));
    // Numeric evidence remains that of the first classified interval, not an average.
  } else if ((next.end ?? next.start) - next.start >= .1) intervals.push(next);
}
function passiveBranches(reference: ReferenceData | null, activations: SkillActivation[], rows: SkillRow[]) {
  return [...activations.filter(a => a.start === 0).map(a => reference ? branch(reference.metadata.skills[a.referenceSkillId??a.skillId], a.effectBranch) : undefined),
    ...rows.filter(r => r.activationStatus === 'inferred-passive').map(r => reference && r.inferredBranches.length === 1 ? branch(reference.metadata.skills[r.skillId], r.inferredBranches[0]) : undefined)];
}
function eventRunner(race: Race, e: Race['events'][number]): string | null {
  return e.runnerId ?? runnerBySlot(race.runners, e.params[0])?.id ?? null;
}
/** Every recorded rushed mode can force the +4% position-keep target. Credit
 * only speed actually run above the ordinary target, up to that 4%. Early and
 * middle targets do not use final speed, so an unrelated speed green must not
 * hide them. A known spurt start still does not reveal the HP-selected target. */
function populateRushedBonuses(race:Race,runner:Runner,course:CourseReference|null,reference:ReferenceData|null,observed:StatusInterval[],rows:SkillRow[],activations:SkillActivation[]) {
  const total=race.distance,style=effectiveStrategyCode(runner,rows),coeff=style===null?null:styleCoefficients[style];
  if(total===null||!course||course.distance!==total||!coeff)return;
  const stats=statBreakdownFor(race,runner,course,reference,rows).stats;
  const distanceKey=total<=1400?'short':total<=1800?'mile':total<=2400?'middle':'long',aptitude=rank(runner.aptitudes?.[distanceKey]);
  const power=stats.power.final,base=20-(total-2000)/1000,stop=Math.min(runner.finishTimeRaw??race.duration,race.duration);
  const target=(distance:number):number|null=>{
    const phase=distance>=total*2/3?2:distance>=total/6?1:0;
    if(phase<2)return base*coeff[phase];
    if(stats.speed.final===null||aptitude===null||runner.lastSpurtDistance==null)return null;
    const term=Math.sqrt(500*stats.speed.final)*distanceAptitude[aptitude-1]*.002;
    if(runner.lastSpurtDistance<0||distance<runner.lastSpurtDistance)return base*coeff[2]+term;
    return null;
  };
  const skillOffset=(time:number):number|null=>{
    let sum=0;
    for(const activation of activations){
      if(time<activation.start)continue;
      const end=activation.effectiveEnd??activation.end;
      if(end!==null&&time>=end)continue;
      for(const effect of activation.effects){
        if(![21,22,27].includes(effect.type)||(effect.targetType??1)!==1)continue;
        if(end===null)return null;
        const value=effectValue(runner,activation.referenceSkillId??activation.skillId,effect);
        if(value===null)return null;
        sum+=Math.max(0,value);
      }
    }
    return sum;
  };
  for(const interval of observed.filter(i=>i.kind==='rushed'||i.kind==='rushed-boost')){
    const end=Math.min(interval.end??interval.observedUntil??interval.start,stop);let area=0,covered=0;
    for(let i=1;i<race.frames.length;i++){
      const fa=race.frames[i-1],fb=race.frames[i],begin=Math.max(fa.time,interval.start),finish=Math.min(fb.time,end),a=at(fa,runner.id),b=at(fb,runner.id);
      if(finish<=begin||a?.temptationMode==null||b?.temptationMode==null)continue;
      if(a.temptationMode<1||a.temptationMode>4){covered+=finish-begin;continue;}
      if(a.blockFrontRunnerIndex==null||b.blockFrontRunnerIndex==null||a.distance==null||b.distance==null||b.distance<a.distance||a.speed==null||b.speed==null)continue;
      if(a.blockFrontRunnerIndex!==-1||b.blockFrontRunnerIndex!==-1){covered+=finish-begin;continue;}
      const cuts=[begin,finish],marks=[total/6,total*2/3,runner.lastSpurtDistance??-1];
      for(const slope of course.slopes)marks.push(slope.start,slope.start+slope.length);
      for(const d of marks)if(d>a.distance&&d<b.distance){const time=fa.time+(fb.time-fa.time)*(d-a.distance)/(b.distance-a.distance);if(time>begin&&time<finish)cuts.push(time);}
      cuts.sort((x,y)=>x-y);
      let piece=0,pieceCovered=0,ok=true;
      for(let j=1;j<cuts.length&&ok;j++){
        const span=cuts[j]-cuts[j-1],mid=(cuts[j-1]+cuts[j])/2,fraction=(mid-fa.time)/(fb.time-fa.time);
        const d=a.distance+(b.distance-a.distance)*fraction,value=target(d),offset=skillOffset(mid);
        const slope=course.slopes.find(s=>d>=s.start&&d<s.start+s.length)?.slopePercent??0;
        if(value===null||offset===null||slope>0&&(power===null||power<=0)){ok=false;break;}
        const ordinary=value-(slope>0?slope*200/power!:0)+offset,bonus=value*.04,speed=a.speed+(b.speed-a.speed)*fraction;
        piece+=Math.min(bonus,Math.max(0,speed-ordinary))*span;pieceCovered+=span;
      }
      if(ok){area+=piece;covered+=pieceCovered;}
    }
    if(Math.abs(covered-(end-interval.start))<.0001){
      interval.model??={};interval.model.integratedSpeedDelta=area;
      interval.detail+=' Realized gain is recorded speed above the ordinary strategy target, capped at 4% of that target. Blocked time and speed still below the ordinary target add nothing; the climb onto the 4% counts only the surplus already reached. Uphill lowers the ordinary target. Positive current-speed and target-skill offsets are removed first. Section-wit stays separate, and an unknown spurt target withholds the window.';
    }
  }
}
/** Competition endpoints use their own recorded inputs, independently of venue identity. */
function competitionStatuses(race: Race, runner: Runner, reference: ReferenceData | null,
  activations: SkillActivation[], observed: StatusInterval[], rows: SkillRow[]): StatusInterval[] {
  const stop = Math.min(runner.finishTimeRaw ?? race.duration, race.duration), result: StatusInterval[] = [];
  const guts = runner.stats?.guts, mood = runner.mood;
  const adjustedGuts=statBreakdownFor(race,runner,null,reference,rows).stats.guts.final;
  const frontRank = rank(runner.aptitudes?.front), runaway = effectiveStrategyCode(runner, rows) === 5;
  for (const interval of observed) {
    if (interval.kind === 'spot-struggle' && race.distance != null && guts != null && guts > 0 && frontRank !== null) {
      const threshold = race.distance * 9 / 24;
      const cap = crossing(race, runner.id, threshold)
        ?? race.frames.find(f => at(f, runner.id)?.distance != null && at(f, runner.id)!.distance! >= threshold)?.time;
      const end = Math.min(stop, cap ?? stop, interval.start + Math.sqrt(700 * guts) * .012 * styleAptitude[frontRank - 1]);
      if (end <= interval.start) continue;
      interval.estimatedEnd = end;
      result.push(modeledInterval('spot-struggle-model', 'Spot struggle', interval.start, end,
        'Duration model: sqrt(700 × recorded guts) × 0.012 × front aptitude, bounded by the observed 9/24-distance crossing and recording/finish. Speed uses adjusted guts when available. Isolated HP factor excludes overlapping rushed/downhill effects.',
        { ...(adjustedGuts !== null ? { speedDelta: (500 * adjustedGuts) ** .6 * .0001 } : {}), hpDrainMultiplier: runaway ? 3.5 : 1.4 }));
    }
    if (interval.kind === 'dueling') {
      const firstHp = at(race.frames[0], runner.id)?.hp;
      if (firstHp == null || firstHp <= 0) continue;
      let end = stop, previousGap: { time: number; index: number; gap: number } | null = null;
      for (let index = 0; index < race.frames.length; index++) {
        const frame = race.frames[index];
        if (frame.time < interval.start || frame.time >= stop) continue;
        const s = at(frame, runner.id);
        const opponentIds = new Set(race.events.filter(e => e.type === 5 && e.time <= frame.time)
          .map(e => eventRunner(race, e)).filter((id): id is string => id !== null && id !== runner.id));
        const opponents = [...opponentIds].map(id => at(frame, id)?.distance);
        const gaps = s?.distance == null ? [] : opponents.filter((d): d is number => d != null).map(d => Math.abs(d - s.distance!));
        const known = opponents.length > 0 && opponents.every(d => d != null);
        const gap = known && gaps.length ? Math.min(...gaps) : null;
        if (s?.hp != null && s.hp < firstHp * .05) { end = frame.time; break; }
        if (gap != null && gap >= 5) {
          const adjacent = previousGap != null && previousGap.index === index - 1 && previousGap.gap < 5;
          end = adjacent ? previousGap!.time + (frame.time - previousGap!.time) * (5 - previousGap!.gap) / (gap - previousGap!.gap) : frame.time;
          break;
        }
        if (gap != null) previousGap = { time: frame.time, index, gap };
      }
      if (end <= interval.start) continue;
      interval.estimatedEnd = end;
      result.push(modeledInterval('dueling-model', 'Dueling', interval.start, end,
        'Endpoint model: stop at HP below 5% of initial HP, at the interpolated crossing of 5 m from every other recorded dueler, or at recording/finish. Missing opponent distances cannot establish separation. Speed-based/uphill-resume exits are unresolved; duration may be an upper estimate. No independent dueling HP multiplier is established; higher speed affects the HP reference curve.',
        adjustedGuts !== null ? { speedDelta: (200 * adjustedGuts) ** .708 * .0001 } : undefined));
    }
  }
  return result;
}
export function modeledStatuses(race: Race, runner: Runner, course: CourseReference | null, reference: ReferenceData | null,
  activations: SkillActivation[], observed: StatusInterval[], rows: SkillRow[] = []): StatusInterval[] {
  const result = competitionStatuses(race, runner, reference, activations, observed, rows);
  populateRushedBonuses(race,runner,course,reference,observed,rows,activations);
  // Final speed, power, and guts can each be withheld by an unproven passive.
  // Early and middle pace targets do not use those stats. Wisdom still does:
  // it sets the target band, so an unproven wisdom passive withholds the fit.
  if ([...unresolvedPassiveStats(runner, rows, reference)].some(stat => stat === 5)) return result;
  if (race.distance === null || !course || !reference || course.distance !== race.distance || runner.finishTimeRaw == null) return result;
  const totalDistance = race.distance;
  const stop = Math.min(runner.finishTimeRaw, race.duration);
  const metadata = reference.metadata;
  const mood = runner.mood, stats = runner.stats;
  const style = effectiveStrategyCode(runner, rows);
  const speedUpMultiplier=1.04;
  if (!stats || statsKeys.some(k => stats[k] == null || stats[k]! <= 0) || mood == null || mood < 1 || mood > 5 || style == null || !styleCoefficients[style]) return result;
  if (!['practice', 'team-trials', 'champions-meeting', 'career'].includes(race.category ?? '')) return result;
  const full = stats as CompleteStats;
  const styleKey = ({ 1: 'front', 2: 'pace', 3: 'late', 4: 'end', 5: 'front' } as Record<number, keyof RunnerAptitudes>)[style];
  const distanceKey = race.distance <= 1400 ? 'short' : race.distance <= 1800 ? 'mile' : race.distance <= 2400 ? 'middle' : 'long';
  const styleRank = rank(runner.aptitudes?.[styleKey]), distanceRank = rank(runner.aptitudes?.[distanceKey]);
  const ground = Number(race.conditions?.ground);
  if (styleRank === null || distanceRank === null || !Number.isInteger(ground) || ground < 1 || ground > 4) return result;
  const adjusted=statBreakdownFor(race,runner,course,reference,rows).stats;
  const proven=(stat:typeof adjusted.guts)=>stat.final!=null?stat.final:[stat.base,stat.courseGain,stat.strategyGain,stat.groundGain,stat.careerGain].every(part=>part!=null)?[stat.base,stat.courseGain,stat.strategyGain,stat.groundGain,stat.careerGain].reduce<number>((sum,part)=>sum+part!,0):null;
  const adjustedGuts=proven(adjusted.guts),adjustedPower=proven(adjusted.power),adjustedWisdom=adjusted.wisdom.final;
  const speedBand=boundedStat(runner,rows,reference,adjusted.speed,1);
  if(adjustedGuts===null||adjustedPower===null||adjustedWisdom===null)return result;
  const keys:Record<number,keyof CompleteStats>={1:'speed',2:'stamina',3:'power',4:'guts',5:'wisdom'};
  const relevant=new Set([1,2,3,4,5,9,21,22,27,28,31,35]);
  const base = 20 - (race.distance - 2000) / 1000;
  const runaway = style === 5;
  const coeff = runaway ? [1.063, .962, .95] : styleCoefficients[style];
  const speedKnown = speedBand !== null;
  const speedTerm = speedKnown ? Math.sqrt(500 * (speedBand.low + speedBand.high) / 2) * distanceAptitude[distanceRank - 1] * .002 : 0;
  const witMax = adjustedWisdom / 5500 * Math.log10(.1 * adjustedWisdom);
  const target = (sample: RunnerSample, slope: number) => {
    const d = sample.distance!, phase = d >= race.distance! * 2 / 3 ? 2 : d >= race.distance! / 6 ? 1 : 0;
    const spurt = runner.lastSpurtDistance != null && runner.lastSpurtDistance >= 0 && d >= runner.lastSpurtDistance;
    if ((phase === 2 || spurt) && !speedKnown) return null;
    let normal = base * coeff[phase] + (phase === 2 ? speedTerm : 0);
    if (spurt) normal = (base * coeff[2] + speedTerm + .01 * base) * 1.05 + speedTerm + (450 * adjustedGuts) ** .597 * .0001;
    if (slope > 0) normal -= slope * 200 / adjustedPower;
    return { base: normal, min: normal + (spurt ? 0 : base * (witMax - .65) / 100), max: normal + (spurt ? 0 : base * witMax / 100) };
  };
  const allSkills = race.events.filter(e => (e.type === 3 || e.type === 'skill') && e.skillId !== null && (e.params[2] !== -1 || e.time === 0));
  const procContexts = allSkills.map(event => {
    const source = race.runners.find(r => r.id === eventRunner(race, event));
    const id = source ? referenceEquippedSkillId(source, event.skillId!) : null, definition = id === null ? undefined : metadata.skills[id];
    const selected = branch(definition, Number.isInteger(event.params[3]) ? event.params[3] : null);
    const timing = source ? resolveSkillTiming(race, source, reference, selected, event.time,
      event.time > 0 && event.params[2] > 0 ? event.params[2] / 10000 : null, definition) : null;
    return { event, source, id, selected, timing };
  });
  // The initial binary markers have no timed recorded proc. A separately
  // supported initial reference activation may still resolve its acceleration
  // context. This local adapter creates no RaceEvent or recorded timing.
  for(const activation of activations){
    if(activation.start!==0||activation.activationEvidence!=='estimated'||procContexts.some(c=>c.source?.id===runner.id&&c.event.skillId===activation.skillId&&c.event.time===activation.start))continue;
    const id=activation.referenceSkillId??referenceEquippedSkillId(runner,activation.skillId),selected=branch(id==null?undefined:metadata.skills[id],activation.effectBranch);
    if(!selected)continue;
    procContexts.push({event:{time:activation.start,type:'reference-context',runnerId:runner.id,skillId:activation.skillId,label:'Initial reference activation context',params:[runner.index,activation.skillId,0,activation.effectBranch??0,1<<runner.index]},source:runner,id,selected,timing:activation});
  }
  /** HP is computed from self velocity. Resolved target/acceleration skills
   * change that observed velocity, so they need not censor an HP-ratio test.
   * Instant HP changes only contaminate their touching sample brackets. */
  function resolvedBracket(start: number, end: number): { currentStart: number; currentEnd: number; targetStart: number; targetEnd: number; targetAt:(time:number)=>number; accelAt:(time:number)=>number; positiveVelocity: boolean; acceleration: boolean; hpContaminated:boolean } | null {
    if (observed.some(i => i.kind === 'dueling' && i.start < end && (i.end ?? i.estimatedEnd ?? stop) > start)) return null;
    let currentStart = 0, currentEnd = 0, targetStart = 0, targetEnd = 0, positiveVelocity = false, acceleration = false, hpContaminated = false;
    const timed:{start:number;end:number;target:number;accel:number}[]=[];
    for (const { event: e, source, id, selected, timing } of procContexts) {
      if (e.time > end) continue;
      const self = source?.id === runner.id, mask = e.params[4];
      const knownMask = Number.isInteger(mask) && race.runners.length <= 32, targeted = knownMask && runner.index < 32 && Boolean(mask & (1 << runner.index));
      if (!selected || !source || id === null) { if (self || targeted || !knownMask) return null; continue; }
      const effects = selected.effects.filter(effect => {
        if (!relevant.has(effect.type)) return false;
        if ((effect.targetType ?? 1) === 1) return self;
        if (source.teamGroup != null && runner.teamGroup != null && source.teamGroup === runner.teamGroup && effect.rawValue < 0) return false;
        return targeted || !knownMask;
      });
      for (const effect of effects) {
        // The stat breakdown already includes proven initial/passive stats.
        if (e.time === 0 && keys[effect.type]) continue;
        if (effect.type === 9) { if (e.time >= start && e.time <= end) hpContaminated=true; continue; }
        const activeEnd = timing?.effectiveEnd ?? stop;
        if (activeEnd <= start) continue;
        if ((effect.targetType ?? 1) !== 1 && !knownMask) return null;
        if ((effect.targetType ?? 1) !== 1 && effect.rawValue < 0 && (source.teamGroup == null || runner.teamGroup == null)) return null;
        // Lane movement changes lateral position. It does not censor the speed fit.
        if (effect.type === 28 || effect.type === 35) continue;
        const magnitude = effectValue(source, id, effect);
        if (magnitude === null || timing?.effectiveEnd == null || ![21, 22, 27, 31].includes(effect.type)) return null;
        if ([21, 22, 27].includes(effect.type) && magnitude > 0) positiveVelocity = true;
        if (effect.type === 31) acceleration = true;
        if ([21, 22].includes(effect.type)) {
          // Retained velocity is not a continuous trace across a direct-speed
          // discontinuity; do not normalize its onset/expiry bracket.
          if (e.time > start && e.time < end || activeEnd > start && activeEnd < end) return null;
          if (start >= e.time && start < activeEnd) currentStart += magnitude;
          if (end >= e.time && end < activeEnd) currentEnd += magnitude;
          else if (activeEnd === end) return null;
        } else if (effect.type === 27) {
          if (start >= e.time && start < activeEnd) targetStart += magnitude;
          if (end >= e.time && end < activeEnd) targetEnd += magnitude;
        }
        if(effect.type===27||effect.type===31)timed.push({start:e.time,end:activeEnd,target:effect.type===27?magnitude:0,accel:effect.type===31?magnitude:0});
      }
    }
    return { currentStart, currentEnd, targetStart, targetEnd, positiveVelocity, acceleration, hpContaminated,
      targetAt:time=>timed.reduce((n,e)=>n+(time>=e.start&&time<e.end?e.target:0),0),accelAt:time=>timed.reduce((n,e)=>n+(time>=e.start&&time<e.end?e.accel:0),0) };
  }
  const effectiveFieldStyles = new Map(race.runners.map(other => {
    if (other.id === runner.id) return [other.id, style] as const;
    if (other.strategyCode === 5) return [other.id, 5] as const;
    if (other.strategyCode === 1 && other.skills?.some(s => s.id === 202051)) {
      const runaway = metadata.skills[202051];
      const proven = allSkills.some(e => e.skillId === 202051 && eventRunner(race, e) === other.id)
        || runaway?.activateLot === 0 && runaway.branches.some(b => b.rawDuration < 0 && b.condition === 'running_style==1' && !b.precondition);
      return [other.id, proven ? 5 : null] as const;
    }
    return [other.id, other.strategyCode ?? null] as const;
  }));
  const struggleModel = result.find(i => i.kind === 'spot-struggle-model');
  const struggleObserved = observed.find(i => i.kind === 'spot-struggle');
  const struggleStart = struggleModel?.start ?? null;
  let struggleEnd = struggleModel?.end ?? null;
  const struggleDelta = struggleModel?.model?.speedDelta ?? 0;
  const struggleAt = (time: number) => struggleStart != null && struggleEnd != null && struggleDelta > .05 && time >= struggleStart && time < struggleEnd ? struggleDelta : 0;
  let dashFinished = false;
  const downhill: StatusInterval[] = [], pace: StatusInterval[] = [];
  type PendingRamp={start:number;end:number;label:string};
  let pendingRamp:PendingRamp|null=null;
  const laneBonusAt=(time:number,lane:number|null)=>{
    if(lane==null)return 0;
    let previous:number|null=null;
    for(const frame of race.frames){if(frame.time>=time-1e-9)break;const recorded=frame.runners.find(r=>r.runnerId===runner.id)?.lane;if(recorded!=null)previous=recorded;}
    if(previous==null||Math.abs(lane-previous)<1e-4)return 0;
    const active=procContexts.some(({event:e,source,selected,timing})=>selected!=null&&source?.id===runner.id&&e.time<=time&&(timing?.effectiveEnd??stop)>time&&selected.effects.some(effect=>effect.type===28&&(effect.targetType??1)===1));
    return active?Math.sqrt(.0002*adjustedPower):0;
  };
  const extendThroughTraffic=(interval:StatusInterval,end:number)=>{
    interval.end=end;
    if(!interval.detail.includes('does not end position keep')){
      interval.detail+=' A recorded front block or nearby slowdown does not end position keep; that readable stretch stays inside the mode.';
    }
  };
  for (let i = 0; i < race.frames.length - 1; i++) {
    const fa = race.frames[i], fb = race.frames[i + 1];
    if (fa.time >= stop || fb.time > stop) break;
    const a = at(fa, runner.id), b = at(fb, runner.id), dt = fb.time - fa.time;
    if (!a || !b || dt < .1 || dt>2 || a.distance == null || b.distance == null || a.speed == null || b.speed == null || a.hp == null || b.hp == null || a.hp <= 0 || b.hp <= 0 || a.temptationMode == null || b.temptationMode == null) continue;
    const slope = course.slopes.find(s => a.distance! >= s.start && a.distance! < s.start + s.length);
    const slopePercent = slope?.slopePercent ?? 0;
    const nextSlopePercent=course.slopes.find(s=>b.distance!>=s.start&&b.distance!<s.start+s.length)?.slopePercent??0;
    const skillContext = resolvedBracket(fa.time, fb.time); if (!skillContext) continue;
    const groundHp=ground===4?1.02:ground===3?course.surface===1?1.02:1.01:1;
    const lateHp=a.distance>=race.distance*2/3?1+200/Math.sqrt(600*adjustedGuts):1;
    const selfA = a.speed - skillContext.currentStart, selfB = b.speed - skillContext.currentEnd;
    if (selfA < 0 || selfB < 0) continue;
    if (selfA >= .85 * base) dashFinished = true;
    const expected = (baselineHp(selfA, race.distance) + baselineHp(selfB, race.distance)) / 2 * groundHp * lateHp;
    const rate = (a.hp - b.hp) / dt, hpValid=!skillContext.hpContaminated&&rate>0, ratio = hpValid&&expected > 0 ? rate / expected : Infinity;
    const acceleration = (selfB - selfA) / dt;
    const bonus = .3 + Math.abs(slopePercent) / 10;
    // Independent HP evidence, never a speed surplus that could later be used
    // to assess the very skill responsible for that surplus.
    const isDownhill = slopePercent < 0 && nextSlopePercent===slopePercent && ratio < .5;
    const model = { baselineHpRate: expected, ...(hpValid?{observedHpRate:rate,hpRatio:ratio}:{}) };
    const normal = target(a, slopePercent);
    if (isDownhill) merge(downhill, modeledInterval('downhill-mode-model', 'Downhill mode', fa.time, fb.time,
      `Downhill-mode candidate from downhill grade and normalized HP drain ratio ${ratio.toFixed(2)} < 0.5. Reference HP uses observed self speed after resolved current-speed modifiers are removed; resolved target-speed/acceleration skills do not censor this independent HP test. Instant HP event brackets and unknown effects/masks/scaling are excluded. Baseline ${expected.toFixed(2)} HP/s; observed net ${rate.toFixed(2)} HP/s. Mode is inferred, not directly recorded; absence of a candidate does not establish mode off.`,
      { ...model, speedDelta: bonus, hpDrainMultiplier: .4, modeledHpRate: expected * .4 }));
    if (!normal) continue;
    const paceLimit=race.distance*10/24;
    if (!dashFinished) { pendingRamp = null; continue; }
    // Section 10 is the last place a mode can start. One already running keeps
    // its ceiling until the speed leaves it, including past that line.
    const carried=pace.at(-1)?.end===fa.time||pendingRamp?.end===fa.time;
    if (a.distance >= paceLimit && !carried) continue;
    if(a.blockFrontRunnerIndex==null||b.blockFrontRunnerIndex==null){pendingRamp=null;continue;}
    // A recorded block caps speed. It does not end position keep, including a
    // pace down, and it must not erase the rest of a mode once the block clears.
    // A bracket that only becomes blocked at its end, while speed is still flat,
    // can still start the mode; the cap has not moved her yet.
    if (a.blockFrontRunnerIndex !== -1 || b.blockFrontRunnerIndex !== -1) {
      const prior = pace.at(-1);
      const open = prior?.end === fa.time;
      const endJustBlocked = a.blockFrontRunnerIndex === -1 && Math.abs((a.speed ?? 0) - (b.speed ?? 0)) < .08;
      const climbingOff = prior?.kind === 'pace-down-model' && (b.speed ?? 0) > (a.speed ?? 0) + .08;
      if (open && !climbingOff) {
        extendThroughTraffic(prior,fb.time);
        if (pendingRamp?.end === fa.time) pendingRamp = { ...(pendingRamp as PendingRamp), end: fb.time };
        else pendingRamp = null;
        continue;
      }
      if (!endJustBlocked) {
        if (pendingRamp?.end === fa.time) pendingRamp = { ...(pendingRamp as PendingRamp), end: fb.time };
        else pendingRamp = null;
        continue;
      }
    }
    const field = race.runners.map(r => ({ runner: r, a: at(fa, r.id), b: at(fb, r.id), style: effectiveFieldStyles.get(r.id) }));
    if (field.some(r => r.a?.distance == null || r.b?.distance == null || r.style == null)) continue;
    const leaderDistance = Math.max(...field.map(r => r.a!.distance!));
    const priority = (s: number) => s === 5 ? 0 : s;
    const forwardStyle = field.reduce((best, r) => priority(r.style!) < priority(best) ? r.style! : best, style);
    const pacerDistance = Math.max(...field.filter(r => r.style === forwardStyle).map(r => r.a!.distance!));
    // Actual post-1.5 pacemaker selection is unrecorded. This is the leading
    // runner of the most forward selected strategy, explicitly a gap proxy.
    const gap = pacerDistance - a.distance, factor = 1 + (race.distance - 1000) * .0008;
    const range = style === 2 ? { min: 3, max: 5 * factor } : style === 3 ? { min: 6.5 * factor, max: 7 * factor } : style === 4 ? { min: 7.5 * factor, max: 8 * factor } : null;
    const downBonus = isDownhill ? bonus : 0, nextNormal = target(b, nextSlopePercent);
    const uphillPenalty = slopePercent > 0 ? slopePercent * 200 / adjustedPower : 0;
    const modeBase = normal.base + uphillPenalty;
    // A rushed flag makes the +4% available. Sitting on that ceiling is the
    // flag. A later climb back up to it is still a pace up.
    const rushCeiling=(skills:number)=>(normal.min+normal.max)/2+modeBase*.04+skills;
    if(a.temptationMode!==0&&b.temptationMode!==0&&Math.abs(selfA-rushCeiling(skillContext.targetStart))<=.12&&Math.abs(selfB-rushCeiling(skillContext.targetEnd))<=.12&&acceleration<.05){pendingRamp=null;continue;}
    const referenceMin = normal.min + downBonus + skillContext.targetStart;
    const downMultiplier = a.distance >= race.distance / 6 ? .945 : .915;
    const theoreticalDown = normal.base + modeBase * (downMultiplier - 1) + downBonus + skillContext.targetStart;
    const hpLow = ratio < (isDownhill ? .3 : .8);
    const low = !skillContext.positiveVelocity && hpLow && (selfA < referenceMin * .98 && acceleration < .2 || selfA < theoreticalDown * 1.06 && acceleration < .5)
      && !(acceleration > .2 && selfA > theoreticalDown * 1.02);
    const surfaceRank=rank(runner.aptitudes?.[course.surface===1?'turf':'dirt']);
    const surfaceFactor=surfaceRank===null?1:[.1,.3,.5,.7,.8,.9,1,1.05][surfaceRank-1];
    const accelCoefficients:Record<number,number[]>={1:[1,1],2:[.985,1],3:[.975,1],4:[.945,1],5:[1.17,.94]};
    const lane=Math.max(laneBonusAt(fa.time,a.lane),laneBonusAt(fb.time,b.lane));
    // Integrate from the observed self speed toward one target. The no-mode
    // path uses multiplier 1. A candidate has to land closer to the next
    // sample than that path; the speed gained inside the bracket is not slack.
    const predict=(multiplier:number,switchAfter=0)=>{let v=selfA;for(let elapsed=0;elapsed<dt;){const step=Math.min(1/60,dt-elapsed),mid=elapsed+step/2,
      d=a.distance!+(b.distance!-a.distance!)*mid/dt,p=d>=race.distance!/6?1:0,s={...a,distance:d},slopeAt=course.slopes.find(s=>d>=s.start&&d<s.start+s.length)?.slopePercent??0,normalAt=target(s,slopeAt);
      if(!normalAt)return null;const baseAt=base*coeff[p],
      ceiling=normalAt.max+baseAt*((mid>=switchAfter?multiplier:1)-1)+Math.max(downBonus,slopeAt<0?.3+Math.abs(slopeAt)/10:0)+skillContext.targetAt(fa.time+mid)+struggleAt(fa.time+mid),
      force=(slopeAt>0?0.0004:0.0006)*Math.sqrt(500*adjustedPower)*accelCoefficients[style][p]*surfaceFactor*[.4,.5,.6,1,1,1,1,1][distanceRank-1]+skillContext.accelAt(fa.time+mid);
      v=v<ceiling?Math.min(ceiling,v+force*step):Math.max(ceiling,v-(p===0?1.2:0.8)*step);elapsed+=step;}return v;};
    const ordinaryEnd=predict(1);
    const tracks=(multiplier:number)=>{const projected=predict(multiplier);return ordinaryEnd!==null&&projected!==null&&Math.abs(selfB-projected)+.08<Math.abs(selfB-ordinaryEnd)&&selfB<=projected+.14&&selfB>=projected-.22;};
    // A 1s sample can land on the raised or lowered ceiling without a clean
    // acceleration integral. That endpoint is enough for every position-keep
    // mode, including pace up and pace down.
    const seated=(multiplier:number)=>{
      const baseMiddle=(normal.min+normal.max)/2+skillContext.targetEnd+struggleAt(fb.time-.0001);
      const hills=nextSlopePercent<0?[0,.3+Math.abs(nextSlopePercent)/10]:[isDownhill?bonus:0];
      return hills.some(hill=>{const target=baseMiddle+hill+modeBase*(multiplier-1),err=Math.abs(selfB-target);return err<=.12&&err+.04<Math.abs(selfB-baseMiddle);});
    };
    if(struggleStart!=null&&struggleEnd!=null&&struggleDelta>.05&&fa.time<struggleEnd&&fb.time>struggleStart){
      const score=(speed:number,skills:number,extra:number)=>{
        const middle=(normal.min+normal.max)/2+(isDownhill?bonus:0)+skills+extra;
        const lifts=[0,modeBase*.04,...(style===1||style===5?[modeBase*.05]:[]),...(range?[modeBase*(downMultiplier-1)]:[])];
        return Math.min(...lifts.map(lift=>Math.abs(speed-(middle+lift))));
      };
      const withoutA=score(selfA,skillContext.targetStart,0),withA=score(selfA,skillContext.targetStart,struggleDelta);
      const withoutB=score(selfB,skillContext.targetEnd,0),withB=score(selfB,skillContext.targetEnd,struggleDelta);
      if(withoutA<=.12&&withoutB<=.12&&withoutA+.08<withA&&withoutB+.08<withB){
        struggleEnd=fa.time;
        if(struggleModel)struggleModel.end=fa.time;
        if(struggleObserved&& (struggleObserved.estimatedEnd==null||struggleObserved.estimatedEnd>fa.time))struggleObserved.estimatedEnd=fa.time;
      }
    }
    // On a downhill, unusable HP cannot tell a hill bonus from a pace bonus.
    // A surplus no larger than the hill bonus stays unlabeled; pace on top of
    // that bonus still exceeds it. Confirmed downhill HP already sits in both integrals.
    const hillSurplusAmbiguous=ordinaryEnd!==null&&slopePercent<0&&!isDownhill&&!hpValid&&selfB-ordinaryEnd<bonus+.15&&!seated(1.04)&&!seated(1.05);
    const minimumSpeed=.85*base+Math.sqrt(200*adjustedGuts)*.001;
    const onFloor=theoreticalDown<=minimumSpeed+.08&&selfA>=minimumSpeed-.1&&selfB>=minimumSpeed-.1&&selfB<=minimumSpeed+.15&&Math.abs(selfB-selfA)<.15;
    const ordinaryMid=(normal.min+normal.max)/2;
    // A new pace down starts when she is still too close and speed is falling
    // back under the ordinary target. It does not have to be on the ceiling yet.
    const settlingDown=!skillContext.positiveVelocity&&acceleration<.02&&selfA<ordinaryMid-.2&&selfB<ordinaryMid-.3&&selfB<=selfA+.02;
    const detail = `Position-keep candidate before 10/24 distance. Each bracket is integrated from the observed self speed toward the no-mode target and toward each position-legal mode target. A mode is kept only when its integral meets the next sample more closely than the no-mode integral. Start dash, blocking, rushed/competition and unresolved skill windows are excluded. Resolved direct-speed modifiers are removed; target-skill offsets and a confirmed downhill bonus are in every hypothesis. Reference speed ${normal.min.toFixed(2)}–${normal.max.toFixed(2)} m/s; ${hpValid?`baseline ${expected.toFixed(2)} HP/s, observed net ${rate.toFixed(2)} HP/s.`:'HP evidence is unavailable in this instant-HP sample bracket; a downhill-sized surplus is not labeled as pace.'} Pacemaker selection is unrecorded; nonfront gap uses the leading runner of the most forward strategy as a proxy. Native entry rolls/cooldowns and unseen exits are not reconstructed. No unknown gaps are joined; absence is not mode off. Modeled speed/HP factors are not measured contributions.`;
    let label: string | null = null;
    const preceding = pace.at(-1), contiguous = preceding?.end === fa.time;
    const nearEnd=proximityPressure(race,runner.id,b)===true,near=proximityPressure(race,runner.id,a)===true||nearEnd;
    const continuingUp = contiguous && preceding?.kind === 'pace-up-model';
    const continuingDown = contiguous && preceding?.kind === 'pace-down-model';
    const previousRamp=pendingRamp as {start:number;end:number;label:string}|null;
    const pendingContiguous:boolean=previousRamp?.end===fa.time;
    const runaways=field.filter(r=>r.style===5),fronts=field.filter(r=>r.style===1),pacerPool=runaways.length?runaways:fronts;
    const paceLeader=pacerPool.length?Math.max(...pacerPool.map(r=>r.a!.distance!)):a.distance;
    // A Front behind the leading Runaway is in overtake. A Runaway who has not
    // taken the overall lead is too: that chase is overtake, and it can keep the
    // ×1.05 ceiling after she leads until the exit gap.
    const behindRunaway=!runaways.some(r=>r.runner.id===runner.id)&&paceLeader>a.distance+.01;
    const leading=a.distance+.01>=leaderDistance;
    let modeMultiplier=speedUpMultiplier;
    const keep=(name:string)=>name==='Overtake'?1.05:name==='Speed up'?modeMultiplier:1.04;
    if (style === 1 || style === 5) {
      const peers = field.filter(r => r.runner.id !== runner.id && r.style === style);
      const second = Math.max(...field.filter(r => r.runner.id !== runner.id).map(r => r.a!.distance!));
      const earlier=race.frames[i-1],earlierSelf=earlier&&at(earlier,runner.id),earlierContext=earlier&&fa.time-earlier.time<=2?resolvedBracket(earlier.time,fa.time):null;
      const earlierTarget=earlierSelf?.distance!=null?target(earlierSelf,course.slopes.find(s=>earlierSelf.distance!>=s.start&&earlierSelf.distance!<s.start+s.length)?.slopePercent??0):null;
      const recentOvertake=(!contiguous||preceding?.kind==='overtake-model')&&earlierTarget!==null&&earlierSelf?.distance!=null&&earlierSelf.speed!=null&&earlierContext!==null&&earlierContext!==undefined
        &&earlierSelf.speed-earlierContext.currentStart>earlierTarget.max+earlierContext.targetStart+.04
        &&peers.some(r=>{const p=at(earlier,r.runner.id);return p?.distance!=null&&p.distance>earlierSelf.distance!+.01;});
      const prior = pace.at(-1), priorOvertake = prior?.kind === 'overtake-model' && prior.end != null && fa.time - prior.end <= .4 || pendingContiguous&&previousRamp?.label==='Overtake'||recentOvertake;
      const otCeiling=(normal.min+normal.max)/2+skillContext.targetEnd+modeBase*.05;
      const laneHold=priorOvertake&&lane>0&&selfB>=otCeiling-.2&&selfB<=otCeiling+lane+.08;
      const high=!hillSurplusAmbiguous&&(tracks(1.05)||seated(1.05)||laneHold);
      const close=a.distance-second<(style===5?17.5:peers.length===0?12.5:4.5);
      const exitGap=style===5?27.5:10;
      const rivalAhead=peers.some(r=>r.a!.distance!>a.distance!+.01);
      const rivalClose=peers.length>0&&a.distance-Math.max(...peers.map(r=>r.a!.distance!))<exitGap;
      // Same-strategy overtake keeps its name after taking that lead. A runaway
      // chase with no runaway rival becomes speed up once she leads the race,
      // still on the ×1.05 ceiling, until she falls to ×1.04.
      const overtake=high&&(behindRunaway||rivalAhead||style===5&&!leading||priorOvertake&&rivalClose);
      const speedUp=!overtake&&!hillSurplusAmbiguous&&leading&&!behindRunaway&&close&&(high||tracks(speedUpMultiplier)||seated(speedUpMultiplier));
      if(overtake){label='Overtake';modeMultiplier=1.05;}
      else if(speedUp){label='Speed up';modeMultiplier=seated(1.05)||laneHold?1.05:speedUpMultiplier;}
      if(label==='Speed up'&&modeMultiplier>1.045&&preceding?.kind==='speed-up-model'&&Math.abs((preceding.model?.speedMultiplier??1)-1.04)<.01&&preceding.end===fa.time)modeMultiplier=1.04;
    } else if (!hillSurplusAmbiguous && range && (gap > range.max - .5 || continuingUp && gap >= range.min) && (tracks(1.04) || seated(1.04))) label = 'Pace up';
    const phaseLine=race.distance/6,crossesPhase=a.distance!<phaseLine&&b.distance!>=phaseLine;
    // Triggered just before the early/mid line, the new ceiling is the mid-leg
    // one. The crossing sample is still below it, so keep the climb as a ramp
    // until a later sample actually lands on that ceiling.
    if(label==='Pace up'&&crossesPhase&&nextNormal&&!seated(1.04)&&selfB<nextNormal.max+skillContext.targetEnd+.04)label=null;
    // The uphill penalty coming off raises ordinary speed on its own. A new
    // mode has to be on the post-hill ceiling; an already-open mode can continue.
    const hillEasing=slopePercent>.2&&nextSlopePercent<slopePercent-.2;
    const continuingRaised=contiguous&&(preceding?.kind==='pace-up-model'||preceding?.kind==='overtake-model'||preceding?.kind==='speed-up-model')||pendingContiguous&&previousRamp?.label===label;
    if(label&&hillEasing&&!continuingRaised&&nextNormal){
      const mult=keep(label),destination=nextNormal.max+nextNormal.base*(mult-1)+skillContext.targetEnd;
      if(selfB<destination-.12)label=null;
    }
    // A pace-up that has left its ceiling is over. The next phase's ordinary
    // target can be higher, and the climb onto that target is not the same mode.
    if(label&&acceleration<-.05){
      const mult=keep(label),hill=nextSlopePercent<0?.3+Math.abs(nextSlopePercent)/10:0,ceiling=(nextNormal?(nextNormal.min+nextNormal.max)/2+(nextNormal.base+(nextSlopePercent>0?nextSlopePercent*200/adjustedPower:0))*(mult-1):(normal.min+normal.max)/2+modeBase*(mult-1))+skillContext.targetEnd+hill;
      if(selfB<ceiling-.05)label=null;
    }
    // Still climbing toward a raised ceiling. Remember the onset, and do not
    // call the climb a mode until a later sample actually reaches that ceiling.
    let rampLabel:string|null=null,rampStart:number=fa.time;
    if(!label&&acceleration>.05){
      const approaching=(multiplier:number)=>{const projected=predict(multiplier);return ordinaryEnd!==null&&projected!==null&&selfB>ordinaryEnd+.06&&selfB<=projected+.14&&selfB<projected-.05;};
      const clearOfOrdinary=selfB>normal.max+downBonus+skillContext.targetEnd+.15;
      const paceGap=!!range&&(gap>range.max-.5||(pendingContiguous&&previousRamp?.label==='Pace up')&&gap>=range.min);
      if(paceGap&&approaching(1.04)&&(clearOfOrdinary||pendingContiguous&&previousRamp?.label==='Pace up'))rampLabel='Pace up';
      else if(!rampLabel&&slopePercent<=.2&&range&&gap>range.max-.5&&acceleration>.05&&selfB>normal.max+downBonus+skillContext.targetEnd+.05&&selfB<normal.max+modeBase*.04+skillContext.targetEnd+.25)rampLabel='Pace up';
      else if(!rampLabel&&a.temptationMode!==0&&range&&gap>range.max-.5&&selfB<(normal.min+normal.max)/2+modeBase*.04+skillContext.targetEnd-.05)rampLabel='Pace up';
      else if(style===1||style===5){const peers=field.filter(r=>r.runner.id!==runner.id&&r.style===style);
        const second=Math.max(...field.filter(r=>r.runner.id!==runner.id).map(r=>r.a!.distance!));
        if(approaching(1.05)&&(behindRunaway||!leading||pendingContiguous&&previousRamp?.label==='Overtake'&&a.distance-second<(style===5?27.5:10)))rampLabel='Overtake';
        else if(approaching(speedUpMultiplier)&&leading&&!behindRunaway&&a.distance-second<(style===5?17.5:peers.length?4.5:12.5)&&(clearOfOrdinary||pendingContiguous&&previousRamp?.label==='Speed up'))rampLabel='Speed up';}
      const earlyPace=(normal.min+normal.max)/2+modeBase*.04+skillContext.targetStart;
      const phaseTrigger=selfA<=normal.max+skillContext.targetStart+.08||selfA>=earlyPace-.08||continuingUp||pendingContiguous&&previousRamp?.label==='Pace up';
      if(!rampLabel&&range&&(gap>range.max-.5||continuingUp&&gap>=range.min)&&crossesPhase&&acceleration>.05&&phaseTrigger&&selfB>normal.base+downBonus+skillContext.targetEnd+.05)rampLabel='Pace up';
      // Keep a climb that started on the early-race ceiling and is now aimed at the mid-race one.
      const destinationMax=(nextNormal?.max??normal.max)+modeBase*.04+skillContext.targetEnd+.2;
      if(!rampLabel&&pendingContiguous&&previousRamp?.label==='Pace up'&&range&&gap>=range.min&&acceleration>.02&&!seated(1.04)&&selfB<=destinationMax)rampLabel='Pace up';
      if(rampLabel&&!pendingContiguous&&!crossesPhase&&hillEasing&&nextNormal){
        const mult=keep(rampLabel),destination=nextNormal.max+nextNormal.base*(mult-1)+skillContext.targetEnd;
        if(selfB<destination-.12)rampLabel=null;
      }
      if(rampLabel&&!pendingContiguous&&selfA<=normal.max+downBonus+skillContext.targetStart+.04){
        const multiplier=keep(rampLabel);let lo=0,hi=dt;
        for(let step=0;step<15;step++){const mid=(lo+hi)/2;const projected=predict(multiplier,mid);if(projected!==null&&projected>selfB)lo=mid;else hi=mid;}
        rampStart=fa.time+(lo+hi)/2;
      }
    }
    if(!label&&rampLabel&&contiguous&&preceding.kind===rampLabel.toLowerCase().replaceAll(' ','-')+'-model'&&!(crossesPhase&&nextNormal&&selfB<nextNormal.max+skillContext.targetEnd+.04))label=rampLabel;
    if (label) {
      const onset=pendingContiguous&&previousRamp?.label===label?previousRamp!.start:fa.time;
      const matched=seated(keep(label));
      merge(pace, modeledInterval(label.toLowerCase().replaceAll(' ', '-') + '-model', label, onset, fb.time, detail+(onset<fa.time?' Onset includes an adjacent reference-acceleration fit before the compatible ceiling; transition time remains sampled, not a recorded entry.':'')+(matched?' Endpoint speed sits on this mode ceiling, including resolved target skills and a spot-struggle bonus while that bonus is still in the velocity.':''),
        { ...model, speedMultiplier: keep(label), speedDelta: modeBase * (keep(label) - 1), ...(matched ? { velocityCeiling: true } : {}) }));
      pendingRamp=null;
    } else if (range && (gap < range.min + .5 || continuingDown && gap <= (a.distance >= race.distance / 6 ? (range.min + range.max) / 2 : range.max)) && (low || settlingDown || !hillSurplusAmbiguous && (seated(downMultiplier) || onFloor))) {
      merge(pace, modeledInterval('pace-down-model', 'Pace down', fa.time, fb.time, detail+(seated(downMultiplier)?' Endpoint speed sits on the pace-down ceiling.':onFloor?' Endpoint speed is the minimum while the pace-down target is at or below that floor.':''),
      { ...model, speedMultiplier: downMultiplier, speedDelta: modeBase * (downMultiplier - 1), hpDrainMultiplier: .6, modeledHpRate: expected * .6, ...(seated(downMultiplier) || onFloor ? { velocityCeiling: true } : {}) }));
    }
    else if(!nearEnd&&nextNormal&&contiguous&&preceding.model?.speedMultiplier!=null&&preceding.model.speedMultiplier>1&&acceleration<-.05
      &&slopePercent===nextSlopePercent&&skillContext.targetStart===skillContext.targetEnd&&selfB>nextNormal.max+downBonus+skillContext.targetEnd+.04){
      const multiplier=preceding.model.speedMultiplier,deceleration=a.distance<race.distance/6?1.2:.8,
        exit=fb.time-(selfA-selfB)/deceleration,ceiling=normal.min+modeBase*(multiplier-1)+downBonus+skillContext.targetStart;
      // A readable bracket can hold its old ceiling briefly and then decelerate.
      // The total drop can exceed .15 m/s over a long retained interval.
      if(exit>fa.time+.1&&selfA>=ceiling-.1&&selfA<=normal.max+modeBase*(multiplier-1)+downBonus+skillContext.targetStart+.1)
        merge(pace,modeledInterval(preceding.kind,preceding.label,fa.time,exit,detail+' Exit includes a partial plateau-to-normal reference-deceleration fit inside this retained bracket; section-wit changes and exact native exit time remain unreported.',{...model,speedMultiplier:multiplier,speedDelta:modeBase*(multiplier-1)}));
    }
    const extended=pace.at(-1)?.end===fb.time;
    if(!label&&!extended){
      const prior=pace.at(-1);
      const climbingOff=prior?.kind==='pace-down-model'&&acceleration>.05&&selfB>theoreticalDown+.25;
      if(near&&!climbingOff&&prior?.end===fa.time){
        // Traffic hides the mode ceiling. Keep the known mode through this
        // readable bracket, including recovery acceleration. A later clear
        // bracket can establish an exit without discarding the traffic tail.
        extendThroughTraffic(prior,fb.time);pendingRamp=null;
      }
      else pendingRamp=rampLabel?{start:pendingContiguous&&previousRamp?.label===rampLabel?previousRamp!.start:rampStart,end:fb.time,label:rampLabel}:null;
    }else if(!label)pendingRamp=null;
  }
  // A pace-up still on the early ceiling at the phase line keeps going. The
  // ceiling is now the mid-leg one, and the mode ends at the speed peak if
  // she turns down before sitting on it.
  const phaseLine=race.distance/6;
  for(const interval of pace){
    if(interval.kind!=='pace-up-model'||interval.end==null)continue;
    const idx=race.frames.findIndex(f=>Math.abs(f.time-interval.end!)<.05);
    const here=idx<0?undefined:at(race.frames[idx],runner.id);
    if(here?.distance==null||here.speed==null||here.distance>phaseLine+8)continue;
    let peak=idx,peakSpeed=here.speed;
    for(let j=idx+1;j<race.frames.length;j++){
      const sample=at(race.frames[j],runner.id);
      if(sample?.speed==null)break;
      if(sample.speed>=peakSpeed+.05){peak=j;peakSpeed=sample.speed;continue;}
      // A later drop marks the peak. A flat hold is the new ordinary target.
      if(sample.speed<peakSpeed-.08&&peak>idx)interval.end=race.frames[peak].time;
      break;
    }
  }
  // Preserve the old ceiling-area field, including a phase crossing inside a
  // back-fitted ramp. Reachable gains are a separate shared-engine comparison.
  const readablePaceGap=(start:number,end:number)=>{
    if(end===start)return true;
    let covered=0;
    for(let i=1;i<race.frames.length;i++){
      const fa=race.frames[i-1],fb=race.frames[i],begin=Math.max(start,fa.time),finish=Math.min(end,fb.time);
      if(finish<=begin)continue;
      const a=at(fa,runner.id),b=at(fb,runner.id);
      if(fb.time-fa.time>2||!a||!b||a.distance==null||b.distance==null||a.speed==null||b.speed==null||a.hp==null||b.hp==null||a.hp<=0||b.hp<=0||a.temptationMode==null||b.temptationMode==null||resolvedBracket(fa.time,fb.time)===null)return false;
      if(race.runners.some(r=>at(fa,r.id)?.distance==null||at(fb,r.id)?.distance==null||effectiveFieldStyles.get(r.id)==null))return false;
      covered+=finish-begin;
    }
    return Math.abs(covered-(end-start))<1e-6;
  };
  for (let i = 0; i < pace.length - 1;) {
    const current = pace[i], next = pace[i + 1];
    if (current.kind === next.kind && current.model?.speedMultiplier === next.model?.speedMultiplier && current.end != null && next.start >= current.end && next.start - current.end <= 1.2 && readablePaceGap(current.end,next.start)) { current.end = next.end; pace.splice(i + 1, 1); }
    else i++;
  }
  for (let i = pace.length - 1; i >= 0; i--) {
    const interval = pace[i];
    const minimum=interval.kind==='pace-down-model'?0.8:2;
    if (interval.end != null && interval.end - interval.start < minimum && !interval.model?.velocityCeiling && ['pace-up-model', 'pace-down-model', 'speed-up-model', 'overtake-model'].includes(interval.kind)) pace.splice(i, 1);
  }
  for(const interval of pace){let area=0;const multiplier=interval.model?.speedMultiplier;if(multiplier==null)continue;
    for(let i=1;i<race.frames.length;i++){const a=race.frames[i-1],b=race.frames[i],s=at(a,runner.id),t=at(b,runner.id),start=Math.max(a.time,interval.start),end=Math.min(b.time,interval.end??interval.start);if(end<=start||s?.distance==null||t?.distance==null)continue;
      const crossing=s.distance<race.distance/6&&t.distance>race.distance/6?a.time+(b.time-a.time)*(race.distance/6-s.distance)/(t.distance-s.distance):null,cuts=[start,...(crossing!==null&&crossing>start&&crossing<end?[crossing]:[]),end];
      for(let j=1;j<cuts.length;j++){const mid=(cuts[j-1]+cuts[j])/2,d=s.distance+(t.distance-s.distance)*(mid-a.time)/(b.time-a.time);area+=base*coeff[d>=race.distance/6?1:0]*(multiplier-1)*(cuts[j]-cuts[j-1]);}}
    interval.model!.integratedSpeedDelta=area;}
  // Downhill mode is a per-second wit entry and a 20% exit, so one HP
  // confirmation does not cover the rest of the hill. A free drop onto the
  // ordinary ceiling is an exit. A block or a close-range cap is not: those
  // slow the horse without ending the mode. After an exit, a free climb back
  // onto the bonus ceiling is a new entry.
  const hpDownhill = downhill.filter(i => i.end != null && i.end - i.start >= .1);
  const coversHp = (time: number) => hpDownhill.some(i => time >= i.start && time < i.end!);
  const slopeAt = (distance: number) => course.slopes.find(s => distance >= s.start && distance < s.start + s.length) ?? null;
  const movementAt = (time: number) => {
    if (observed.some(i => ['rushed', 'spot-struggle', 'dueling'].includes(i.kind) && i.start <= time && (i.end ?? i.estimatedEnd ?? stop) >= time)) return null;
    let current = 0, targetSum = 0, accel = 0;
    for (const { event: e, source, id, selected, timing } of procContexts) {
      if (e.time > time) continue;
      const activeEnd = timing?.effectiveEnd ?? (e.params[2] > 0 ? e.time + e.params[2] / 10000 : stop);
      if (activeEnd <= time) continue;
      const self = source?.id === runner.id, mask = e.params[4];
      const knownMask = Number.isInteger(mask) && race.runners.length <= 32;
      // The activation mask includes the owner. Debuff recipients are the other marked runners.
      const recipient = knownMask && !self && runner.index < 32 && Boolean(mask & (1 << runner.index));
      // The speed-only fallback needs the same proc completeness as the HP fit.
      // An unresolved branch may be exactly what created the one-sample surplus.
      if (!selected || !source || id === null) { if (self || recipient || !knownMask) return null; continue; }
      for (const effect of selected.effects) {
        if (![21, 22, 27, 28, 31, 35].includes(effect.type) || e.time === 0 && keys[effect.type]) continue;
        const foreign = (effect.targetType ?? 1) !== 1;
        if (effect.type === 28 || effect.type === 35) {
          if (!foreign && self || foreign && (!knownMask || recipient)) return null;
          continue;
        }
        if (!foreign) { if (!self) continue; }
        else if (effect.rawValue < 0 && source.teamGroup != null && source.teamGroup === runner.teamGroup) continue;
        else if (!knownMask) return null;
        else if (!recipient) continue;
        else if (effect.rawValue < 0 && (source.teamGroup == null || runner.teamGroup == null)) return null;
        const magnitude = effectValue(source, id, effect);
        if (magnitude === null || timing?.effectiveEnd == null) return null;
        if (effect.type === 21 || effect.type === 22) current += magnitude;
        else if (effect.type === 27) targetSum += magnitude;
        else accel += magnitude;
      }
    }
    return { current, target: targetSum, accel };
  };
  const healBetween = (start: number, end: number) => procContexts.some(({ event: e, source, selected }) => {
    if (!selected || !source || e.time <= start || e.time > end) return false;
    const self = source.id === runner.id, mask = e.params[4];
    const knownMask = Number.isInteger(mask) && race.runners.length <= 32, targeted = knownMask && runner.index < 32 && Boolean(mask & (1 << runner.index));
    return selected.effects.some(effect => effect.type === 9 && ((effect.targetType ?? 1) === 1 ? self : targeted || !knownMask));
  });
  const restrained = (sample: RunnerSample | undefined, time: number) => {
    if (!sample || sample.blockFrontRunnerIndex == null || sample.blockFrontRunnerIndex >= 0) return true;
    const near = neighborhoodConstraintAt(race, runner, time);
    return near.kind === 'geometry-block' || near.kind === 'unknown' || proximityPressure(race,runner.id,sample)===true;
  };
  const downhillAccel = (distance: number, slopePercent: number, skillAccel: number) => {
    const phase = distance >= totalDistance / 6 ? 1 : 0;
    const surfaceRank = rank(runner.aptitudes?.[course.surface === 1 ? 'turf' : 'dirt']);
    const surfaceFactor = surfaceRank === null ? 1 : [.1, .3, .5, .7, .8, .9, 1, 1.05][surfaceRank - 1];
    const accelCoefficients: Record<number, number[]> = { 1: [1, 1], 2: [.985, 1], 3: [.975, 1], 4: [.945, 1], 5: [1.17, .94] };
    return (slopePercent > 0 ? .0004 : .0006) * Math.sqrt(500 * adjustedPower) * accelCoefficients[style][phase] * surfaceFactor * [.4, .5, .6, 1, 1, 1, 1, 1][distanceRank - 1] + skillAccel;
  };
  const fitBracket = (fa: Race['frames'][number], fb: Race['frames'][number], a: RunnerSample, b: RunnerSample) => {
    const dt = fb.time - fa.time, startMove = movementAt(fa.time);
    if (!startMove || a.speed == null || b.speed == null || a.distance == null || b.distance == null || b.distance <= a.distance) return 'unreadable' as const;
    const project = (useBonus: boolean) => {
      let current = startMove.current, velocity = a.speed! - current;
      if (velocity < 0) return null;
      for (let elapsed = 0; elapsed < dt;) {
        const step = Math.min(1 / 60, dt - elapsed), mid = elapsed + step / 2;
        const distance = a.distance! + (b.distance! - a.distance!) * mid / dt;
        const grade = slopeAt(distance), move = movementAt(fa.time + mid), normal = target({ ...a, distance }, grade?.slopePercent ?? 0);
        if (!move || !normal) return null;
        const bonus = useBonus && grade && grade.slopePercent < 0 ? .3 + Math.abs(grade.slopePercent) / 10 : 0;
        velocity += move.current - current; current = move.current;
        const ceiling = normal.base + move.target + bonus;
        const paceDown = pace.some(i => i.kind === 'pace-down-model' && fa.time + mid >= i.start && fa.time + mid < (i.end ?? i.start));
        const force = velocity < ceiling ? downhillAccel(distance, grade?.slopePercent ?? 0, move.accel) : -referenceDeceleration(distance, race.distance, paceDown);
        velocity = velocity < ceiling ? Math.min(ceiling, velocity + force * step) : Math.max(ceiling, velocity + force * step);
        elapsed += step;
      }
      return velocity;
    };
    const endMove = movementAt(fb.time), on = project(true), off = project(false);
    if (!endMove || on === null || off === null) return 'unreadable' as const;
    const actual = b.speed - endMove.current, onErr = Math.abs(actual - on), offErr = Math.abs(actual - off);
    if (onErr + .08 < offErr && onErr < .2) return 'on' as const;
    if (offErr + .08 < onErr && offErr < .2) return 'off' as const;
    return 'ambiguous' as const;
  };
  const keptDownhill: StatusInterval[] = [];
  let modeStart: number | null = null, confirmed = false, exited = false, slopeKey = '';
  const closeMode = (end: number) => {
    if (modeStart == null || end - modeStart < .1) { modeStart = null; return; }
    const origin = hpDownhill.find(i => i.start < end && i.end! > modeStart!);
    const sampleDistance = race.frames.find(frame => frame.time + .05 >= modeStart!)?.runners.find(s => s.runnerId === runner.id)?.distance;
    const grade = sampleDistance == null ? null : slopeAt(sampleDistance);
    const bonus = grade && grade.slopePercent < 0 ? .3 + Math.abs(grade.slopePercent) / 10 : .3;
    const baseline = origin?.model?.baselineHpRate ?? (sampleDistance == null ? null : baselineHp(20, totalDistance));
    merge(keptDownhill, modeledInterval('downhill-mode-model', 'Downhill mode', modeStart, end,
      `Downhill mode is a wit check each second on a downhill, and each second in the mode can end it. ${origin ? 'Normalized HP drain supports this entry. ' : 'Speed returned to the downhill bonus after a free exit. '}A free settle onto the ordinary target ends the mode. A recorded block or a close-range cap does not. Bonus ${bonus.toFixed(2)} m/s and HP factor 0.4. The per-second rolls are not recorded; this boundary is the sampled speed fit.`,
      { ...(origin?.model ?? {}), speedDelta: bonus, hpDrainMultiplier: .4, ...(baseline != null ? { baselineHpRate: baseline, modeledHpRate: baseline * .4 } : {}) }));
    modeStart = null;
  };
  for (let i = 0; i < race.frames.length - 1; i++) {
    const fa = race.frames[i], fb = race.frames[i + 1], a = at(fa, runner.id), b = at(fb, runner.id);
    const gradeA = a?.distance == null ? null : slopeAt(a.distance), gradeB = b?.distance == null ? null : slopeAt(b.distance);
    const key = gradeA && gradeA.slopePercent < 0 ? `${gradeA.start}:${gradeA.slopePercent}` : '';
    if (key !== slopeKey) { if (modeStart != null) closeMode(fa.time); slopeKey = key; confirmed = false; exited = false; }
    if (!key || !a || !b || a.distance == null || b.distance == null || a.speed == null || b.speed == null || fb.time - fa.time < .1 || fb.time - fa.time > 2 || fa.time >= stop) {
      if (modeStart != null) closeMode(fa.time);
      continue;
    }
    if (coversHp(fa.time)) confirmed = true;
    const leaving = !gradeB || gradeB.slopePercent !== gradeA!.slopePercent || gradeB.start !== gradeA!.start;
    const heal = healBetween(fa.time, fb.time), blocked = restrained(a, fa.time) || restrained(b, fb.time);
    const fit = heal || blocked ? null : fitBracket(fa, fb, a, b);
    // A free settle onto the ordinary ceiling ends the mode even if HP is still
    // low. HP can start or keep the mode only while speed does not contradict it.
    const wantOn = heal || fit === 'off' ? false
      : fit === 'on' && (coversHp(fa.time) || modeStart != null || confirmed && exited) ? true
      : fit === 'ambiguous' && (modeStart != null || coversHp(fa.time)) ? true
      : blocked && modeStart != null ? true
      : coversHp(fa.time) && fit !== 'unreadable' ? true
      : false;
    if (wantOn && modeStart == null) modeStart = fa.time;
    if (!wantOn && modeStart != null) { closeMode(fa.time); if (fit === 'off') exited = true; }
    else if (fit === 'off' && confirmed) exited = true;
    if (leaving && modeStart != null) {
      const endDistance = gradeA!.start + gradeA!.length;
      const endTime = b.distance > a.distance && a.distance < endDistance && b.distance >= endDistance
        ? fa.time + (fb.time - fa.time) * (endDistance - a.distance) / (b.distance - a.distance) : fa.time;
      closeMode(Math.min(stop, endTime));
      confirmed = false; exited = false; slopeKey = '';
    }
  }
  if (modeStart != null) closeMode(Math.min(stop, race.frames.at(-1)!.time));
  // Downhill is a per-second check. One fast sample, gone on the next sample or
  // because the slope ended, is an entry that did not survive the following tick.
  for (let i = 1; i < race.frames.length - 1; i++) {
    const frame = race.frames[i], next = race.frames[i + 1];
    const sample = at(frame, runner.id), after = at(next, runner.id);
    if (!sample || !after || sample.speed == null || after.speed == null || sample.distance == null || after.distance == null || frame.time >= stop) continue;
    if (keptDownhill.some(mode => frame.time >= mode.start - 1e-6 && frame.time < (mode.end ?? mode.start) || mode.end != null && Math.abs(mode.end - frame.time) < .05)) continue;
    const earlierSpeed=i>0?at(race.frames[i-1],runner.id)?.speed:null;
    if (earlierSpeed!=null && sample.speed<=earlierSpeed+.05) continue;
    const grade = slopeAt(sample.distance);
    if (!grade || grade.slopePercent >= 0) continue;
    const move = movementAt(frame.time), laterMove = movementAt(next.time);
    const laterGrade = slopeAt(after.distance);
    const normalNow = target(sample, grade.slopePercent), normalLater = target(after, laterGrade?.slopePercent ?? 0);
    if (!move || !laterMove || !normalNow || !normalLater) continue;
    const bonus = .3 + Math.abs(grade.slopePercent) / 10;
    const surplus = sample.speed - move.current - (normalNow.base + move.target);
    const laterSurplus = after.speed - laterMove.current - (normalLater.base + laterMove.target);
    const slopeEnds = !laterGrade || laterGrade.slopePercent >= 0 || laterGrade.start !== grade.start;
    if (surplus < .15 || surplus > bonus + .12 || (!slopeEnds && (laterSurplus > surplus - .12 || Math.abs(sample.speed - after.speed) < .1))) continue;
    let end = next.time;
    const endDistance = grade.start + grade.length;
    if (slopeEnds && sample.distance < endDistance && after.distance >= endDistance && after.distance > sample.distance)
      end = frame.time + (next.time - frame.time) * (endDistance - sample.distance) / (after.distance - sample.distance);
    if (end <= frame.time + .05) continue;
    merge(keptDownhill, modeledInterval('downhill-mode-model', 'Downhill mode', frame.time, end,
      `Downhill mode is a wit check each second. This sample is above the ordinary downhill target and back off it on the next sample, or the downhill ended before the next sample. Bonus ${bonus.toFixed(2)} m/s. The per-second roll is not recorded.`,
      { speedDelta: bonus, hpDrainMultiplier: .4 }));
  }
  const speedAt=(time:number)=>{let best:number|null=null,err=Infinity;for(const frame of race.frames){const gap=Math.abs(frame.time-time);if(gap>=err)continue;const speed=frame.runners.find(sample=>sample.runnerId===runner.id)?.speed;if(speed==null)continue;err=gap;best=speed;}return best;};
  for(let i=0;i<keptDownhill.length-1;){
    const left=keptDownhill[i],right=keptDownhill[i+1];
    const leftSpeed=left.end==null?null:speedAt(left.end),rightSpeed=speedAt(right.start);
    if(left.end!=null&&right.start>=left.end&&right.start-left.end<=1.2&&leftSpeed!=null&&rightSpeed!=null&&rightSpeed>=leftSpeed-.02&&readablePaceGap(left.end,right.start)&&!healBetween(left.end,right.start)){left.end=right.end;keptDownhill.splice(i+1,1);}
    else i++;
  }
  return [...result, ...keptDownhill, ...pace].sort((a, b) => a.start - b.start);
}
