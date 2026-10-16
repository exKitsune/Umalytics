import type { Race, Runner } from './types';
import type { RaceAnalysis, RunnerAnalysis } from './analytics';
import type { CourseReference } from './reference';
import type { SlowdownAnalysis, SlowdownInterval } from './effect-types';
import { mechanicsContext } from './mechanics-model';
import { atTime, stopTime, trace } from './effect-sampling';
import { effectiveStrategyCode } from './skill-details';
import { advanceSelf, advanceSelfArea, frontBlockCapAt, referenceMotionAt, movementAt } from './movement-context';

export function slowdownFor(race:Race,runner:Runner,course:CourseReference|null,analysis:RaceAnalysis):Record<'blocking'|'exhaustion',SlowdownAnalysis> {
  const detail=analysis.runners[runner.id],ctx=mechanicsContext(race,runner,course,detail.statBreakdown,effectiveStrategyCode(runner,detail.skillRows));
  const model=(kind:'blocking'|'exhaustion'):SlowdownAnalysis=>{
    let unobserved=false;const intervals:SlowdownInterval[]=[],reasons=new Set<string>();let duration=0,assessed=0,lossLow=0,lossHigh=0,timeLow=0,timeHigh=0,freeLow:number|null=null,freeHigh:number|null=null,priorEnd:number|null=null;
    const stop=stopTime(race,runner.id),retained=trace(race,runner.id);unobserved=retained.length<2||retained[0].time>0||retained.at(-1)!.time<stop-1e-5;if(unobserved)reasons.add('The retained history does not cover the whole race.');let current:SlowdownInterval|null=null;
    for(let i=1;i<race.frames.length;i++){
      const first=race.frames[i-1],last=race.frames[i],start=first.time,end=Math.min(last.time,stop);if(end<=start)continue;
      const a=first.runners.find(s=>s.runnerId===runner.id),b=last.runners.find(s=>s.runnerId===runner.id);
      if(kind==='blocking'?(a?.blockFrontRunnerIndex==null||b?.blockFrontRunnerIndex==null):(a?.hp==null||b?.hp==null)){unobserved=true;reasons.add(kind==='blocking'?'Part of the front-block history is missing.':'Part of the HP history is missing.');}
      // Keep the sampled exit bracket in the reported block window, matching
      // telemetry. Its unknown transition is unassessed, not silently dropped
      // from the coverage denominator to make a partial loss look complete.
      const on=kind==='blocking'?a?.blockFrontRunnerIndex!=null&&a.blockFrontRunnerIndex>=0:a?.hp!=null&&a.hp<=0&&b?.hp!=null&&b.hp<=0;
      if(!on){freeLow=freeHigh=null;priorEnd=null;current=null;continue;}
      duration+=end-start;
      if(!current||priorEnd!==start){current={start,end,duration:end-start,assessedDuration:0,distanceLossMin:0,distanceLossMax:0,timeLossMin:0,timeLossMax:0,detail:''};intervals.push(current);freeLow=freeHigh=null;}else{current.end=end;current.duration+=end-start;}priorEnd=end;
      for(let time=start;time<end-1e-6;){const next=Math.min(end,time+1/15),dt=next-time,mid=(time+next)/2,p=atTime(race,runner.id,time),q=atTime(race,runner.id,next);time=next;
        if(!ctx||!p||!q||p.speed===null||q.speed===null||p.distance===null||q.distance===null){reasons.add('Reference stats or recorded speed are unavailable.');freeLow=freeHigh=null;continue;}
        const mods=movementAt(race,analysis,runner,mid);if(mods.unknown){reasons.add('An overlapping movement effect is unresolved.');freeLow=freeHigh=null;continue;}
        const self=Math.max(0,p.speed-mods.current),after=Math.max(0,q.speed-mods.current),motion=referenceMotionAt(ctx,analysis,mid,p.distance,self),block=frontBlockCapAt(race,runner,mid);
        if(!motion){reasons.add('The reference target or position-keeping state is unresolved.');freeLow=freeHigh=null;continue;}
        if(p.blockFrontRunnerIndex==null||q.blockFrontRunnerIndex==null||block.blocked&&block.cap===null){reasons.add(block.detail);freeLow=freeHigh=null;continue;}
        if(kind==='blocking'&&(p.hp===null||q.hp===null||p.hp<=0||q.hp<=0)){reasons.add('Exhaustion overlaps the recorded block.');freeLow=freeHigh=null;continue;}
        if(kind==='exhaustion'&&after<Math.min(motion.minimum,block.cap??motion.minimum)-.15){reasons.add('Recorded speed does not resolve the exhaustion floor.');freeLow=freeHigh=null;continue;}
        freeLow??=self;freeHigh??=self;
        const beforeLow=freeLow,beforeHigh=freeHigh;
        const areaLow=advanceSelfArea(freeLow,motion.min,motion.accel,dt,p.distance,ctx.course.distance),areaHigh=advanceSelfArea(freeHigh,motion.max,motion.accel,dt,p.distance,ctx.course.distance);
        freeLow=advanceSelf(freeLow,motion.min,motion.accel,dt,p.distance,ctx.course.distance);freeHigh=advanceSelf(freeHigh,motion.max,motion.accel,dt,p.distance,ctx.course.distance);
        // Hold recorded blocking fixed when isolating exhaustion. Removing the
        // block compares the free trajectory instead; escape/lane changes are
        // outside this local counterfactual.
        if(kind==='exhaustion'&&block.cap!==null){freeLow=Math.min(freeLow,block.cap);freeHigh=Math.min(freeHigh,block.cap);}
        if(kind==='blocking'&&block.cap!==null&&(after>block.cap+.15||freeHigh>block.cap+.02&&after<block.cap-.25)){reasons.add('Blocker geometry does not explain the recorded velocity.');freeLow=freeHigh=null;continue;}
        const actual=(self+after)/2,low=Math.max(0,(kind==='blocking'?areaLow.travel/dt:(beforeLow+freeLow)/2)-actual),high=Math.max(low,(kind==='blocking'?areaHigh.travel/dt:(beforeHigh+freeHigh)/2)-actual);
        const actualTravel=actual+mods.current,tLow=actualTravel+low>0?low/(actualTravel+low)*dt:0,tHigh=actualTravel+high>0?high/(actualTravel+high)*dt:0;
        lossLow+=low*dt;lossHigh+=high*dt;timeLow+=tLow;timeHigh+=tHigh;assessed+=dt;current.assessedDuration+=dt;
        current.distanceLossMin!+=low*dt;current.distanceLossMax!+=high*dt;current.timeLossMin!+=tLow;current.timeLossMax!+=tHigh;
      }
    }
    const complete=!unobserved&&Math.abs(duration-assessed)<1e-4;
    for(const interval of intervals){if(interval.assessedDuration===0){interval.distanceLossMin=interval.distanceLossMax=interval.timeLossMin=interval.timeLossMax=null;}interval.detail=`${kind} local target scenarios; assessed ${interval.assessedDuration.toFixed(2)} of ${interval.duration.toFixed(2)} seconds.`;}
    return {duration,assessedDuration:assessed,coverageRate:duration>0?assessed/duration:unobserved?null:1,distanceLoss:complete&&Math.abs(lossHigh-lossLow)<1e-4?lossLow:null,
      distanceLossMin:complete?lossLow:null,distanceLossMax:complete?lossHigh:null,assessedDistanceLossMin:assessed>0?lossLow:duration===0?0:null,assessedDistanceLossMax:assessed>0?lossHigh:duration===0?0:null,timeLossMin:complete?timeLow:null,timeLossMax:complete?timeHigh:null,intervals,unavailableReasons:[...reasons],
      detail:kind==='blocking'?'Local reference comparison removes only the recorded front-speed cap, anchoring at each supported block-window entry. Blocker movement, phase/grade schedule and resolved skills stay fixed. Loss is conditional missed travel while constrained, not a reconstructed finish-time loss; unknown blocker geometry stays unassessed. Skill-specific foregone gains are subsets, not extra amounts to add.':'Local reference comparison keeps the same recorded block and skill context while replacing HP-zero deceleration/minimum target with healthy lower/upper reference targets. It starts at the retained zero-HP window, excludes earlier unobserved loss, and does not reconstruct hidden spurt selection or finish time. Blocking and exhaustion models overlap and must not be added as independent race losses.'};
  };
  return {blocking:model('blocking'),exhaustion:model('exhaustion')};
}
export const emptySlowdown=():SlowdownAnalysis=>({duration:0,assessedDuration:0,coverageRate:null,distanceLoss:null,distanceLossMin:null,distanceLossMax:null,assessedDistanceLossMin:null,assessedDistanceLossMax:null,timeLossMin:null,timeLossMax:null,intervals:[],unavailableReasons:['Reference slowdown analysis unavailable.'],detail:'Reference slowdown analysis unavailable.'});
