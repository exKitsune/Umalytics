import type { Race, Runner, RaceEvent } from './types';
import type { ReferenceData, CourseReference } from './reference';
import type { RaceAnalysis } from './analytics';
import { effectValue } from './effect-value';
import { referenceEquippedSkillId } from './equipped-skills';
import { selfSpeedAt } from './mechanics-effects';
import { atTime, trace } from './effect-sampling';
import { effectiveStrategyCode } from './skill-details';

export interface HpTimelinePoint { time:number; hp:number|null; evidence:'recorded'|'reference'|'unknown'; kind:'sample'|'bridge'|'jump-before'|'jump-after'|'unknown'; skillId?:number }
interface Jump { time:number; amount:number; skillId:number; immunityUnresolved?:boolean }
export interface HpSampledBridge {start:number;end:number;startHp:number;endHp:number;reason:string}
export interface HpHitModelContext {analysis:Pick<RaceAnalysis,'runners'>;course:CourseReference|null}
export interface HpHitEvidence {time:number;skillId:number;start:number;end:number;nominalHpLoss:number;observedWindowDrop:number;roundingTolerance:number;immunityInference:'same-team-supported'|'unresolved';reason:string;
  comparisonEligible?:boolean;otherLossMin?:number;otherLossMax?:number;
  normalHpMin?:number|null;normalHpMax?:number|null;noHitLossMin?:number|null;noHitLossMax?:number|null;hitLossMin?:number|null;hitLossMax?:number|null;
  hitInference?:'applied-supported'|'immunity-supported'|'both-possible'|'neither-fits'|'unresolved';}
const caches = new WeakMap<Race, Map<ReferenceData|null, Map<string, HpTimelinePoint[]>>>();
const bridgeCaches = new WeakMap<Race, Map<ReferenceData|null, Map<string, HpSampledBridge[]>>>();
const hitCaches = new WeakMap<Race, Map<ReferenceData|null, Map<string, HpHitEvidence[]>>>();
const onsetCache = new WeakMap<Race, Map<string, number|null>>();
const skillEvent = (event:RaceEvent) => (event.type === 3 || event.type === '3' || event.type === 'skill') && (event.params[2] !== -1 || event.time === 0);

/** null means an HP effect may apply but its amount/recipient is unresolved. */
function jumpFor(race:Race, runner:Runner, event:RaceEvent, reference:ReferenceData|null, maximum:number|null):Jump|null|undefined {
  const source = race.runners.find(r=>r.id===event.runnerId) ?? race.runners.find(r=>r.index===event.params[0]);
  if (!source || event.skillId == null) return null;
  const id = referenceEquippedSkillId(source,event.skillId);
  const definition = id == null ? null : reference?.metadata.skills[id];
  const mask = event.params[4];
  const selectedByMask = Number.isInteger(mask) && runner.index < 32 && (((mask>>>0) >>> runner.index)&1) !== 0;
  if (!definition) return source.id===runner.id || selectedByMask || !Number.isInteger(mask) ? null : undefined;
  const branch = event.params[3] == null && definition.branches.length===1 ? definition.branches[0] : definition.branches.find((b,i)=>(b.branchIndex??i)===event.params[3]);
  if (!branch) return definition.branches.some(b=>b.effects.some(e=>e.type===9)) ? null : undefined;
  let amount = 0, found = false, positive=false,negative=false,immunityUnresolved=false;
  for (const effect of branch.effects.filter(e=>e.type===9)) {
    if ((effect.targetType??1)===1) { if (source.id!==runner.id) continue; }
    else {
      if (!Number.isInteger(mask) || mask < 0 || runner.index >= 32) return null;
      if (!selectedByMask) continue;
      if (source.id!==runner.id && effect.rawValue < 0) {
        if (source.teamGroup != null && runner.teamGroup != null) { if(source.teamGroup===runner.teamGroup) continue; }
        else immunityUnresolved=true;
      }
    }
    found = true;
    const value = id == null ? null : effectValue(source,id,effect);
    if (value == null || maximum == null) return null;
    positive ||= value>0;negative ||= value<0;
    if(positive&&negative)return null;
    amount += value*maximum;
  }
  return found ? {time:event.time,amount,skillId:event.skillId,...(immunityUnresolved?{immunityUnresolved:true}:{})} : undefined;
}

/** Playback interpolation, not recorded HP facts. Instant reference jumps and
 * nonpositive residual drain bridge both exact retained endpoints. */
