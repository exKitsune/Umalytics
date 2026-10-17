import type { Race, Runner } from './types';
import { preparedFor } from '../analysis/prepared';
import type { RaceAnalysis, SkillActivation, SkillRow } from './analytics';
import type { ReferenceData, SkillReference } from './reference';
import type { StatKey } from './effect-types';
import { effectValue, type EffectValueContext } from './effect-value';
import { referenceEquippedSkillId } from './equipped-skills';
import { effectiveStrategyCode } from './skill-details';
import { aptitudeRank, distanceAptitude } from './race-stats';
import { mechanicsContext, baseAcceleration } from './mechanics-model';
import { trace } from './effect-sampling';
import { skillEffectDefinitions } from './skill-effect-catalog';

/** Component quantities, not a percentage of causal finish-time effectiveness. */
export interface SkillMetric {
  label:string; value:number|string|null; unit:string; detail:string;
  evidence:'recorded'|'reference'|'sampled'|'unknown'; reason?:string;
}
type Effect=SkillReference['branches'][number]['effects'][number];
interface Applied {id:number;effects:Effect[];start:number;end:number|null;passive:boolean;activation?:SkillActivation;inferred:boolean}
const cache=new WeakMap<RaceAnalysis,Map<string,SkillMetric[]>>();
const statKeys:StatKey[]=['speed','stamina','power','guts','wisdom'];
function applications(row:SkillRow,ref:ReferenceData):Applied[] {
  const result:Applied[]=row.activations.map(a=>({id:a.referenceSkillId??row.skillId,effects:a.effects,start:a.start,end:a.effectiveEnd,passive:a.timingKind==='passive',activation:a,inferred:false}));
  if(!row.activations.length&&row.inferredBranches.length===1){const index=row.inferredBranches[0],b=ref.metadata.skills[row.skillId]?.branches.find((b,i)=>(b.branchIndex??i)===index);if(b)result.push({id:row.skillId,effects:b.effects,start:0,end:null,passive:b.rawDuration<0,inferred:true});}
  return result;
}
function context(rows:SkillRow[],ref:ReferenceData,time:number):EffectValueContext {
  // No random roll or additional-hit history is invented.
  const active=rows.filter(r=>r.inferredBranches.length===1||r.activations.some(a=>a.start<time));
  return {activeGreenCount:active.some(r=>ref.metadata.skills[r.skillId]?.tagIds==null&&ref.metadata.skills[r.skillId]?.tagId==null)?null:active.filter(r=>{const definition=ref.metadata.skills[r.skillId];return (definition.tagIds??[definition.tagId??0]).some(tag=>tag>=601&&tag<=615);}).length};
}
function missing(e:Effect):string {
  if((e.additionalActivateType??0)!==0)return 'Additional activation count is unavailable.';
  if(e.valueUsage>=3&&e.valueUsage<=7)return 'Racing-team total is not in the replay.';
  if([8,9].includes(e.valueUsage))return 'The random effect roll is unavailable.';
  return 'Effect scaling or skill level is unresolved.';
}
/** Resolved applications are deliberately separate from equipped definitions. */
export function metricsForSkill(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,skillId:number):SkillMetric[] {
  const ready=preparedFor(analysis)?.runners[runnerId];if(ready&&skillId in ready.metrics)return ready.metrics[skillId];
  const runner=race.runners.find(r=>r.id===runnerId),detail=analysis.runners[runnerId];
  if(!runner||!detail||!reference)return [];
  const canonical=referenceEquippedSkillId(runner,skillId)??skillId,row=detail.skillRows.find(r=>r.skillId===canonical||r.skillId===skillId);
  if(!row)return [];
  let saved=cache.get(analysis);if(!saved)cache.set(analysis,saved=new Map());const key=`${runnerId}:${canonical}`;if(saved.has(key))return saved.get(key)!;
  const out:SkillMetric[]=[],add=(label:string,value:number|string|null,unit:string,explanation:string,evidence:SkillMetric['evidence']='reference',reason?:string)=>{
    const finite=typeof value==='number'&&!Number.isFinite(value)?null:value;
    out.push({label,value:finite,unit,detail:explanation,evidence:finite===null?'unknown':evidence,...finite===null?{reason:reason??'Required reference inputs are missing or unresolved.'}:{}});
  };
  const applied=applications(row,reference),definition=reference.metadata.skills[canonical]??reference.metadata.skills[skillId];
  const relevant=(e:Effect)=>[1,2,3,4,5,6,8,10,13,14,28,29,35,37,501,502,503].includes(e.type)||!skillEffectDefinitions[e.type];
  if(!applied.length&&definition?.branches.some(b=>b.effects.some(relevant))){add('Component result',null,'',row.nonProcReason,'unknown','No resolved activation or guaranteed passive branch.');saved.set(key,out);return out;}
  if(row.inferredBranches.length>1){add('Component result',null,'','Several passive branches remain possible.','unknown','Passive branch is ambiguous.');saved.set(key,out);return out;}
  const course=race.courseId===null?null:reference.courses[race.courseId]??null,stats=detail.statBreakdown;
  const style=effectiveStrategyCode(runner,detail.skillRows),base=race.distance===null?null:20-(race.distance-2000)/1000;
  for(const [n,a] of applied.entries()){
    const suffix=applied.length>1?` · ${n+1}`:'',applicationPrefix=a.inferred?'Guaranteed passive reference. ':'Activated effect reference. ';
    if(!a.effects.length&&definition?.branches.some(b=>b.effects.some(relevant))){add('Component result'+suffix,null,'','The activation is recorded but its effect branch is unresolved.','unknown','Effect branch is unavailable.');continue;}
    const ec=context(detail.skillRows,reference,a.start);let gateDone=false;
    for(const e of a.effects.filter(relevant)){
      const foreign=(e.targetType??1)!==1,value=effectValue(runner,a.id,e,ec),label=(s:string)=>s+suffix;
      const why=missing(e);
      const assumption=e.valueUsage>=3&&e.valueUsage<=7&&value===null?'Racing-team total is not in the replay. ':
        e.valueUsage===10&&(runner.raceWinCount==null||!Number.isInteger(runner.raceWinCount)||runner.raceWinCount<0)?'Race-win count is unavailable; magnitude assumes the maximum 1.2 tier. ':
        e.valueUsage===12&&(runner.fanCount==null||!Number.isInteger(runner.fanCount)||runner.fanCount<0)?'Fan count is unavailable; magnitude assumes the maximum 1.2 tier. ':'';
      const prefix=applicationPrefix+assumption;
      if(!skillEffectDefinitions[e.type]){add(label('Effect data'),null,'','This effect is not modeled yet.','unknown',`Unsupported effect ${e.type}.`);continue;}
      if([501,502,503].includes(e.type)){add(label('Carnival effect'),null,'','Event scoring/stat/motivation behavior is not reconstructed.','unknown','Carnival calculation is unsupported.');continue;}
      if(foreign){const name=e.type===8?'Vision modifier':e.type===13?'Rushed reset timer':e.type===29?'Rushed chance modifier':'Targeted component';const unit=e.type===8?'m':e.type===13?'s':e.type===29?'pp':'reference units';add(label(name),value,unit,assumption+'The caster magnitude is separate from recipient selection and team immunity. This is not applied damage or finish gain.',value===null?'unknown':'reference',value===null?why:undefined);continue;}
      if(e.type>=1&&e.type<=5){
        const stat=statKeys[e.type-1],s=stats.stats[stat];
        add(label(`${stat==='wisdom'?'Wit':stat[0].toUpperCase()+stat.slice(1)} stat`),value,'points',prefix+'Resolved reference addition before the final stat cap; not a measured in-race stat.', 'reference',value===null?why:undefined);
        if(value===null)continue;
        const initial=a.start===0&&a.passive;
        const otherSelected=a.effects.filter(x=>x!==e&&x.type===e.type&&(x.targetType??1)===1);
        // Keep the other effects fixed; remove only this additive component before the final cap.
        const before=s.final===null||s.capGain===null?null:s.final-s.capGain;
        const withStat=initial?s.final:s.final===null?null:Math.max(1,Math.min(2000,s.final+value));
        const without=initial?before===null?null:Math.max(1,Math.min(2000,before-value)):s.final;
        const delta=withStat===null||without===null?null:withStat-without;
        const note=assumption+'Conditional reference coefficient with other initial inputs fixed; does not simulate interactions or causal finish gain.';
        if(otherSelected.length)add(label('Stat attribution'),null,'','Several same-stat effects are present; each coefficient removes one component with the others fixed.','unknown','Do not sum marginal coefficients as independent race gain.');
        if(e.type===2){const coef=stats.startingHp.strategyCoefficient;const hp=initial&&delta!==null&&coef!==null?0.8*coef*delta:null;add(label('Starting HP contribution'),hp,'HP',note+' A later stamina modifier is not assumed to refill maximum HP.','reference','Initial adjusted stamina or strategy coefficient is unavailable.');}
        if(e.type===1){const distanceKey=course?course.distance<=1400?'short':course.distance<=1800?'mile':course.distance<=2400?'middle':'long':null,rank=distanceKey?aptitudeRank(runner.aptitudes?.[distanceKey]):null;
          const term=withStat!==null&&without!==null&&rank!==null?0.002*distanceAptitude[rank-1]*(Math.sqrt(500*withStat)-Math.sqrt(500*without)):null;
          add(label('Late target coefficient'),term,'m/s',note+' Early/mid base target does not use speed stat.');add(label('Maximum spurt coefficient'),term===null?null:2.05*term,'m/s',note+' Maximum-spurt ceiling only; actual selected spurt target is unreported.');
        }
        if(e.type===3){const ctx=mechanicsContext(race,runner,course,stats,style);let gain:number|null=null;if(ctx&&withStat!==null&&without!==null){const withCtx={...ctx,stats:{...stats,stats:{...stats.stats,power:{...s,final:withStat}}}},withoutCtx={...ctx,stats:{...stats,stats:{...stats.stats,power:{...s,final:without}}}};const x=baseAcceleration(withCtx,0,3),y=baseAcceleration(withoutCtx,0,3);if(x!==null&&y!==null)gain=x-y;}
          add(label('Initial acceleration coefficient'),gain,'m/s²',note+' Uses starting slope and strategy/aptitude; excludes start-dash and other acceleration.');
          add(label('Uphill mitigation per 1%'),withStat!==null&&without!==null?200/without-200/withStat:null,'m/s',note);
        }
        if(e.type===4){add(label('Minimum speed coefficient'),withStat!==null&&without!==null?0.001*(Math.sqrt(200*withStat)-Math.sqrt(200*without)):null,'m/s',note);
          add(label('Late HP drain change'),withStat!==null&&without!==null?100*((1+200/Math.sqrt(600*withStat))/(1+200/Math.sqrt(600*without))-1):null,'%',note+' Negative means lower reference drain at equal self speed.');}
        if(e.type===5){const variance=(w:number)=>w/5500*Math.log10(.1*w);add(label('Mean section target coefficient'),withStat!==null&&without!==null&&base!==null?base*(variance(withStat)-variance(without))/100:null,'m/s',note+' Mean of the uniform section-wit distribution; selected last spurt excludes this term.');
          add(label('Downhill entry chance change'),withStat!==null&&without!==null?Math.min(100,.04*withStat)-Math.min(100,.04*without):null,'pp/check',note+' A one-second check opportunity, not extra mode uptime. Pre-race skill lottery uses base wit, not this passive.');}
      }else if(e.type===10||e.type===14){if(!gateDone)gateMetrics(race,runner,reference,analysis,row,a,add,suffix);gateDone=true;
      }else if(e.type===8){add(label('Vision modifier'),value,'m',prefix+'Reference visibility distance change; recipients and applied hits remain separate.','reference',value===null?why:undefined);}
      else if(e.type===28||e.type===35){add(label(e.type===28?'Lane speed modifier':'Target-lane setting'),value,e.type===28?'m/s':'reference units',prefix+'Lateral rule parameter, not longitudinal gain.','reference',value===null?why:undefined);
        const end=a.end===null?null:Math.min(runner.finishTimeRaw??race.duration,a.end),lane=sampledLane(race,runner.id,a.start,end);add(label('Sampled lane travel'),lane,'lane units','Sum of absolute recorded lane changes within the active window (decoded raw lane /10000). Includes all concurrent skills and decisions; no per-skill causal attribution.','sampled',lane===null?'A bounded active window or complete lane samples is unavailable.':undefined);}
      else if(e.type===29){add(label('Rushed chance modifier'),value,'pp',prefix+'Probability modifier only. One replay cannot prove that rushed was prevented.','reference',value===null?why:undefined);}
      else if(e.type===13){add(label('Rushed reset timer'),value,'s',prefix+'Reference overwrites the ongoing rushed exit timer; this is not added duration.','reference',value===null?why:undefined);
        const active=detail.intervals.find(i=>i.kind==='rushed'&&i.start<=a.start&&(i.end??i.observedUntil??i.start)>=a.start);add(label('Rushed observed after activation'),active?.end==null?null:Math.max(0,active.end-a.start),'s','Recorded episode context only; the unextended random calm-down time is unknown.','recorded','No complete overlapping rushed episode.');}
      else if(e.type===6){const active=row.effectiveActive&&runner.strategyCode===1;add(label('Running style'),active?'Runaway':null,'',prefix+'Runaway AI/style coefficients are distinct from ordinary Front Runner.','reference',active?undefined:'A supported Front Runner Runaway activation is unavailable.');
        if(active){add(label('Early target coefficient'),base===null?null:base*.063,'m/s','Reference base-strategy difference 1.063−1; before position keeping, section wit and skills.');add(label('Mid target coefficient'),base===null?null:base*(.962-.98),'m/s','Reference base-strategy difference; does not imply a slower finish.');const stamina=stats.stats.stamina.final;add(label('Starting HP style change'),stamina===null?null:.8*stamina*(.86-.95),'HP','Reference Runaway versus Front Runner, fixed adjusted stamina.');}}
      else if(e.type===37){add(label('Requested gold activations'),value,'skills',prefix+'Nominal random-selection count; actual choices and attribution are separate.','reference',value===null?why:undefined);
        const candidates=detail.skillActivations.filter(p=>p!==a.activation&&p.skillId!==a.activation?.skillId&&Math.abs(p.start-a.start)<1e-6&&reference.metadata.skills[p.referenceSkillId??p.skillId]?.rarity===2);add(label('Same-frame gold candidates'),candidates.length,'skills','Recorded same-source, same-time gold activations. Parent-child links are not reported, so this count is association rather than proven random children.','recorded');}
    }
  }
  saved.set(key,out);return out;
}
function sampledLane(race:Race,id:string,start:number,end:number|null):number|null {
  if(end===null||end<=start)return null;const rows=trace(race,id);let total=0,covered=0;
  for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],lo=Math.max(a.time,start),hi=Math.min(b.time,end);if(hi<=lo)continue;if(b.time-a.time>2||a.sample.lane===null||b.sample.lane===null)return null;total+=Math.abs(b.sample.lane-a.sample.lane)*(hi-lo)/(b.time-a.time);covered+=hi-lo;}
  return Math.abs(covered-(end-start))<1e-6?total:null;
}
function gateMetrics(race:Race,runner:Runner,ref:ReferenceData,analysis:RaceAnalysis,selected:SkillRow,a:Applied,add:(label:string,value:number|string|null,unit:string,detail:string,evidence?:SkillMetric['evidence'],reason?:string)=>void,suffix:string){
  const all=analysis.runners[runner.id].skillRows,items=all.flatMap(r=>applications(r,ref).map(p=>({row:r,proc:p}))).filter(v=>v.proc.start===0),gate=items.flatMap(v=>v.proc.effects.filter(e=>[10,14].includes(e.type)).map(e=>({...v,e,value:effectValue(runner,v.proc.id,e,context(all,ref,0))})));
  const selectedItems=gate.filter(v=>v.row===selected&&v.proc.id===a.id),overrides=gate.filter(v=>v.e.type===14),multipliers=gate.filter(v=>v.e.type===10);
  for(const g of selectedItems)add((g.e.type===14?'Gate delay override':'Gate delay multiplier')+suffix,g.value,g.e.type===14?'s':'×','Resolved activated gate component; all simultaneous gate effects must be accounted for before inversion.','reference',g.value===null?missing(g.e):undefined);
  const unresolved=!runner.skills||all.some(r=>r.equipped&&(!ref.metadata.skills[r.skillId]||ref.metadata.skills[r.skillId].branches.some((b,i)=>b.effects.some(e=>[10,14].includes(e.type))&&!r.conditionEvaluation?.branches.some(c=>c.branchIndex===(b.branchIndex??i)&&c.state==='unmet')&&!applications(r,ref).some(p=>p.start===0&&p.effects.some(e=>[10,14].includes(e.type))))));
  const bad=unresolved||gate.some(v=>v.value===null||(v.e.targetType??1)!==1)||a.start!==0;
  let raw:number|null=null,saved:number|null=null,reason:string|undefined;
  if(bad)reason='Another gate modifier, branch, or recipient is unresolved.';
  else if(overrides.length)reason='A fixed override destroys the original random gate draw; ordering with multipliers is not established.';
  else {const product=multipliers.reduce((p,v)=>p*v.value!,1),own=selectedItems.filter(v=>v.e.type===10).reduce((p,v)=>p*v.value!,1);if(runner.startDelay==null||product<=0||own<=0)reason='Recorded delay is missing or the multiplier is noninvertible.';else {raw=runner.startDelay/product;if(raw<0||raw>.10001){raw=null;reason='Recorded delay is inconsistent with the complete 0–0.1s reference draw.';}else saved=runner.startDelay/own-runner.startDelay;}}
  add('Gate delay saved'+suffix,saved,'s','Conditional removal of this skill with every other applied multiplier held fixed; no acceleration, blocking, or finish-time benefit is inferred.','reference',reason);
  add('Inferred raw gate draw'+suffix,raw,'s','Recorded delay divided by the product of all resolved applied gate multipliers.','reference',reason);
}
