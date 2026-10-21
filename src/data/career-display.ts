import facts from './career-reference.json';
import fallback from './career-fallback.json';
import type {CareerRecord,CareerFactor,CareerSupport} from './career';
import type {Runner} from './types';
export const careerReference={...facts,supports:{...fallback.supports,...facts.supports}} as unknown as {
  ranks:{id:number;min:number;max:number;label:string}[];
  supports:Record<string,{name:string;charaId:number;rarity:number;type:number;command:number}>;
  scenarios:Record<string,string>;supportLevels:Record<string,number[][]>;epithets:Record<string,string>;
  factors:Record<string,{name:string;group:number;stars:number;type:number;skillIds:number[]}>;
  programs:Record<string,{name:string;raceId:number;grade:number;courseId:number;month:number;half:number}>;
  saddles:Record<string,string>;relations:Record<string,Record<string,number>>;
  turns:Record<string,Record<string,[number,number,number]>>;
  g1Races:Record<string,string>;g1Artwork:Record<string,number>;g1Wins:Record<string,{name:string;races:number[];condition:number}>;
};
export function rating(score:number|null|undefined,rank?:number|null){return score!=null?careerReference.ranks.find(r=>score>=r.min&&score<=r.max)??null:rank!=null?careerReference.ranks.find(r=>r.id===rank)??null:null;}
export const scenarioName=(id:number|null|undefined)=>id==null?'Not recorded':careerReference.scenarios[id]??`Scenario ${id}`;
export function supportLevel(s:CareerSupport):number|null {
  if(s.level!==null)return s.level;
  const meta=careerReference.supports[s.id];if(!meta||s.exp===null)return null;
  return careerReference.supportLevels[meta.rarity]?.filter(([_,exp])=>exp<=s.exp!).at(-1)?.[0]??null;
}
export function legacyRunner(c:CareerRecord):Runner{return {id:'legacy',index:0,gate:null,name:'Legacy',cardId:c.cardId,charaId:c.cardId===null?null:Math.floor(c.cardId/100),trainer:c.trainerName,trainerId:c.trainerId,strategy:null,finishOrder:null,finishTime:null,stats:c.stats,aptitudes:c.aptitudes,skills:c.skills??undefined,rankScore:c.score,starCount:c.stars};}
/** Base affinity from shared relation groups; race bonuses are added separately. */
export function baseAffinity(...ids:(number|null|undefined)[]):number|null {
  if(ids.some(id=>id==null||!careerReference.relations[id!]))return null;
  if(new Set(ids).size!==ids.length)return 0;
  const groups=ids.map(id=>careerReference.relations[id!]);
  return Object.entries(groups[0]).filter(([k])=>groups.every(g=>k in g)).reduce((sum,[,points])=>sum+points,0);
}
export function factorGroups(factors:CareerFactor[]|null,skills:CareerRecord['skills']){
  const owned=new Set(skills?.map(s=>s.id)??[]);
  return (factors??[]).map(f=>{const meta=careerReference.factors[f.id];return {...f,name:meta?.name??`Factor ${f.id}`,stars:meta?.stars??f.stars??null,type:meta?.type??0,owned:!!meta?.skillIds.some(id=>owned.has(id)),skillIds:meta?.skillIds??[]};});
}
export type DisplayFactor=ReturnType<typeof factorGroups>[number]&{parentStars?:number};
/** One row per master factor group, including different star rarities of the same spark. */
export function familyFactors(family:CareerRecord[],parent:CareerRecord,selected:CareerRecord|null=null):DisplayFactor[]{
  const rows=new Map<number,DisplayFactor>();
  for(const member of selected?[selected]:family)for(const factor of factorGroups(member.factors,null)){
    const key=careerReference.factors[factor.id]?.group??factor.id,previous=rows.get(key);
    rows.set(key,{...factor,stars:previous?(previous.stars??0)+(factor.stars??0):factor.stars,
      parentStars:selected?0:(previous?.parentStars??0)+(member===parent?(factor.stars??0):0)});
  }
  return [...rows.values()];
}
export function careerDate(turn:number|null,scenario:number|null):string{
  if(turn===null)return 'Date not recorded';
  const date=scenario===null?null:careerReference.turns[scenario]?.[turn];
  if(!date)return 'Date unavailable';
  const [year,month,half]=date,part=`${half===1?'Early':'Late'} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1]}`;
  return year>=4?`${part} Finale`:`${['','Junior','Classic','Senior'][year]} Year ${part}`;
}
/** Current Global: only distinct shared G1 win records contribute +3.
 * Crown records never award an extra epithet bonus.
 * Rule reference: saved upstream calculator, src/data/VeteransHelper.ts. */
