import type { Race } from '../data/types';
import { parseRaceJson } from '../data/import';
import type { RaceAnalysis } from '../data/analytics';
import { rememberAnalysis } from '../data/analytics';
import type { ReferenceData } from '../data/reference';
import type { LibraryEntry } from '../library';
import { api } from '../api';
import { attachPrepared, type PreparedRace } from './prepared';
import { AnalysisStore, type CachePolicy, type CacheStatus } from './store';
import type { AnalysisGateReport, AnalysisGateReportSummary, SimulationJob, SimulationJobDetails, InferencePlanRevalidation } from '../simulation/contracts';
import { canUseInferencePlan, canUseSimulatedCapability } from '../simulation/contracts';
declare const __ANALYSIS_REVISION__:string;
export interface AnalysisState {busy:boolean;background:boolean;done:number;total:number;message:string}
interface Authorization extends InferencePlanRevalidation {cacheKey:string;artifactUrl:string;dataUrl:string;uiRevision:string}

/** No mechanics or derived cache access until a fresh service-owned gate passes. */
export class AnalysisClient {
  private worker:Worker|null=null;
  private generation=0;
  private disposed=false;
  private lease:ReturnType<typeof setTimeout>|null=null;
  private detailRequest:(()=>Promise<AnalysisGateReport|null>)|null=null;
  constructor(readonly store:AnalysisStore,private callbacks:{
    parsed:(race:Race,id:string)=>void; base:(race:Race,analysis:RaceAnalysis,id:string)=>void;
    ready:(value:PreparedRace,id:string)=>void; state:(state:AnalysisState)=>void;
    cache:(status:CacheStatus)=>void; error:(message:string)=>void;
    gate?:(report:AnalysisGateReportSummary|null,id:string)=>void; recorded?:(id:string)=>void;
    historical?:(value:PreparedRace,id:string)=>void; reference?:(reference:ReferenceData)=>void;
    token?:()=>string|undefined;
  }){}
  async configure(_reference:ReferenceData){}
  setLibrary(_library:LibraryEntry[],_assignments:Record<string,number>){} // No whole-library simulation warming.
  setPaused(_value:boolean){}
  interacting(){}
  private state(message:string,busy=false){this.callbacks.state({busy,background:false,done:0,total:0,message});}
  private stop(){this.generation++;this.worker?.terminate();this.worker=null;this.detailRequest=null;if(this.lease)clearTimeout(this.lease);this.lease=null;}
  async simulatedDetails(){return this.detailRequest?this.detailRequest():null;}
  async open(entry:LibraryEntry,_override?:number){
    this.stop();const generation=this.generation,alive=()=>!this.disposed&&generation===this.generation;
    this.callbacks.gate?.(null,entry.id);this.callbacks.recorded?.(entry.id);this.state('Opening recorded replay…',true);
    let storedHash=entry.sha256;
    try{
      let race=entry.race;
      if(entry.remoteId){const stored=await api<{data:unknown;sha256:string}>(`races/${encodeURIComponent(entry.remoteId)}`);storedHash=stored.sha256;const races=parseRaceJson(stored.data);if(races.length!==1)throw new Error('Select one saved race entry.');race=races[0];}
      if(!alive())return;
      if(!race)throw new Error('Recorded race is unavailable.');
      this.callbacks.parsed(race,entry.id);this.state('Recorded replay ready');
      const token=this.callbacks.token?.();
      if(!entry.remoteId||!storedHash||!token)return;
      const endpoint=`simulation/races/${encodeURIComponent(entry.remoteId)}`;
      let job=await api<SimulationJob>(endpoint,{expectedEntrySha256:storedHash},token);
      while(alive()&&job.phase!=='complete'){
        await new Promise(resolve=>setTimeout(resolve,350));
        if(!alive())return;job=await api<SimulationJob>(`${endpoint}?jobId=${job.jobId}`);
      }
      if(!alive()||job.phase!=='complete')return;
      const report=job.report;this.callbacks.gate?.(report,entry.id);
      if(canUseSimulatedCapability(report,'recordedResults',report.binding))this.detailRequest=async()=>{
        const detail=await api<SimulationJobDetails>(`${endpoint}?jobId=${job.jobId}&include=payloads`);
        if(!alive()||!canUseSimulatedCapability(detail.report,'recordedResults',report.binding))return null;
        return detail.report;
      };
      if(report.mode==='inference_plan'&&canUseInferencePlan(report,report.binding)){
        const authorize=()=>api<Authorization>(`${endpoint}/inference`,{jobId:job.jobId},token);
        const auth=await authorize();if(!alive())return;
        if(!auth.authorized||!auth.plan)throw new Error('Inference unavailable.');
        // Never restore legacy unqualified entries or look up cache before authorization.
        const cached=await this.store.get(auth.cacheKey).catch(()=>null);if(!alive())return;
        await authorize();if(!alive())return;
        this.state('Preparing versioned inference…',true);
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
              }else this.callbacks.historical?.(value,entry.id);
              this.state('Ready');
              await this.store.put({key:auth.cacheKey,raceId:entry.id,date:entry.receivedAt,revision:'versioned-v1'},event.data.packed);
              worker.terminate();
            }catch(error){if(alive()){this.callbacks.recorded?.(entry.id);this.callbacks.gate?.(null,entry.id);this.state('Recorded replay ready');this.callbacks.error(String(error));}}
          };
          worker.onerror=()=>{worker.terminate();if(alive()){this.callbacks.recorded?.(entry.id);this.callbacks.gate?.({...report,mode:'recorded_only'},entry.id);this.state('Recorded replay ready');this.callbacks.error('Versioned inference worker failed.');}};
          worker.postMessage({type:'run',raceId:entry.remoteId,entrySha256:storedHash,jobId:job.jobId,cacheKey:auth.cacheKey,token,cached:payload});
        };
        execute(cached);
      }
      const check=async()=>{
        try{
          await api<SimulationJob>(`${endpoint}?jobId=${job.jobId}`);
          if(report.mode==='inference_plan')await api(`${endpoint}/inference`,{jobId:job.jobId},token);
          if(alive())this.lease=setTimeout(check,2000);
        }catch{if(alive()){this.stop();this.callbacks.recorded?.(entry.id);this.callbacks.gate?.(null,entry.id);this.state('Recorded replay ready');}}
      };
      if(alive())this.lease=setTimeout(check,2000);
    }catch(error){if(alive()){this.stop();this.callbacks.recorded?.(entry.id);this.callbacks.gate?.(null,entry.id);this.state('Recorded replay ready');this.callbacks.error(String(error));}}
  }
  async policy(policy:CachePolicy){this.callbacks.cache(await this.store.change({action:'policy',policy:{...policy,background:false}}));}
  async purge(){this.stop();this.callbacks.cache(await this.store.change({action:'purge'}));this.state('Cache cleared');}
  async refresh(){this.callbacks.cache(await this.store.status());}
  dispose(){this.disposed=true;this.stop();}
}
