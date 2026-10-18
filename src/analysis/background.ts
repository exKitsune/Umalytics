import type {LibraryEntry} from '../library';
import type {CachePolicy} from './store';

export const backgroundKey=(entry:LibraryEntry)=>`${entry.id}/${entry.sha256??entry.receivedAt}`;
/** One idle job at a time, newest race first. Aborted work stays eligible. */
export class BackgroundQueue {
  private library:LibraryEntry[]=[];
  private policy:CachePolicy={mode:'unlimited',value:1000,background:false};
  private finished=new Set<string>();
  private controller:AbortController|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private paused=false;
  private closed=false;
  private busy=false;
  private bytes=0;
  private idleAt=0;
  constructor(private run:(entry:LibraryEntry,signal:AbortSignal)=>Promise<void>,private changed:(done:number,total:number,running:boolean)=>void,private idleMs=1500){}
  setLibrary(entries:LibraryEntry[]){this.library=entries.filter(e=>e.remoteId).sort((a,b)=>(b.racedAt??b.receivedAt).localeCompare(a.racedAt??a.receivedAt)||b.id.localeCompare(a.id));this.schedule();}
  configure(policy:CachePolicy,bytes=0){this.policy=policy;this.bytes=bytes;if(!policy.background)this.controller?.abort();this.schedule();}
  pause(value:boolean){this.paused=value;if(value)this.controller?.abort();else this.touch();this.schedule();}
  touch(){this.idleAt=Date.now()+this.idleMs;this.schedule();}
  mark(entry:LibraryEntry){this.finished.add(backgroundKey(entry));this.schedule();}
  reset(){this.controller?.abort();this.finished.clear();this.touch();}
  private candidates(){return this.policy.mode==='races'?this.library.slice(0,this.policy.value):this.library;}
  private schedule(){
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    if(this.closed||this.busy||this.paused||!this.policy.background)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.next();},Math.max(0,this.idleAt-Date.now()));
  }
  private async next(){
    if(this.closed||this.busy||this.paused||!this.policy.background)return;
    const entries=this.candidates(),done=entries.filter(e=>this.finished.has(backgroundKey(e))).length;
    if(this.policy.mode==='size'&&this.bytes>=this.policy.value*1024*1024){this.changed(done,entries.length,false);return;}
    const entry=entries.find(e=>!this.finished.has(backgroundKey(e)));
    if(!entry){this.changed(done,entries.length,false);return;}
    this.busy=true;const controller=this.controller=new AbortController();this.changed(done,entries.length,true);
    try{await this.run(entry,controller.signal);if(!controller.signal.aborted)this.finished.add(backgroundKey(entry));}
    catch{if(!controller.signal.aborted)this.finished.add(backgroundKey(entry));} // Retry on a later session, not a tight failure loop.
    finally{this.busy=false;this.controller=null;this.changed(this.candidates().filter(e=>this.finished.has(backgroundKey(e))).length,this.candidates().length,false);this.idleAt=Math.max(this.idleAt,Date.now()+this.idleMs);this.schedule();}
  }
  dispose(){this.closed=true;this.controller?.abort();if(this.timer)clearTimeout(this.timer);this.timer=null;}
}
