import type {BranchConditionEvaluation,PredicateExplanation,SkillConditionEvaluation} from '../data/skill-conditions';
import {conditionLabel} from '../data/condition-label';
import {motionAt,motionIndex as m,type DecisionEvent} from './trace';

const atoms=(text:unknown)=>String(text??'').split(/[@&]/).map(s=>s.trim()).filter(Boolean);
const at=(history:DecisionEvent[],tick:number)=>history.find(e=>e.tick<=tick&&e.lastTick>=tick);
const passed=(event:DecisionEvent|undefined)=>event?.data.passed===true;


/** Explain checks the engine actually executed. A failed branch is shown at its
 * closest evaluated opportunity, not at an arbitrary late-race tick. Never
 * combine individually successful checks from different ticks into a pass. */
export function simulationConditions(events:DecisionEvent[],motion:number[][]=[],fieldSize?:number):SkillConditionEvaluation|null {
  const words=(expressions:string[])=>expressions.map(expression=>conditionLabel(expression,null,fieldSize)).join(' ');
  const definitions=events.filter(e=>e.kind==='skill-definition');
  if(!definitions.length)return null;
  const branches:BranchConditionEvaluation[]=definitions.map(def=>{
    const checks=events.filter(e=>e.detail===def.detail),ready=checks.filter(e=>e.kind==='activation-ready');
    const condition=checks.filter(e=>e.kind==='condition'),met=condition.find(passed);
    const dynamic=checks.filter(e=>/[<>=!]/.test(e.kind));
    const histories=new Map<string,DecisionEvent[]>();
    for(const e of dynamic){const key=`${e.stage==='precondition'?'precondition':'condition'}:${e.kind}`;const list=histories.get(key)??[];list.push(e);histories.set(key,list);}
    const latch=checks.find(e=>e.kind==='precondition-latched'&&passed(e));
    const eligible=ready.some(passed);
    let state:'met'|'unmet'|'unknown'=met?'met':condition.length?'unmet':'unknown';
    const candidates=new Map<number,number>();
    for(const e of [...dynamic,...condition]){
      candidates.set(e.tick,e.time);candidates.set(e.lastTick,e.lastTime);
    }
    let opportunity=met?{tick:met.tick,time:met.time}:null,best=-1;
    if(!met)for(const [tick,time] of candidates){
      const evaluated=[...histories].filter(([key])=>key.startsWith('precondition:')===!condition.length).map(([,h])=>at(h,tick)).filter(Boolean);
      const score=evaluated.filter(passed).length;
      if(evaluated.some(e=>e!.data.passed===false)&&score>best){best=score;opportunity={tick,time};}
    }
    const predicates:PredicateExplanation[]=[];
    for(const role of ['precondition','condition'] as const)for(const expression of atoms(def.data[role])){
      const history=histories.get(`${role}:${expression}`)??[];
      const point=role==='precondition'?latch??opportunity:opportunity;
      const checked=point?at(history,point.tick):undefined;
      const compiled=checks.find(e=>e.kind==='static-condition'&&e.stage===`build-${role}`&&`${e.data.predicate}${e.data.operator}${e.data.argument}`===expression);
      let result:PredicateExplanation['state']=checked?(passed(checked)?'met':'unmet'):'unknown';
      let observed=checked?(passed(checked)?'Satisfied':'Not satisfied'):'Not reached; an earlier activation requirement prevented this check.';
      // Static filters are cumulative regions. A nonempty region containing this
      // opportunity proves the filter passed; an empty region does not identify
      // which earlier filter emptied it.
      if(!checked&&compiled?.data.dynamic===false&&point){
        const position=motionAt(motion,point.time)?.[m.position];
        const windows=compiled.data.windows;
        if(position!=null&&Array.isArray(windows)&&windows.some(w=>Array.isArray(w)&&position>=Number(w[0])&&position<Number(w[1]))){result='met';observed='Satisfied';}
      }
      if(!checked&&compiled?.data.dynamic===false&&!String(def.data[role]).includes('@')){
        const prior=checks.filter(e=>e.kind==='static-condition'&&e.stage===compiled.stage&&e.sequence<compiled.sequence).at(-1);
        if(Array.isArray(compiled.data.windows)&&!compiled.data.windows.length&&(!prior||Array.isArray(prior.data.windows)&&prior.data.windows.length>0)){
          result='unmet';observed='This condition excludes the entire course.';
          if(role==='condition'&&!met)state='unmet';
        }
      }
      const trigger=checks.find(e=>e.kind==='sampled-trigger'&&e.data.field===role&&`${e.data.predicate}==${e.data.argument}`===expression);
      if(!checked&&trigger&&point){
        const position=motionAt(motion,point.time)?.[m.position];
        if(position!=null&&Array.isArray(trigger.data.windows)&&trigger.data.windows.some(w=>Array.isArray(w)&&position>=Number(w[0])&&position<Number(w[1]))){result='met';observed='Sampled window reached';}
      }
      predicates.push({expression,key:expression.split(/[<>=!]/)[0],meaning:conditionLabel(expression,null,fieldSize),mechanicsState:'understood',observation:'Engine condition check',limitation:null,
        state:result,observed,time:checked?point!.time:null,role});
    }
    const blockers=predicates.filter(p=>p.state==='unmet').map(p=>p.expression);
    const earlier=[...new Set(dynamic.filter(e=>e.data.passed===false&&(!met||e.time<met.time)).map(e=>e.kind))];
    const gate=checks.find(e=>['precondition-ready','target-available','cooldown-ready','sampled-window','trigger-window'].includes(e.kind)&&e.data.passed===false&&(!opportunity||e.tick<=opportunity.tick&&e.lastTick>=opportunity.tick));
    const gateNames:Record<string,string>={'precondition-ready':'The prerequisite was not reached.','target-available':'No eligible target was available.','cooldown-ready':'The skill was on cooldown.','sampled-window':'The sampled activation window was not reached.','trigger-window':'The activation window was not reached.'};
    const detail=met?`Conditions met at ${met.time.toFixed(2)} s.${earlier.length?` Earlier restrictions: ${words(earlier)}`:''}`:
      blockers.length?`${opportunity?`Closest checked opportunity: ${opportunity.time.toFixed(2)} s. `:''}Restricting conditions: ${words(blockers)}`:
      gate?gateNames[gate.kind]:'No complete condition opportunity was recorded.';
    return {branchIndex:def.detail,state,inferredState:state,staticOnly:false,firstOpportunity:met?.time??null,
      opportunities:condition.filter(passed).reduce((n,e)=>n+e.count,0),unresolved:[],detail,
      mechanicsState:'understood',eligibilityState:eligible?'eligible':ready.length?'ineligible':'unresolved',randomTrigger:checks.some(e=>e.kind==='sampled-trigger'),definitiveOpportunity:eligible,
      observations:[],proxies:[],missingInputs:[],hiddenState:[],inferenceBasis:'observed',absenceAssessment:met?'conditions-supported':condition.length?'conditions-excluded':'no-observed-candidate',predicates};
  });
  const state=branches.some(b=>b.state==='met')?'met':branches.every(b=>b.state==='unmet')?'unmet':'unknown';
  const eligible=branches.some(b=>b.eligibilityState==='eligible');
  return {state,inferredState:state,branches,mechanicsState:'understood',eligibilityState:eligible?'eligible':branches.every(b=>b.eligibilityState==='ineligible')?'ineligible':'unresolved',definitiveOpportunity:eligible,randomTrigger:branches.some(b=>b.randomTrigger)};
}

