import type { Race } from '../data/types';
import { timeAtDistance } from '../telemetry';

export const REPLAY_PHASE_COLOR='#f59b42';
export function replayPhaseTimes(race:Race,runnerId:string,total:number|null=race.distance){
  if(total===null||!Number.isFinite(total)||total<=0||race.duration<=0)return [];
  return [{label:'Midleg',distance:total/6},{label:'Late race',distance:total*2/3}].flatMap(mark=>{
    const time=timeAtDistance(race,runnerId,mark.distance);
    // Do not invent a crossing when the recording starts late or has a gap.
    return time===null||time<0||time>race.duration?[]:[{...mark,time,position:time/race.duration}];
  });
}
