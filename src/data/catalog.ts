import bundled from './career-fallback.json';
import type {ReferenceData,ReferenceMetadata} from './reference';

/** Presentation catalog can refresh without changing a recorded analysis snapshot. */
export const catalog=structuredClone(bundled);
export let catalogRevision=bundled.source.revision;
let latest:ReferenceMetadata['fallback'];
export interface CatalogSnapshot {schemaVersion:1;revision:string|null;checkedAt:string|null;updatedAt:string|null;nextCheckAt?:string|null;error:string|null;career:typeof bundled|null;fallback:ReferenceMetadata['fallback']|null}
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
    Object.assign(target,value.career[key]);
  }
  catalog.source=value.career.source;latest=value.fallback;catalogRevision=value.revision;return true;
}
export function catalogReference(base:ReferenceData,_revision=catalogRevision,engineSkillIds?:Set<string>):ReferenceData {
  if(!latest)return {...base,engineSkillIds};
  const skills={...base.metadata.skills};
  for(const [id,skill] of Object.entries(latest.skills))if(!skills[id]||base.metadata.fallback?.skills[id])skills[id]=skill;
  for(const [id,labels] of Object.entries(latest.skillTexts??{}))if(skills[id])skills[id]={...skills[id],...labels};
  return {...base,engineSkillIds,metadata:{...base.metadata,
    characters:{...base.metadata.characters,...latest.characters},outfits:{...base.metadata.outfits,...latest.outfits},
    skillNames:{...base.metadata.skillNames,...latest.skillNames},skills}};
}
