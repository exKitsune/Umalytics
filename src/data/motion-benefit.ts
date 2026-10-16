import type { MotionBand, RunnerMotion } from './race-motion';

const channels=['min','mid','max'] as const;
const zero=():MotionBand=>({min:0,mid:0,max:0});
const envelope=(v:MotionBand):MotionBand=>({min:Math.min(v.min,v.mid,v.max),mid:v.mid,max:Math.max(v.min,v.mid,v.max)});
export interface MotionBenefit {
  distance:MotionBand|null;time:MotionBand|null;
  activeDistance:MotionBand|null;carryoverDistance:MotionBand|null;carryoverTime:MotionBand|null;
  speedPotentialDistance:MotionBand|null;
  blockedDistance:MotionBand|null;duration:number;assessedDuration:number;coverage:number;
  carryoverComplete:boolean;carryoverEfficiency:number|null;reasons:string[];
}

/** Paired paths keep the same recorded race context. Only the chosen effects
 * change. Acceleration's entire head start is direct gain. The speed-only
 * comparison keeps selected acceleration on and isolates speed carryover. */
export function measureMotionBenefit(withSkill:RunnerMotion,without:RunnerMotion,windows:{start:number;end:number}[],speedWithout:RunnerMotion|null=without,speedPotentialDistance:MotionBand|null=null):MotionBenefit {
  const distance=zero(),time=zero(),direct=zero(),carry=zero(),carryTime=zero(),blocked=zero();
  const baseline=new Map(without.samples.map(p=>[p.time,p]));
  const speedBaseline=speedWithout===without?baseline:speedWithout?new Map(speedWithout.samples.map(p=>[p.time,p])):null;
  let duration=0,assessed=0,tailOpen=false,carryoverComplete=true,any=false;
  const reasons=new Set<string>();
  for(let i=1;i<withSkill.samples.length;i++){
    const p=withSkill.samples[i-1],q=withSkill.samples[i],u=baseline.get(p.time),v=baseline.get(q.time),su=speedBaseline?.get(p.time),sv=speedBaseline?.get(q.time),dt=q.time-p.time;
    if(dt<=0)continue;
    const active=windows.some(w=>w.start<=p.time+1e-8&&w.end>p.time+1e-8);
    if(active){duration+=dt;tailOpen=true;}
    if(!tailOpen)continue;
    const unresolved=[p,q,u,v,su,sv].some(s=>s?.reasons.some(r=>r.startsWith('Skill ')));
    const valid=!unresolved&&p.constrained&&q.constrained&&u?.constrained&&v?.constrained&&q.intervalConstrained&&v.intervalConstrained&&q.intervalFree&&v.intervalFree&&(!speedBaseline||su?.constrained&&sv?.constrained&&sv.intervalConstrained);
    if(!valid){
      carryoverComplete=false;
      for(const reason of [...p.reasons,...q.reasons])reasons.add(reason);
      reasons.add('A missing interval prevents tracing the full speed advantage.');
      // Do not resurrect a tail after both paths re-anchor at a missing sample.
      if(!active)tailOpen=false;
      continue;
    }
    any=true;if(active)assessed+=dt;
    for(const c of channels){
      const full=q.intervalConstrained![c],base=v!.intervalConstrained![c],delta=full-base;
      const freeDelta=q.intervalFree![c]-v!.intervalFree![c];
      const gained=delta*dt;
      distance[c]+=gained;
      // Equivalent travel time for this fixed interval, not changed finish time.
      if(base>0)time[c]-=gained/base;
      blocked[c]+=Math.max(0,freeDelta-delta)*dt;
      const speedDelta=sv?.intervalConstrained?Math.max(0,full-sv.intervalConstrained[c]):0;
      let applied=0;
      if(active&&speedDelta>0&&p.targetActive&&su?.targetActive){
        const immediate=p.currentSpeedDelta-su.currentSpeedDelta;
        const self=full-p.currentSpeedDelta;
        const targetBonus=Math.max(0,p.targetActive[c]-su.targetActive[c]);
        applied=Math.max(0,immediate)+Math.max(0,Math.min(targetBonus,self-su.targetActive[c]));
      }
      // Interactions are allocated once: speed carryover is bounded by the
      // joint benefit; the remaining gain includes the acceleration head start.
      const retained=Math.max(0,Math.min(delta,speedDelta-applied))*dt;
      carry[c]+=retained;direct[c]+=gained-retained;
      if(base>0)carryTime[c]-=retained/base;
    }
    if(!active&&channels.every(c=>Math.abs(q.constrained![c]-v!.constrained![c])<1e-5))tailOpen=false;
  }
  const coverage=duration>0?Math.min(1,assessed/duration):0;
  // No arbitrary percentage for a zero denominator or incomplete advantage.
  const efficiency=coverage>=.999&&carryoverComplete&&speedPotentialDistance&&speedPotentialDistance.mid>.0001?Math.max(0,carry.mid)/speedPotentialDistance.mid:null;
  return {distance:any?envelope(distance):null,time:any?envelope(time):null,activeDistance:any?envelope(direct):null,
    carryoverDistance:any?envelope(carry):null,carryoverTime:any?envelope(carryTime):null,blockedDistance:any?envelope(blocked):null,
    speedPotentialDistance,duration,assessedDuration:assessed,coverage,carryoverComplete,carryoverEfficiency:efficiency,reasons:[...reasons]};
}
