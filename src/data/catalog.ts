import bundled from './career-fallback.json';
import {installMasterCareer} from './installed-master';
import aptitudeDefaults from '../sandbox/outfit-aptitudes.json';
import {withNativeCourseProperties,type ReferenceData,type ReferenceMetadata,type CourseReference} from './reference';

/** Presentation catalog can refresh without changing a recorded analysis snapshot. */
export const catalog=structuredClone(bundled);
export const outfitAptitudes:Record<string,string[]>=structuredClone(aptitudeDefaults.cards);
export let catalogRevision=bundled.source.revision;
let latest:ReferenceMetadata['fallback'];
let installedIds=new Set<string>();
let nativeCourses:Record<string,Partial<CourseReference>>|undefined;
export interface CatalogSnapshot {schemaVersion:1;masterCareer?:unknown;nativeCourses?:Record<string,Partial<CourseReference>>;mode?:string;installedSkillIds?:string[];revision:string|null;checkedAt:string|null;updatedAt:string|null;nextCheckAt?:string|null;error:string|null;career:(typeof bundled&{aptitudes?:Record<string,string[]>})|null;fallback:ReferenceMetadata['fallback']|null}
export function installCatalog(value:CatalogSnapshot):boolean {
  if(value.schemaVersion!==1||!value.revision||!value.career||!value.fallback)return false;
  if(value.revision===catalogRevision&&latest)return false;
  for(const key of ['prices','supports','characters','skillOwners','outfitGlobalReleases'] as const){
    const rows=value.career[key];if(!rows||typeof rows!=='object'||Array.isArray(rows))return false;
  }
  // Preserve map identities for consumers that retain a lookup reference.
  for(const key of ['prices','supports','characters','skillOwners','outfitGlobalReleases'] as const){
    const target=catalog[key] as Record<string,unknown>;
    for(const id of Object.keys(target))delete target[id];
    Object.assign(target,value.mode==='local'?structuredClone(bundled[key]):{},value.career[key]);
    if(value.mode==='local')for(const [id,row] of Object.entries(value.career[key]))if(row&&typeof row==='object'&&!Array.isArray(row))target[id]={...(bundled[key] as Record<string,unknown>)[id] as object,...row};
  }
  for(const [id,grades] of Object.entries(value.career.aptitudes??{}))if(Array.isArray(grades)&&grades.length===10&&grades.every(g=>typeof g==='string'&&/^[GFEDCBAS]$/.test(g)))outfitAptitudes[id]=[...grades];
  if(value.masterCareer)installMasterCareer(value.masterCareer);
  nativeCourses=value.nativeCourses;
  installedIds=new Set(value.installedSkillIds??[]);
  catalog.source=value.career.source;latest=value.fallback;catalogRevision=value.revision;return true;
}
export function catalogReference(base:ReferenceData,_revision=catalogRevision,engineSkillIds?:Set<string>):ReferenceData {
  base=withNativeCourseProperties(base,nativeCourses);
  if(!latest)return {...base,engineSkillIds};
  const installed=new Set(base.metadata.installedGameSkillIds??[]);
  const skills={...base.metadata.skills};
  for(const [id,skill] of Object.entries(latest.skills))if(installedIds.has(id)||!skills[id]||base.metadata.fallback?.skills[id]&&!installed.has(id))skills[id]=skill;
  for(const [id,labels] of Object.entries(latest.skillTexts??{}))if(skills[id]&&!installed.has(id))skills[id]={...skills[id],...labels};
  return {...base,engineSkillIds,metadata:{...base.metadata,
    characters:{...base.metadata.characters,...latest.characters},outfits:{...base.metadata.outfits,...latest.outfits},
    skillNames:{...base.metadata.skillNames,...latest.skillNames,
      ...Object.fromEntries([...installed].filter(id=>base.metadata.skillNames[id]).map(id=>[id,base.metadata.skillNames[id]]))},skills}};
}
