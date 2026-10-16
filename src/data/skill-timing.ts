import type { Race, Runner } from './types';
import type { SkillReference, ReferenceData } from './reference';
export type SkillTimingKind='reported'|'reference'|'instant'|'passive'|'unknown';
export interface SkillTiming {effectiveDuration:number|null;effectiveEnd:number|null;timingKind:SkillTimingKind;timingReason:string;}
function positionAt(race:Race,id:string,time:number):number|null {
  const i=race.frames.findIndex(f=>f.time>=time);if(i<0)return null;
  const b=race.frames[i],right=b.runners.find(r=>r.runnerId===id)?.distance;
  if(right==null)return null;if(b.time===time)return right;if(i===0)return null;
  const a=race.frames[i-1],left=a.runners.find(r=>r.runnerId===id)?.distance;
  return left==null?null:left+(right-left)*(time-a.time)/(b.time-a.time);
}
/** Pairwise sampled crossings; overtakes between samples remain model evidence. */
export function sampledPassTimes(race:Race,id:string):number[] {
  const result:number[]=[];
  for(let i=1;i<race.frames.length;i++){
    const a=race.frames[i-1],b=race.frames[i],selfA=a.runners.find(r=>r.runnerId===id)?.distance,selfB=b.runners.find(r=>r.runnerId===id)?.distance;
    if(selfA==null||selfB==null)continue;
    for(const opponent of race.runners){if(opponent.id===id)continue;
      const otherA=a.runners.find(r=>r.runnerId===opponent.id)?.distance,otherB=b.runners.find(r=>r.runnerId===opponent.id)?.distance;
      if(otherA==null||otherB==null||race.distance!==null&&(otherA>=race.distance||selfA>=race.distance))continue;
      const da=selfA-otherA,db=selfB-otherB;
      if(da<0&&db>=0)result.push(a.time+(b.time-a.time)*-da/(db-da));
    }
  }return result.sort((a,b)=>a-b);
}
export function resolveSkillTiming(race:Race,runner:Runner,reference:ReferenceData|null,branch:SkillReference['branches'][number]|undefined,start:number,reported:number|null,definition?:SkillReference):SkillTiming {
  const result=(duration:number|null,kind:SkillTimingKind,reason:string):SkillTiming=>({effectiveDuration:duration,effectiveEnd:duration===null?null:start+duration,timingKind:kind,timingReason:reason});
  // Recovery/drain and gate-delay changes apply once, irrespective of a spare
  // replay time field. No timed interval is invented for these effects.
  if(branch?.effects.length&&branch.effects.every(e=>[9,10,14].includes(e.type)))return result(0,'instant','Instant effect; no active duration.');
  if(reported!==null)return result(reported,'reported','Replay reports the active duration.');
  if(!branch)return result(null,'unknown','Skill branch unavailable.');
  if(branch.rawDuration<0)return result(null,'passive','Passive effect; no timed expiry.');
  if(branch.rawDuration<=0)return result(null,'unknown','No supported timed duration.');
  if(race.distance===null)return result(null,'unknown','Race distance unavailable.');
  const extended=definition?.rarity===6&&runner.skills?.some(s=>reference?.metadata.skills[s.id]?.branches.some(b=>b.effects.some(e=>e.type===42&&(e.targetType??1)===1)));
  if(extended)return result(null,'unknown','Duration extension unresolved.');
  // Ordinary ability_time_usage1 is direct. Master skill_level_value scales
  // effect magnitudes, not duration; no extra level multiplier is invented.
  const base=branch.rawDuration/10000*race.distance/1000;
  if(branch.durationUsage===1)return result(base,'reference','Base duration scaled by race distance.');
  if(branch.durationUsage===2){
    const positions=race.runners.map(r=>positionAt(race,r.id,start)),self=positionAt(race,runner.id,start);
    if(self===null||positions.some(p=>p===null))return result(null,'unknown','Positions at activation are missing.');
    return result(base*Math.min(.8+Math.max(0,Math.max(...positions as number[])-self)/62.5,1.6),'reference','Duration uses the interpolated gap to the leader.');
  }
  if(branch.durationUsage===3){
    const before=race.frames.filter(f=>f.time<=start).at(-1),after=race.frames.find(f=>f.time>=start);
    const hpA=before?.runners.find(r=>r.runnerId===runner.id)?.hp,hpB=after?.runners.find(r=>r.runnerId===runner.id)?.hp;
    if(hpA==null||hpB==null)return result(null,'unknown','HP at activation is missing.');
    const tier=(hp:number)=>hp<2000?1:hp<2400?1.5:hp<2600?2:hp<2800?2.2:hp<3000?2.5:hp<3200?3:hp<3500?3.5:4;
    // A recovery/drain in the bracket can cross a tier and return before the
    // next sample. Do not infer a pre-event value from those endpoints.
    const shared=race.events.some(e=>e.time>=before!.time&&e.time<=after!.time&&e.skillId!=null&&reference?.metadata.skills[e.skillId]?.branches.some(b=>b.effects.some(v=>v.type===9)));
    if(shared||tier(hpA)!==tier(hpB))return result(null,'unknown','HP crosses a duration tier near activation.');
    return result(base*tier(hpA),'reference','Duration uses the HP tier at activation.');
  }
  if(branch.durationUsage===4){
    let end=start+base,count=0;
    for(const pass of sampledPassTimes(race,runner.id)){if(pass<=start)continue;if(pass>=end||count===3)break;end+=race.distance/1000;count++;}
    return result(end-start,'reference','Duration includes sampled overtakes while active.');
  }
  return result(null,'unknown','Duration scaling unresolved.');
}
