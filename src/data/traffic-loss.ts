import type {Race,Runner} from './types';
import type {RaceAnalysis} from './analytics';
import type {CourseReference} from './reference';
import type {MotionBand,MotionSample} from './race-motion';
import {atTime,trace,stopTime} from './effect-sampling';
import {runningHpRange} from './hp-timeline';
import {referenceDeceleration} from './mechanics-model';

export interface MotionLossEpisode {
  start:number;end:number;anchorStart:number;anchorEnd:number;duration:number;assessedDuration:number;
  onsetMin?:number;onsetMax?:number;distanceLoss:MotionBand|null;timeLoss:MotionBand|null;detail:string;
}
export interface MotionLossSummary {duration:number;assessedDuration:number;coverage:number|null;distanceLoss:MotionBand|null;timeLoss:MotionBand|null;episodes:MotionLossEpisode[];detail:string;}
/** Optional diagnostic sink; segments are emitted by the production integrator
 * and never retained in cached motion results. Each segment is linear, including
 * a split at fractional arrival at the reference target. */
export interface MotionLossSegment {
  kind:'traffic'|'exhaustion';channel:keyof MotionBand;episodeStart:number;episodeEnd:number;
  start:number;end:number;actualStart:number;actualEnd:number;referenceStart:number;referenceEnd:number;
  target:number;distanceLoss:number;timeLoss:number;
}
export interface MotionLossDiagnostics { onSegment:(segment:MotionLossSegment)=>void }
const channels=['min','mid','max']as const,zero=():MotionBand=>({min:0,mid:0,max:0});
const exhaustionWindowCache=new WeakMap<RaceAnalysis,Map<string,{start:number;end:number;anchorStart:number;anchorEnd:number;onsetMin?:number;onsetMax?:number}[]>>();
const envelope=(b:MotionBand):MotionBand=>({min:Math.min(b.min,b.mid,b.max),mid:b.mid,max:Math.max(b.min,b.mid,b.max)});
const positiveLinearArea=(a:number,b:number,dt:number)=>a>=0&&b>=0?(a+b)*dt/2:a<=0&&b<=0?0:Math.max(a,b)**2*dt/(2*Math.abs(b-a));
function sampleAt(samples:MotionSample[],time:number){let lo=0,hi=samples.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(samples[mid].time<=time)lo=mid;else hi=mid-1;}return samples[lo];}
function pointAt(samples:MotionSample[],time:number){const p=sampleAt(samples,time),i=samples.indexOf(p),q=samples[i+1];if(p.time===time||!q)return p;const f=(time-p.time)/(q.time-p.time),lerp=(a:number|null,b:number|null)=>a===null||b===null?null:a+(b-a)*f;return{...p,time,actual:lerp(p.actual,q.actual),selfActual:lerp(p.selfActual,q.selfActual)};}

/** Traffic removal/healthy-HP paths are anchored at observed episode entry.
 * Recorded phase/grade, skill schedule and other runners remain fixed. */