export function hpTimeline(race:Race,runnerId:string,reference:ReferenceData|null,maximumHp?:number|null):HpTimelinePoint[] {
  let byRef=caches.get(race);if(!byRef){byRef=new Map();caches.set(race,byRef);}
  let cache=byRef.get(reference);if(!cache){cache=new Map();byRef.set(reference,cache);}
  const key=`${runnerId}:${maximumHp??''}`;const saved=cache.get(key);if(saved)return saved;
  const runner=race.runners.find(r=>r.id===runnerId);
  const samples=race.frames.map(f=>({time:f.time,sample:f.runners.find(r=>r.runnerId===runnerId)}));
  const first=samples[0];
  const initial=first?.time===0 && first.sample?.distance!=null && first.sample.distance<=.5 && (first.sample.hp??0)>0 ? first.sample!.hp : null;
  const maximum=maximumHp!=null&&Number.isFinite(maximumHp)&&maximumHp>0?maximumHp:initial;
  const points:HpTimelinePoint[]=[];
  const bridges:HpSampledBridge[]=[];
  const hits:HpHitEvidence[]=[];
  const recorded=(s:typeof first)=>points.push({time:s.time,hp:s.sample?.hp??null,evidence:'recorded',kind:'sample'});
  if(first)recorded(first);
  const events=race.events.filter(skillEvent).sort((a,b)=>a.time-b.time);
  for(let i=1;i<samples.length;i++) {
    const a=samples[i-1],b=samples[i],start=a.sample?.hp,end=b.sample?.hp;
    const jumps:Jump[]=[];let unknown=false;
    if(runner)for(const event of events)if(event.time>a.time&&event.time<=b.time){const jump=jumpFor(race,runner,event,reference,maximum);if(jump===null)unknown=true;else if(jump)jumps.push(jump);}
    if(jumps.some((j,n)=>n>0&&j.time===jumps[n-1].time))unknown=true;
    const gap=(reason='HP between recorded samples; instant HP reconstruction is unresolved.')=>{
      points.push({time:a.time,hp:null,evidence:'unknown',kind:'unknown'});
      if(start!=null&&end!=null&&Number.isFinite(start)&&Number.isFinite(end)&&b.time>a.time)bridges.push({start:a.time,end:b.time,startHp:start,endHp:end,reason});
    };
    if(start==null||end==null||b.time<=a.time){gap();recorded(b);continue;}
    for(const jump of jumps.filter(j=>j.immunityUnresolved&&j.amount<0)){
      const loss=-jump.amount,drop=start-end,tolerance=2;
      // Two endpoint HP values are quantized; require a strict margin. Positive
      // ending HP rules out zero-floor truncation when no recovery is present.
      const excluded=unknown||jumps.some(j=>j.amount>0)||end<=0||drop<0||maximum==null||start>maximum+1e-6||end>maximum+1e-6;
      const supported=!excluded&&drop+tolerance<loss;
      hits.push({time:jump.time,skillId:jump.skillId,start:a.time,end:b.time,nominalHpLoss:loss,observedWindowDrop:drop,roundingTolerance:tolerance,comparisonEligible:!excluded,
        otherLossMin:jumps.filter(j=>j!==jump&&!j.immunityUnresolved).reduce((n,j)=>n+Math.max(0,-j.amount),0),otherLossMax:jumps.filter(j=>j!==jump).reduce((n,j)=>n+Math.max(0,-j.amount),0),
        immunityInference:supported?'same-team-supported':'unresolved',reason:supported?'The whole recorded HP drop is smaller than this full hit, with no recovery in the bracket; team immunity is supported for this hit only.':excluded?'Recovery, unknown HP effects, or HP-floor context prevents a per-hit immunity inference.':'The recorded HP drop can include the full hit plus normal drain; team immunity is unresolved.'});
    }
    if(unknown|| (maximum!=null&&(start>maximum+1e-6||end>maximum+1e-6))){gap();recorded(b);continue;}
    if(jumps.some(j=>j.immunityUnresolved)){
      // A recorded target mask does not settle team immunity. Preserve that
      // model gap, while exposing a display-only net sampled decline separately.
      // Unknown heals/scaling/targets never acquire an invented instant amount.
      const inferred=hits.some(h=>h.start===a.time&&h.end===b.time&&h.immunityInference==='same-team-supported');
      gap(inferred?'HP between recorded samples; same-team immunity inferred for a hit in this interval.':'HP between recorded samples; recipient team immunity is unresolved.');recorded(b);continue;
    }
    if(!jumps.length){if(end>start+1e-6)gap();recorded(b);continue;}
    // Endpoint exhaustion, or a capped heal exactly at the endpoint, leaves a
    // range of equally valid pre-event HP/drain histories.
    if(end===0 || (maximum!=null&&end===maximum&&jumps.at(-1)!.time===b.time)){gap();recorded(b);continue;}
    const cap=(hp:number)=>Math.max(0,Math.min(maximum!,hp));
    const simulate=(rate:number,emit=false)=>{
      let hp=start,time=a.time;
      for(const jump of jumps){hp=cap(hp+rate*(jump.time-time));if(emit)points.push({time:jump.time,hp,evidence:'reference',kind:'jump-before',skillId:jump.skillId});hp=cap(hp+jump.amount);if(emit)points.push({time:jump.time,hp,evidence:'reference',kind:'jump-after',skillId:jump.skillId});time=jump.time;}
      return cap(hp+rate*(b.time-time));
    };
    let low=-4*(maximum!+jumps.reduce((sum,j)=>sum+Math.abs(j.amount),0))/(b.time-a.time),high=0;
    if(end<simulate(low)-1e-6||end>simulate(high)+1e-6){gap();recorded(b);continue;}
    for(let n=0;n<64;n++){const mid=(low+high)/2;if(simulate(mid)<end)low=mid;else high=mid;}
    const rate=(low+high)/2,epsilon=Math.max(1e-4,Math.abs(rate)*1e-5);
    // A clamp plateau hides differing pre-event HP; do not choose one bridge.
    if(Math.abs(simulate(rate+epsilon)-simulate(rate-epsilon))<1e-7){gap();recorded(b);continue;}
    simulate(rate,true);recorded(b);
  }
  let bridgeRefs=bridgeCaches.get(race);if(!bridgeRefs){bridgeRefs=new Map();bridgeCaches.set(race,bridgeRefs);}let bridgeRows=bridgeRefs.get(reference);if(!bridgeRows){bridgeRows=new Map();bridgeRefs.set(reference,bridgeRows);}bridgeRows.set(key,bridges);
  let hitRefs=hitCaches.get(race);if(!hitRefs){hitRefs=new Map();hitCaches.set(race,hitRefs);}let hitRows=hitRefs.get(reference);if(!hitRows){hitRows=new Map();hitRefs.set(reference,hitRows);}hitRows.set(key,hits);
  cache.set(key,points);return points;
}

