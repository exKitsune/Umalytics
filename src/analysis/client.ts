import type { Race } from '../data/types';
import { parseRaceJson } from '../data/import';
import type { RaceAnalysis } from '../data/analytics';
import { rememberAnalysis } from '../data/analytics';
import {assembleReferenceData,type ReferenceData} from '../data/reference';
import {readGeometry} from '../data/geometry';
import {restoreDashboard} from './dashboard-codec';
import type { LibraryEntry } from '../library';
import { api, ApiError } from '../api';
import { attachPrepared, type PreparedRace } from './prepared';
import { AnalysisStore, type CachePolicy, type CacheStatus } from './store';
import type { AnalysisGateReport, AnalysisGateReportSummary, SimulationJob, SimulationJobDetails, InferencePlanRevalidation } from '../simulation/contracts';
import { canUseInferencePlan, canUseSimulatedCapability } from '../simulation/contracts';
import { projectSimulation } from '../simulation/project';
import { digest } from './codec';
import {BackgroundQueue} from './background';
declare const __ANALYSIS_REVISION__:string;
export interface AnalysisState {busy:boolean;background:boolean;done:number;total:number;message:string}
interface Authorization extends InferencePlanRevalidation {cacheKey:string;artifactUrl:string;dataUrl:string;uiRevision:string}

