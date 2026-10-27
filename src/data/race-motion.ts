import type { Race, Runner, RunnerSample } from './types';
import type { ReferenceData, SkillReference } from './reference';
import type { RaceAnalysis, SkillActivation, StatusInterval } from './analytics';
import { effectiveStrategyCode } from './skill-details';
import { aptitudeRank, distanceAptitude } from './race-stats';
import { effectValue } from './effect-value';
import { atTime, trace, stopTime } from './effect-sampling';
import { frontBlockCapAt, proximityPressure, inFrontCollisionRange } from './movement-context';
import { referenceDeceleration } from './mechanics-model';
import { hpAt } from './hp-timeline';
import { sampledPassTimes } from './skill-timing';
import { startDashStateAt } from './mechanics-effects';
import { createLastSpurtCondition } from './condition-spurt';
import { conditionStaticValues } from './condition-observations';
import { motionLosses,type MotionLossSummary } from './traffic-loss';
import { skillEffectDefinitions } from './skill-effect-catalog';

export interface MotionBand { min: number; mid: number; max: number }
export interface TargetStack {baseline:MotionBand;ceilings:Record<string,MotionBand>;floors:Record<string,MotionBand>}
export interface MotionConstraint { kind: 'recorded-block' | 'geometry-block' | 'none' | 'unknown'; cap: number | null; runnerId: string | null; detail: string }
export interface SectionCalibration { section: number; min: number; mid: number; max: number; evidence: 'calibrated' | 'bounded'; observations: number; detail: string }
export interface MotionSample {
  blockingClamps?: { self: number; final: number };
  time: number; distance: number | null; actual: number | null;
  currentSpeedDelta: number; selfActual: number | null;
  targetBase: MotionBand | null; targetActive: MotionBand | null;healthyTargetActive:MotionBand|null;healthyAccelerationRange:MotionBand|null;hpEmpty:boolean|null;
  /** Conditional target retaining inferred modes for the local traffic comparison. */
  trafficTargetActive?: MotionBand | null;
  healthyTrafficTargetActive?: MotionBand | null;
  /** Last-spurt budget decision governing this sample, after any own recovery. */
  decisionTime?: number | null;
  free: MotionBand | null; constrained: MotionBand | null; acceleration: number | null; accelerationRange:MotionBand|null;
  blockCap: number | null; constraint: MotionConstraint; nearbySlowdown: boolean;
  downhillTargetDelta: MotionBand; pace: string; startDash: boolean | null;
  cumulativeDistance: MotionBand; cumulativeTime: MotionBand;
  /** Mean actual velocity over the preceding step, before endpoint impulses. */
  intervalFree?: MotionBand | null; intervalConstrained?: MotionBand | null;
  targetStack?:TargetStack|null;intervalTargetStack?:TargetStack|null;
  evidence: 'calibrated' | 'reference' | 'bounded' | 'simulated' | 'unknown'; reasons: string[]; assumptions: string[];
}
export interface RunnerMotion {
  samples: MotionSample[]; sections: SectionCalibration[];
  coverage: { target: number; free: number; constrained: number; calibrated: number; assessedDuration: number; duration: number };
  distanceLoss: MotionBand | null; timeLoss: MotionBand | null;
  assessedDistanceLoss: MotionBand | null; assessedTimeLoss: MotionBand | null;
  observedTrafficDeficit: MotionBand | null; observedTrafficTime: MotionBand | null;
  observedTrafficDuration: number; observedTrafficAssessedDuration: number; observedTrafficCoverage: number | null;
  trafficLoss:MotionLossSummary;exhaustionLoss:MotionLossSummary;
  initialStats: StatBands;
  paceStarts: { time: number; kind: string; detail: string }[]; detail: string;
}
export interface RaceMotion { runners: Record<string, RunnerMotion>; detail: string }
export interface RaceMotionOptions { excludePowerRelease?:boolean; runnerId?: string; excludeActivationKey?: string | null;excludeActivationKeys?:readonly string[];excludeEffectTypes?:readonly number[];excludeStatusKey?:string|null;applyInferredModes?:boolean }
export const activationMotionKey = (sourceId: string, activation: Pick<SkillActivation, 'skillId' | 'start'>) => `${sourceId}:${activation.skillId}:${activation.start}`;
export const statusMotionKey=(runnerId:string,interval:Pick<StatusInterval,'kind'|'start'>)=>`${runnerId}:${interval.kind}:${interval.start}`;
const styleSpeed: Record<number, number[]> = { 1: [1,.98,.962],2: [.978,.991,.975],3: [.938,.998,.994],4: [.931,1,1],5: [1.063,.962,.95] };
const styleAccel: Record<number, number[]> = { 1:[1,1,.996],2:[.985,1,.996],3:[.975,1,1],4:[.945,1,.997],5:[1.17,.94,.956] };
const keys = ['speed','stamina','power','guts','wisdom'] as const;
const band = (min: number, max = min, mid = (min + max) / 2): MotionBand => ({min,mid,max});
const zero = () => band(0);
const channels = ['min','mid','max'] as const;
type EffectExclusion=string|ReadonlySet<string>|{activationKeys:ReadonlySet<string>;types:ReadonlySet<number>}|null;
// A component removal preserves the activation notification for other skills.
const isExcluded=(keys:EffectExclusion,key:string,type?:number)=>typeof keys==='string'?keys===key:keys&&'activationKeys' in keys?type!==undefined&&keys.activationKeys.has(key)&&keys.types.has(type):keys?.has(key)??false;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo,n));
const active = (i: StatusInterval, time: number) => time >= i.start && time < (i.end ?? i.estimatedEnd ?? i.observedUntil ?? i.start);
const modelKind = (i: StatusInterval) => i.kind.replace(/-model$/, '');
const excludesStatus=(runnerId:string,i:StatusInterval,key:string|null)=>key===statusMotionKey(runnerId,i)||key===`kind:${modelKind(i)}`;
const notes = 'Acceleration-bounded replay-context reference paths. Recorded distance/phase, HP and other runners remain fixed; these are not re-simulated race outcomes. Midpoints are explicit reference choices, not recovered random draws. Endpoint scenarios are conditional, not confidence intervals. Unknown inputs reset trajectories; missing intervals are never assigned zero loss.';
interface Effect { key: string; sourceId: string; skillId: number; type: number; start: number; end: number | null; value: number | null; initial: boolean; unknownRecipient: boolean; unknownTeam:boolean;
  source:Runner;referenceId:number;raw:SkillReference['branches'][number]['effects'][number] }
export interface StatBands { speed: MotionBand | null; stamina: MotionBand | null; power: MotionBand | null; guts: MotionBand | null; wisdom: MotionBand | null }
interface State { base: MotionBand | null; target: MotionBand | null; trafficTarget:MotionBand|null;targetStack?:TargetStack|null;accel: MotionBand | null; current: number; currentRange:MotionBand; minimum: MotionBand | null;terrain:MotionBand;decisionTime:number|null;
  downhill: MotionBand; pace: string; paceDown: boolean; hpEmpty: boolean | null; reasons: string[]; assumptions: string[]; calibrated: boolean }

/** A rule-based neighborhood hypothesis, separate from the replay's block flag.
 * Lane is already decoded in course-width units; one horse lane =1/18. */
