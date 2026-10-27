import {skillName,type ReferenceData} from '../data/reference';
import {totalSkillCost} from '../data/skill-cost';
import {fuzzyScore} from './search';
import {uid,type UmaBuild,type Library} from './model';

export type LibrarySort='recent'|'name'|'character'|'sp'|'speed'|'stamina'|'power'|'guts'|'wisdom';
export interface LibraryFilter {view:string;query:string;tag:string;character:string;outfit:string;sort:LibrarySort}
export const emptyFilter=():LibraryFilter=>({view:'unfiled',query:'',tag:'',character:'',outfit:'',sort:'recent'});
export const parseTags=(value:string)=>[...new Map(value.split(',').map(s=>s.trim()).filter(Boolean).map(s=>[s.toLocaleLowerCase(),s])).values()];
export function libraryIndex(library:Library,reference:ReferenceData){
  return library.umas.map((uma,index)=>({uma,index,cost:totalSkillCost(uma.skills),character:reference.metadata.characters[uma.charaId]??'',outfit:reference.metadata.outfits[uma.cardId]??'',
    search:[uma.name,uma.memo,...uma.tags??[],reference.metadata.characters[uma.charaId],reference.metadata.outfits[uma.cardId],...uma.skills.map(s=>skillName(reference,s.id))].filter(Boolean).join(' ')}));
}
export function inLibraryView(uma:UmaBuild,view:string,folders:Library['folders']=[]){
  if(view==='archive')return !!uma.archived;
  if(uma.archived)return false;
  if(view==='favorites')return !!uma.favorite;
  if(view==='unfiled')return !folders?.some(f=>f.id===uma.folderId);
  return view==='all'||uma.folderId===view.slice(7);
}
export function filterLibrary(rows:ReturnType<typeof libraryIndex>,filter:LibraryFilter,folders:Library['folders']=[]){
  return rows.filter(r=>inLibraryView(r.uma,filter.view,folders)&&(!filter.tag||r.uma.tags?.some(t=>t.toLocaleLowerCase()===filter.tag.toLocaleLowerCase()))&&(!filter.character||r.uma.charaId===Number(filter.character))&&(!filter.outfit||r.uma.cardId===Number(filter.outfit)))
    .map(r=>({...r,score:fuzzyScore(filter.query,r.search)})).filter(r=>r.score>0).sort((a,b)=>{
      if(filter.query.trim()&&a.score!==b.score)return b.score-a.score;
      if(filter.sort==='recent')return (b.uma.updatedAt??'').localeCompare(a.uma.updatedAt??'')||a.index-b.index;
      if(filter.sort==='name')return a.uma.name.localeCompare(b.uma.name);
      if(filter.sort==='character')return a.character.localeCompare(b.character)||a.outfit.localeCompare(b.outfit)||a.uma.name.localeCompare(b.uma.name);
      if(filter.sort==='sp')return b.cost.total-a.cost.total;
      return (b.uma.stats[filter.sort]??0)-(a.uma.stats[filter.sort]??0)||a.uma.name.localeCompare(b.uma.name);
    });
}
export function duplicateUma(uma:UmaBuild):UmaBuild{
  const {createdAt,updatedAt,...copy}=structuredClone(uma);
  return {...copy,id:uid(),name:`${uma.name.slice(0,150)} · variant`,favorite:false,archived:false,variantOf:uma.variantOf??uma.id};
}
export function exportUmas(library:Library,ids:string[]){
  const selected=new Set(ids),umas=library.umas.filter(u=>selected.has(u.id)),folders=new Set(umas.map(u=>u.folderId));
  return {kind:'umalytics-uma-library',schemaVersion:1,umas,folders:(library.folders??[]).filter(f=>folders.has(f.id))};
}
