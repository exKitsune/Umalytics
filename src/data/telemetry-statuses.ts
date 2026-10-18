import {telemetryStatusKinds} from './status-presentation';

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