/** No mechanics or derived cache access until a fresh service-owned gate passes. */
export class AnalysisClient {
  private serviceOwned=false;
  private backgroundQueue:BackgroundQueue|null=null;
  private foregroundBusy=false;
  private playbackPaused=false;
  private activeEntry:LibraryEntry|null=null;
  private foregroundState:AnalysisState={busy:false,background:false,done:0,total:0,message:''};
  private cachePolicy:CachePolicy|null=null;
  private cacheBytes=0;
  private worker:Worker|null=null;
  private generation=0;
  private disposed=false;
  private lease:ReturnType<typeof setTimeout>|null=null;
  private detailRequest:(()=>Promise<AnalysisGateReport|null>)|null=null;
  private reference:ReferenceData|null=null;
  private prepared=new Map<string,{hash:string;authorization:string;recorded:Race;value:PreparedRace;reference:ReferenceData|null}>();
  private remember(id:string,hash:string,authorization:string,recorded:Race,value:PreparedRace,reference=this.reference){
    this.prepared.delete(id);this.prepared.set(id,{hash,authorization,recorded,value,reference});
    while(this.prepared.size>3)this.prepared.delete(this.prepared.keys().next().value!);
  }
  constructor(readonly store:AnalysisStore,private callbacks:{
    parsed:(race:Race,id:string)=>void; base:(race:Race,analysis:RaceAnalysis,id:string)=>void;
    ready:(value:PreparedRace,id:string)=>void; state:(state:AnalysisState)=>void;
    cache:(status:CacheStatus)=>void; error:(message:string)=>void;
    gate?:(report:AnalysisGateReportSummary|null,id:string)=>void; recorded?:(id:string)=>void;
    historical?:(value:PreparedRace,id:string)=>void; reference?:(reference:ReferenceData)=>void;
    token?:()=>string|undefined;
  },background=true){
    if(background)this.backgroundQueue=new BackgroundQueue(async(entry,signal)=>{
      let finish!:()=>void;
      const terminal=new Promise<void>(resolve=>finish=resolve);
      const child=new AnalysisClient(this.store,{parsed:()=>{},base:()=>{},ready:()=>{},
        state:state=>{if(!state.busy)finish();},cache:status=>this.cache(status),error:()=>finish(),token:this.callbacks.token},false);
      const abort=()=>{child.dispose();finish();};signal.addEventListener('abort',abort,{once:true});
      try{if(this.reference)await child.configure(this.reference);if(signal.aborted)return;await Promise.race([Promise.all([child.open(entry),terminal]),new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))]);}
      finally{signal.removeEventListener('abort',abort);child.dispose();}
    },(done,total,running)=>{
      if(!this.foregroundBusy)this.callbacks.state(running?{busy:true,background:true,done,total,message:`Analyzing recent races · ${done} / ${total}`}:{...this.foregroundState,done,total});
    });
  }
  useService(enabled:boolean){this.serviceOwned=enabled;this.updateBackground();}
  async configure(reference:ReferenceData){this.reference=reference;this.updateBackground();}
  setLibrary(library:LibraryEntry[],_assignments:Record<string,number>){this.backgroundQueue?.setLibrary(library);}
  setPaused(value:boolean){this.playbackPaused=value;this.backgroundQueue?.pause(value||this.foregroundBusy);}
  interacting(){this.backgroundQueue?.touch();}
  private updateBackground(){if(this.cachePolicy)this.backgroundQueue?.configure({...this.cachePolicy,background:!this.serviceOwned&&this.cachePolicy.background&&!!this.reference&&!!this.callbacks.token?.()},this.cacheBytes);}
  private cache(status:CacheStatus){this.cachePolicy=status.policy;this.cacheBytes=status.bytes;this.callbacks.cache(status);this.updateBackground();}
  private state(message:string,busy=false){
    this.foregroundBusy=busy;this.foregroundState={busy,background:false,done:0,total:0,message};
    if(!busy&&this.activeEntry)this.backgroundQueue?.mark(this.activeEntry);
    this.backgroundQueue?.pause(busy||this.playbackPaused);this.callbacks.state(this.foregroundState);
  }
  private stop(){this.generation++;this.worker?.terminate();this.worker=null;this.detailRequest=null;if(this.lease)clearTimeout(this.lease);this.lease=null;}
  async simulatedDetails(){return this.detailRequest?this.detailRequest():null;}
  async open(entry:LibraryEntry,_override?:number){
    this.backgroundQueue?.pause(true);this.activeEntry=entry;this.stop();const generation=this.generation,alive=()=>!this.disposed&&generation===this.generation;
    this.callbacks.gate?.(null,entry.id);this.callbacks.recorded?.(entry.id);this.state(this.prepared.has(entry.id)?'Loading saved analysis':'Analyzing race',true);
    if(this.serviceOwned&&entry.remoteId&&this.callbacks.token?.()){await this.openService(entry,generation);return;}
    let storedHash=entry.sha256;
    try{
      let race=entry.race;
      if(entry.remoteId){const stored=await api<{data:unknown;sha256:string}>(`races/${encodeURIComponent(entry.remoteId)}`);storedHash=stored.sha256;const prior=this.prepared.get(entry.id);if(prior?.hash===storedHash)race=prior.recorded;else{const races=parseRaceJson(stored.data);if(races.length!==1)throw new Error('Select one saved race entry.');race=races[0];}}
      if(!alive())return;
      if(!race)throw new Error('Recorded race is unavailable.');
      this.callbacks.parsed(race,entry.id);
      const token=this.callbacks.token?.();
      if(!entry.remoteId||!storedHash||!token){this.state('Recorded replay ready');return;}
      const endpoint=`simulation/races/${encodeURIComponent(entry.remoteId)}`;
      let job=await api<SimulationJob>(endpoint,{expectedEntrySha256:storedHash},token);
      let pollDelay=60;
      while(alive()&&job.phase!=='complete'){
        await new Promise(resolve=>setTimeout(resolve,pollDelay));pollDelay=Math.min(350,pollDelay*1.5);
        if(!alive())return;job=await api<SimulationJob>(`${endpoint}?jobId=${job.jobId}`);
      }
      if(!alive()||job.phase!=='complete')return;
      const report=job.report;this.callbacks.gate?.(report,entry.id);
      const remembered=this.prepared.get(entry.id),warm=remembered?.hash===storedHash&&remembered.authorization===report.binding?.authorizationSha256?remembered:null;
      if(canUseSimulatedCapability(report,'recordedResults',report.binding)){
        this.state('Loading saved analysis',true);
        this.detailRequest=async()=>{
        const detail=await api<SimulationJobDetails>(`${endpoint}?jobId=${job.jobId}&include=payloads`);
        if(!alive()||!canUseSimulatedCapability(detail.report,'recordedResults',report.binding))return null;
        return detail.report;
        };
        if(warm){
          attachPrepared(warm.value);this.callbacks.ready(warm.value,entry.id);this.state('Simulator analysis ready');
          this.remember(entry.id,storedHash,report.binding!.authorizationSha256,race,warm.value);
        }else{
        const detail=await this.detailRequest();if(!alive())return;
        const cacheKey=detail&&this.reference?await digest(JSON.stringify(['replay-math-v1',__ANALYSIS_REVISION__,detail.binding?.authorizationSha256])):null;
        const cached=cacheKey?await this.store.get(cacheKey).catch(()=>null):null;
        if(!alive())return;
        this.state(cached?'Loading saved analysis':'Analyzing race',true);
        let packed:Uint8Array|undefined;
        const projected=detail&&this.reference?await new Promise<PreparedRace>((resolve,reject)=>{
          const worker=this.worker=new Worker(new URL('../simulation/analysis-worker.ts',import.meta.url),{type:'module'});
          worker.onmessage=event=>{worker.terminate();packed=event.data.packed;event.data.type==='complete'?resolve(event.data.value):reject(new Error(event.data.error));};
          worker.onerror=()=>{worker.terminate();reject(new Error('Simulation analysis calculations failed.'));};
          worker.postMessage({race,report:detail,reference:this.reference,cached,cacheKey});
        }):detail?projectSimulation(race,detail,this.reference):null;
        if(!alive())return;
        if(this.reference){const fresh=await api<SimulationJob>(`${endpoint}?jobId=${job.jobId}`);if(!alive())return;if(fresh.phase!=='complete'||!canUseSimulatedCapability(fresh.report,'recordedResults',report.binding))throw new Error('Simulation authorization changed. Reopen the race.');}
        if(projected){attachPrepared(projected);this.callbacks.ready(projected,entry.id);this.remember(entry.id,storedHash,report.binding!.authorizationSha256,race,projected);}
        this.state(projected?'Simulator analysis ready':'Recorded replay ready');
        if(packed&&cacheKey)await this.store.put({key:cacheKey,raceId:detail?.simulation?.cacheKey??entry.id,date:entry.racedAt??entry.receivedAt,revision:__ANALYSIS_REVISION__},packed).then(status=>this.cache(status)).catch(()=>{});
        this.refresh().catch(()=>{});
        }
      }
      else if(report.mode==='inference_plan'&&canUseInferencePlan(report,report.binding)){
        const authorize=()=>api<Authorization>(`${endpoint}/inference`,{jobId:job.jobId},token);
        const auth=await authorize();if(!alive())return;
        if(!auth.authorized||!auth.plan)throw new Error('Inference unavailable.');
        if(warm&&warm.value.authorization?.cacheKey===auth.cacheKey&&auth.uiRevision===__ANALYSIS_REVISION__){
          if(warm.reference)this.callbacks.reference?.(warm.reference);attachPrepared(warm.value);this.callbacks.ready(warm.value,entry.id);this.state('Ready');
          this.remember(entry.id,storedHash,report.binding!.authorizationSha256,race,warm.value,warm.reference);
        }else{
        // Never restore legacy unqualified entries or look up cache before authorization.
        const cached=await this.store.get(auth.cacheKey).catch(()=>null);if(!alive())return;
        await authorize();if(!alive())return;
        this.state(cached?'Loading saved analysis':'Analyzing race',true);
        const execute=(payload:Uint8Array|null)=>{
          const worker=this.worker=new Worker(auth.artifactUrl,{type:'module'});
          worker.onmessage=async event=>{
            if(!alive())return;
            if(event.data.type==='corrupt'){worker.terminate();await this.store.change({action:'remove',key:auth.cacheKey}).catch(()=>{});if(alive())execute(null);return;}
            if(event.data.type==='error'){worker.terminate();this.callbacks.recorded?.(entry.id);this.callbacks.gate?.({...report,mode:'recorded_only'},entry.id);this.state('Recorded replay ready');this.callbacks.error(event.data.error);return;}
            if(event.data.type!=='complete')return;
            try{
              const fresh=await authorize();if(!alive())return;
              const value=event.data.value as PreparedRace;
              if(fresh.cacheKey!==auth.cacheKey||value.authorization?.cacheKey!==auth.cacheKey)throw new Error('Stale inference output.');
              if(auth.uiRevision===__ANALYSIS_REVISION__){
                this.callbacks.reference?.(event.data.reference);attachPrepared(value);
                rememberAnalysis(value.race,event.data.reference,value.analysis);this.callbacks.ready(value,entry.id);
                this.remember(entry.id,storedHash!,report.binding!.authorizationSha256,race!,value,event.data.reference);
              }else this.callbacks.historical?.(value,entry.id);
              this.cache(await this.store.put({key:auth.cacheKey,raceId:entry.id,date:entry.racedAt??entry.receivedAt,revision:auth.uiRevision},event.data.packed));
              if(alive())this.state('Ready');worker.terminate();
            }catch(error){if(alive()){this.callbacks.recorded?.(entry.id);this.callbacks.gate?.(null,entry.id);this.state('Recorded replay ready');this.callbacks.error(String(error));}}
          };
          worker.onerror=()=>{worker.terminate();if(alive()){this.callbacks.recorded?.(entry.id);this.callbacks.gate?.({...report,mode:'recorded_only'},entry.id);this.state('Recorded replay ready');this.callbacks.error('Versioned inference worker failed.');}};
          worker.postMessage({type:'run',raceId:entry.remoteId,entrySha256:storedHash,jobId:job.jobId,cacheKey:auth.cacheKey,token,cached:payload});
        };
        execute(cached);
        }
      }else this.state('Recorded replay ready');
      const check=async()=>{
        try{
          await api<SimulationJob>(`${endpoint}?jobId=${job.jobId}`);
          if(report.mode==='inference_plan')await api(`${endpoint}/inference`,{jobId:job.jobId},token);
          if(alive()&&this.backgroundQueue)this.lease=setTimeout(check,2000);
        }catch{if(alive()){this.stop();this.callbacks.recorded?.(entry.id);this.callbacks.gate?.(null,entry.id);this.state('Recorded replay ready');}}
      };
      if(alive()&&this.backgroundQueue)this.lease=setTimeout(check,2000);
    }catch(error){if(alive()){this.stop();this.callbacks.recorded?.(entry.id);this.callbacks.gate?.(null,entry.id);this.state('Recorded replay ready');this.callbacks.error(String(error));}}
  }
  private async openService(entry:LibraryEntry,generation:number){
    const alive=()=>!this.disposed&&generation===this.generation;
    const endpoint=`analysis/races/${encodeURIComponent(entry.remoteId!)}`,token=this.callbacks.token!()!;
    type Saved={phase:string;key:string;entrySha256:string;revision:string;hasAnalysis:boolean;report:AnalysisGateReportSummary};
    const authorize=()=>api<Saved>(endpoint,{expectedEntrySha256:entry.sha256,revision:__ANALYSIS_REVISION__},token);
    try{
      let saved=await authorize(),delay=60;
      while(alive()&&saved.phase!=='complete'){
        await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(350,delay*1.5);
        if(!alive())return;saved=await authorize();
      }
      if(!alive())return;
      this.callbacks.gate?.(saved.report,entry.id);
      const prior=this.prepared.get(entry.id);
      if(saved.hasAnalysis){
        const warm=prior?.authorization===saved.key&&prior.hash===saved.entrySha256?prior:null;
        const restored=warm?{value:warm.value,reference:warm.reference,recorded:warm.recorded}:await new Promise<{value:PreparedRace;reference:ReferenceData;recorded:Race}>((resolve,reject)=>{
          const worker=this.worker=new Worker(new URL('./dashboard-worker.ts',import.meta.url),{type:'module'});
          worker.onmessage=event=>{worker.terminate();if(event.data.type!=='complete'){reject(new Error(event.data.error));return;}try{const saved=JSON.parse(new TextDecoder().decode(event.data.bytes)),data=saved.referenceData;resolve({value:restoreDashboard(saved),recorded:saved.recorded,reference:assembleReferenceData(data.metadata,data.courses,data.source,data.skillIds,readGeometry(data.geometry))});}catch(error){reject(error);}};
          worker.onerror=()=>{worker.terminate();reject(new Error('Saved dashboard could not be loaded.'));};
          worker.postMessage({url:`/api/${endpoint}?key=${saved.key}`});
        });
        if(!alive())return;
        if(restored.reference)this.callbacks.reference?.(restored.reference);
        this.callbacks.parsed(restored.recorded,entry.id);attachPrepared(restored.value);this.callbacks.ready(restored.value,entry.id);
        this.remember(entry.id,saved.entrySha256,saved.key,restored.recorded,restored.value,restored.reference);
        this.state('Ready');
      }else{
        const recorded=prior?.hash===saved.entrySha256?prior.recorded:parseRaceJson((await api<{data:unknown}>(`races/${encodeURIComponent(entry.remoteId!)}`)).data)[0];
        if(!alive())return;this.callbacks.parsed(recorded,entry.id);this.state('Recorded data ready');
      }
      const key=saved.key;
      const check=async()=>{
        try{
          const current=await authorize();
          if(!alive())return;
          if(current.key!==key){this.prepared.delete(entry.id);void this.open(entry);return;}
        }catch(error){
          if(!alive())return;
          if(error instanceof ApiError&&error.status===409){this.prepared.delete(entry.id);void this.open({...entry,sha256:undefined});return;}
          // A transport failure does not retract the last valid result or invent
          // an unknown game version. Retry against the same stable identity.
        }
        if(alive())this.lease=setTimeout(check,15000);
      };
      if(alive())this.lease=setTimeout(check,15000);
    }catch(error){
      if(!alive())return;
      try{const stored=await api<{data:unknown}>(`races/${encodeURIComponent(entry.remoteId!)}`);if(alive())this.callbacks.parsed(parseRaceJson(stored.data)[0],entry.id);}catch{}
      if(alive()){this.callbacks.recorded?.(entry.id);this.state('Recorded data ready');this.callbacks.error(String(error));}
    }
  }
  async policy(policy:CachePolicy){this.cache(await this.store.change({action:'policy',policy}));}
  async purge(){this.backgroundQueue?.reset();this.stop();this.prepared.clear();this.cache(await this.store.change({action:'purge'}));this.state('Cache cleared');}
  async refresh(){this.cache(await this.store.status());}
  dispose(){this.disposed=true;this.backgroundQueue?.dispose();this.stop();this.prepared.clear();}
}