/** Display-only linear sampled HP segments. These are not reconstructed debuff
 * amounts or resolved immunity, and do not enter analytical effect attribution. */
export function hpSampledBridges(race:Race,runnerId:string,reference:ReferenceData|null,maximumHp?:number|null,context?:HpHitModelContext):HpSampledBridge[]{
  hpTimeline(race,runnerId,reference,maximumHp);
  const rows=bridgeCaches.get(race)?.get(reference)?.get(`${runnerId}:${maximumHp??''}`)??[];
  if(!context)return rows;
  const evidence=hpHitEvidence(race,runnerId,reference,maximumHp,context);
  return rows.map(b=>{const hit=evidence.find(h=>h.start===b.start&&h.end===b.end&&h.hitInference!==undefined&&h.hitInference!=='unresolved');return hit?{...b,reason:`HP between recorded samples. ${hit.reason}`}:b;});
}
/** Reference running consumption at the observed/interpolated self speed.
 * Unreported HP-derived mode candidates do not establish mode state here: early
 * pace-down and downhill remain on/off bounds, independent of this HP bracket. */
export function runningHpRange(race:Race,runnerId:string,start:number,end:number,context:HpHitModelContext):{min:number;max:number}|null{
  const {course,analysis}=context,runner=race.runners.find(r=>r.id===runnerId),detail=analysis.runners[runnerId],ground=Number(race.conditions?.ground);
  if(!course||race.distance!==course.distance||!runner||!detail||![1,2].includes(course.surface)||!Number.isInteger(ground)||ground<1||ground>4||end-start>2||end<=start)return null;
  // A direct-speed discontinuity inside the retained bracket cannot be undone
  // by subtracting its modifier from a linearly interpolated actual velocity.
  for(const source of race.runners)for(const activation of analysis.runners[source.id].skillActivations){
    if(!activation.effects.some(e=>[21,22].includes(e.type)&&((e.targetType??1)===1?source.id===runnerId:activation.targetRunnerIds.includes(runnerId))))continue;
    if(source.id!==runnerId&&(source.teamGroup==null||runner.teamGroup==null)&&activation.start<end&&(activation.effectiveEnd==null||activation.effectiveEnd>start)&&activation.effects.some(e=>[21,22].includes(e.type)&&(e.targetType??1)!==1&&e.rawValue<0))return null;
    if([activation.start,activation.effectiveEnd].some(t=>t!=null&&t>start+1e-7&&t<=end+1e-7))return null;
  }
  const style=effectiveStrategyCode(runner,detail.skillRows),total=course.distance,base=20-(total-2000)/1000,guts=detail.statBreakdown.stats.guts.final;
  const groundFactor=ground===4?1.02:ground===3?(course.surface===1?1.02:1.01):1;
  const active=(kind:string,time:number)=>detail.intervals.some(i=>i.kind.replace(/-model$/,'')===kind&&time>=i.start&&time<(i.end??i.estimatedEnd??i.observedUntil??race.duration));
  let min=0,max=0;
  for(let time=start;time<end-1e-8;){const next=Math.min(end,time+1/30),mid=(time+next)/2,dt=next-time;time=next;
    const sample=atTime(race,runnerId,mid);if(!sample||sample.distance==null||sample.speed==null||sample.hp==null||sample.hp<=0)return null;
    if(['compete-before-spurt','stamina-keep','secure-lead'].some(k=>active(k,mid)))return null;
    const self=selfSpeedAt(race,analysis,runnerId,mid,sample.speed);if(self==null)return null;
    const late=sample.distance>=total*2/3;if(late&&(guts==null||guts<=0))return null;
    const rate=20*Math.max(0,self-base+12)**2/144*groundFactor*(late?1+200/Math.sqrt(600*guts!):1);
    const rushedKnown=sample.temptationMode!=null,rushed=rushedKnown&&sample.temptationMode!>0;
    const spot=active('spot-struggle',mid)&&sample.distance<total*9/24;
    let statusMin=rushed?1.6:1,statusMax=rushedKnown?statusMin:1.6;
    if(spot){const solo=style===5?3.5:style===1?1.4:3.5,combined=style===5?7.7:style===1?3.6:7.7;statusMax=Math.max(statusMax,rushed?combined:rushedKnown?solo:combined);}
    // Dueling/target/acceleration affect drain through retained self speed; no
    // separate HP multiplier is invented. Rushed + spot uses compound factors.
    const paceDownPossible=sample.distance<total*10/24&&style!==1&&style!==5;
    const downhillPossible=(course.slopes.find(s=>sample.distance!>=s.start&&sample.distance!<s.start+s.length)?.slopePercent??0)<0;
    min+=rate*statusMin*(paceDownPossible ? .6 : 1)*(downhillPossible ? .4 : 1)*dt;
    max+=rate*statusMax*dt;
  }
  return {min,max};
}
/** Per-hit evidence never constructs or modifies runner team groups. */
export function hpHitEvidence(race:Race,runnerId:string,reference:ReferenceData|null,maximumHp?:number|null,context?:HpHitModelContext):HpHitEvidence[]{
  hpTimeline(race,runnerId,reference,maximumHp);
  const rows=hitCaches.get(race)?.get(reference)?.get(`${runnerId}:${maximumHp??''}`)??[];
  if(!context)return rows;
  return rows.map(row=>{
    const normal=row.comparisonEligible?runningHpRange(race,runnerId,row.start,row.end,context):null;
    if(!normal)return {...row,normalHpMin:null,normalHpMax:null,hitInference:'unresolved' as const};
    const noMin=normal.min+(row.otherLossMin??0),noMax=normal.max+(row.otherLossMax??0),hitMin=noMin+row.nominalHpLoss,hitMax=noMax+row.nominalHpLoss,drop=row.observedWindowDrop,tol=row.roundingTolerance;
    const noFits=drop+tol>=noMin-1e-6&&drop-tol<=noMax+1e-6,hitFits=drop+tol>=hitMin-1e-6&&drop-tol<=hitMax+1e-6;
    const inference=hitFits&&!noFits?'applied-supported':noFits&&!hitFits?'immunity-supported':hitFits&&noFits?'both-possible':'neither-fits';
    const amount=Math.abs(normal.max-normal.min)<.01?normal.min.toFixed(2):`${normal.min.toFixed(2)}–${normal.max.toFixed(2)}`;
    const reason=inference==='applied-supported'?`Running drain ${amount} HP plus the ${row.nominalHpLoss.toFixed(2)} HP hit fits the ${drop.toFixed(0)} HP drop; the hit is supported.`:inference==='immunity-supported'?`Running drain ${amount} HP fits the ${drop.toFixed(0)} HP drop without the ${row.nominalHpLoss.toFixed(2)} HP hit; same-team immunity is supported for this hit.`:inference==='both-possible'?`Running drain ${amount} HP leaves both hit and no-hit hypotheses possible.`:'Neither reference HP hypothesis fits; running context or effect inputs remain unresolved.';
    return {...row,normalHpMin:normal.min,normalHpMax:normal.max,noHitLossMin:noMin,noHitLossMax:noMax,hitLossMin:hitMin,hitLossMax:hitMax,hitInference:inference as NonNullable<HpHitEvidence['hitInference']>,immunityInference:inference==='immunity-supported'?'same-team-supported' as const:row.immunityInference,reason};
  });
}