export function motionLosses(race:Race,runner:Runner,samples:MotionSample[],course:CourseReference|null,analysis:RaceAnalysis,diagnostics?:MotionLossDiagnostics):{trafficLoss:MotionLossSummary;exhaustionLoss:MotionLossSummary}{
  const rows=trace(race,runner.id),stop=stopTime(race,runner.id),at=(t:number)=>pointAt(samples,t),windows:{start:number;end:number}[]=[];
  const contextTarget=(s:MotionSample)=>s.trafficTargetActive===undefined?s.targetActive:s.trafficTargetActive;
  function addWindow(start:number,end:number){if(end>start)windows.push({start,end});}
  // The sample-held recorded duration is retained as an anchor even when a
  // transition between two retained frames has no exact flag at interpolated t.
  for(let i=1;i<rows.length;i++){const p=rows[i-1],q=rows[i];if(p.time>=stop)break;if(p.sample.blockFrontRunnerIndex!=null&&p.sample.blockFrontRunnerIndex>=0)addWindow(p.time,Math.min(stop,q.time));}
  for(let i=1;i<samples.length;i++)if(samples[i-1].constraint.kind==='geometry-block')addWindow(samples[i-1].time,Math.min(stop,samples[i].time));
  // Near is a conditional anchor only while the complete context target is
  // actually suppressed. A target gap alone never establishes traffic.
  const nearby=analysis.runners[runner.id].intervals.filter(i=>i.kind==='near-slowdown');
  for(let i=1;i<samples.length;i++){const p=samples[i-1],q=samples[i],target=contextTarget(p);
    if(p.actual!==null&&target&&p.hpEmpty===false&&p.startDash!==true&&target.mid+p.currentSpeedDelta-p.actual>.15+1e-9
      &&nearby.some(w=>p.time>=w.start&&p.time<(w.end??w.observedUntil??w.start)))addWindow(p.time,Math.min(stop,q.time));}
  windows.sort((a,b)=>a.start-b.start);const anchors:{start:number;end:number}[]=[];for(const w of windows){const prev=anchors.at(-1);if(prev&&w.start<=prev.end+1e-6)prev.end=Math.max(prev.end,w.end);else anchors.push({...w});}
  const residual=(time:number)=>{const s=at(time),target=contextTarget(s);return s.selfActual!==null&&target?target.max-s.selfActual:null;};
  const extended=anchors.map(w=>{
    let start=w.start,end=w.end,j=rows.findIndex(r=>r.time>=start);
    while(j>0){const p=rows[j-1],q=rows[j],dt=q.time-p.time,a=at(p.time),b=at(q.time);
      if(dt>2||p.sample.speed==null||q.sample.speed==null||p.sample.hp==null||q.sample.hp==null||p.sample.hp<=0||q.sample.hp<=0||!contextTarget(a)||!contextTarget(b)||a.selfActual===null||b.selfActual===null)break;
      // A rising approach is not retrospectively called blocked. Extend only
      // the contiguous braking/flat approach that has a positive ideal residual.
      if(q.sample.speed>p.sample.speed+.03||(residual(q.time)??0)<=.03||Math.abs(a.currentSpeedDelta-b.currentSpeedDelta)>.00001)break;
      if(contextTarget(b)!.max<contextTarget(a)!.min-.05&&q.sample.speed>=contextTarget(b)!.max-.03)break;
      if(p.sample.speed-q.sample.speed>.02)start=p.time;j--;}
    let k=rows.findIndex(r=>r.time>=end);if(k<0)k=rows.length-1;
    while(k+1<rows.length&&rows[k].time<stop){const p=rows[k],q=rows[k+1],dt=q.time-p.time,a=at(p.time),b=at(Math.min(stop,q.time));
      if(dt>2||p.sample.speed==null||q.sample.speed==null||p.sample.hp==null||q.sample.hp==null||p.sample.hp<=0||q.sample.hp<=0||!contextTarget(a)||!contextTarget(b)||a.selfActual===null||b.selfActual===null)break;
      if(q.sample.speed<=p.sample.speed+1e-6||(residual(p.time)??0)<=0||Math.abs(a.currentSpeedDelta-b.currentSpeedDelta)>.00001)break;
      // A changing grade, phase or mode exit can lower the ceiling during a
      // real recovery. Integrate that lower goal rather than dropping the tail.
      end=Math.min(stop,q.time);k++;if((residual(end)??0)<=0)break;}
    return{start,end,anchorStart:w.start,anchorEnd:w.end};
  });
  const merged:typeof extended=[];for(const w of extended){const prev=merged.at(-1);if(prev&&w.start<=prev.end+1e-6){prev.end=Math.max(prev.end,w.end);prev.anchorEnd=Math.max(prev.anchorEnd,w.anchorEnd);}else merged.push({...w});}

  function integrate(window:{start:number;end:number;anchorStart:number;anchorEnd:number;onsetMin?:number;onsetMax?:number},healthy:boolean):MotionLossEpisode{
    const loss=zero(),times=zero(),velocities:{min:number|null;mid:number|null;max:number|null}={min:null,mid:null,max:null};let assessed=0;
    const points=[window.start,...samples.filter(s=>s.time>window.start&&s.time<window.end).map(s=>s.time),window.end];
    for(let i=1;i<points.length;i++){
      const start=points[i-1],end=points[i],dt=end-start,p=at(start),q=at(end),mid=at((start+end)/2),raw=atTime(race,runner.id,(start+end)/2),target=healthy?(mid.healthyTrafficTargetActive===undefined?mid.healthyTargetActive:mid.healthyTrafficTargetActive):contextTarget(mid),accel=healthy?mid.healthyAccelerationRange:mid.accelerationRange;
      const retained=rows.findIndex(r=>r.time>=end),gap=retained>0?rows[retained].time-rows[retained-1].time:0;
      const cap=healthy&&mid.constraint.kind!=='none'?mid.constraint.cap:null;
      if(dt<=0||gap>2||p.actual===null||q.actual===null||p.selfActual===null||q.selfActual===null||!target||!accel||!raw||raw.distance===null||!healthy&&(p.hpEmpty!==false||q.hpEmpty!==false)||healthy&&(mid.constraint.kind==='unknown'||mid.constraint.kind!=='none'&&cap===null)||Math.abs(p.currentSpeedDelta-q.currentSpeedDelta)>.00001){for(const c of channels)velocities[c]=null;continue;}
      let valid=true;const stepLoss=zero(),stepTime=zero(),segments:MotionLossSegment[]=[];
      for(const c of channels){
        const onset=healthy&&window.onsetMin!==undefined?(c==='max'?window.onsetMin:c==='min'?window.onsetMax!:(window.onsetMin+window.onsetMax!)/2):window.start;
        if(end<=onset+1e-9)continue;
        const t0=Math.max(start,onset),span=end-t0,f=(t0-start)/dt,actualStart=p.actual+(q.actual-p.actual)*f,selfStart=p.selfActual+(q.selfActual-p.selfActual)*f;
        let velocity=velocities[c]??selfStart;
        if(cap!==null&&selfStart>cap+.15){velocities[c]=null;valid=false;continue;}
        if(cap!==null)velocity=Math.min(velocity,cap);
        const goal=cap===null?target[c]:Math.min(target[c],cap),force=velocity<goal?Math.max(0,accel[c]):-referenceDeceleration(raw.distance??Infinity,race.distance,mid.pace==='pace-down');
        const hit=force===0?Infinity:(goal-velocity)/force,cut=hit>0&&hit<span?hit:span,next=force===0?velocity:velocity<goal?Math.min(goal,velocity+force*cut):Math.max(goal,velocity+force*cut),actualCut=actualStart+(q.actual-actualStart)*cut/span,direct=p.currentSpeedDelta;
        const area=positiveLinearArea(velocity+direct-actualStart,next+direct-actualCut,cut)+positiveLinearArea(next+direct-actualCut,next+direct-q.actual,span-cut);
        const travel=(velocity+next)*cut/2+next*(span-cut)+direct*span,mean=travel/span;
        if(diagnostics){
          const emit=(begin:number,finish:number,a:number,b:number,x:number,y:number)=>{if(finish<=begin)return;const distanceLoss=positiveLinearArea(x-a,y-b,finish-begin);segments.push({kind:healthy?'exhaustion':'traffic',channel:c,episodeStart:window.start,episodeEnd:window.end,start:begin,end:finish,actualStart:a,actualEnd:b,referenceStart:x,referenceEnd:y,target:goal+direct,distanceLoss,timeLoss:mean>0?distanceLoss/mean:0});};
          emit(t0,t0+cut,actualStart,actualCut,velocity+direct,next+direct);
          emit(t0+cut,end,actualCut,q.actual,next+direct,next+direct);
        }
        stepLoss[c]=area;stepTime[c]=mean>0?area/mean:0;velocities[c]=next;
      }
      if(valid){assessed+=dt;for(const c of channels){loss[c]+=stepLoss[c];times[c]+=stepTime[c];}for(const segment of segments)diagnostics?.onSegment(segment);}else for(const c of channels)velocities[c]=null;
    }
    return{...window,duration:window.end-window.start,assessedDuration:assessed,distanceLoss:assessed>0?envelope(loss):null,timeLoss:assessed>0?envelope(times):null,
      detail:healthy?'Healthy-HP reference from the bounded zero crossing, holding recorded traffic/skills fixed. This equivalent travel-time loss is not a finish-time prediction.':'Locally anchored traffic-associated shortfall through approach braking and regain, including conditional nearby holds. Inferred modes, timed effects and grades stay fixed; acceleration and natural deceleration limit the comparison. This is conditional reference loss, not proved causal loss or a finish-time prediction.'};
  }
  const traffic=merged.map(w=>integrate(w,false));
  let cachedWindows=exhaustionWindowCache.get(analysis);if(!cachedWindows)exhaustionWindowCache.set(analysis,cachedWindows=new Map());const cacheKey=`${runner.id}:${course?.id??''}`;
  const zeroWindows:{start:number;end:number;anchorStart:number;anchorEnd:number;onsetMin?:number;onsetMax?:number}[]=cachedWindows.get(cacheKey)?.map(w=>({...w}))??[];
  if(!cachedWindows.has(cacheKey)){
  for(let i=0;i<rows.length;i++){
    const row=rows[i];if(row.time>=stop||row.sample.hp==null||row.sample.hp>0)continue;
    const prior=zeroWindows.at(-1);if(prior&&prior.end>=row.time-1e-6){prior.end=Math.min(stop,rows[i+1]?.time??stop);prior.anchorEnd=prior.end;continue;}
    let start=row.time,onsetMin:number|undefined,onsetMax:number|undefined;
    const before=rows[i-1];if(course&&before?.sample.hp!=null&&before.sample.hp>0&&row.time-before.time<=2){
      const hpEvents=Object.values(analysis.runners).flatMap(r=>r.skillActivations).some(a=>a.start>before.time&&a.start<=row.time&&(!a.effects.length||a.effects.some(e=>e.type===9)));
      const full=!hpEvents?runningHpRange(race,runner.id,before.time,row.time,{analysis,course}):null;
      if(full&&full.max>=before.sample.hp-1){
        const solve=(channel:'min'|'max',amount:number)=>{let lo=before.time,hi=row.time;for(let n=0;n<30;n++){const mid=(lo+hi)/2,r=runningHpRange(race,runner.id,before.time,mid,{analysis,course});if(!r)return row.time;if(r[channel]<amount)lo=mid;else hi=mid;}return(lo+hi)/2;};
        onsetMin=solve('max',Math.max(0,before.sample.hp-1));onsetMax=full.min>=before.sample.hp+1?solve('min',before.sample.hp+1):row.time;start=onsetMin;
      }
    }
    zeroWindows.push({start,end:Math.min(stop,rows[i+1]?.time??stop),anchorStart:row.time,anchorEnd:Math.min(stop,rows[i+1]?.time??stop),...(onsetMin===undefined?{}:{onsetMin,onsetMax})});
  }
  cachedWindows.set(cacheKey,zeroWindows.map(w=>({...w})));
  }
  for(const w of zeroWindows){let i=rows.findIndex(r=>r.time>=w.end);if(i<0)continue;
    while(i+1<rows.length&&rows[i].time<stop){const p=rows[i],q=rows[i+1],a=at(p.time),b=at(Math.min(stop,q.time));
      if(q.time-p.time>2||p.sample.hp==null||q.sample.hp==null||p.sample.hp<=0||q.sample.hp<=0||p.sample.speed==null||q.sample.speed==null||q.sample.speed<=p.sample.speed+.02||!a.healthyTargetActive||!b.healthyTargetActive||a.selfActual===null||b.selfActual===null||a.healthyTargetActive.max-a.selfActual<=.03||Math.abs(a.currentSpeedDelta-b.currentSpeedDelta)>.00001||b.healthyTargetActive.max<a.healthyTargetActive.min-.05)break;
      w.end=Math.min(stop,q.time);i++;if(b.healthyTargetActive.max-b.selfActual<=.03)break;
    }
  }
  const exhaustion=zeroWindows.map(w=>integrate(w,true));
  function summarize(episodes:MotionLossEpisode[],healthy:boolean):MotionLossSummary{
    const duration=episodes.reduce((n,e)=>n+e.duration,0),assessedDuration=episodes.reduce((n,e)=>n+e.assessedDuration,0),distance=zero(),time=zero();for(const e of episodes)for(const c of channels){distance[c]+=e.distanceLoss?.[c]??0;time[c]+=e.timeLoss?.[c]??0;}
    const known=rows.length>1&&rows[0].time===0&&rows.at(-1)!.time>=stop&&rows.every(r=>healthy?r.sample.hp!=null:r.sample.blockFrontRunnerIndex!=null);
    return{duration,assessedDuration,coverage:duration>0?Math.min(1,assessedDuration/duration):known?1:null,distanceLoss:assessedDuration>0||duration===0&&known?envelope(distance):null,timeLoss:assessedDuration>0||duration===0&&known?envelope(time):null,episodes,
      detail:healthy?'Local healthy-HP comparison to finish; onset can use normal running-drain bounds in a valid positive-to-zero bracket. No post-finish loss or invented recovery is counted.':'Local traffic reference retains inferred modes and integrates reachable velocity through approach and recovery around recorded, collision or qualifying nearby holds. Raw blocked duration is separate. Conditional scenarios and partial coverage are not exact causal attribution.'};
  }
  return{trafficLoss:summarize(traffic,false),exhaustionLoss:summarize(exhaustion,true)};
}
