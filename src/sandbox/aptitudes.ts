import {outfitAptitudes} from '../data/catalog';
import type {CourseReference} from '../data/reference';
import type {Aptitude,Participant,UmaBuild} from './model';
export const aptitudeKeys=['turf','dirt','short','mile','middle','long','front','pace','late','end'] as const;
export type AptitudeKey=typeof aptitudeKeys[number];
export type UmaAptitudes=Record<AptitudeKey,Aptitude>;
export type RaceAptitude='surface'|'distance'|'strategyAptitude';
export const aptitudeGroups=[{label:'Track',keys:[['turf','Turf'],['dirt','Dirt']]},{label:'Distance',keys:[['short','Sprint'],['mile','Mile'],['middle','Medium'],['long','Long']]},{label:'Style',keys:[['front','Front'],['pace','Pace'],['late','Late'],['end','End']]}] as const;
export function defaultAptitudes(cardId:number):UmaAptitudes {
  const values=outfitAptitudes[String(cardId)]??[];
  return Object.fromEntries(aptitudeKeys.map((key,i)=>[key,/^[GFEDCBAS]$/.test(values[i]??'')?values[i]:'G'])) as UmaAptitudes;
}
export function buildAptitudes(uma:Pick<UmaBuild,'cardId'|'aptitudes'>):UmaAptitudes {
  const defaults=defaultAptitudes(uma.cardId);
  return Object.fromEntries(aptitudeKeys.map(key=>[key,/^[GFEDCBAS]$/.test(uma.aptitudes?.[key]??'')?uma.aptitudes![key]:defaults[key]])) as UmaAptitudes;
}
type Course=Pick<CourseReference,'distance'|'surface'>|undefined;
export function raceAptitudeKeys(course:Course,strategy:number):Record<RaceAptitude,AptitudeKey>{
  const length=course?.distance??2000;
  return {surface:course?.surface===2?'dirt':'turf',distance:length<=1400?'short':length<=1800?'mile':length<=2400?'middle':'long',strategyAptitude:({1:'front',2:'pace',3:'late',4:'end',5:'front'} as const)[strategy as 1]??'pace'};
}
export function savedRaceAptitudes(p:Participant,course:Course):Record<RaceAptitude,Aptitude>{const grades=buildAptitudes(p.uma),keys=raceAptitudeKeys(course,p.strategy);return {surface:grades[keys.surface],distance:grades[keys.distance],strategyAptitude:grades[keys.strategyAptitude]};}
export function syncParticipantAptitudes(p:Participant,course:Course):Participant {
  const saved=savedRaceAptitudes(p,course),overrides=p.aptitudeOverrides??Object.fromEntries((Object.keys(saved) as RaceAptitude[]).filter(k=>p[k]!==saved[k]).map(k=>[k,p[k]]));
  return {...p,uma:{...p.uma,aptitudes:buildAptitudes(p.uma)},...saved,...overrides,aptitudeOverrides:{...overrides}};
}
export function setRaceAptitude(p:Participant,key:RaceAptitude,value:Aptitude|undefined,course:Course):Participant {
  const normalized=syncParticipantAptitudes(p,course),overrides={...normalized.aptitudeOverrides},saved=savedRaceAptitudes(p,course);
  if(value===undefined||value===saved[key])delete overrides[key];else overrides[key]=value;
  return syncParticipantAptitudes({...normalized,aptitudeOverrides:overrides},course);
}
export function replaceParticipantBuild(p:Participant,uma:UmaBuild,course:Course):Participant {
  const active=syncParticipantAptitudes(p,course),before=buildAptitudes(p.uma),after=buildAptitudes(uma),keys=raceAptitudeKeys(course,p.strategy),overrides={...active.aptitudeOverrides};
  for(const field of Object.keys(keys) as RaceAptitude[])if(p.uma.cardId!==uma.cardId||before[keys[field]]!==after[keys[field]])delete overrides[field];
  return syncParticipantAptitudes({...p,uma:structuredClone(uma),aptitudeOverrides:overrides},course);
}
export function runnerAptitudes(p:Participant,course:Course):UmaAptitudes {const active=syncParticipantAptitudes(p,course),keys=raceAptitudeKeys(course,p.strategy);return {...buildAptitudes(p.uma),[keys.surface]:active.surface,[keys.distance]:active.distance,[keys.strategyAptitude]:active.strategyAptitude};}
