import type {ReferenceData} from '../data/reference';
import {outfitUniques,nativeUnique} from '../sandbox/editor';
import {fuzzyScore} from '../sandbox/search';
export const statKeys=['speed','stamina','power','guts','wisdom'] as const;
export type Stat=typeof statKeys[number];
export interface OcrWord {text:string;confidence:number;bbox:{x0:number;y0:number;x1:number;y1:number}}
export interface OcrLine extends OcrWord {words:OcrWord[]}
export interface SkillReading {text:string;confidence:number;image:number;iconId?:number;nativeUnique?:boolean}
export interface ScreenshotReading {image:number;lines:OcrLine[];skills:SkillReading[];stats:Partial<Record<Stat,number>>;aptitudes:Record<string,string>}
export interface SkillChoice {id:number;name:string;score:number}
export interface RecognizedSkill {id:number;name:string;level:number;sources:number[];confidence:number}
export interface ImportResult {cardId:number|null;cardChoices:number[];stats:Record<Stat,number|null>;statChoices:Record<Stat,number[]>;aptitudes:Record<string,string>;skills:RecognizedSkill[];unresolved:{text:string;image:number;choices:SkillChoice[];nativeUnique?:boolean}[];warnings:string[]}
export function normalizeText(value:string):string{return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’‘]/g,"'").replace(/[\[\]']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
function skillText(value:string):string{return normalizeText(value.replace(/[◎©®]/g,' oo ').replace(/[○◯°]/g,' o ').replace(/[×✕]/g,' x ').replace(/\bLv[l.]?\s*[1-6]\b/gi,'').replace(/^\|\s*/,'I '));}
export function similarity(a:string,b:string):number {
  if(a===b)return 1;if(!a.length||!b.length)return 0;
  let last=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,last[j]+1,last[j-1]+(a[i-1]===b[j-1]?0:1));last=next;}
  return 1-last[b.length]/Math.max(a.length,b.length);
}
export function skillCandidates(text:string,reference:ReferenceData,cardId:number|null,iconId?:number):SkillChoice[]{
  const query=skillText(text),own=cardId?new Set(outfitUniques(reference,cardId)):new Set<number>();
  if(query.length<4)return [];
  const choices:SkillChoice[]=[];
  for(const [key,skill] of Object.entries(reference.metadata.skills)){
    const id=Number(key);if(skill.rarity>=3&&!own.has(id))continue;
    if(iconId!==undefined&&skill.iconId!==iconId)continue;
    if(id>=900000&&own.has(id-800000))continue;
    const name=skill.name||reference.metadata.skillNames[key];if(!name)continue;
    const normalized=skillText(name.replace(/ \(inherited\)$/i,''));
    const marker=query.endsWith(' oo')?' oo':query.endsWith(' o')?' o':null;
    if(marker&&!normalized.endsWith(marker))continue;
    if(Math.abs(normalized.length-query.length)>Math.max(5,query.length*.3))continue;
    const score=similarity(query,normalized);if(score>=.65)choices.push({id,name,score});
  }
  return choices.sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,5);
}
/** Manual correction is broader than automatic matching and never auto-selects. */
export function reviewSkillCandidates(text:string,reference:ReferenceData,cardId:number|null,nativeEvidence=false):SkillChoice[]{
  const query=skillText(text),own=new Set(cardId?outfitUniques(reference,cardId):[]);if(!query)return [];
  return Object.entries(reference.metadata.skills).flatMap(([key,skill])=>{
    const id=Number(key),name=skill.name||reference.metadata.skillNames[key];
    if(!name)return [];
    if(nativeEvidence?(!nativeUnique(skill)||cardId!==null&&!own.has(id)):(skill.rarity>=3&&!own.has(id)||id>=900000&&own.has(id-800000)))return [];
    const normalized=skillText(name),fuzzy=fuzzyScore(query,normalized),distance=similarity(query,normalized);
    const score=normalized===query?3:normalized.includes(query)?2+query.length/normalized.length:distance+(fuzzy>0?.25:0);
    return score>=.45?[{id,name,score}]:[];
  }).sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,8);
}
export function identifyOutfits(lines:OcrLine[],reference:ReferenceData):number[]{
  // Sparse OCR can split one name or outfit across several adjacent lines.
  const text=lines.flatMap((_,i)=>[1,2,3].map(n=>normalizeText(lines.slice(i,i+n).map(l=>l.text).join(' ')))),candidates:{id:number;score:number}[]=[];
  for(const [key,outfit] of Object.entries(reference.metadata.outfits)){
    const id=Number(key),name=reference.metadata.characters[Math.floor(id/100)];if(!name)continue;
    const a=normalizeText(outfit),b=normalizeText(name);
    const outfitScore=Math.max(0,...text.filter(l=>Math.abs(l.length-a.length)<a.length*.35).map(l=>similarity(l,a)));
    const nameScore=Math.max(0,...text.filter(l=>Math.abs(l.length-b.length)<b.length*.3).map(l=>similarity(l,b)));
    if(outfitScore>=.88&&nameScore>=.8)candidates.push({id,score:outfitScore+nameScore});
  }
  return candidates.sort((a,b)=>b.score-a.score).slice(0,1).map(c=>c.id);
}
export function uniqueOutfits(readings:ScreenshotReading[],reference:ReferenceData):number[]{
  const owners=new Map<number,number[]>();
  for(const id of Object.keys(reference.metadata.outfits).map(Number))for(const skill of outfitUniques(reference,id))owners.set(skill,[...owners.get(skill)??[],id]);
  const matches:number[]=[];
  for(const row of readings.flatMap(r=>r.skills).filter(r=>r.nativeUnique&&/\bLv[l.]?\s*[1-6]\b/i.test(r.text))){
    const choices=[...owners].map(([id,cards])=>({cards,score:similarity(skillText(row.text),skillText(reference.metadata.skills[id].name))})).sort((a,b)=>b.score-a.score);
    const best=choices[0];if(!best||best.score<.86)continue;
    const plausible=choices.filter(c=>best.score-c.score<.07),cards=[...new Set(plausible.flatMap(c=>c.cards))];
    if(cards.length===1)matches.push(cards[0]);
  }
  return [...new Set(matches)];
}
export function mergeScreenshots(readings:ScreenshotReading[],reference:ReferenceData,override?:number|null):ImportResult {
  const cardChoices=[...new Set([...readings.flatMap(r=>identifyOutfits(r.lines,reference)),...uniqueOutfits(readings,reference)])];
  const cardId=override??(cardChoices.length===1?cardChoices[0]:null),warnings:string[]=[];
  if(cardChoices.length>1)warnings.push('The header or native unique identifies different Umas. Choose the correct outfit and check the merged skills.');
  const stats={} as ImportResult['stats'],statChoices={} as ImportResult['statChoices'];
  for(const key of statKeys){const choices=[...new Set(readings.flatMap(r=>r.stats[key]===undefined?[]:[r.stats[key]!]))];statChoices[key]=choices;stats[key]=choices.length===1?choices[0]:null;if(choices.length>1)warnings.push(`Conflicting ${key==='wisdom'?'Wit':key} values: ${choices.join(', ')}.`);}
  const aptitudes:Record<string,string>={};
  for(const r of readings)for(const [k,v] of Object.entries(r.aptitudes)){if(aptitudes[k]&&aptitudes[k]!==v){aptitudes[k]='?';}else if(!aptitudes[k])aptitudes[k]=v;}
  const skills=new Map<number,RecognizedSkill>(),unresolved:ImportResult['unresolved']=[];
  for(const reading of readings)for(const row of reading.skills){
    const choices=skillCandidates(row.text,reference,cardId,row.iconId),best=choices[0],level=Number(row.text.match(/\bLv[l.]?\s*([1-6])\b/i)?.[1]??1);
    if(best&&best.score>=.84&&(!choices[1]||best.score-choices[1].score>=.07)){
      const old=skills.get(best.id);if(old){old.sources=[...new Set([...old.sources,row.image])];old.level=Math.max(old.level,level);old.confidence=Math.max(old.confidence,best.score);}
      else skills.set(best.id,{id:best.id,name:best.name,level,sources:[row.image],confidence:best.score});
    }else unresolved.push({text:row.text,image:row.image,choices,nativeUnique:row.nativeUnique});
  }
  const missing=unresolved.filter(r=>{const text=skillText(r.text).replaceAll(' ','');return text.length<8||![...skills.values()].some(s=>skillText(s.name).replaceAll(' ','').includes(text));});
  return {cardId,cardChoices,stats,statChoices,aptitudes,skills:[...skills.values()],unresolved:missing,warnings};
}
