import bundled from './career-reference.json';

/** Shared live career maps; readers retaining a map keep seeing fresh entries. */
export const installedCareer=structuredClone(bundled);
export let installedMasterRevision='';
export function installMasterCareer(value:unknown):void {
  const incoming=value as typeof bundled|undefined;
  const valid=incoming?.schema===2&&!!incoming.source?.sha256;
  const revision=valid?incoming!.source.sha256:'';
  if(revision===installedMasterRevision)return;
  const data=structuredClone(bundled);
  if(valid)for(const key of Object.keys(data) as (keyof typeof bundled)[]){
    const extra=incoming![key];if(!extra)continue;
    if(Array.isArray(extra))Object.assign(data,{[key]:extra});
    else if(typeof extra==='object'&&typeof data[key]==='object')Object.assign(data[key]!,extra);
  }
  for(const key of Object.keys(installedCareer) as (keyof typeof bundled)[]){
    const incoming=data[key],target=installedCareer[key];
    if(Array.isArray(target)&&Array.isArray(incoming))target.splice(0,target.length,...incoming as never[]);
    else if(target&&incoming&&typeof target==='object'&&typeof incoming==='object'){
      for(const name of Object.keys(target))delete (target as Record<string,unknown>)[name];
      Object.assign(target,incoming);
    }
  }
  installedMasterRevision=revision;
}