export function neighborhoodConstraintAt(race: Race, runner: Runner, time: number): MotionConstraint {
  const self = atTime(race, runner.id, time);
  if (!self || self.distance === null || self.lane === null) return {kind:'unknown',cap:null,runnerId:null,detail:'Neighborhood positions/lane unavailable.'};
  let closest = Infinity, chosen: Runner | null = null, cap: number | null = null, missing = false;
  for (const other of race.runners) {
    if (other.id === runner.id) continue; const sample = atTime(race,other.id,time);
    if (!sample || sample.distance === null || sample.lane === null) {missing=true;continue;}
    const gap = sample.distance - self.distance;
    if (!inFrontCollisionRange(gap,Math.abs(sample.lane-self.lane))) continue;
    if (gap < closest) {closest=gap;chosen=other;cap=sample.speed !== null && sample.speed > 0 ? (.988+.012*gap/2)*sample.speed : null;}
  }
  if (chosen&&missing) return {kind:'unknown',cap:null,runnerId:chosen.id,detail:'A qualifying neighbor is visible, but missing field positions prevent establishing the nearest blocker/cap.'};
  if (chosen) return {kind:'geometry-block',cap,runnerId:chosen.id,detail:'Sampled front-collision geometry:0<gap<2m and lane gap within (1−0.6×gap/2)×0.75 horse lane; nearest qualifying runner. Conditional geometry cap, not a recorded internal block or a separate anticipation rule.'};
  return {kind:missing?'unknown':'none',cap:null,runnerId:null,detail:missing?'Some field positions are unavailable.':'No front-collision geometry at this sampled point; mere proximity causes no invented slowdown.'};
}

