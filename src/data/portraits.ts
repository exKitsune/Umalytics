import type { Runner } from './types';
import portraitIds from './portrait-ids.json';
import outfitPortraits from './outfit-portraits.json';

const available=new Set<number>(portraitIds);
const outfits:Readonly<Record<string,string>>=outfitPortraits;
/** Explicit card-to-art mapping: card IDs and costume asset IDs can differ. */
export function portraitUrl(runner:Pick<Runner,'charaId'|'cardId'>):string|null {
  const outfit=runner.cardId===null?undefined:outfits[String(runner.cardId)];
  if(outfit)return `./portraits/${outfit}`;
  const id=runner.charaId??(runner.cardId===null?null:Math.floor(runner.cardId/100));
  if(id===null||!available.has(id))return null;
  return `./portraits/chr_icon_${id}.png`;
}

interface CachedPortrait {image:HTMLImageElement;ready:Promise<void>;loaded:boolean}
const cache=new Map<string,CachedPortrait>();
function cachedPortrait(url:string):CachedPortrait|null {
  if(typeof Image==='undefined')return null;
  const cached=cache.get(url);if(cached)return cached;
  const image=new Image();let resolve:()=>void=()=>{};
  const entry:CachedPortrait={image,ready:new Promise<void>(done=>resolve=done),loaded:false};
  cache.set(url,entry);
  image.onload=()=>{entry.loaded=image.naturalWidth>0;resolve();};
  image.onerror=()=>resolve();image.src=url;return entry;
}
export function portraitImage(runner:Pick<Runner,'charaId'|'cardId'>):HTMLImageElement|null {
  const url=portraitUrl(runner),entry=url?cachedPortrait(url):null;
  return entry?.loaded?entry.image:null;
}
export async function preloadPortraits(runners:readonly Pick<Runner,'charaId'|'cardId'>[]):Promise<void> {
  await Promise.all(runners.map(r=>{const url=portraitUrl(r);return url?cachedPortrait(url)?.ready:undefined;}));
}
