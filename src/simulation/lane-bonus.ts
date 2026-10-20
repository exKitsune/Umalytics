import type {Race,Runner} from '../data/types';
import type {SkillActivation,StatusInterval} from '../data/analytics';
import {effectValue} from '../data/effect-value';
import {skillName,type ReferenceData} from '../data/reference';
import {motionIndex as m} from './trace';

/** The target-speed calculation reads the PREVIOUS tick's voluntary move.
 * Motion rows precede overlap correction; frame lanes follow that correction. */
export function previousLaneMoves(race:Race,runnerId:string,rows:readonly number[][]):(boolean|null)[]{
  const beforeFrame=new Map(race.frames.slice(1).map((frame,i)=>[frame.time,race.frames[i]]));
  return rows.map((row,i)=>{
    const previous=rows[i-1];if(!previous)return false;
    const before=beforeFrame.get(previous[m.time]),start=before?.runners.find(s=>s.runnerId===runnerId)?.lane;
    if(start==null||Math.abs(previous[m.time]-before!.time-previous[m.dt])>1e-4
      ||Math.abs(row[m.time]-previous[m.time]-row[m.dt])>1e-4)return null;
    return Math.fround(previous[m.lane])!==Math.fround(start);
  });
}
export function laneTargetBonus(power:number):number{
  return Math.fround(Math.sqrt(Math.fround(Math.fround(Math.min(2000,Math.max(1,power)))*Math.fround(.0002))));
}
export interface LaneBonusTick {start:number;end:number;active:boolean|null;bonus:number|null;skillIds:number[]}
export function traceLaneBonus(race:Race,runner:Runner,rows:number[][],activations:SkillActivation[],power:number|null):LaneBonusTick[]{
  const moves=previousLaneMoves(race,runner.id,rows),stop=runner.finishTimeRaw??race.duration;
  const effects=activations.flatMap(a=>a.effects.filter(e=>(e.targetType??1)===1).map(e=>({
    type:e.type,skillId:a.skillId,start:e.appliedStart??a.start,end:e.appliedEnd??a.effectiveEnd??a.start,
    value:effectValue(runner,a.referenceSkillId??a.skillId,e),
  })));
  return rows.map((row,i)=>{
    const start=row[m.time],end=Math.min(stop,rows[i+1]?.[m.time]??start+row[m.dt]);
    const live=effects.filter(e=>start>=e.start&&start<e.end),skillIds=[...new Set(live.filter(e=>e.type===28).map(e=>e.skillId))];
    const active=row[m.hp]>0&&skillIds.length>0?moves[i]:false;
    const added=live.filter(e=>e.type===3&&e.start>0);
    const bonus=active===false?0:active===null||power===null||added.some(e=>e.value===null)?null:
      laneTargetBonus(power+added.reduce((sum,e)=>sum+e.value!,0));
    return {start,end,active,bonus,skillIds};
  });
}
export function laneBonusStatuses(ticks:LaneBonusTick[],reference:ReferenceData|null):StatusInterval[]{
  const intervals:StatusInterval[]=[];
  for(const tick of ticks){
    if(!tick.active||tick.end<=tick.start)continue;
    const detail=`${tick.skillIds.map(id=>skillName(reference,id)).join(' / ')} · ${tick.bonus===null?'Forward target-speed bonus':`+${tick.bonus.toFixed(3)} m/s target speed`} while changing lanes.`;
    const prior=intervals.at(-1);
    if(prior&&prior.end===tick.start&&prior.detail===detail){prior.end=prior.observedUntil=tick.end;continue;}
    intervals.push({kind:'lane-bonus',label:'Lane bonus',start:tick.start,end:tick.end,observedUntil:tick.end,evidence:'simulated',detail,
      skillId:tick.skillIds.length===1?tick.skillIds[0]:undefined,model:tick.bonus===null?undefined:{speedDelta:tick.bonus}});
  }
  return intervals;
}
