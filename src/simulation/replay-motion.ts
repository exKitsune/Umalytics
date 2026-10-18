/** Local velocity comparisons. Field positions, HP, decisions and effect times
 * stay fixed. Nothing here predicts another race's finish or consumes RNG. */
import type {Race} from '../data/types';
import type {RaceAnalysis} from '../data/analytics';
import type {ReferenceData} from '../data/reference';
import {activationMotionKey,createRaceMotionEngine,type ReplayMotionEngine,type RaceMotionOptions,type RunnerMotion,type MotionSample,type MotionBand} from '../data/race-motion';
import {motionIndex as m,type DecisionTrace} from './trace';
import {motionLosses} from '../data/traffic-loss';
import {referenceDeceleration} from '../data/mechanics-model';
import {effectValue} from '../data/effect-value';

const exact=(v:number):MotionBand=>({min:v,mid:v,max:v});
const note='Local velocity comparison with the matched race’s positions, HP, statuses, targets and activation schedule held fixed. Distance is integrated movement difference; time is equivalent travel time, not a predicted finish-time change.';
export function createTraceMotionEngine(race:Race,reference:ReferenceData,analysis:RaceAnalysis,trace:DecisionTrace):ReplayMotionEngine {
  // This provider supplies only differences for stat/mode/healthy-HP formulas.
  // Full paths use the trace directly, without fitting a hidden state from speed.
  const formulas=createRaceMotionEngine(race,reference,race.courseId,analysis);
  const cache=new Map<string,RunnerMotion>();
  const course=reference.courses[race.courseId??-1]??null;
  const rows=new Map(race.runners.map(r=>[r.id,trace.motion.filter(v=>v[m.horse]===r.index)]));
  const basePhysics=new Map<string,ReturnType<typeof formulas.physics>>();
  const physics=(id:string,t:number)=>{const key=`${id}/${t}`;let value=basePhysics.get(key);if(!value){value=formulas.physics(id,t);basePhysics.set(key,value);}return value;};
  function build(options:RaceMotionOptions={}){
    const runners:Record<string,RunnerMotion>={};
    const excluded=new Set([...(options.excludeActivationKeys??[]),...(options.excludeActivationKey?[options.excludeActivationKey]:[])]);
    for(const runner of race.runners.filter(r=>!options.runnerId||r.id===options.runnerId)){
      const key=JSON.stringify([runner.id,[...excluded].sort(),options.excludeEffectTypes,options.excludeStatusKey]);
      const cached=cache.get(key);if(cached){runners[runner.id]=cached;continue;}
      const detail=analysis.runners[runner.id],ticks=rows.get(runner.id)!,stop=runner.finishTimeRaw??race.duration;
      const effects=race.runners.flatMap(source=>analysis.runners[source.id].skillActivations.flatMap(a=>
        (source.id===runner.id?a.effects.filter(e=>(e.targetType??1)===1):a.simulatedRecipients?.[runner.id]??[]).map(e=>({
          key:activationMotionKey(source.id,a),type:e.type,start:e.appliedStart??a.start,end:e.appliedEnd??a.effectiveEnd??a.start,
          value:effectValue(source,a.referenceSkillId??a.skillId,e),
        }))));
      const selected=effects.filter(e=>excluded.has(e.key)&&(!options.excludeEffectTypes||options.excludeEffectTypes.includes(e.type)));
      const complicated=selected.some(e=>![21,22,27,31].includes(e.type));
      const altered=selected.length>0||!!options.excludeStatusKey;
      const samples:MotionSample[]=[];let self=3,freeSelf=3,previousRaw=3,distance=0,timeLoss=0;
      for(let index=0;index<ticks.length;index++){
        const r=ticks[index],time=r[m.time];if(time>=stop)break;
        const dt=Math.min(r[m.dt],stop-time),active=selected.filter(e=>time>=e.start&&time<e.end);
        const sum=(type:number)=>active.filter(e=>e.type===type).reduce((n,e)=>n+(e.value??0),0);
        let target=r[m.target]-sum(27),acceleration=r[m.acceleration]-sum(31),current=r[m.skillSpeed]-r[m.selfSpeed]-sum(21)-sum(22);
        let healthyTarget=r[m.target],healthyAccel=r[m.acceleration];
        const reasons=active.some(e=>e.value===null)?['Skill effect magnitude unavailable.']:[];
        const useFormula=complicated||!!options.excludeStatusKey||r[m.hp]<=0;
        if(useFormula){
          const full=physics(runner.id,time);
          if(complicated||options.excludeStatusKey){
            const reduced=formulas.physics(runner.id,time,options);
            if(full.target&&reduced.target&&full.accel&&reduced.accel){
              target=r[m.target]+reduced.target.mid-full.target.mid;
              acceleration=r[m.acceleration]+reduced.accel.mid-full.accel.mid;
              current=r[m.skillSpeed]-r[m.selfSpeed]+reduced.current-full.current;
            }else reasons.push('Skill or mode comparison inputs are incomplete.');
          }
          if(r[m.hp]<=0){const healthy=formulas.physics(runner.id,time,{},true);
            if(full.target&&healthy.target)healthyTarget=r[m.target]+healthy.target.mid-full.target.mid;
            if(healthy.accel)healthyAccel=healthy.accel.mid;
          }
        }
        const minimum=r[m.minimum],cap=r[m.cap],dashLimit=.85*(20-((race.distance??2000)-2000)/1000);
        const dash=previousRaw<dashLimit-1e-4&&r[m.phase]===0&&r[m.acceleration]>20;
        const deceleration=r[m.hp]<=0?1.2:referenceDeceleration(r[m.position],race.distance??2000,r[m.paceMode]===4);
        const advance=(v:number,t:number,a:number)=>{
          if(dash)t=Math.min(t,dashLimit);
          return r[m.hp]<=0?(v<=t?v-1.2*dt:Math.max(t,v-1.2*dt)):
            v<t?Math.min(t,v+Math.max(0,a)*dt):Math.max(t,v-deceleration*dt);
        };
        // Carry the same recorded-step residual through both paths. This anchors
        // the no-removal path exactly, including native float/order details.
        const residual=r[m.unclamped]-advance(previousRaw,r[m.target],r[m.acceleration]);
        const expired=selected.filter(e=>e.type===22&&e.end>time-r[m.dt]+1e-7&&e.end<=time+1e-7).reduce((n,e)=>n+(e.value??0),0);
        self=altered?Math.max(minimum,Math.min(cap,advance(self,target,acceleration)+residual-expired)):r[m.selfSpeed];
        freeSelf=Math.max(minimum,Math.min(30,advance(freeSelf,target,acceleration)+residual-expired));
        const constrained=altered?Math.min(cap,Math.max(minimum,self+current)):r[m.speed];
        const free=Math.min(30,Math.max(minimum,freeSelf+current));
        previousRaw=r[m.selfSpeed];
        distance+=Math.max(0,free-constrained)*dt;timeLoss+=Math.max(0,free-constrained)/Math.max(.001,constrained)*dt;
        const prior=samples.at(-1);
        const positives=effects.filter(e=>e.type===27&&e.value!==null&&e.value>0&&time>=e.start&&time<e.end&&!excluded.has(e.key)).sort((a,b)=>a.start-b.start||a.key.localeCompare(b.key));
        const stack={baseline:exact(target-positives.reduce((n,e)=>n+e.value!,0)),floors:{} as Record<string,MotionBand>,ceilings:{} as Record<string,MotionBand>};
        let cumulative=stack.baseline.mid;
        for(let p=0;p<positives.length;){let q=p;while(q<positives.length&&positives[q].start===positives[p].start)q++;
          const floor=cumulative;cumulative+=positives.slice(p,q).reduce((n,e)=>n+e.value!,0);
          for(let j=p;j<q;j++){stack.floors[positives[j].key]=exact(floor);stack.ceilings[positives[j].key]=exact(cumulative);}p=q;}
        samples.push({time,distance:r[m.position],actual:r[m.speed],selfActual:r[m.selfSpeed],currentSpeedDelta:current,
          targetBase:exact(r[m.base]+r[m.section]),targetActive:exact(target),healthyTargetActive:exact(healthyTarget),healthyAccelerationRange:exact(healthyAccel),hpEmpty:r[m.hp]<=0,
          trafficTargetActive:exact(target),healthyTrafficTargetActive:exact(healthyTarget),free:exact(free),constrained:exact(constrained),
          acceleration,accelerationRange:exact(acceleration),blockCap:r[m.blocker]>=0?cap:null,
          constraint:{kind:r[m.blocker]>=0?'recorded-block':'none',cap:r[m.blocker]>=0?cap:null,runnerId:race.runners.find(h=>h.index===r[m.blocker])?.id??null,detail:'Matched movement tick.'},
          nearbySlowdown:r[m.nearFrontSeconds]>0||r[m.nearBehindSeconds]>0,blockingClamps:{self:r[m.selfLoss],final:r[m.finalLoss]},
          downhillTargetDelta:exact(r[m.downhill]?0.3+Math.abs(course?.slopes.find(s=>r[m.position]>=s.start&&r[m.position]<s.start+s.length)?.slopePercent??0)/10:0),
          pace:['normal','speed-up','overtake','pace-up','pace-down','extra-pace-up'][r[m.paceMode]]??'normal',startDash:dash,
          cumulativeDistance:exact(distance),cumulativeTime:exact(timeLoss),targetStack:stack,intervalTargetStack:prior?.targetStack??stack,
          intervalConstrained:prior?.constrained??exact(constrained),intervalFree:prior?.free??exact(free),evidence:'simulated',reasons,assumptions:altered?[note]:[]});
      }
      const last=samples.at(-1);if(last&&last.time<stop)samples.push({...last,time:stop,intervalConstrained:last.constrained,intervalFree:last.free,intervalTargetStack:last.targetStack});
      const losses=motionLosses(race,runner,samples,course,analysis);
      const initialStats=Object.fromEntries(Object.entries(detail.statBreakdown.stats).map(([k,s])=>[k,s.final==null?null:exact(s.final)])) as unknown as RunnerMotion['initialStats'];
      const value:RunnerMotion={samples,sections:[],coverage:{target:1,free:1,constrained:1,calibrated:1,assessedDuration:stop,duration:stop},
        distanceLoss:exact(distance),timeLoss:exact(timeLoss),assessedDistanceLoss:exact(distance),assessedTimeLoss:exact(timeLoss),...losses,
        observedTrafficDeficit:losses.trafficLoss.distanceLoss,observedTrafficTime:losses.trafficLoss.timeLoss,observedTrafficDuration:losses.trafficLoss.duration,
        observedTrafficAssessedDuration:losses.trafficLoss.assessedDuration,observedTrafficCoverage:losses.trafficLoss.coverage,initialStats,
        paceStarts:detail.intervals.filter(i=>/pace|overtake|speed-up/.test(i.kind)).map(i=>({time:i.start,kind:i.kind.replace(/-model$/,''),detail:i.detail})),detail:note};
      cache.set(key,value);runners[runner.id]=value;
    }
    return {runners,detail:note};
  }
  return {build,physics:formulas.physics,speedPotential:formulas.speedPotential};
}
