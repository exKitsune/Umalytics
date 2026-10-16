export type RaceTags=Record<string,string[]>;
export function normalizeTags(value:string):string[]{
  const seen=new Set<string>();return value.split(',').map(tag=>tag.trim().slice(0,40)).filter(tag=>{
    const key=tag.toLocaleLowerCase();if(!tag||seen.has(key))return false;seen.add(key);return true;
  }).slice(0,20);
}
export function withinDateRange(timestamp:string,from:string,to:string):boolean {
  const value=new Date(timestamp);if(!Number.isFinite(value.getTime()))return !from&&!to;
  const day=`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  return (!from||day>=from)&&(!to||day<=to);
}
export function readRaceTags():RaceTags {
  try {const value=JSON.parse(localStorage.getItem('umalytics-race-tags')??'{}');if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).filter(([,tags])=>Array.isArray(tags)&&tags.every(t=>typeof t==='string')).map(([id,tags])=>[id,normalizeTags((tags as string[]).join(','))]));}catch{}
  return {};
}
