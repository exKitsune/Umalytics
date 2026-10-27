import {catalog as fallback} from '../data/catalog';
import {skillName,type ReferenceData} from '../data/reference';
import type {SkillReference} from '../data/reference';
import {nativeUnique,editorSkillName} from './editor';
export const isUnreleased=(skill:SkillReference)=>skill.dataRegion==='JP'||skill.unreleasedGlobal===true;
const owners=(fallback as unknown as {skillOwners?:Record<string,number[]>}).skillOwners??{};
const normalize=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ');
export function fuzzyScore(query:string,text:string):number {
  const q=normalize(query).trim(),t=normalize(text);if(!q)return 1;
  if(t.includes(q))return 1000-t.indexOf(q)-Math.max(0,t.length-q.length)*.01;
  let position=0,score=0;
  for(const ch of q.replace(/ /g,'')){const found=t.indexOf(ch,position);if(found<0)return 0;score+=found===position?4:1;position=found+1;}
  return score/Math.max(t.length,1);
}
export interface SkillFilters {rarity:string[];strategy:number[];distance:number[];surface:number[];phase:string[];effect:string[]}
export const emptySkillFilters=():SkillFilters=>({rarity:[],strategy:[],distance:[],surface:[],phase:[],effect:[]});
export const effectFilters=[
  {id:'speed-stat',name:'Speed stat',icon:10011,types:[1]}, {id:'stamina-stat',name:'Stamina stat',icon:10021,types:[2]},
  {id:'power-stat',name:'Power stat',icon:10031,types:[3]}, {id:'guts-stat',name:'Guts stat',icon:10041,types:[4]},
  {id:'wit-stat',name:'Wit stat',icon:10051,types:[5]}, {id:'recovery',name:'Recovery',icon:20021,types:[9]},
  {id:'start',name:'Start',icon:20061,types:[10,14]}, {id:'vision',name:'Vision',icon:20091,types:[8]},
  {id:'speed',name:'Speed',icon:20011,types:[21,22,27]}, {id:'acceleration',name:'Acceleration',icon:20041,types:[31]},
  {id:'lane',name:'Lane movement',icon:20051,types:[28,35]}, {id:'debuff',name:'Debuff',icon:30011,types:[]},
] as const;
function explicitCondition(skill:SkillReference,key:string,values:number[]):boolean {
  return skill.branches.some(b=>`${b.precondition??''}&${b.condition}`.split('@').some(branch=>{
    const atoms=[...branch.matchAll(new RegExp(`(?:^|[&|(])${key}(==|!=|>=|<=|>|<)([0-9]+)`,'g'))];
    return atoms.length>0&&values.some(value=>atoms.every(([,op,n])=>op==='=='?value===+n:op==='!='?value!==+n:op==='>='?value>=+n:op==='<='?value<=+n:op==='>'?value>+n:value<+n));
  }));
}
export function matchesSkillFilters(id:number,s:SkillReference,f:SkillFilters):boolean {
  const inherited=String(id).startsWith('9'),rarity=inherited?'inherited':s.rarity===2?'gold':s.rarity===6?'evolved':'white';
  if(f.rarity.length&&!f.rarity.includes(rarity))return false;
  if(f.strategy.length&&!explicitCondition(s,'running_style',f.strategy))return false;
  if(f.distance.length&&!explicitCondition(s,'distance_type',f.distance))return false;
  if(f.surface.length&&!explicitCondition(s,'ground_type',f.surface))return false;
  const phase=(values:number[])=>['phase','phase_random','phase_firsthalf_random','phase_laterhalf_random'].some(key=>explicitCondition(s,key,values));
  if(f.phase.length&&!f.phase.some(p=>p==='corner'?['is_finalcorner','is_finalcorner_random','is_finalcorner_laterhalf'].some(key=>explicitCondition(s,key,[1])):p==='straight'?['is_last_straight','is_last_straight_onetime','last_straight_random'].some(key=>explicitCondition(s,key,[1]))||s.branches.some(b=>/is_finalcorner==1/.test(b.condition)&&/corner==0/.test(b.condition)):p==='spurt'?explicitCondition(s,'is_lastspurt',[1])||phase([3]):phase(p==='opening'?[0]:p==='middle'?[1]:[2,3])))return false;
  const effects=s.branches.flatMap(b=>b.effects),debuff=effects.some(e=>e.rawValue<0)||Math.floor((s.iconId??0)/10000)===3;
  if(f.effect.length&&!f.effect.some(id=>id==='debuff'?debuff:!debuff&&effects.some(e=>(effectFilters.find(f=>f.id===id)?.types as readonly number[]|undefined)?.includes(e.type))))return false;
  return true;
}
export function skillSearch(reference:ReferenceData,query:string,owned:number[]=[],showUnreleased=false,filters:SkillFilters=emptySkillFilters()){
  const inventory=new Set(owned);
  return Object.entries(reference.metadata.skills).filter(([id,s])=>!nativeUnique(s)&&!inventory.has(Number(id))&&(showUnreleased||!isUnreleased(s))&&matchesSkillFilters(Number(id),s,filters)).map(([id,s])=>{
    const aliases=(owners[id]??[]).flatMap(card=>[reference.metadata.characters[Math.floor(card/100)],reference.metadata.outfits[card]]).filter(Boolean).join(' ');
    return {id:Number(id),name:editorSkillName(reference,Number(id)),skill:s,supported:reference.engineSkillIds?.has(id),score:fuzzyScore(query,`${skillName(reference,Number(id))} ${aliases} ${id}`)};
  }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
}