export interface ReplayMotionEngine {
  build(options?:RaceMotionOptions):RaceMotion;
  speedPotential(runnerId:string,activationKeys:readonly string[]):MotionBand|null;
  physics(runnerId:string,time:number,options?:RaceMotionOptions,healthy?:boolean):State;
}
const replayEngines=new WeakMap<RaceAnalysis,ReplayMotionEngine>();
export function registerReplayMotion(analysis:RaceAnalysis,engine:ReplayMotionEngine){replayEngines.set(analysis,engine);}
export function createRaceMotionEngine(race: Race, reference: ReferenceData | null, courseIdOverride: number | null | undefined, analysis: RaceAnalysis):ReplayMotionEngine {
  const supplied=replayEngines.get(analysis);if(supplied)return supplied;
  const course = reference?.courses[courseIdOverride ?? race.courseId ?? ''] ?? null;
  const compiled = new Map<string,Effect[]>(), statCache = new Map<string,StatBands>(), calibration = new Map<string,SectionCalibration[]>();
  const runnerBuildCache=new Map<string,RunnerMotion>();
  const laneHistory=new Map<string,ReturnType<typeof trace>>();
  const copyStats=(source:StatBands):StatBands=>Object.fromEntries(keys.map(key=>[key,source[key]?{...source[key]}:null])) as unknown as StatBands;
  const spurtDecisions=new Map(race.runners.map(r=>[r.id,createLastSpurtCondition(race,r,course,reference,conditionStaticValues(race,r,course))]));
  const spurtFloorCache=new Map<string,{time:number;decisionTime:number|null;floor:MotionBand}[]>();
  const spurtPlateauCache=new Map<string,number|null>();
  const passCache=new Map<string,number[]>();
  const passesFor=(id:string)=>{let passes=passCache.get(id);if(!passes){passes=sampledPassTimes(race,id);passCache.set(id,passes);}return passes;};
  for (const target of race.runners) {
    const effects: Effect[] = [];
    for (const source of race.runners) for (const activation of analysis.runners[source.id].skillActivations) {
      const event = race.events.find(e=>e.skillId===activation.skillId&&e.time===activation.start&&(e.runnerId===source.id||e.runnerId===null&&e.params[0]===source.index));
      for (const effect of activation.effects) {
        const foreign=(effect.targetType??1)!==1;
        if (!foreign && source.id!==target.id) continue;
        if (foreign && source.teamGroup!=null && target.teamGroup!=null && source.teamGroup===target.teamGroup && (effect.rawValue<0||[13,14,15,16].includes(effect.type))) continue;
        const knownMask=Number.isInteger(event?.params[4])&&target.index<32;
        if (foreign && knownMask && !activation.targetRunnerIds.includes(target.id)) continue;
        effects.push({key:activationMotionKey(source.id,activation),sourceId:source.id,skillId:activation.skillId,type:effect.type,start:activation.start,end:activation.timingKind==='passive'?Infinity:activation.effectiveEnd,
          value:effectValue(source,activation.referenceSkillId??activation.skillId,effect),initial:!foreign&&source.id===target.id&&activation.start===0&&activation.timingKind==='passive',unknownRecipient:foreign&&!knownMask,
          unknownTeam:foreign&&effect.rawValue<0&&(source.teamGroup==null||target.teamGroup==null),
          source,referenceId:activation.referenceSkillId??activation.skillId,raw:effect});
      }
    }
    compiled.set(target.id,effects);
  }
  function initialStats(runner:Runner):StatBands {
    const cached=statCache.get(runner.id);if(cached)return cached;const detail=analysis.runners[runner.id],result={} as StatBands;
    for(const [index,key] of keys.entries()) {
      const stat=detail.statBreakdown.stats[key]; if(stat.final!==null){result[key]=band(stat.final);continue;}
      const components=[stat.base,stat.courseGain,stat.strategyGain,stat.groundGain,stat.careerGain];
      if(components.some(n=>n===null)){result[key]=null;continue;}
      let low=components.reduce<number>((n,v)=>n+v!,0),high=low,unknown=false;
      for(const row of detail.skillRows){const def=reference?.metadata.skills[row.skillId];if(!def){if(row.equipped)unknown=true;continue;}
        const candidates=def.branches.filter(b=>b.rawDuration<0&&b.effects.some(e=>e.type===index+1));if(!candidates.length||row.activationStatus==='conditions-unmet')continue;
        const deltas=candidates.map(b=>b.effects.filter(e=>e.type===index+1).map(e=>(e.targetType??1)===1?effectValue(runner,row.skillId,e):null));
        if(deltas.some(a=>a.some(n=>n===null))){unknown=true;break;}
        const values=deltas.map(a=>a.reduce<number>((n,v)=>n+v!,0));const applied=row.effectiveActive&&candidates.length===1;
        low+=Math.min(...values,...(applied?[]:[0]));high+=Math.max(...values,...(applied?[]:[0]));
      }
      result[key]=unknown?null:band(clamp(low,1,2000),clamp(high,1,2000));
    }
    statCache.set(runner.id,result);return result;
  }
  /** The move-lane target bonus needs a lane-speed skill and a lane change on the previous frame. Retained samples stand in for that frame. */
  function laneChanged(runnerId:string,time:number,lane:number){
    let rows=laneHistory.get(runnerId);
    if(!rows){rows=trace(race,runnerId).filter(r=>r.sample.lane!=null);laneHistory.set(runnerId,rows);}
    let lo=0,hi=rows.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<time-1e-9)lo=mid+1;else hi=mid;}
    const previous=lo?rows[lo-1].sample.lane:null;
    return previous!=null&&Math.abs(lane-previous)>1e-4;
  }
  function resolvedValue(effect:Effect,time:number,excluded:EffectExclusion){
    if(effect.raw.valueUsage!==14&&(effect.raw.additionalActivateType??0)===0)return effect.value;
    const owner=analysis.runners[effect.sourceId];
    const greens=owner.skillRows.filter(row=>{const d=reference?.metadata.skills[row.skillId];return (d?.tagIds??[d?.tagId??0]).some(t=>t>=601&&t<=615);});
    const missingTags=effect.raw.valueUsage===14&&owner.skillRows.some(row=>row.equipped&&reference?.metadata.skills[row.skillId]?.tagId==null&&!reference?.metadata.skills[row.skillId]?.tagIds?.length);
    const activeGreenCount=missingTags?null:greens.filter(row=>row.effectiveActive&&(row.activationStatus==='inferred-passive'||row.activations.some(a=>a.start<=time))).length;
    const additional=effect.raw.additionalActivateType??0;
    const count=additional===1?passesFor(effect.sourceId).filter(t=>t>effect.start&&t<=time).length:
      additional===2||additional===3?owner.skillActivations.filter(a=>!isExcluded(excluded,activationMotionKey(effect.sourceId,a))&&a.start>effect.start&&a.start<=time).length:null;
    return effectValue(effect.source,effect.referenceId,effect.raw,{activeGreenCount,additionalActivations:count});
  }
  function effectBand(effect:Effect,value:number){
    const scaleUnreported=effect.raw.valueUsage>=3&&effect.raw.valueUsage<=7||effect.raw.valueUsage===10&&effect.source.raceWinCount==null||effect.raw.valueUsage===12&&effect.source.fanCount==null;
    const alternative=scaleUnreported?value*2/3:value;
    return band(Math.min(value,alternative,...(effect.unknownTeam?[0]:[])),Math.max(value,alternative,...(effect.unknownTeam?[0]:[])),value);
  }
  function stateAt(runner:Runner,time:number,excluded:EffectExclusion,sections?:SectionCalibration[],healthy=false,useSpurtEvidence=true,excludedStatus:string|null=null,applyInferredModes=false):State {
    const sample=atTime(race,runner.id,time),detail=analysis.runners[runner.id],stats=copyStats(initialStats(runner)),reasons:string[]=[],assumptions:string[]=[];
    const empty:State={base:null,target:null,trafficTarget:null,accel:null,current:0,currentRange:zero(),minimum:null,terrain:zero(),decisionTime:null,downhill:zero(),pace:'unknown',paceDown:false,hpEmpty:null,reasons,assumptions,calibrated:false};
    if(!course||race.distance!==course.distance||!sample||sample.distance===null){reasons.push('Course or recorded progress unavailable.');return empty;}
    const distance=sample.distance,total=course.distance,base=20-(total-2000)/1000,phase=distance>=total*2/3?2:distance>=total/6?1:0,style=effectiveStrategyCode(runner,detail.skillRows);
    if(style===null||!styleSpeed[style]){reasons.push('Running style unavailable.');return empty;}
    let current=0;const currentRange=zero(),targetSkill=zero(),accelSkill=zero();let laneEffect=false;
    const positiveTargets:{key:string;start:number;amount:MotionBand}[]=[];
    for(const effect of compiled.get(runner.id)??[]) {
      if(isExcluded(excluded,effect.key,effect.type)){if(effect.initial&&effect.type>=1&&effect.type<=5&&effect.value!==null){const key=keys[effect.type-1],original=detail.statBreakdown.stats[key];
        if(stats[key])for(const c of channels)stats[key]![c]=clamp(stats[key]![c]-(original.capGain??0)-effect.value,1,2000);}continue;}
      if(time<effect.start||effect.end!==null&&time>=effect.end)continue;
      if(effect.initial&&effect.type>=1&&effect.type<=5)continue;
      if(!skillEffectDefinitions[effect.type]){reasons.push(`Skill ${effect.skillId}: effect ${effect.type} is not modeled.`);continue;}
      if(![1,2,3,4,5,21,22,27,28,31,35].includes(effect.type))continue;
      let value=effect.value;
      if(value===null&&effect.raw.valueUsage===11&&[110341,910341].includes(effect.referenceId)){
        value=effectValue(effect.source,effect.referenceId,{...effect.raw,valueUsage:1});
        assumptions.push('Firelight uses the pinned simulator’s fixed reference strength; native pass-count scaling is unresolved. This is not a recovered magnitude or a guaranteed native bound.');
      }
      // Lane movement does not use its raw magnitude in the speed equation. An
      // unresolved team-stat scale must not blank the whole simulated line.
      if(effect.type===28){if(effect.end!==null&&!effect.unknownRecipient)laneEffect=true;continue;}
      if(effect.raw.valueUsage===10&&effect.source.raceWinCount==null||effect.raw.valueUsage===12&&effect.source.fanCount==null)assumptions.push('Scenario scaling uses the maximum 1.2 tier when the replay has no win or fan total.');
      if(effect.raw.valueUsage===14||(effect.raw.additionalActivateType??0)!==0){
        if(effect.raw.additionalActivateType===1)assumptions.push('Additional overtake increments use sampled interpolated crossings; hidden between-sample passes are not recovered.');
        value=resolvedValue(effect,time,excluded);
      }
      if(effect.unknownRecipient||value===null||effect.end===null){reasons.push(`Skill ${effect.skillId}: effect magnitude, recipient or end unresolved.`);continue;}
      const amount=effectBand(effect,value);
      if(effect.type===27&&value>0)positiveTargets.push({key:effect.key,start:effect.start,amount});
      if(effect.unknownTeam)assumptions.push(`Skill ${effect.skillId}: team immunity unknown; midpoint assumes selected enemy, endpoints include immunity.`);
      if(effect.type>=1&&effect.type<=5){const key=keys[effect.type-1];if(stats[key])for(const c of channels)stats[key]![c]=clamp(stats[key]![c]+amount[c],1,2000);}
      else if(effect.type===21||effect.type===22)for(const c of channels)currentRange[c]+=amount[c];
      else if(effect.type===27)for(const c of channels)targetSkill[c]+=amount[c];else if(effect.type===31)for(const c of channels)accelSkill[c]+=amount[c];
    }
    current=currentRange.mid;
    const surface=aptitudeRank(runner.aptitudes?.[course.surface===1?'turf':'dirt']),distanceKey=total<=1400?'short':total<=1800?'mile':total<=2400?'middle':'long',aptitude=aptitudeRank(runner.aptitudes?.[distanceKey]);
    if(!stats.guts||!stats.power||!stats.wisdom||phase===2&&(!stats.speed||aptitude===null)||surface===null||aptitude===null){reasons.push('Relevant stat or aptitude inputs unavailable.');return {...empty,current,currentRange};}
    const slope=course.slopes.find(s=>distance>=s.start&&distance<s.start+s.length)?.slopePercent??0;
    const allIntervals=detail.intervals.filter(i=>active(i,time)),omitted=allIntervals.find(i=>excludesStatus(runner.id,i,excludedStatus)),intervals=allIntervals.filter(i=>!excludesStatus(runner.id,i,excludedStatus)),paceIntervals=intervals.filter(i=>i.kind.endsWith('-model')&&['pace-up','pace-down','speed-up','overtake'].includes(modelKind(i)));
    const paceKinds=new Set(paceIntervals.map(modelKind)),paceMultiplier=paceIntervals[0]?.model?.speedMultiplier;
    // Inferred pace and downhill modes explain why recorded speed left the
    // ordinary target. They are not written back into that target, or the line
    // would be rebuilt from the same speed it was inferred from. A skill can
    // still aim at full section speed and leave pace down.
    let pace=band(1),paceLabel='normal-reference';
    const rawTempt=omitted&&['rushed','rushed-boost'].includes(modelKind(omitted))?0:sample.temptationMode;
    if(paceKinds.size>1){reasons.push('Conflicting pace candidates.');}
    else if(paceIntervals.length&&paceMultiplier!=null){paceLabel=paceKinds.values().next().value!;
      if(applyInferredModes)pace=band(paceMultiplier);
      else assumptions.push('Inferred pace mode stays a status. The simulated target remains ordinary section speed.');}
    else if(rawTempt===4){pace=band(1.04);paceLabel='rushed-boost';}
    const dh=intervals.some(i=>i.kind==='downhill-mode-model');let downhill=zero();
    if(slope<0&&dh){
      const bonus=intervals.find(i=>i.kind==='downhill-mode-model')?.model?.speedDelta;
      if(applyInferredModes&&bonus!=null)downhill=band(bonus);
      else assumptions.push('Inferred downhill mode stays a status. The simulated target does not add the downhill bonus.');
    }
    let statusSpeed=0,statusAccel=0;const seen=new Map<string,number>();
    for(const interval of intervals.filter(i=>i.kind.endsWith('-model'))){const kind=modelKind(interval);if(['pace-up','pace-down','speed-up','overtake','downhill-mode'].includes(kind))continue;
      const delta=interval.model?.speedDelta;if(delta==null){if(['dueling','spot-struggle'].includes(kind))reasons.push(`${kind} magnitude unresolved.`);continue;}
      if(seen.has(kind)&&Math.abs(seen.get(kind)!-delta)>1e-5){reasons.push(`Conflicting ${kind} models.`);continue;}seen.set(kind,delta);}
    statusSpeed=[...seen.values()].reduce((n,v)=>n+v,0);if(seen.has('dueling'))statusAccel=(160*stats.guts.mid)**.59*.0001;
    const extraTarget=zero(),extraAcceleration=zero();
    // These starts have no reported duration. Use the supplied pre-fifth
    // anniversary reference rules and explicit unknown-credit/random bounds,
    // never an invented exact release duration or modern JP coefficient.
    for(const interval of detail.intervals.filter(i=>!excludesStatus(runner.id,i,excludedStatus))){
      if(time<interval.start)continue;
      const age=time-interval.start;
      if(interval.kind==='release-conserve-power'){
        const stat=detail.statBreakdown.stats.power,raw=runner.stats?.power;
        if(stat.base===null||raw==null||stat.passiveGain===null){assumptions.push('Conserve-power release inputs unresolved; optional release contribution is not included.');continue;}
        const power=stat.base+.5*Math.max(0,raw-1200)+stat.passiveGain;
        const distanceType=total<=1400?0:total<=1800?1:total<=2400?2:3;
        const strategyCoefficients:Record<number,number[]>={1:[1,1,1,1],2:[.7,.8,.9,.9],3:[.75,.7,.875,1],4:[.7,.75,.86,.9],5:[1,1,1,1]};
        const creditCap=interval.start*6.7*({1:1,2:.75,3:1,4:.7,5:1} as Record<number,number>)[style];
        const durationCap=creditCap*Math.sqrt(total)*[.45,1,.875,.8][distanceType]/1450;
        if(age<=durationCap&&power>1200){extraAcceleration.max+=Math.sqrt((power-1200)*130)*.001*strategyCoefficients[style][distanceType];
          assumptions.push('Recorded conserve-power release: acceleration bounded by unknown earned credit/activity; zero midpoint and maximum-credit upper scenario.');}
        else if(power<=1200&&age<1)assumptions.push('Release start conflicts with available reference power threshold; its contribution is not reconstructed.');
      }else if(interval.kind==='stamina-limit-break'){
        const stat=detail.statBreakdown.stats.stamina;if(stat.base===null||stat.passiveGain===null){assumptions.push('Stamina-limit-break inputs unresolved; optional contribution not included.');continue;}
        const stamina=stat.base+stat.passiveGain,distanceFactor=total<=2100?0:total<=2200?0.5:total<=2400?1:total<=2600?1.2:1.5;
        const delta=Math.sqrt(Math.max(0,stamina-1200))*.0085*distanceFactor;
        extraTarget.min+=delta*.95;extraTarget.mid+=delta*.985;extraTarget.max+=delta*1.02;
        assumptions.push('Recorded stamina-limit-break start uses pre-update distance factors and conditional0.95–1.02 random-factor scenarios; exact native choice/version not recovered.');
      }else if((interval.kind==='compete-before-spurt'||interval.kind==='secure-lead')&&age<2){
        const single=style===1||style===5;let knownNeighbor=false,missingNeighbor=false;
        for(const other of race.runners){if(other.id===runner.id)continue;const o=atTime(race,other.id,time),otherStyle=effectiveStrategyCode(other,analysis.runners[other.id].skillRows);
          if(o?.distance==null||otherStyle==null){missingNeighbor=true;continue;}if(otherStyle===style&&Math.abs(o.distance-distance)<10)knownNeighbor=true;}
        for(const c of channels){let delta=0;
          if(interval.kind==='compete-before-spurt')delta=(Math.sqrt(stats.power[c]/1500)*2+(stats.guts[c]/3000)**.2)*.1*({1:.8,2:1,3:1,4:1,5:.2} as Record<number,number>)[style];
          else delta=Math.sqrt(stats.guts[c]/2000)*.3*({1:1,2:1,3:.8,4:0,5:.2} as Record<number,number>)[style];
          const maximum=interval.kind==='compete-before-spurt'?(style===5?2:1.1):(style===5?7:2);
          extraTarget[c]+=delta*(c==='max'&&single&&!knownNeighbor?maximum:1);
        }
        assumptions.push(`Recorded ${interval.kind} start uses a2s reference window; entry/random solitary-lead bonus is conditional${missingNeighbor?' and neighbor membership incomplete':''}.`);
      }
    }
    const forceIn=zero();
    if(phase===0&&sample.lane!=null&&sample.lane>.12){let inside=false,missing=false;
      for(const other of race.runners){if(other.id===runner.id)continue;const o=atTime(race,other.id,time);if(o?.distance==null||o.lane==null){missing=true;continue;}
        if(o.lane<sample.lane&&sample.lane-o.lane<2/18&&Math.abs(o.distance-distance)<1.05)inside=true;}
      if(inside||missing){const bonus=({1:.02,2:.01,3:.01,4:.03,5:.02} as Record<number,number>)[style];
        forceIn.min=inside?bonus:0;forceIn.mid=inside?bonus+.05:0;forceIn.max=bonus+.1;assumptions.push('Early force-in target uses sampled inside-block geometry and conditional once-per-race random bounds.');}
    }
    const hp=hpAt(race,runner.id,time,reference,detail.statBreakdown.startingHp.modeled),hpEmpty=healthy?false:hp===null?null:hp<=0;
    if(hpEmpty===null)reasons.push('HP state unavailable.');
    const spurt=runner.lastSpurtDistance!=null&&runner.lastSpurtDistance>=0&&distance>=runner.lastSpurtDistance;
    const decision=spurtDecisions.get(runner.id)!({time,runners:[sample]}),floor=spurt&&useSpurtEvidence?spurtFloorsFor(runner).filter(f=>f.time<=time&&f.decisionTime===decision.decisionTime).at(-1)?.floor:null;
    const section=Math.min(23,Math.max(0,Math.floor(distance/(total/24)))),calibration=sections?.[section];
    let calibrated=false;const targetBase=zero(),targetActive=zero(),trafficTarget=zero(),acceleration=zero(),minimum=zero(),terrainRange=zero();
    positiveTargets.sort((a,b)=>a.start-b.start||a.key.localeCompare(b.key));
    const targetStack:TargetStack={baseline:zero(),ceilings:{},floors:{}};
    for(const c of channels){const speed=stats.speed?.[c]??0,guts=stats.guts[c],power=stats.power[c],wisdom=stats.wisdom[c],term=phase===2?Math.sqrt(500*speed)*distanceAptitude[aptitude-1]*.002:0;
      const ordinary=base*styleSpeed[style][phase]+term,maximumSpurt=(ordinary+.01*base)*1.05+term+(450*guts)**.597*.0001;
      let baseTarget=ordinary;
      if(spurt){const plateau=useSpurtEvidence?spurtPlateauFor(runner,decision.decisionTime):null;
        if(plateau!=null){const onMaximum=Math.abs(plateau-maximumSpurt)<=.05;baseTarget=onMaximum?maximumSpurt:clamp(plateau,ordinary,maximumSpurt);assumptions.push(onMaximum?'Last spurt target is the maximum. Clear unblocked speed in this decision window sits on that ceiling.':'Last spurt target is the clear unblocked speed plateau in this decision window. The wisdom step sits under the theoretical maximum, so a block is the gap under that line.');}
        else{const recorded=sample.speed,committed=decision.value===2||recorded!=null&&Math.abs(recorded-maximumSpurt)+.05<Math.abs(recorded-ordinary);
          baseTarget=committed?maximumSpurt:c==='min'?ordinary:c==='max'?maximumSpurt:(ordinary+maximumSpurt)/2;
          if(decision.value===2)assumptions.push('Reference HP decision supports maximum spurt; selected speed inferred, not recorded.');
          else if(committed)assumptions.push('Recorded speed is nearer the maximum spurt than the late-base target, so the line follows the full spurt.');
          else assumptions.push('Selected spurt target unreported: late-to-maximum reference scenarios.');
          if(floor){baseTarget=Math.max(baseTarget,Math.min(maximumSpurt,floor[c]));assumptions.push('Earlier clear-path self-speed acceleration bounds the selected spurt target from below; it is not used as a free-speed ceiling.');}}}
      else if(phase===2&&runner.lastSpurtDistance==null)assumptions.push('Spurt start missing: normal midpoint / maximum-spurt upper scenario.');
      if(phase===2&&runner.lastSpurtDistance==null&&c==='max')baseTarget=maximumSpurt;
      const variance=wisdom/5500*Math.log10(.1*wisdom),fullWisdom=initialStats(runner).wisdom?.mid??wisdom,fullVariance=fullWisdom/5500*Math.log10(.1*fullWisdom);
      const wit=spurt?0:calibration?.evidence==='calibrated'?(calibrated=true,calibration[c]+base*(variance-fullVariance)/100):base*(variance-(c==='min'?0.65:c==='mid'?0.325:0))/100;
      const terrain=slope>0?-slope*200/power:0;terrainRange[c]=terrain;minimum[c]=.85*base+Math.sqrt(200*guts)*.001;
      targetBase[c]=clamp(baseTarget+wit+terrain,minimum[c],30);
      let lane=0;if(laneEffect){const extra=Math.sqrt(.0002*power);
        if(sample.lane==null){lane=c==='max'?extra:0;assumptions.push('Lane-speed forward coupling bounded; exact lateral movement state is unreported.');}
        else if(laneChanged(runner.id,time,sample.lane)){lane=extra;assumptions.push('Lane-speed target adds sqrt(0.0002×power) while a lane-speed skill is active and recorded lane is changing.');}}
      // Section wit and terrain remain outside the position-keep multiplier.
      targetActive[c]=clamp((hpEmpty?minimum[c]:baseTarget*pace[c]+wit)+targetSkill[c]+terrain+downhill[c]+statusSpeed+extraTarget[c]+forceIn[c]+lane,minimum[c],30);
      const contextPace=paceKinds.size===1&&paceMultiplier!=null?paceMultiplier:pace[c];
      const contextDownhill=slope<0&&dh?intervals.find(i=>i.kind==='downhill-mode-model')?.model?.speedDelta??downhill[c]:downhill[c];
      trafficTarget[c]=clamp((hpEmpty?minimum[c]:baseTarget*contextPace+wit)+targetSkill[c]+terrain+contextDownhill+statusSpeed+extraTarget[c]+forceIn[c]+lane,minimum[c],30);
      const normal=(hpEmpty?minimum[c]:baseTarget*pace[c]+wit)+targetSkill[c]-positiveTargets.reduce((n,e)=>n+e.amount[c],0)+terrain+downhill[c]+statusSpeed+extraTarget[c]+forceIn[c]+lane;
      targetStack.baseline[c]=clamp(normal,minimum[c],30);
      let cumulative=0;
      for(let i=0;i<positiveTargets.length;){
        let j=i;while(j<positiveTargets.length&&positiveTargets[j].start===positiveTargets[i].start)j++;
        const floor=clamp(normal+cumulative,minimum[c],30);
        for(let k=i;k<j;k++)cumulative+=positiveTargets[k].amount[c];
        // Same-timestamp notifications have no observable priority. Share one
        // tier instead of making skill IDs decide which receives full credit.
        for(let k=i;k<j;k++){const key=positiveTargets[k].key;(targetStack.ceilings[key]??=zero())[c]=clamp(normal+cumulative,minimum[c],30);(targetStack.floors[key]??=zero())[c]=floor;}
        i=j;
      }
      const surfaceFactor=[.1,.3,.5,.7,.8,.9,1,1.05][surface-1],distanceFactor=[.4,.5,.6,1,1,1,1,1][aptitude-1];
      acceleration[c]=Math.max(0,(slope>0?0.0004:0.0006)*Math.sqrt(500*power)*styleAccel[style][phase]*surfaceFactor*distanceFactor+accelSkill[c]+statusAccel+extraAcceleration[c]);
      if(hpEmpty)acceleration[c]=-1.2;
    }
    if(stats.guts.min!==stats.guts.max||stats.power.min!==stats.power.max||stats.wisdom.min!==stats.wisdom.max||stats.speed&&stats.speed.min!==stats.speed.max)assumptions.push('Unresolved equipped passive uses conditional final-stat endpoints.');
    return {base:targetBase,target:reasons.length?null:targetActive,trafficTarget:reasons.length?null:trafficTarget,targetStack:reasons.length?null:targetStack,accel:reasons.length?null:acceleration,current,currentRange,minimum,terrain:terrainRange,decisionTime:decision.decisionTime,downhill,pace:paceLabel,paceDown:paceLabel==='pace-down',hpEmpty,reasons:[...new Set(reasons)],assumptions:[...new Set(assumptions)],calibrated};
  }

  /** Clear spurt speed picks the target. The maximum is used when she holds it. A stable step under it is the wisdom choice. A lane-speed add is not that step. */
  function spurtPlateauFor(runner:Runner,decisionTime:number|null):number|null{
    const key=`${runner.id}:${decisionTime}`;
    if(spurtPlateauCache.has(key))return spurtPlateauCache.get(key)!;
    spurtPlateauCache.set(key,null);
    if(runner.lastSpurtDistance==null||runner.lastSpurtDistance<0||decisionTime===null)return null;
    // A malformed early spurt marker must not fit the late-leg ceiling from
    // middle-leg cruising speed. Only the final leg can supply spurt evidence.
    const spurtStart=Math.max(runner.lastSpurtDistance,(course?.distance??race.distance??Infinity)*2/3);
    const rows=trace(race,runner.id),onMax:number[]=[],under:number[]=[];
    for(let i=1;i<rows.length;i++){
      const p=rows[i-1],q=rows[i],a=p.sample,b=q.sample,dt=q.time-p.time;
      if(dt<=0||dt>2||a.distance==null||b.distance==null||a.distance<spurtStart)continue;
      if(a.speed==null||b.speed==null||a.hp==null||b.hp==null||a.hp<=0||b.hp<=0)continue;
      if(a.blockFrontRunnerIndex!==-1||b.blockFrontRunnerIndex!==-1||Math.abs(b.speed-a.speed)/dt>.12)continue;
      if(proximityPressure(race,runner.id,a)!==false||proximityPressure(race,runner.id,b)!==false)continue;
      if(neighborhoodConstraintAt(race,runner,p.time).kind!=='none'||neighborhoodConstraintAt(race,runner,q.time).kind!=='none')continue;
      const decide=spurtDecisions.get(runner.id)!;
      if(decide({time:p.time,runners:[a]}).decisionTime!==decisionTime||decide({time:q.time,runners:[b]}).decisionTime!==decisionTime)continue;
      if((compiled.get(runner.id)??[]).some(e=>e.start>p.time&&e.start<=q.time||e.end!==null&&e.end>p.time&&e.end<=q.time))continue;
      const state=stateAt(runner,(p.time+q.time)/2,null,undefined,false,false);
      if(!state.target||!state.base||state.currentRange.min!==state.currentRange.max)continue;
      // Normalize to the flat spurt base. Keeping terrain in the fitted value
      // would apply the same uphill penalty again when the target is rebuilt.
      const raw=(a.speed+b.speed)/2-state.current,implied=raw-(state.target.mid-state.base.mid)-state.terrain.mid,ceiling=state.base.mid-state.terrain.mid;
      if(implied>=ceiling-.05&&implied<=ceiling+.08)onMax.push(ceiling);
      else if(implied<=ceiling-.015&&implied>=ceiling-.8)under.push(implied);
    }
    const chosen=onMax.length>=3?onMax:under.length>=3?under:null;
    if(!chosen)return null;
    chosen.sort((x,y)=>x-y);
    const plateau=chosen[Math.floor(chosen.length/2)];
    spurtPlateauCache.set(key,plateau);
    return plateau;
  }

  function spurtFloorsFor(runner:Runner){
    const existing=spurtFloorCache.get(runner.id);if(existing)return existing;
    const evidence:{time:number;decisionTime:number|null;floor:MotionBand}[]=[];spurtFloorCache.set(runner.id,evidence);
    const rows=trace(race,runner.id);if(runner.lastSpurtDistance==null||runner.lastSpurtDistance<0)return evidence;
    for(let i=1;i<rows.length;i++){
      const p=rows[i-1],q=rows[i],a=p.sample,b=q.sample,dt=q.time-p.time;
      if(dt<=0||dt>2||a.distance==null||b.distance==null||a.distance<runner.lastSpurtDistance||a.speed==null||b.speed==null||a.hp==null||b.hp==null||a.hp<=0||b.hp<=0||a.blockFrontRunnerIndex!==-1||b.blockFrontRunnerIndex!==-1)continue;
      if(neighborhoodConstraintAt(race,runner,p.time).kind!=='none'||neighborhoodConstraintAt(race,runner,q.time).kind!=='none')continue;
      const before=stateAt(runner,p.time,null,undefined,false,false),after=stateAt(runner,q.time,null,undefined,false,false);
      if(!before.target||!after.target||!after.base||!before.base||before.currentRange.min!==before.currentRange.max||after.currentRange.min!==after.currentRange.max||Math.abs(before.current-after.current)>.00001)continue;
      const selfA=a.speed-before.current,selfB=b.speed-after.current;if((selfB-selfA)/dt<=.05)continue;
      const offsets=channels.map(c=>after.target![c]-after.base![c]);if(Math.max(...offsets)-Math.min(...offsets)>.00001)continue;
      const floor=zero();for(const c of channels)floor[c]=selfB-(after.target[c]-after.base[c])-after.terrain[c]-.015;
      if(floor.max>after.base.max-after.terrain.max+.05)continue;
      const previous=evidence.filter(e=>e.decisionTime===after.decisionTime).at(-1);if(previous)for(const c of channels)floor[c]=Math.max(floor[c],previous.floor[c]);
      evidence.push({time:q.time,decisionTime:after.decisionTime,floor});
    }
    return evidence;
  }

  function sectionsFor(runner:Runner):SectionCalibration[] {
    const existing=calibration.get(runner.id);if(existing)return existing;
    const total=course?.distance??race.distance??1,wisdom=initialStats(runner).wisdom;
    const sections=Array.from({length:24},(_,section):SectionCalibration=>{const factor=20-(total-2000)/1000,max=wisdom?factor*wisdom.max/5500*Math.log10(.1*wisdom.max)/100:0;
      const min=wisdom?factor*(wisdom.min/5500*Math.log10(.1*wisdom.min)-.65)/100:max-factor*.65/100;
      return {section,min,mid:(min+max)/2,max,evidence:'bounded',observations:0,detail:'Unreported section-wit draw; midpoint reference and conditional extrema.'};});
    const candidates=Array.from({length:24},()=>[] as number[]),rows=trace(race,runner.id);
    for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],sa=a.sample,sb=b.sample,dt=b.time-a.time;
      if(dt<=0||dt>2||sa.distance===null||sb.distance===null||sa.speed===null||sb.speed===null||sa.blockFrontRunnerIndex!==-1||sb.blockFrontRunnerIndex!==-1||sa.temptationMode!==0||sb.temptationMode!==0)continue;
      const section=Math.floor(sa.distance/(total/24));if(section<0||section>23||section!==Math.floor(sb.distance/(total/24))||Math.abs(sb.speed-sa.speed)/dt>.05)continue;
      const mid=(a.time+b.time)/2,state=stateAt(runner,mid,null),sample=atTime(race,runner.id,mid);if(!state.target||!sample||state.assumptions.some(s=>/spurt|Downhill mode|passive|Lane-speed|reconstructed|force-in|release|limit-break|Recorded compete|Recorded secure|immunity/.test(s)))continue;
      if(runner.lastSpurtDistance!=null&&runner.lastSpurtDistance>=0&&sa.distance>=runner.lastSpurtDistance)continue;
      if(neighborhoodConstraintAt(race,runner,mid).kind!=='none')continue;
      const referenceMid=state.target.mid-sections[section].mid,residual=(sa.speed+sb.speed)/2-state.current-referenceMid;
      if(residual>=sections[section].min-.015&&residual<=sections[section].max+.015)candidates[section].push(residual);
    }
    for(const [index,values]of candidates.entries())if(values.length>=2){values.sort((a,b)=>a-b);const mid=clamp(values[Math.floor(values.length/2)],sections[index].min,sections[index].max);
      sections[index]={section:index,min:Math.max(sections[index].min,mid-.015),mid,max:Math.min(sections[index].max,mid+.015),evidence:'calibrated',observations:values.length,
        detail:'Conditional section residual fitted to clean stable retained self-speed plateaus, assuming the supported/normal reference pace and no unreported force-in/lane boost; not a recovered RNG draw. The same calibrated quantile is reused in excluded-skill comparisons, shifting the offset when wit changes.'};}
    calibration.set(runner.id,sections);return sections;
  }

  function build(options:RaceMotionOptions={}):RaceMotion {
    const runners:Record<string,RunnerMotion>={};
    const excludedKeys=[...new Set([...(options.excludeActivationKeys??[]),...(options.excludeActivationKey?[options.excludeActivationKey]:[])])].sort();
    const excludedTypes=options.excludeEffectTypes?[...new Set(options.excludeEffectTypes)].sort((a,b)=>a-b):null;
    const excluded:EffectExclusion=excludedKeys.length?excludedTypes?{activationKeys:new Set(excludedKeys),types:new Set(excludedTypes)}:new Set(excludedKeys):null;
    for(const runner of race.runners.filter(r=>!options.runnerId||r.id===options.runnerId)) {
      const applyInferredModes=options.applyInferredModes===true,buildKey=JSON.stringify([runner.id,excludedKeys,excludedTypes,options.excludeStatusKey??null,applyInferredModes]),cached=runnerBuildCache.get(buildKey);if(cached){runners[runner.id]=cached;continue;}
      const sections=sectionsFor(runner),stop=stopTime(race,runner.id),rows=trace(race,runner.id),tick=1/15;
      const times=new Set<number>([0,stop]);for(let t=0;t<stop;t+=tick)times.add(Number(t.toFixed(7)));
      for(const row of rows)if(row.time<=stop)times.add(row.time);
      for(const effect of compiled.get(runner.id)??[]){if(effect.start>=0&&effect.start<=stop)times.add(effect.start);if(effect.end!==null&&effect.end>=0&&effect.end<=stop)times.add(effect.end);}
      for(const interval of analysis.runners[runner.id].intervals){if(interval.start>=0&&interval.start<=stop)times.add(interval.start);const end=interval.end??interval.estimatedEnd;if(end!=null&&end<=stop)times.add(end);}
      if((compiled.get(runner.id)??[]).some(e=>e.raw.additionalActivateType===1))for(const time of passesFor(runner.id))if(time>=0&&time<=stop)times.add(time);
      const ordered=[...times].sort((a,b)=>a-b),samples:MotionSample[]=[],distanceDeficit=zero(),timeDeficit=zero(),observedTrafficDeficit=zero(),observedTrafficTime=zero();
      let freeSelf:MotionBand|null=null,constrainedSelf:MotionBand|null=null,freeDash:[boolean,boolean,boolean]=[true,true,true],constrainedDash:[boolean,boolean,boolean]=[true,true,true];
      let targetDuration=0,freeDuration=0,constrainedDuration=0,calibratedDuration=0,firstAnchor=true;
      let trafficDuration=0,trafficAssessed=0;
      for(let i=0;i<ordered.length;i++) {
        const time=ordered[i],previous=i?ordered[i-1]:time,dt=time-previous,raw=atTime(race,runner.id,time),state=stateAt(runner,time,excluded,sections,false,true,options.excludeStatusKey??null,applyInferredModes),mid=(time+previous)/2;
        const recordedDash=startDashStateAt(race,analysis,runner.id,time);
        let physics=dt>0?stateAt(runner,mid,excluded,sections,false,true,options.excludeStatusKey??null,applyInferredModes):state;
        let constraint=neighborhoodConstraintAt(race,runner,time);
        if(raw?.blockFrontRunnerIndex!=null&&raw.blockFrontRunnerIndex>=0){const block=frontBlockCapAt(race,runner,time);constraint={kind:'recorded-block',cap:block.cap,runnerId:race.runners.find(r=>r.index===raw.blockFrontRunnerIndex)?.id??null,detail:block.detail};}
        const reasons=[...state.reasons],assumptions=[...state.assumptions];if(constraint.kind==='unknown'||constraint.kind!=='none'&&constraint.cap===null)reasons.push(constraint.detail);
        if(raw?.blockFrontRunnerIndex==null&&constraint.kind==='none')assumptions.push('Interpolated neighborhood has no reference front collision; block-transition time is unreported, not recorded no-block state.');
        let free:MotionBand|null=null,constrained:MotionBand|null=null,intervalFree:MotionBand|null=null,intervalConstrained:MotionBand|null=null;
        const bracket=rows.findIndex(row=>row.time>=time),gap=bracket>0?rows[bracket].time-rows[bracket-1].time:0;
        const anchorAfterGap=gap>2&&rows[bracket]?.time===time,stepDt=anchorAfterGap?0:dt;if(anchorAfterGap)physics=state;
        if(gap>2&&!anchorAfterGap)reasons.push('Retained motion gap exceeds2s; trajectory reset.');
        if(!state.target||!state.accel||!state.minimum||!physics.target||!physics.accel||!physics.minimum||!raw||raw.speed===null||raw.distance===null||gap>2&&!anchorAfterGap){freeSelf=constrainedSelf=null;}
        else {
          if(!freeSelf){const anchor=Math.max(0,raw.speed-state.current);freeSelf=band(anchor);
            const knownDash=startDashStateAt(race,analysis,runner.id,time);freeDash=knownDash===null?[true,true,false]:[knownDash,knownDash,knownDash];constrainedDash=[...freeDash];
            if(knownDash===null)assumptions.push('Start-dash history unresolved after anchor: dash-on lower/mid and dash-off upper reference scenarios; no2s cutoff.');
            if(!firstAnchor)assumptions.push('Re-anchored at retained velocity after an unknown gap; no deficit invented through missing history.');firstAnchor=false;}
          const canConstrain=constraint.kind!=='unknown'&&(constraint.kind==='none'||constraint.cap!==null);
          if(!constrainedSelf&&canConstrain){constrainedSelf=band(Math.max(0,raw.speed-state.current));constrainedDash=[...freeDash];}
          free=zero();constrained=canConstrain&&constrainedSelf?zero():null;
          if(stepDt>0){intervalFree=zero();if(constrained)intervalConstrained=zero();}
          for(const [index,c]of channels.entries()) {
            const startFree=freeSelf[c],startConstrained=constrainedSelf?.[c]??null;
            const advance=(speed:number,dash:boolean,cap:number|null):{speed:number;dash:boolean}=>{
              // A sub-frame gate delay reduces first-frame displacement, not
              // acceleration. Only complete still-delayed ticks skip physics.
              const gatePhysicsStart=runner.startDelay==null?0:Math.max(0,Math.floor((runner.startDelay-1e-9)/tick))*tick;
              const threshold=.85*(20-((course?.distance??2000)-2000)/1000),actualDt=anchorAfterGap?0:Math.max(0,time-Math.max(previous,gatePhysicsStart));
              let target=physics.target![c],accel=physics.accel![c]+(dash?24:0),deceleration=physics.hpEmpty?1.2:referenceDeceleration(raw.distance!,course?.distance??2000,physics.paceDown);
              if(dash)target=Math.min(target,threshold);
              let next=physics.hpEmpty?(speed<=target?speed-1.2*actualDt:Math.max(target,speed-1.2*actualDt))
                :speed<target?Math.min(target,speed+accel*actualDt):Math.max(target,speed-deceleration*actualDt);
              if(!dash)next=Math.max(next,physics.minimum![c]);if(cap!==null)next=Math.min(next,cap);
              return {speed:next,dash:dash&&next<threshold};
            };
            // Type22 transfers its modifier to self speed at expiry. Type21 does not.
            const residual=(compiled.get(runner.id)??[]).filter(e=>!isExcluded(excluded,e.key,e.type)&&e.type===22&&e.end!=null&&e.end>previous+1e-8&&e.end<=time+1e-8&&!e.unknownRecipient).reduce((n,e)=>{const value=resolvedValue(e,e.end!-1e-7,excluded);return n+(value===null?0:effectBand(e,value)[c]);},0);
            const stepFree=advance(freeSelf[c],freeDash[index],null),freeEndWithoutImpulse=stepFree.speed;freeSelf[c]=stepFree.speed+residual;freeDash[index]=recordedDash===true?true:stepFree.dash;
            let constrainedEndWithoutImpulse:number|null=null;
            if(constrainedSelf&&constrained){
              // The front cap limits self speed; direct current-speed effects
              // are applied afterward, as in the recorded velocity pipeline.
              const step=advance(constrainedSelf[c],constrainedDash[index],constraint.cap);constrainedEndWithoutImpulse=step.speed;constrainedSelf[c]=constraint.cap===null?step.speed+residual:Math.min(constraint.cap,step.speed+residual);constrainedDash[index]=recordedDash===true?true:step.dash;constrained[c]=Math.max(0,constrainedSelf[c]+state.currentRange[c]);}
            free[c]=Math.max(0,freeSelf[c]+state.currentRange[c]);
            // Instant current-speed changes belong to the interval where they
            // were active. An expiry impulse affects only subsequent travel.
            if(intervalFree)intervalFree[c]=Math.max(0,(startFree+freeEndWithoutImpulse)/2+physics.currentRange[c]);
            if(intervalConstrained&&startConstrained!==null&&constrainedEndWithoutImpulse!==null)intervalConstrained[c]=Math.max(0,(startConstrained+constrainedEndWithoutImpulse)/2+physics.currentRange[c]);
            if(constrainedSelf&&constrained&&startConstrained!==null&&stepDt>0){const averageFree=(startFree+freeSelf[c])/2+physics.current;
              const continuousDelta=Math.max(0,((startFree+freeEndWithoutImpulse)-(startConstrained+(constrainedEndWithoutImpulse??constrainedSelf[c])))/2);
              distanceDeficit[c]+=continuousDelta*stepDt;timeDeficit[c]+=averageFree>0?continuousDelta/averageFree*stepDt:0;}
          }
          if(!canConstrain)constrainedSelf=null;
          if(stepDt>0){targetDuration+=stepDt;freeDuration+=stepDt;if(constrained)constrainedDuration+=stepDt;if(state.calibrated)calibratedDuration+=stepDt;}
          if(constraint.kind==='geometry-block')assumptions.push('Neighbor cap is inferred from sampled geometry, independently of the recorded block flag.');
        }
        const previousSample=samples.at(-1),traffic=constraint.kind==='recorded-block'||constraint.kind==='geometry-block';
        if(dt>0&&traffic){trafficDuration+=dt;
          if(free&&previousSample?.free&&raw?.speed!=null&&previousSample.actual!=null){trafficAssessed+=dt;
            for(const c of channels){const ideal=(previousSample.free[c]+free[c])/2,actual=(previousSample.actual+raw.speed)/2,shortfall=Math.max(0,ideal-actual);observedTrafficDeficit[c]+=shortfall*dt;observedTrafficTime[c]+=ideal>0?shortfall/ideal*dt:0;}}}
        const bounded=assumptions.length>0||state.target&&state.target.max-state.target.min>.001;
        const healthy=state.hpEmpty?stateAt(runner,time,excluded,sections,true,true,options.excludeStatusKey??null,applyInferredModes):state;
        samples.push({time,distance:raw?.distance??null,actual:raw?.speed??null,currentSpeedDelta:state.current,selfActual:raw?.speed==null||state.currentRange.max!==state.currentRange.min||state.reasons.some(r=>r.startsWith('Skill '))?null:Math.max(0,raw.speed-state.current),targetBase:state.base,targetActive:state.target,healthyTargetActive:healthy.target,healthyAccelerationRange:healthy.accel,hpEmpty:state.hpEmpty,free,constrained,acceleration:state.accel?.mid??null,accelerationRange:state.accel,
          blockCap:constraint.cap,constraint,nearbySlowdown:constraint.kind==='geometry-block',downhillTargetDelta:state.downhill,pace:state.pace,startDash:recordedDash!==null?recordedDash:free?freeDash[1]:null,
          trafficTargetActive:state.trafficTarget,healthyTrafficTargetActive:healthy.trafficTarget,decisionTime:state.decisionTime,targetStack:state.targetStack,intervalTargetStack:physics.targetStack,intervalFree,intervalConstrained,cumulativeDistance:{...distanceDeficit},cumulativeTime:{...timeDeficit},evidence:!free?'unknown':state.calibrated?'calibrated':bounded?'bounded':'reference',reasons:[...new Set(reasons)],assumptions:[...new Set(assumptions)]});
      }
      const complete=Math.abs(constrainedDuration-stop)<1e-4,assessed=constrainedDuration>0;
      const losses=motionLosses(race,runner,samples,course,analysis);
      runners[runner.id]={samples,sections,coverage:{target:stop>0?targetDuration/stop:0,free:stop>0?freeDuration/stop:0,constrained:stop>0?constrainedDuration/stop:0,calibrated:stop>0?calibratedDuration/stop:0,assessedDuration:constrainedDuration,duration:stop},
        distanceLoss:complete?{...distanceDeficit}:null,timeLoss:complete?{...timeDeficit}:null,assessedDistanceLoss:assessed?{...distanceDeficit}:null,assessedTimeLoss:assessed?{...timeDeficit}:null,
        observedTrafficDeficit:losses.trafficLoss.distanceLoss,observedTrafficTime:losses.trafficLoss.timeLoss,
        observedTrafficDuration:losses.trafficLoss.duration,observedTrafficAssessedDuration:losses.trafficLoss.assessedDuration,observedTrafficCoverage:losses.trafficLoss.coverage,...losses,initialStats:copyStats(initialStats(runner)),
        paceStarts:analysis.runners[runner.id].intervals.filter(i=>i.kind.endsWith('-model')&&['pace-up','pace-down','speed-up','overtake'].includes(modelKind(i))).map(i=>({time:i.start,kind:modelKind(i),detail:i.detail})),detail:notes};
      runnerBuildCache.set(buildKey,runners[runner.id]);
    }
    return {runners,detail:notes};
  }
  /** Nominal speed area, not another race simulation. Include the full skill
   * duration, even when part of it falls after the finish. Resolved trigger
   * changes split the area; acceleration has no carryover denominator. */
  function speedPotential(runnerId:string,activationKeys:readonly string[]):MotionBand|null {
    const selected=new Set(activationKeys),result=zero();
    for(const effect of compiled.get(runnerId)??[]){
      if(!selected.has(effect.key)||effect.sourceId!==runnerId||(effect.raw.targetType??1)!==1||![21,22,27].includes(effect.type))continue;
      if(effect.end===null)return null;
      const end=Number.isFinite(effect.end)?effect.end:stopTime(race,runnerId);
      if(end<=effect.start)continue;
      const transitions=(analysis.runners[runnerId]?.skillActivations??[]).map(a=>a.start);
      if(effect.raw.additionalActivateType===1)transitions.push(...passesFor(runnerId));
      const times=[effect.start,...new Set(transitions.filter(t=>t>effect.start&&t<end)),end].sort((a,b)=>a-b);
      for(let i=1;i<times.length;i++){
        const value=resolvedValue(effect,(times[i-1]+times[i])/2,null);
        if(value===null)return null;
        const amount=effectBand(effect,value),dt=times[i]-times[i-1];
        for(const c of channels)result[c]+=Math.max(0,amount[c])*dt;
      }
    }
    return result;
  }
  function physics(runnerId:string,time:number,options:RaceMotionOptions={},healthy=false){
    const selected=new Set([...(options.excludeActivationKeys??[]),...(options.excludeActivationKey?[options.excludeActivationKey]:[])]);
    const excluded:EffectExclusion=options.excludeEffectTypes?{activationKeys:selected,types:new Set(options.excludeEffectTypes)}:selected;
    return stateAt(race.runners.find(r=>r.id===runnerId)!,time,excluded,undefined,healthy,false,options.excludeStatusKey??null,true);
  }
  return {build,speedPotential,physics};
}
export function buildRaceMotion(race:Race,reference:ReferenceData|null,courseIdOverride:number|null|undefined,analysis:RaceAnalysis):RaceMotion {
  return createRaceMotionEngine(race,reference,courseIdOverride,analysis).build();
}