export function g1Wins(c:CareerRecord):Set<number>{
  return new Set((c.saddles??[]).filter(id=>careerReference.g1Wins[id]?.races.length===1));
}
const g1Categories=[
  {label:'Junior',ids:[33,35,34]},
  {label:'Classics & fillies',ids:[24,18,19,12,16,28,26]},
  {label:'Mile',ids:[27,21,23,25]},
  {label:'Sprint',ids:[22,20]},
  {label:'Spring',ids:[17,13,14]},
  {label:'Autumn',ids:[15,11,10]},
  {label:'Dirt',ids:[30,29,36,38,39,37,31,32,165,166,167,168]},
];
/** Venue/year variants keep their own win records but share the race's category. */
export function g1WinGroups(c:CareerRecord){
  const wins=[...g1Wins(c)].map(id=>{
    const win=careerReference.g1Wins[id],race=win.races[0];
    return {id,key:win.name,name:careerReference.g1Races[race]??win.name,art:careerReference.g1Artwork[race]};
  });
  const assigned=new Set<number>();
  const groups=g1Categories.map(({label,ids})=>{
    const names=ids.map(id=>careerReference.g1Wins[id]?.name);
    const races=wins.filter(win=>names.includes(win.key)).sort((a,b)=>names.indexOf(a.key)-names.indexOf(b.key)||a.id-b.id);
    races.forEach(r=>assigned.add(r.id));
    return {label,races};
  });
  const other=wins.filter(win=>!assigned.has(win.id));
  if(other.length)groups.push({label:'Other G1 wins',races:other});
  return groups.filter(group=>group.races.length);
}
export function raceAffinity(a:CareerRecord,b:CareerRecord):number|null{
  if(a.saddles===null||b.saddles===null)return null;
  const right=g1Wins(b);return [...g1Wins(a)].filter(id=>right.has(id)).length*3;
}
export interface Affinity {base:number|null;race:number|null;total:number|null}
const affinity=(base:number|null,race:number|null):Affinity=>({base,race,total:base===null||race===null?null:base+race});
const sum=(v:(number|null)[])=>v.some(n=>n===null)?null:v.reduce<number>((a,b)=>a+b!,0);
const character=(c:CareerRecord)=>c.cardId===null?null:Math.floor(c.cardId/100);
/** Family-only subtotal: the future trainee and the other parent are unknown. */
export function grandparentAffinity(parent:CareerRecord,gp:CareerRecord):Affinity{
  return affinity(baseAffinity(character(parent),character(gp)),raceAffinity(parent,gp));
}
export function parentAffinity(parent:CareerRecord,gps:CareerRecord[]):Affinity{
  if(gps.length!==2)return affinity(null,null);
  const children=gps.map(gp=>grandparentAffinity(parent,gp));
  return affinity(sum(children.map(c=>c.base)),sum(children.map(c=>c.race)));
}
export const whiteSparkCount=(c:CareerRecord)=>factorGroups(c.factors,null).filter(f=>[4,5,6].includes(f.type)).length;
/** Scenario sparks are evidence only when exactly one known scenario is represented. */
export function ancestorScenario(c:CareerRecord):string|null{
  if(c.scenarioId!==null)return scenarioName(c.scenarioId);
  const names=[...new Set(factorGroups(c.factors,null).filter(f=>f.type===6).map(f=>f.name))];
  return names.length===1?`${names[0]} · scenario spark`:null;
}
export function statRank(value:number|null|undefined){
  if(value==null||value<0)return null;
  // Game stat grades (not career-score grades), including the 50 and 1200 boundaries.
  // Reference: wikiru's 育成の基礎知識, stat-rank table; Global atlas ends at US9.
  if(value>2000)return null;
  const minima=[0,51,100,150,200,250,300,350,400,500,600,700,800,900,1000,1050,1100,1150];
  const index=value<=1200?minima.filter(n=>value>=n).length-1:Math.min(97,18+Math.floor((value-1200)/10));
  const label=careerReference.ranks[index]?.label;
  return label?{index,label}:null;
}
export function characterUrl(runner:Runner,name:string):string|null{
  if(!runner.cardId)return null;
  const slug=(fallback.characters as Record<string,string>)[runner.cardId];
  return slug?`https://gametora.com/\u0075mamusume/characters/${slug}`:null;
}
export function supportUrl(id:number):string|null {
  const row=(fallback.supports as Record<string,{slug:string}>)[id];
  return row?`https://gametora.com/\u0075mamusume/supports/${row.slug}`:null;
}
