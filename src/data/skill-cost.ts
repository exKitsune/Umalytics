import reference from './career-reference.json';
import type {RunnerSkill} from './types';
interface Price {cost:number|null;group:number;order:number;rarity:number}
const prices=reference.skills as Record<string,Price>;
/** Undiscounted acquisition cost. Prerequisites shared by equipped upgrades count once. */
export function skillCost(id:number):{cost:number|null;steps:number[];free:boolean}{
  const row=prices[id];if(!row)return {cost:null,steps:[],free:false};
  if(row.cost===null)return {cost:[3,4,5].includes(row.rarity)?0:null,steps:[],free:[3,4,5].includes(row.rarity)};
  if(row.order<=0)return {cost:0,steps:[],free:true}; // negative traits are removed, not purchased
  const prerequisites=Object.entries(prices).filter(([,p])=>p.group===row.group&&p.order>0&&p.order<row.order&&p.cost!==null);
  const byOrder=new Map<number,[string,Price][]>();
  for(const [key,p] of prerequisites)byOrder.set(p.order,[...(byOrder.get(p.order)??[]),[key,p]]);
  if([...byOrder.values()].some(rows=>rows.length!==1))return {cost:null,steps:[],free:false};
  const steps=[...byOrder.values()].map(rows=>Number(rows[0][0])).concat(id);
  return {cost:steps.reduce((sum,id)=>sum+prices[id].cost!,0),steps,free:false};
}
export function totalSkillCost(skills:readonly RunnerSkill[]|undefined){
  const steps=new Set<number>();let unknown=0;
  for(const id of new Set(skills?.map(s=>s.id)??[])){const price=skillCost(id);if(price.cost===null)unknown++;else price.steps.forEach(x=>steps.add(x));}
  return {total:[...steps].reduce((sum,id)=>sum+prices[id].cost!,0),unknown};
}
export const skillCostHelp='Base SP cost including prerequisite upgrades; hint and event discounts are not recorded.';
