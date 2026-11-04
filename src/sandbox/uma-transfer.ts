import {blankUma,type UmaBuild,type UmaFolder} from './model';
import {buildAptitudes,aptitudeKeys} from './aptitudes';
import {outfitUniques} from './editor';
import {type UmalatorUma} from '../data/umalator';
import type {ReferenceData} from '../data/reference';

const styles=['Nige','Senkou','Sasi','Oikomi','Oonige'];
const styleKeys=['front','pace','late','end','front'] as const;
const grades='GFEDCBAS';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Keep the complete library build beside the interoperable single-Uma fields. */
export function exportUma(uma:UmaBuild,folders:UmaFolder[],reference:ReferenceData){
  const aptitudes=buildAptitudes(uma),context=uma.exportContext;
  const best=(keys:readonly (typeof aptitudeKeys[number])[])=>keys.reduce((a,b)=>grades.indexOf(aptitudes[b])>grades.indexOf(aptitudes[a])?b:a);
  const style=best(['pace','front','late','end']);
  const strategy=context?.strategy??styles[styleKeys.indexOf(style as typeof styleKeys[number])];
  const own=outfitUniques(reference,uma.cardId).find(id=>uma.skills.some(s=>s.id===id));
  const uniqueLv=uma.skills.find(s=>s.id===own)?.level??context?.uniqueLv??1;
  const skills=uma.skills.flatMap(s=>{const original=context?.skills.filter(id=>Number(id.split('-')[0])===s.id);return original?.length?original:[String(s.id)];});
  // Imported context chooses the same simulator inputs on re-export. Builds
  // without a race use their strongest grades, Pace on ties, and Normal mood.
  const payload:UmalatorUma={outfitId:String(uma.cardId),starCount:context?.starCount??3,uniqueLv,
    speed:uma.stats.speed!,stamina:uma.stats.stamina!,power:uma.stats.power!,guts:uma.stats.guts!,wisdom:uma.stats.wisdom!,
    strategy,distanceAptitude:context?.distanceAptitude??aptitudes[best(['middle','short','mile','long'])],
    surfaceAptitude:context?.surfaceAptitude??aptitudes[best(['turf','dirt'])],
    strategyAptitude:context?.strategyAptitude??aptitudes[style],mood:context?.mood??0,skills,
    forcedSkillPositions:context?.forcedSkillPositions??{}};
  return {...payload,kind:'umalytics-uma' as const,schemaVersion:1,uma:structuredClone(uma),
    folders:folders.filter(f=>f.id===uma.folderId)};
}

function readNative(value:Record<string,any>):UmalatorUma{
  for(const key of ['speed','stamina','power','guts','wisdom'])if(!Number.isInteger(value[key])||value[key]<1||value[key]>2000)throw new Error(`Enter a valid ${key} stat (1–2000).`);
  if(typeof value.outfitId!=='string'||!/^\d+$/.test(value.outfitId)||!Number.isSafeInteger(Number(value.outfitId))||Number(value.outfitId)<1)throw new Error('Uma JSON needs an outfit ID.');
  if(!styles.includes(value.strategy))throw new Error('Uma JSON has an invalid running style.');
  for(const key of ['distanceAptitude','surfaceAptitude','strategyAptitude'])if(typeof value[key]!=='string'||!grades.includes(value[key])||value[key].length!==1)throw new Error('Uma JSON has an invalid aptitude.');
  if(!Number.isInteger(value.mood)||value.mood < -2||value.mood>2)throw new Error('Uma JSON has an invalid mood.');
  if(!Array.isArray(value.skills)||value.skills.length>256||!value.skills.every((id:unknown)=>typeof id==='string'&&/^\d+(?:-[\w]+)?$/.test(id)&&Number.isSafeInteger(Number(id.split('-')[0]))&&Number(id.split('-')[0])>0))throw new Error('Uma JSON has invalid skill IDs.');
  for(const [key,max] of [['starCount',5],['uniqueLv',6]] as const)if(value[key]!==undefined&&(!Number.isInteger(value[key])||value[key]<1||value[key]>max))throw new Error(`Uma JSON has an invalid ${key}.`);
  const forced=value.forcedSkillPositions??{};
  if(!object(forced)||Object.keys(forced).length>256||Object.entries(forced).some(([key,v])=>key.length>80||typeof v!=='string'||v.length>256))throw new Error('Uma JSON has invalid forced skill positions.');
  return {outfitId:value.outfitId,starCount:value.starCount??3,uniqueLv:value.uniqueLv??1,
    speed:value.speed,stamina:value.stamina,power:value.power,guts:value.guts,wisdom:value.wisdom,
    strategy:value.strategy,distanceAptitude:value.distanceAptitude,surfaceAptitude:value.surfaceAptitude,
    strategyAptitude:value.strategyAptitude,mood:value.mood,skills:[...value.skills],forcedSkillPositions:{...forced}};
}

export function importUmas(value:unknown,reference:ReferenceData):{umas:UmaBuild[];folders:UmaFolder[]}|null{
  if(!object(value))return null;
  if(value.kind==='umalytics-uma'&&object(value.uma))return {umas:[value.uma as UmaBuild],folders:value.folders??[]};
  if(value.kind==='umalytics-uma-library'&&value.schemaVersion===1&&Array.isArray(value.umas))return {umas:value.umas,folders:value.folders??[]};
  if(typeof value.outfitId!=='string')return null;
  const native=readNative(value),uma=blankUma(),cardId=Number(native.outfitId);
  Object.assign(uma,{cardId,charaId:Math.floor(cardId/100),name:reference.metadata.characters[Math.floor(cardId/100)]??'Imported Uma',
    stats:{speed:native.speed,stamina:native.stamina,power:native.power,guts:native.guts,wisdom:native.wisdom},exportContext:native});
  uma.aptitudes=buildAptitudes(uma);
  // The native format has just three race-specific grades. Fill the matching
  // known grades without pretending it reports every distance and surface.
  uma.aptitudes[styleKeys[styles.indexOf(native.strategy)]]=native.strategyAptitude as any;
  const own=new Set(outfitUniques(reference,cardId));
  uma.skills=[...new Set(native.skills.map(id=>Number(id.split('-')[0])))].map(id=>({id,level:own.has(id)?native.uniqueLv??1:1}));
  return {umas:[uma],folders:[]};
}