/** First zero sample is the moment HP was observed empty, not the moment it
 * reached empty. Out-of-HP speed falls at 1.2 m/s², so the speed already lost
 * before that sample places the crossing inside the preceding bracket. */
export function hpDepletionOnset(race:Race,runnerId:string):number|null {
  let byRunner=onsetCache.get(race);if(!byRunner)onsetCache.set(race,byRunner=new Map());
  if(byRunner.has(runnerId))return byRunner.get(runnerId)!;
  const rows=trace(race,runnerId).flatMap(point=>point.sample.hp==null||point.sample.speed==null?[]:[{t:point.time,hp:point.sample.hp,v:point.sample.speed}]);
  const zero=rows.findIndex(row=>row.hp===0);
  let onset:number|null=null;
  if(zero<0)onset=null;
  else if(zero===0)onset=rows[0].t;
  else {
    let index=zero;onset=rows[zero].t;
    while(index>0){
      const previous=rows[index-1],current=rows[index],dt=current.t-previous.t;
      if(dt<=0||dt>2)break;
      const rate=(current.v-previous.v)/dt;
      if(previous.hp===0){onset=previous.t;index--;continue;}
      if(previous.hp<=40&&rate<=-.9&&rate>=-1.45&&previous.v>12){onset=previous.t;index--;continue;}
      if(previous.hp>0&&current.hp===0&&previous.v>12&&previous.v>current.v){
        const partial=current.t-Math.min(dt,(previous.v-current.v)/1.2);
        if(partial>previous.t&&partial<current.t)onset=partial;
      }
      break;
    }
  }
  byRunner.set(runnerId,onset);return onset;
}
function bridgeAt(bridges:readonly HpSampledBridge[],time:number){
  let lo=0,hi=bridges.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(bridges[mid].start<time)lo=mid+1;else hi=mid;}
  const b=bridges[lo-1];return b&&time>b.start&&time<b.end?b:undefined;
}
export function hpAt(race:Race,runnerId:string,time:number,reference:ReferenceData|null,maximumHp?:number|null):number|null {
  const points=hpTimeline(race,runnerId,reference,maximumHp);if(!points.length)return null;
  let frameLow=0,frameHigh=race.frames.length;while(frameLow<frameHigh){const mid=(frameLow+frameHigh)>>>1;if(race.frames[mid].time<time)frameLow=mid+1;else frameHigh=mid;}
  const frame=race.frames[frameLow];if(frame?.time===time)return frame.runners.find(r=>r.runnerId===runnerId)?.hp??null;
  const bridge=bridgeAt(hpSampledBridges(race,runnerId,reference,maximumHp),time);
  if(bridge){
    if(bridge.endHp===0&&bridge.startHp>0){const onset=hpDepletionOnset(race,runnerId);if(onset!=null&&time>=onset)return 0;}
    return bridge.startHp+(bridge.endHp-bridge.startHp)*(time-bridge.start)/(bridge.end-bridge.start);
  }
  if(time<points[0].time)return points[0].hp;if(time>points[points.length-1].time)return points[points.length-1].hp;
  let low=0,high=points.length;while(low<high){const mid=(low+high)>>>1;if(points[mid].time<=time)low=mid+1;else high=mid;}
  const a=points[low-1],b=points[low];if(a?.time===time)return a.hp;if(!a||!b||a.hp==null||b.hp==null)return null;
  if(b.hp===0&&a.hp>0){const onset=hpDepletionOnset(race,runnerId);if(onset!=null&&time>=onset)return 0;}
  return a.hp+(b.hp-a.hp)*(time-a.time)/(b.time-a.time);
}
