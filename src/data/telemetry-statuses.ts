import {telemetryStatusKinds} from './status-presentation';
import type {StatusInterval} from './analytics';

export interface TelemetryStatusGroup {interval:StatusInterval;bursts?:StatusInterval[]}
/** Presentation envelopes only. The original intervals and inactive gaps stay exact. */
export function groupTelemetryStatuses(intervals:StatusInterval[]):TelemetryStatusGroup[]{
  const result:TelemetryStatusGroup[]=[],lastLane=new Map<string,TelemetryStatusGroup>();
  for(const interval of [...intervals].sort((a,b)=>a.start-b.start)){
    if(interval.kind!=='lane-bonus'||interval.end===null){result.push({interval});continue;}
    const key=JSON.stringify([interval.skillId,interval.evidence,interval.detail,interval.model?.speedDelta]);
    const prior=lastLane.get(key);
    if(prior&&interval.start>=prior.interval.end!&&interval.start-prior.interval.end!<=.35){
      prior.interval.end=interval.end;prior.interval.observedUntil=interval.end;prior.bursts!.push(interval);
    }else{
      const group={interval:{...interval},bursts:[interval]};lastLane.set(key,group);result.push(group);
    }
  }
  return result;
}

const key='umalytics.telemetry-hidden-statuses.v2';
export const defaultHiddenStatuses=()=>new Set(['last-spurt','force-in','conserve-power']);
export function decodeHiddenStatuses(value:string|null):Set<string>{
  try{const parsed=JSON.parse(value??'null');if(Array.isArray(parsed)&&parsed.every(v=>typeof v==='string'))return new Set(parsed.filter(v=>telemetryStatusKinds.has(v)));}catch{}
  return defaultHiddenStatuses();
}
export function readHiddenStatuses():Set<string>{
  try{const value=localStorage.getItem(key);if(value!==null)return decodeHiddenStatuses(value);const hidden=decodeHiddenStatuses(localStorage.getItem('umalytics.telemetry-hidden-statuses.v1'));hidden.add('conserve-power');saveHiddenStatuses(hidden);return hidden;}catch{return defaultHiddenStatuses();}
}
export function saveHiddenStatuses(hidden:Set<string>){
  try{localStorage.setItem(key,JSON.stringify([...hidden]));}catch{}
}

export function readPositionKeepGuides():boolean {
  try{return localStorage.getItem('umalytics.position-keep-guides')!=='false';}catch{return true;}
}
export function savePositionKeepGuides(shown:boolean){
  try{localStorage.setItem('umalytics.position-keep-guides',String(shown));}catch{}
}
