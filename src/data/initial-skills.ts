/** Initial -1 markers are not ordinary recorded procs. This deliberately small
 * inference accepts only a unique positive self-acceleration combination whose
 * gate conditions and clean, post-dash sampled acceleration independently agree.
 * It does not use inferred pace modes or the counterfactual motion engine. */
import type { Race, Runner, RaceEvent, Frame } from './types';
import type { ReferenceData, CourseReference, SkillReference } from './reference';
import type { SkillActivation, SkillRow } from './analytics';
import { conditionStaticValues, comparePredicate } from './condition-observations';
import { referenceEquippedSkillId } from './equipped-skills';
import { effectValue } from './effect-value';
import { resolveSkillTiming } from './skill-timing';
import { statBreakdownFor } from './race-stats';
import { effectiveStrategyCode } from './skill-details';
import { mechanicsContext, baseAcceleration, baselineTarget } from './mechanics-model';

type Candidate={event:RaceEvent;id:number;branch:SkillReference['branches'][number];index:number;value:number;timing:ReturnType<typeof resolveSkillTiming>};
const local=(race:Race,event:RaceEvent,runner:Runner)=>event.runnerId===runner.id||event.runnerId===null&&race.runners.find(r=>r.index===event.params[0])?.id===runner.id;
export function inferInitialSkills(race:Race,runner:Runner,course:CourseReference|null,reference:ReferenceData|null,rows:SkillRow[],recorded:SkillActivation[]):SkillActivation[]{
  if(!reference||!course||race.distance!==course.distance||race.frames[0]?.time!==0||runner.startDelay==null||runner.startDelay<0||runner.startDelay>=1/15||!runner.skills)return [];
  const first=race.frames[0].runners.find(s=>s.runnerId===runner.id);
  if(first?.distance==null||Math.abs(first.distance)>.5||first.speed==null||Math.abs(first.speed-3)>.011)return [];
  if(runner.skills.some(s=>{const id=referenceEquippedSkillId(runner,s.id);return id===null||!reference.metadata.skills[id];}))return [];
  const candidates:Candidate[]=[];
  for(const event of race.events.filter(e=>(e.type===3||e.type==='skill')&&e.time===0&&e.params[2]===-1&&e.skillId!==null&&local(race,e,runner))){
    const id=referenceEquippedSkillId(runner,event.skillId!),definition=id===null?null:reference.metadata.skills[id];
    if(id===null||!definition||rows.find(r=>r.skillId===id)?.lottery?.won===false||!runner.skills.some(s=>referenceEquippedSkillId(runner,s.id)===id)||recorded.some(a=>(a.referenceSkillId??a.skillId)===id))continue;
    const index=event.params[3],branch=definition.branches.find((b,i)=>(b.branchIndex??i)===index);
    if(!branch||!Number.isInteger(index)||branch.rawDuration<=0||branch.durationUsage!==1||!branch.effects.length)continue;
    if(branch.effects.some(e=>e.type!==31||(e.targetType??1)!==1||(e.additionalActivateType??0)!==0))continue;
    const values=branch.effects.map(e=>effectValue(runner,id,e));if(values.some(v=>v===null||v<=0))continue;
    const timing=resolveSkillTiming(race,runner,reference,branch,0,null,definition);if(timing.effectiveEnd===null||timing.effectiveEnd<=1)continue;
    candidates.push({event,id,branch,index,value:values.reduce<number>((n,v)=>n+v!,0),timing});
  }
  // Duplicate branches/definitions and large ambiguous sets are withheld.
  if(!candidates.length||candidates.length>8||new Set(candidates.map(c=>c.id)).size!==candidates.length)return [];
  const stats=statBreakdownFor(race,runner,course,reference,rows),style=effectiveStrategyCode(runner,rows),ctx=mechanicsContext(race,runner,course,stats,style);
  if(!ctx||stats.stats.guts.final===null||stats.stats.wisdom.final===null)return [];
  const baseline=baseAcceleration(ctx,0,3),target=baselineTarget(ctx,0);if(baseline===null||!target)return [];
  const base=20-(course.distance-2000)/1000,minimum=.85*base+Math.sqrt(200*stats.stats.guts.final)*.001;
  const coeff=({1:1,2:.978,3:.938,4:.931,5:1.063} as Record<number,number>)[ctx.style];
  // Stay below even the lowest early pace-down target, rather than fitting a
  // capped ramp as reduced acceleration. Wit/terrain are already in target.min.
  const ceiling=target.min-base*coeff*(1-.915)-.03;
  const stop=Math.min(2,...candidates.map(c=>c.timing.effectiveEnd!-1/15));
  if(race.events.some(e=>typeof e.type==='number'&&e.type>=4&&e.type<=10&&e.time<=stop&&local(race,e,runner)))return [];
  // A different unresolved initial movement modifier or any subsequent skill
  // during the evidence window could explain the same ramp.
  const motionTypes=new Set([1,3,4,5,21,22,27,28,31,35]);
  for(const event of race.events){
    if((event.type!==3&&event.type!=='skill')||event.skillId===null||event.time<0||event.time>stop)continue;
    const source=race.runners.find(r=>local(race,event,r)),id=source?referenceEquippedSkillId(source,event.skillId):null,def=id===null?null:reference.metadata.skills[id];
    const branch=def?.branches.find((b,i)=>(b.branchIndex??i)===event.params[3]);
    if(!source||!branch)return [];
    const relevant=branch.effects.some(e=>motionTypes.has(e.type)&&((e.targetType??1)===1?source.id===runner.id:source.id!==runner.id));
    if(!relevant||source.id===runner.id&&candidates.some(c=>c.event===event))continue;
    if(source.id===runner.id&&event.time===0&&branch.rawDuration<0&&rows.find(r=>r.skillId===id)?.inferredBranches.includes(event.params[3]))continue;
    return [];
  }
  const sample=(f:Frame)=>f.runners.find(s=>s.runnerId===runner.id);
  const clean=(f:Frame)=>{
    const s=sample(f);if(!s||s.distance===null||s.speed===null||s.hp===null||s.hp<=0||s.lane===null||s.blockFrontRunnerIndex!==-1||s.temptationMode!==0||s.distance>=course.distance/6||s.speed<minimum+.025||s.speed>=ceiling)return false;
    if(course.slopes.some(g=>s.distance!>=g.start&&s.distance!<g.start+g.length&&g.slopePercent!==0))return false;
    // The opening pack is alongside with no recorded block. A missing position is
    // the contamination; a horse within 2 m is not, or no real start can be fitted.
    return race.runners.every(r=>{if(r.id===runner.id)return true;const o=f.runners.find(v=>v.runnerId===r.id);return o?.distance!=null&&o.lane!=null;});
  };
  // A contiguous window, not cherry-picked matching intervals. Quantized speed
  // endpoints allow .022m/s total discrepancy, not an accumulating per-step error.
  const points=race.frames.filter(f=>f.time>0&&f.time<=stop);let window:Frame[]=[];
  for(const f of points){if(!clean(f)){if(window.length)break;continue;}if(window.length&&f.time-window.at(-1)!.time>.15)break;window.push(f);}
  if(window.length<4||window.at(-1)!.time-window[0].time<.25)return [];
  // Opening lane drift of a few hundredths is not a lane skill. A real move is wider.
  if(window.some(f=>Math.abs(sample(f)!.lane!-sample(window[0])!.lane!)>.02))return [];
  const guaranteed=new Set(rows.filter(row=>row.inferredBranches.length===1&&race.events.some(e=>e.time===0&&e.skillId!==null&&referenceEquippedSkillId(runner,e.skillId)===row.skillId&&local(race,e,runner))).map(row=>row.skillId));
  for(const a of recorded.filter(a=>a.start===0))guaranteed.add(a.referenceSkillId??a.skillId);
  const markedStart=new Set(race.events.filter(e=>(e.type===3||e.type==='skill')&&e.time===0&&e.params[2]===-1&&e.skillId!==null&&local(race,e,runner)).flatMap(e=>{const id=referenceEquippedSkillId(runner,e.skillId!);return id===null?[]:[id];}));
  const provenStart=(id:number)=>{if(guaranteed.has(id))return true;const row=rows.find(r=>r.skillId===id);return !!row&&row.lottery?.won!==false&&row.conditionEvaluation?.state!=='unmet'&&markedStart.has(id);};
  const statics=conditionStaticValues(race,runner,course,{reference});
  const condition=(text:string,id:number,selected:Candidate[]):boolean=>!text.trim()||text.split('@').some(group=>group.split('&').every(atom=>{
    const m=atom.trim().match(/^(\w+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);if(!m)return false;
    const [,key,op,arg]=m,value=Number(arg);
    if(key==='phase')return comparePredicate(0,op,value);
    if(key==='activate_count_start'){
      if(op!=='>'&&op!=='>=')return false;
      const count=new Set([...[...guaranteed,...markedStart].filter(prior=>prior<id&&provenStart(prior)),...selected.filter(c=>c.id<id).map(c=>c.id)]).size;
      return comparePredicate(count,op,value);
    }
    const input=statics[key];return input?.confidence==='known'&&input.value!==null&&comparePredicate(input.value,op,value);
  }));
  const matches:Candidate[][]=[];
  for(let mask=0;mask<1<<candidates.length;mask++){
    const selected=candidates.filter((_,i)=>mask&(1<<i));
    if(selected.some(c=>!condition(c.branch.condition,c.id,selected)||!condition(c.branch.precondition??'',c.id,selected)))continue;
    if(selected.some(c=>reference.metadata.skills[c.id].groupId!=null&&runner.skills!.some(s=>{const id=referenceEquippedSkillId(runner,s.id);return id!==null&&id!==c.id&&reference.metadata.skills[id]?.groupId===reference.metadata.skills[c.id].groupId;})))continue;
    const acceleration=baseline+selected.reduce((n,c)=>n+c.value,0),origin=window[0];
    if(window.every(f=>Math.abs(sample(f)!.speed!-sample(origin)!.speed!-acceleration*(f.time-origin.time))<=.022))matches.push(selected);
  }
  if(matches.length!==1||!matches[0].length)return [];
  const reason=`Initial activation inferred from its gate marker, satisfied initial conditions (including only proven earlier skill counts), and a unique acceleration combination matching ${window.length} clean post-dash samples over ${(window.at(-1)!.time-window[0].time).toFixed(3)}s. Initial start and distance-scaled expiry are reference assumptions, not reported timed procs; the fitted ramp is not independent evidence of causal gain.`;
  return matches[0].map(c=>({skillId:c.event.skillId!,referenceSkillId:c.id,start:0,end:null,duration:null,...c.timing,activationEvidence:'estimated',durationEvidence:'estimated',effectBranch:c.index,effects:c.branch.effects,targetRunnerIds:[],detail:reason,timingReason:`${c.timing.timingReason} Initial start inferred from gate-marker conditions and sampled acceleration.`}));
}
