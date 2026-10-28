import {parseRoute,routeHash,type WorkspaceRoute} from './navigation';
import type {Setup,UmaBuild} from './model';

export const SESSION_KEY='umalytics.workspace-session.v1';
export interface WorkspaceSession {
  schemaVersion:1;
  route?:WorkspaceRoute;
  lastCapturedId?:string;
  race?:{id:string;selected:string;time:number;speed:number};
  simulator?:{setup:Setup;warnings:string[];view:'setup'|'results';jobId?:string;editing:UmaBuild|null;editingSlot:number|null;libraryView:string};
}
const empty=():WorkspaceSession=>({schemaVersion:1});
export function readWorkspaceSession(storage?:Pick<Storage,'getItem'>):WorkspaceSession {
  try{
    const raw=(storage??localStorage).getItem(SESSION_KEY);if(!raw||raw.length>4*1024*1024)return empty();
    const value=JSON.parse(raw);if(value?.schemaVersion!==1)return empty();
    const result=empty();
    if(typeof value.lastCapturedId==='string')result.lastCapturedId=value.lastCapturedId;
    if(value.route&&['races','umas','simulator','simulation'].includes(value.route.kind))result.route=parseRoute(routeHash(value.route));
    if(value.race&&typeof value.race.id==='string'&&typeof value.race.selected==='string'&&Number.isFinite(value.race.time)&&value.race.time>=0&&[.25,.5,1,2,4].includes(value.race.speed))result.race=value.race;
    const sim=value.simulator,setup=sim?.setup;
    if(setup?.schemaVersion===1&&Array.isArray(setup.participants)&&setup.participants.length<=18&&typeof setup.id==='string'&&Number.isFinite(setup.courseId)&&setup.participants.every((p:any)=>p?.uma?.stats&&Array.isArray(p.uma.skills)&&p.uma.skills.length<=2000)&&['setup','results'].includes(sim.view)){
      result.simulator={...sim,editing:sim.editing?.stats&&Array.isArray(sim.editing.skills)?sim.editing:null,editingSlot:Number.isInteger(sim.editingSlot)&&sim.editingSlot>=0&&sim.editingSlot<setup.participants.length?sim.editingSlot:null,warnings:Array.isArray(sim.warnings)?sim.warnings.filter((s:unknown)=>typeof s==='string'):[],libraryView:typeof sim.libraryView==='string'?sim.libraryView:'unfiled'};
    }
    return result;
  }catch{return empty();}
}
let pending:Partial<WorkspaceSession>={},timer:ReturnType<typeof setTimeout>|undefined;
/** Buffer rapid field edits; update/reload hooks flush synchronously. */
export function checkpointWorkspace(patch:Partial<WorkspaceSession>){pending={...pending,...patch};clearTimeout(timer);timer=setTimeout(flushWorkspaceSession,250);}
export function flushWorkspaceSession(){
  clearTimeout(timer);timer=undefined;if(!Object.keys(pending).length)return;
  try{const raw=JSON.stringify({...readWorkspaceSession(),...pending,schemaVersion:1});if(raw.length<=4*1024*1024&&localStorage.getItem(SESSION_KEY)!==raw)localStorage.setItem(SESSION_KEY,raw);pending={};}catch{/* A storage limit must not block normal use or updating. */}
}
