import type {SkillReference} from './reference';
import type {Runner} from './types';
import type {SkillActivation} from './analytics';
import {effectValue} from './effect-value';

type Branch=SkillReference['branches'][number];
export const postProcLimit=(kind:number):number|null=>kind===3?2:kind===1||kind===2?3:null;
export const postProcCondition=(kind:number)=>kind===1?'Pass a runner':kind===2||kind===3?'Activate another skill':'Additional condition';
export function postProcDefinition(branch:Branch,runner:Runner|null,skillId:number,distance:number|null){
  const conditional=branch.effects.filter(e=>(e.additionalActivateType??0)!==0);
  if(!conditional.length&&branch.durationUsage!==4)return null;
  const baseDuration=distance!=null&&branch.rawDuration>0&&[1,4].includes(branch.durationUsage)?branch.rawDuration/10000*distance/1000:null;
  const extension=branch.durationUsage===4&&distance!=null?distance/1000:0;
  const bonuses=conditional.map(effect=>({effect,kind:effect.additionalActivateType!,limit:postProcLimit(effect.additionalActivateType!),
    value:runner?effectValue(runner,skillId,{...effect,additionalActivateType:0}):null}));
  const base=branch.effects.filter(e=>!(e.additionalActivateType??0)).map(effect=>({effect,value:runner?effectValue(runner,skillId,effect):null}));
  return {base,bonuses,baseDuration,extension,maximumDuration:baseDuration===null?null:baseDuration+extension*3};
}

/** Full potential is maximum magnitude for the full possible duration. Actual
 * benefit remains a fixed-replay comparison, never a hypothetical race rerun. */
export function postProcPotential(branch:Branch,runner:Runner,skillId:number,distance:number|null,activation:SkillActivation,types:readonly number[]){
  const definition=postProcDefinition(branch,runner,skillId,distance);if(!definition)return null;
  const base=definition.base.filter(e=>types.includes(e.effect.type)),bonuses=definition.bonuses.filter(e=>types.includes(e.effect.type));
  const known=activation.activationEvidence==='simulated'&&definition.maximumDuration!==null
    &&base.every(e=>e.value!==null&&e.value>=0)&&bonuses.every(e=>e.value!==null&&e.value>=0&&e.limit!==null);
  const maximum=known?base.reduce((n,e)=>n+e.value!,0)+bonuses.reduce((n,e)=>n+e.value!*e.limit!,0):null;
  return {definition,maximum,duration:definition.maximumDuration,
    baseValue:base.reduce((n,e)=>n+(e.value??0),0),baseDuration:definition.baseDuration};
}
