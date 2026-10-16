import type { Race } from '../data/types';
import type { RaceAnalysis } from '../data/analytics';
import { rememberAnalysis } from '../data/analytics';
import type { ReferenceData } from '../data/reference';
import type { LibraryEntry } from '../library';
import { attachPrepared, type PreparedRace } from './prepared';
import { AnalysisStore, defaultCachePolicy, type CachePolicy, type CacheStatus } from './store';
import { digest } from './codec';
declare const __ANALYSIS_REVISION__:string;
interface Job {entry:LibraryEntry;override?:number;key:string;generation:number;foreground:boolean;race?:Race;analysis?:RaceAnalysis;partial?:PreparedRace}
export interface AnalysisState {busy:boolean;background:boolean;done:number;total:number;message:string}
export class AnalysisClient {
  private worker:Worker|null=null;
  private reference:ReferenceData|null=null;
  private revision='';
  private generation=0;
  private selection=0;
  private job:Job|null=null;
  private memory=new Map<string,PreparedRace>();
  private keys=new Map<string,Promise<string>>();
  private attempted=new Set<string>();
  private library:LibraryEntry[]=[];
  private assignments:Record<string,number>={};
  private paused=false;
  private quietUntil=0;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private disposed=false;
  private clearing=false;
  private status:CacheStatus={policy:defaultCachePolicy(),entries:[],bytes:0};
  constructor(readonly store:AnalysisStore,private callbacks:{
    parsed:(race:Race,id:string)=>void;
    base:(race:Race,analysis:RaceAnalysis,id:string)=>void;
    ready:(value:PreparedRace,id:string)=>void;
    state:(state:AnalysisState)=>void;
    cache:(status:CacheStatus)=>void;
    error:(message:string)=>void;
  }){}
  async configure(reference:ReferenceData){
    this.stop();this.revision='';this.reference=reference;this.keys.clear();this.memory.clear();this.attempted.clear();
    const generation=this.generation;
    // Portraits and styling do not invalidate calculations. Geometry does.
    const revision=await digest(__ANALYSIS_REVISION__+JSON.stringify({metadata:reference.metadata,courses:reference.courses}));
    if(generation!==this.generation||this.disposed)return;
    this.revision=revision;
    try{const status=await this.store.change({action:'revision',revision});if(generation!==this.generation||this.disposed)return;this.updateStatus(status);}catch(error){if(generation===this.generation)this.callbacks.error(`Analysis cache unavailable: ${error}`);}
    this.schedule();
  }
  setLibrary(library:LibraryEntry[],assignments:Record<string,number>){this.library=library;this.assignments=assignments;this.schedule();}
  setPaused(value:boolean){this.paused=value;this.worker?.postMessage({type:'priority',foreground:this.job?.foreground??false,paused:value||Date.now()<this.quietUntil});if(!value)this.schedule();}
  interacting(){this.quietUntil=Date.now()+700;if(!this.job?.foreground)this.worker?.postMessage({type:'priority',foreground:false,paused:true});this.schedule();}
  private updateStatus(value:CacheStatus){this.status=value;this.callbacks.cache(value);}
  private key(entry:LibraryEntry,override?:number){
    const identity=`${this.revision}/${entry.id}/${entry.sha256??entry.receivedAt}/${override??''}`;
    let key=this.keys.get(identity);
    if(!key){key=(async()=>digest(`${this.revision}/${entry.id}/${entry.raceIndex??0}/${entry.sha256??await digest(JSON.stringify(entry.race??entry))}/${override??''}`))();this.keys.set(identity,key);}
    return key;
  }
  async open(entry:LibraryEntry,override?:number){
    const selection=++this.selection;
    this.callbacks.state({busy:true,background:false,done:0,total:0,message:'Opening race…'});
    if(!this.reference||!this.revision)return;
    const key=await this.key(entry,override);if(selection!==this.selection||this.disposed)return;
    if(this.job?.key===key){this.job.foreground=true;this.job.entry=entry;this.worker?.postMessage({type:'priority',foreground:true,paused:false});if(this.job.race)this.callbacks.parsed(this.job.race,entry.id);if(this.job.analysis)this.callbacks.base(this.job.race!,this.job.analysis,entry.id);if(this.job.partial){attachPrepared(this.job.partial);rememberAnalysis(this.job.partial.race,this.reference!,this.job.partial.analysis);this.callbacks.ready(this.job.partial,entry.id);}return;}
    this.stop();
    const saved=this.memory.get(key);if(saved){this.deliver(saved,entry.id);this.schedule();return;}
    await this.start(entry,key,override,true);
  }
  private stop(){this.generation++;this.worker?.terminate();this.worker=null;this.job=null;}
  private deliver(value:PreparedRace,id:string){
    attachPrepared(value);rememberAnalysis(value.race,this.reference!,value.analysis);this.callbacks.ready(value,id);
    this.callbacks.state({busy:false,background:false,done:0,total:0,message:'Ready'});
  }
  private async start(entry:LibraryEntry,key:string,override:number|undefined,foreground:boolean,skipCache=false){
    if(this.disposed||this.clearing)return;
    const generation=++this.generation;
    const job:Job={entry,override,key,generation,foreground};this.job=job;
    let cached:Uint8Array|null=null;
    if(!skipCache)try{cached=await this.store.get(key);}catch {/* Calculation remains usable if storage is unavailable. */}
    if(this.job!==job||this.disposed)return;
    const worker=this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=async event=>{
      if(this.job!==job||this.disposed)return;
      const message=event.data;
      if(message.type==='parsed'){job.race=message.race;if(job.foreground)this.callbacks.parsed(message.race,entry.id);}
      if(message.type==='base'){job.race=message.race;job.analysis=message.analysis;job.partial={race:message.race,analysis:message.analysis,runners:{}};if(job.foreground){attachPrepared(job.partial);rememberAnalysis(message.race,this.reference!,message.analysis);this.callbacks.base(message.race,message.analysis,entry.id);}}
      if(message.type==='progress'){
        if(job.partial){job.partial={...job.partial,runners:{...job.partial.runners,[message.id]:message.runner}};if(job.foreground){attachPrepared(job.partial);this.callbacks.ready(job.partial,entry.id);}}
        this.callbacks.state({busy:true,background:!job.foreground,done:message.done,total:message.total,message:job.foreground?'Preparing runner details…':'Preparing saved races…'});
      }
      if(message.type==='corrupt'){this.stop();await this.store.change({action:'remove',key}).catch(()=>{});if(this.generation===generation+1)void this.start(entry,key,override,job.foreground,true);}
      if(message.type==='error'){this.attempted.add(key);this.stop();this.callbacks.state({busy:false,background:false,done:0,total:0,message:'Analysis failed'});if(job.foreground)this.callbacks.error(message.error);this.schedule();}
      if(message.type==='complete'){
        const value=message.value as PreparedRace;
        this.memory.set(key,value);while(this.memory.size>3)this.memory.delete(this.memory.keys().next().value!);
        this.attempted.add(key);
        if(job.foreground)this.deliver(value,entry.id);
        // Saving completes before the next job. A purge waits for this write.
        if(message.packed)try{this.updateStatus(await this.store.put({key,raceId:entry.id,date:entry.receivedAt,revision:this.revision},message.packed));}catch(error){this.callbacks.error(`Race is ready, but its analysis could not be saved: ${error}`);}
        if(this.job!==job)return;
        this.stop();this.callbacks.state({busy:false,background:false,done:0,total:0,message:'Ready'});this.schedule();
      }
    };
    worker.onerror=()=>{if(this.job===job){this.stop();this.attempted.add(key);this.callbacks.state({busy:false,background:false,done:0,total:0,message:'Analysis failed'});if(job.foreground)this.callbacks.error('Analysis worker stopped. Select the race to retry.');this.schedule();}};
    // Restoring needs only the packed result. Cloning the reference and raw
    // replay here adds avoidable main-thread work to every persistent cache hit.
    if(!cached)worker.postMessage({type:'reference',reference:this.reference});
    worker.postMessage({type:'priority',foreground:job.foreground,paused:this.paused});
    worker.postMessage(cached?{type:'run',foreground:job.foreground,cached}:{type:'run',foreground:job.foreground,data:entry.race,remoteId:entry.race?undefined:entry.remoteId,override,raceIndex:entry.raceIndex??0});
  }
  private schedule(){if(this.disposed||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;void this.warm();},800);}
  private async warm(){
    if(this.disposed||!this.revision||this.clearing)return;
    if(this.job){if(!this.job.foreground)this.worker?.postMessage({type:'priority',foreground:false,paused:this.paused||Date.now()<this.quietUntil||!this.status.policy.background});if(Date.now()<this.quietUntil)this.schedule();return;}
    if(this.paused||!this.status.policy.background||Date.now()<this.quietUntil){if(Date.now()<this.quietUntil)this.schedule();return;}
    const generation=this.generation,keys=new Set(this.status.entries.map(entry=>entry.key));
    const candidates=[...this.library].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    const limit=this.status.policy.mode==='races'?this.status.policy.value:candidates.length;
    const bytesLimit=this.status.policy.mode==='size'?this.status.policy.value*1024*1024:Infinity;
    // When a byte limit is full, newer races may replace older entries. Do not
    // cycle through old races only to immediately evict their results again.
    const oldest=this.status.entries.map(e=>e.date).sort()[0];
    for(const entry of candidates.slice(0,limit)){
      if(!entry.race&&!entry.remoteId)continue;
      if(this.status.bytes>=bytesLimit*.95&&oldest&&entry.receivedAt<oldest)continue;
      const key=await this.key(entry,this.assignments[entry.id]);if(generation!==this.generation||this.disposed)return;
      if(keys.has(key)||this.attempted.has(key))continue;
      this.callbacks.state({busy:true,background:true,done:0,total:entry.race?.runners.length??0,message:'Preparing saved races…'});
      void this.start(entry,key,this.assignments[entry.id],false);return;
    }
  }
  async policy(policy:CachePolicy){this.updateStatus(await this.store.change({action:'policy',policy}));this.setPaused(this.paused);this.schedule();}
  async purge(){this.clearing=true;this.stop();this.memory.clear();this.attempted.clear();try{this.updateStatus(await this.store.change({action:'purge'}));await this.policy({...this.status.policy,background:false});}finally{this.clearing=false;}this.callbacks.state({busy:false,background:false,done:0,total:0,message:'Cache cleared'});}
  async refresh(){this.updateStatus(await this.store.status());}
  dispose(){this.disposed=true;this.stop();if(this.timer)clearTimeout(this.timer);}
}
