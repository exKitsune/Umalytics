/** A single cancellable long poll per window; periodic library refresh remains a fallback. */
export function watchServiceEvents(changed:(event:{library:boolean;analysis:boolean})=>void){
  const abort=new AbortController();let revision=0,library=0,analysis=0;
  void (async()=>{
    while(!abort.signal.aborted){
      try{
        const response=await fetch(`/api/analysis/events?after=${revision}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
        if(!response.ok)throw new Error('Event stream unavailable.');
        const next=await response.json();
        if(![next.revision,next.library,next.analysis].every(Number.isSafeInteger))throw new Error('Invalid event counters.');
        const event={library:next.library!==library,analysis:next.analysis!==analysis};
        revision=next.revision;library=next.library;analysis=next.analysis;
        if(event.library||event.analysis)changed(event);
      }catch{
        if(abort.signal.aborted)break;
        await new Promise<void>(resolve=>{const stop=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{abort.signal.removeEventListener('abort',stop);resolve();},3000);abort.signal.addEventListener('abort',stop,{once:true});});
      }
    }
  })();
  return ()=>abort.abort();
}