export function simulationRestriction(events:DecisionEvent[],evaluation:SkillConditionEvaluation|null):{label:string;detail:string;failed:boolean}{
  if(events.some(e=>e.kind==='skill-wit'&&e.data.checked===true&&e.data.passed===false))return {label:'Wit check failed',detail:'The activation roll failed before condition checks.',failed:true};
  if(evaluation?.state==='unmet')return {label:'Conditions unmet',detail:[...new Set(evaluation.branches.map(b=>b.detail))].join(' '),failed:true};
  const opportunities=events.filter(e=>e.kind==='condition'&&passed(e));
  const failed=events.filter(e=>e.data.passed===false&&(!opportunities.length||opportunities.some(o=>o.detail===e.detail&&e.tick<=o.tick&&e.lastTick>=o.tick)));
  const requirements:[string,string,string][]=[['condition','Conditions unmet','Condition checks did not pass together.'],['precondition-ready','Prerequisite unmet','The required earlier event never became ready.'],['target-available','No eligible target','The skill had no eligible target at its activation opportunity.'],['cooldown-ready','On cooldown','The skill was on cooldown at its activation opportunity.'],['sampled-window','Trigger window missed','The sampled activation window was never reached with the other requirements ready.'],['trigger-window','Trigger window missed','The activation window was never reached with the other requirements ready.']];
  // When conditions did pass, prefer the gate that actually prevented activation.
  for(const [kind,label,detail] of requirements){
    if(kind==='condition'&&evaluation?.state==='met')continue;
    if(failed.some(e=>e.kind===kind))return {label,detail:kind==='condition'?evaluation?.branches.filter(b=>b.state!=='met').map(b=>b.detail).join(' ')||detail:detail,failed:true};
  }
  return {label:'Check unavailable',detail:'This trace contains no conclusive failed activation check.',failed:false};
}
