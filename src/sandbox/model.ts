import type {Race,Runner,RunnerStats,RunnerSkill} from '../data/types';
import {runnerName,type ReferenceData} from '../data/reference';
import {normalizePopularity,normalizeTeams} from './editor';
import {buildAptitudes,syncParticipantAptitudes,type UmaAptitudes,type RaceAptitude} from './aptitudes';

export type Aptitude='G'|'F'|'E'|'D'|'C'|'B'|'A'|'S';
export interface UmaBuild {id:string;name:string;memo:string;charaId:number;cardId:number;stats:RunnerStats;aptitudes?:UmaAptitudes;skills:RunnerSkill[];fans:number;careerWins:number;folderId?:string;tags?:string[];favorite?:boolean;archived?:boolean;createdAt?:string;updatedAt?:string;variantOf?:string}
export interface UmaFolder {id:string;name:string;color:string;icon:string}
export interface Participant {id:string;uma:UmaBuild;surface:Aptitude;distance:Aptitude;strategyAptitude:Aptitude;aptitudeOverrides?:Partial<Record<RaceAptitude,Aptitude>>;strategy:number;mood:number;randomizeMood:boolean;gate:number;team:number|null;popularity:number}
export interface Setup {schemaVersion:1;id:string;name:string;courseId:number;weather:number;ground:number;season:number;time:number;grade:number;seed:number;keepSeed:boolean;shuffleGates:boolean;moodOverride?:{mode:'fixed';mood:number}|{mode:'random'};count:number;participants:Participant[];variations?:{participantId:string;builds:UmaBuild[]}}
export interface Library {umas:UmaBuild[];folders?:UmaFolder[];setups:Setup[];conditions:{id:string;name:string;courseId:number;weather:number;ground:number;season:number;time:number;grade:number}[];templates:{id:string;name:string;skills:RunnerSkill[]}[]}
export interface SkillSample {id:number;activated:boolean;checks:number;passed:number;effectiveness:number|null;gain:number|null;time:number|null;cost:number|null;carryover?:number|null;carryoverTime?:number|null}
export interface RunnerSummary {id:string;name:string;slot?:number;place:number;time:number;hp:number|null;traffic:number|null;exhausted:boolean|null;fullSpurt:boolean|null;gain:number|null;gainTime:number|null;carryover:number|null;power:number|null;powerTime:number|null;effectiveness:number|null;metrics?:Record<string,number|null>;skills:SkillSample[]}
export interface RunSummary {outcomeOnly?:boolean;index:number;seed:number;moods:number[];gates:number[];variantIndex?:number;variantLabel?:string;runners:RunnerSummary[]}
export interface Job {autoImpact?:boolean;runCursor?:number;runsPartial?:boolean;id:string;phase:'queued'|'running'|'complete'|'cancelled'|'failed'|'interrupted';setup:Setup;createdAt:string;engine:{version:string;profile:string;artifact_sha256:string};runs:RunSummary[];completed:number;total:number;error?:string;impactSourceId?:string;referenceKey?:string;seedSchedule?:number[]}
export const uid=()=>crypto.randomUUID();
export const randomSeed=()=>(crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1;
export const blankUma=():UmaBuild=>({id:uid(),name:'New Uma',memo:'',charaId:1001,cardId:100101,stats:{speed:1200,stamina:800,power:1000,guts:600,wisdom:1000},skills:[],fans:0,careerWins:0,favorite:false});
export const blankSetup=():Setup=>({schemaVersion:1,id:uid(),name:'New race',courseId:0,weather:1,ground:1,season:1,time:2,grade:100,seed:randomSeed(),keepSeed:false,shuffleGates:true,count:1,participants:[]});
export const participant=(uma:UmaBuild,index:number):Participant=>syncParticipantAptitudes({id:uid(),uma:structuredClone(uma),surface:'A',distance:'A',strategyAptitude:'A',aptitudeOverrides:{},strategy:2,mood:3,randomizeMood:false,gate:index+1,team:null,popularity:index+1},undefined);
export function rank(value:unknown):Aptitude|null {if(typeof value==='string'&&/^[GFEDCBAS]$/.test(value))return value as Aptitude;return typeof value==='number'&&value>=1&&value<=8?'GFEDCBAS'[value-1] as Aptitude:null;}
export function fromRace(race:Race,reference:ReferenceData):{setup:Setup;warnings:string[]}{
  const setup=blankSetup(),warnings:string[]=[];const course=reference.courses[race.courseId??0];
  Object.assign(setup,{name:race.title||'Imported race',courseId:race.courseId??0,seed:race.randomSeed??race.raw?.randomSeed??setup.seed,keepSeed:true,shuffleGates:false});
  if(!course)warnings.push('Choose a course; it was not recorded.');
  for(const [key,raw,max] of [['weather',race.conditions?.weather,4],['ground',race.conditions?.ground,4],['season',race.conditions?.season,5],['time',race.conditions?.timeOfDay,4],['grade',race.grade,1000]] as const){
    const aliases:Record<string,number>={sunny:1,cloudy:2,rainy:3,snowy:4,good:1,firm:1,yielding:2,soft:3,heavy:4,spring:1,summer:2,autumn:3,winter:4,sakura:5,none:0,morning:1,midday:2,evening:3,night:4,g1:100,g2:200,g3:300,op:400};
    const n=raw==null?NaN:aliases[String(raw).toLowerCase()]??Number(raw);
    if(Number.isFinite(n)&&n>=0&&n<=max)setup[key]=n;else warnings.push(`${key}: using the displayed default; confirm before running.`);
  }
  if(race.randomSeed==null&&race.raw?.randomSeed==null)warnings.push('Original seed unavailable; a new seed was generated.');
  setup.participants=race.runners.map((r,index)=>{
    const uma=blankUma();Object.assign(uma,{name:runnerName(reference,r),charaId:r.charaId??1001,cardId:r.cardId??100101,skills:structuredClone(r.skills??[]),fans:r.fanCount??0,careerWins:r.raceWinCount??0});
    for(const k of ['speed','stamina','power','guts','wisdom'] as const){uma.stats[k]=r.stats?.[k]??null;if(uma.stats[k]==null)warnings.push(`${r.name}: enter missing ${k}.`);}
    uma.aptitudes=buildAptitudes(uma);for(const key of Object.keys(uma.aptitudes) as (keyof UmaAptitudes)[]){const value=rank(r.aptitudes?.[key]);if(value)uma.aptitudes[key]=value;}
    const p=participant(uma,index),distance=course?.distance??race.distance??0;
    const surface=course?.surface===2?'dirt':'turf',length=distance<=1400?'short':distance<=1800?'mile':distance<=2400?'middle':'long';
    const strategy=r.strategyCode??2,style=({1:'front',2:'pace',3:'late',4:'end',5:'front'} as const)[strategy as 1]??'pace';
    Object.assign(p,{strategy,mood:r.mood??3,gate:r.gate??index+1,team:r.teamGroup??index,popularity:r.popularity??index+1});
    for(const [key,value] of [['surface',r.aptitudes?.[surface]],['distance',r.aptitudes?.[length]],['strategyAptitude',r.aptitudes?.[style]]] as const){const v=rank(value);if(v)p[key]=v;else warnings.push(`${r.name}: ${key} missing; using the outfit default.`);}
    if(r.mood==null)warnings.push(`${r.name}: mood missing; using Normal.`);
    if(r.strategyCode==null)warnings.push(`${r.name}: strategy missing; using Pace.`);
    return syncParticipantAptitudes(p,course);
  });
  setup.participants=normalizeTeams(normalizePopularity(setup.participants));
  return {setup,warnings};
}
export const strategyNames=['','Front','Pace','Late','End','Runaway'];
export const moodNames=['','Awful','Bad','Normal','Good','Great'];
