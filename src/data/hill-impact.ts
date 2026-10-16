import type { Race, Runner } from './types';
import type { RunnerAnalysis, RaceAnalysis } from './analytics';
import type { CourseReference } from './reference';
import type { ContributionTotal, HillImpact } from './effect-types';
import { atTime, crossing, observedWindow, stopTime } from './effect-sampling';
import { mechanicsContext, hpReference } from './mechanics-model';
import { effectiveStrategyCode } from './skill-details';
import { selfSpeedAt, statusHpFactor } from './mechanics-effects';

/** Uphill target penalty is a reference steady-speed equivalent. It is not an
 * observed split of travel time from acceleration, blocking or active skills. */
export function hillImpactsFor(race:Race,runner:Runner,course:CourseReference|null,detail:RunnerAnalysis,analysis:RaceAnalysis):HillImpact[] {
  if(!course||course.distance!==race.distance)return [];
  const power=detail.statBreakdown.stats.power.final,ctx=mechanicsContext(race,runner,course,detail.statBreakdown,effectiveStrategyCode(runner,detail.skillRows));
  return course.slopes.filter(s=>s.slopePercent!==0&&s.start<course.distance).map(slope=>{
    const distanceEnd=Math.min(course.distance,slope.start+slope.length),start=crossing(race,runner.id,slope.start),crossEnd=crossing(race,runner.id,distanceEnd),end=crossEnd===null?null:Math.min(stopTime(race,runner.id),crossEnd);
    const duration=start!==null&&end!==null&&end>=start?end-start:null,up=slope.slopePercent>0;
    const penalty=power!==null?Math.abs(slope.slopePercent)*200/power:null,mitigation=power!==null&&up?Math.abs(slope.slopePercent)*200*(1/1000-1/power):null;
    let assessed=0,distanceDelta=0,timeDelta=0,hpDelta=0,hpSeconds=0,powerTime=0,powerSeconds=0,modeDuration=0;
    if(start!==null&&end!==null)for(let time=start;time<end-1e-6;){const finish=Math.min(end,time+1/15),dt=finish-time,mid=(time+finish)/2,p=atTime(race,runner.id,mid);time=finish;
      if(!p||p.speed===null||p.distance===null||p.speed<=0)continue;
      if(up){if(penalty===null)continue;assessed+=dt;distanceDelta-=penalty*dt;timeDelta+=penalty/(p.speed+penalty)*dt;
        if(mitigation!==null&&p.speed-mitigation>0){powerTime+=(1-p.speed/(p.speed-mitigation))*dt;powerSeconds+=dt;}
      }else{
        const mode=detail.intervals.find(i=>i.kind==='downhill-mode-model'&&mid>=i.start&&mid<(i.end??i.start));if(!mode)continue;
        const bonus=mode.model?.speedDelta;if(bonus==null||p.speed-bonus<=0)continue;
        assessed+=dt;modeDuration+=dt;distanceDelta+=bonus*dt;timeDelta-=bonus/(p.speed-bonus)*dt;
        if(ctx){const self=selfSpeedAt(race,analysis,runner.id,mid,p.speed);if(self!==null&&p.hp!==null&&p.hp>0){const full=hpReference(ctx,self,p.distance),without=hpReference(ctx,Math.max(0,self-bonus),p.distance);if(full!==null&&without!==null){const factor=statusHpFactor(detail.intervals,mid,ctx.style,'downhill-mode');hpDelta+=(full*.4-without)*factor*dt;hpSeconds+=dt;}}}
      }
    }
    const observed=start!==null&&end!==null?observedWindow(race,runner.id,start,end):{observedDistance:null,observedHpConsumed:null,observedHpRecovered:null};
    const modelDistance=assessed>0?distanceDelta:null,modelTime=assessed>0?timeDelta:null,modelHp=!up&&assessed>0&&Math.abs(hpSeconds-assessed)<1e-4?hpDelta:null;
    return {kind:up?'uphill':'downhill',start,end,distanceStart:slope.start,distanceEnd,slopePercent:slope.slopePercent,duration,assessedDuration:assessed,
      evidence:assessed>0?'estimated':'unknown',modeledSpeedDelta:up&&penalty!==null?-penalty:!up&&modeDuration>0?0.3+Math.abs(slope.slopePercent)/10:null,
      powerMitigationSpeed:mitigation,powerReference:1000,powerTimeDelta:duration!==null&&Math.abs(powerSeconds-duration)<1e-4?powerTime:null,
      modeDuration:up?null:modeDuration,modeledHpSaved:modelHp===null?null:-modelHp,...observed,modeledDistanceDelta:modelDistance,modeledTimeDelta:modelTime,modeledHpDelta:modelHp,
      detail:up?`Reference uphill target-speed penalty = grade ×200 / final power. Distance/time are a steady-target equivalent at retained observed speed, not measured hill-caused loss; acceleration, speed caps and blocking can reduce or change realization. Power comparison is against1000 final power, all other sampled conditions fixed. Negative powerTimeDelta means the actual-power model is faster. ${duration===null?'Slope crossing coverage is incomplete.':''}`
        :`Reference downhill-mode target bonus0.3+abs(grade)/10 and HP factor0.4, only over identified modeled downhill-mode windows (${modeDuration.toFixed(2)} s of ${duration?.toFixed(2)??'?'} s). Unidentified parts remain unassessed; absence of a model candidate is not proof that downhill mode was off. HP savings compare the reference curve at retained speed against speed without this bonus; not observed causal savings. Resolved current-speed modifiers are removed for the self-speed HP curve; known compound status factors are held fixed. Unknown scaling/timing withholds HP; interactions remain a conditional model.`} satisfies HillImpact;
  });
}
export function hillTotals(values:HillImpact[]):Record<'uphill'|'downhill',ContributionTotal>{
  const total=(kind:'uphill'|'downhill'):ContributionTotal=>{const rows=values.filter(v=>v.kind===kind),complete=rows.every(v=>v.duration!==null&&Math.abs(v.assessedDuration-v.duration)<1e-4),overlap=rows.some((v,i)=>v.start!==null&&rows.slice(0,i).some(p=>p.end!==null&&p.end>v.start!));
    const sum=(key:'observedDistance'|'observedHpConsumed'|'observedHpRecovered'|'modeledDistanceDelta'|'modeledTimeDelta'|'modeledHpDelta',modeled=false)=>!overlap&&(!modeled||complete)&&rows.every(v=>v[key]!==null)?rows.reduce((n,v)=>n+v[key]!,0):null;
    return {intervals:rows.length,duration:rows.reduce((n,v)=>n+(v.duration??0),0),assessedDuration:rows.reduce((n,v)=>n+v.assessedDuration,0),observedDistance:sum('observedDistance'),observedHpConsumed:sum('observedHpConsumed'),observedHpRecovered:sum('observedHpRecovered'),modeledDistanceDelta:sum('modeledDistanceDelta',true),modeledTimeDelta:sum('modeledTimeDelta',true),modeledHpDelta:sum('modeledHpDelta',true),detail:`${kind} reference contributions. Totals require complete nonoverlapping slope/window coverage; otherwise they stay unknown. Per-slope entries can expose assessed subsets. ${rows.map(v=>v.detail).filter((d,i,a)=>a.indexOf(d)===i).join(' ')}`};};
  return {uphill:total('uphill'),downhill:total('downhill')};
}
