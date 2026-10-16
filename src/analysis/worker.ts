import { parseRaceJson } from '../data/import';
import { prepareRace, resolveAnalysisRace } from './prepare';
import { compressAnalysis, decompressAnalysis } from './codec';
import type { ReferenceData } from '../data/reference';

let reference:ReferenceData, foreground=false, paused=false, running=false, last=performance.now();
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function checkpoint(){
  // Background work spends at most roughly one quarter of its time computing.
  // Every checkpoint pumps messages, including promotions and pause requests.
  const work=performance.now()-last;
  await sleep(foreground?0:Math.min(750,Math.max(25,work*3)));
  while(paused&&!foreground)await sleep(75);
  last=performance.now();
}
self.onmessage=async(event:MessageEvent)=>{
  const message=event.data;
  if(message.type==='reference'){reference=message.reference;return;}
  if(message.type==='priority'){foreground=message.foreground;paused=message.paused;return;}
  if(message.type!=='run'||running)return;
  running=true;foreground=message.foreground;last=performance.now();
  try {
    if(message.cached){
      try {const value=await decompressAnalysis(message.cached);self.postMessage({type:'complete',value,cached:true});return;}
      catch {self.postMessage({type:'corrupt'});return;}
    }
    let data=message.data;
    if(message.remoteId){const response=await fetch(`/api/races/${encodeURIComponent(message.remoteId)}`);if(!response.ok)throw new Error('Race could not be loaded.');data=(await response.json()).data;}
    const races=parseRaceJson(data),race=resolveAnalysisRace(races[message.raceIndex??0],reference,message.override);
    self.postMessage({type:'parsed',race});await checkpoint();
    const value=await prepareRace(race,reference,checkpoint,analysis=>self.postMessage({type:'base',race,analysis}),
      (done,total,id,runner)=>self.postMessage({type:'progress',done,total,id,runner}));
    await checkpoint();const packed=await compressAnalysis(value);
    self.postMessage({type:'complete',value,packed},{transfer:[packed.buffer as ArrayBuffer]});
  } catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:String(error)});}
  finally{running=false;}
};
