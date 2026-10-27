import reference from './career-reference.json';
import {catalog as fallback} from './catalog';
import type {RunnerSkill} from './types';
interface Price {cost:number|null;group:number;order:number;rarity:number}
const prices=reference.skills as Record<string,Price>;
const extra=fallback.prices as Record<string,{cost:number|null;steps:number[]|null}>;
const groups=new Map<number,[string,Price][]>();
for(const entry of Object.entries(prices)){
  const group=groups.get(entry[1].group)??[];group.push(entry);groups.set(entry[1].group,group);
}
const stepCost=(id:number)=>prices[id]?.cost??extra[id]?.cost??null;
/** Undiscounted acquisition cost. Prerequisites shared by equipped upgrades count once. */
export function skillCost(id:number):{cost:number|null;steps:number[];free:boolean}{
  const row=prices[id];if(!row){
    const value=extra[id],steps=value?.steps;
    if(!steps||steps.some(id=>stepCost(id)===null))return {cost:null,steps:[],free:false};
    return {cost:steps.reduce((sum,id)=>sum+stepCost(id)!,0),steps,free:steps.length===0};
  }
  if(row.cost===null)return {cost:[3,4,5].includes(row.rarity)?0:null,steps:[],free:[3,4,5].includes(row.rarity)};
  if(row.order<=0)return {cost:0,steps:[],free:true}; // negative traits are removed, not purchased
  const prerequisites=(groups.get(row.group)??[]).filter(([,p])=>p.order>0&&p.order<row.order&&p.cost!==null);
  const byOrder=new Map<number,[string,Price][]>();
  for(const [key,p] of prerequisites)byOrder.set(p.order,[...(byOrder.get(p.order)??[]),[key,p]]);
  if([...byOrder.values()].some(rows=>rows.length!==1))return {cost:null,steps:[],free:false};
  const steps=[...byOrder.values()].map(rows=>Number(rows[0][0])).concat(id);
  return {cost:steps.reduce((sum,id)=>sum+prices[id].cost!,0),steps,free:false};
}
export function totalSkillCost(skills:readonly RunnerSkill[]|undefined){
  const steps=new Set<number>();let unknown=0;
  for(const id of new Set(skills?.map(s=>s.id)??[])){const price=skillCost(id);if(price.cost===null)unknown++;else price.steps.forEach(x=>steps.add(x));}
  return {total:[...steps].reduce((sum,id)=>sum+stepCost(id)!,0),unknown};
}
export const skillCostHelp='Base SP cost including prerequisite upgrades; hint and event discounts are not recorded.';
