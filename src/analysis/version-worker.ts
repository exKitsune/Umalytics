// This entry is built as a self-contained immutable module. It contains its
// historical formulas and compiled tables; data comes only from its bound file.
import { parseRaceJson } from '../data/import';
import { assembleReferenceData } from '../data/reference';
import { readGeometry } from '../data/geometry';
import { prepareRace, resolveAnalysisRace } from './prepare';
import { compressAnalysis, decompressAnalysis } from './codec';
import type { PreparedRace } from './prepared';

let running=false;
self.onmessage=async(event:MessageEvent)=>{
  const message=event.data;
  if(message.type!=='run'||running)return;
  running=true;
  try {
    const endpoint=`/api/simulation/races/${encodeURIComponent(message.raceId)}/inference`;
    const authorize=async()=>{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-UmaTrace-CSRF':message.token},body:JSON.stringify({jobId:message.jobId})});
      if(!response.ok)throw new Error('Inference authorization expired. Recorded replay remains available.');
      const auth=await response.json();
      if(!auth.authorized||auth.cacheKey!==message.cacheKey)throw new Error('Inference selection changed.');
      return auth;
    };
    const auth=await authorize(); // Before references, prepared cache, or mechanics.
    const response=await fetch(auth.dataUrl);if(!response.ok)throw new Error('Pinned inference data unavailable.');
    const data=await response.json();
    const reference=assembleReferenceData(data.metadata,data.courses,data.source,data.skillIds,readGeometry(data.geometry));
    let value:PreparedRace;
    if(message.cached){
      try{value=await decompressAnalysis(message.cached);if(!value.authorization||value.authorization.cacheKey!==auth.cacheKey||JSON.stringify(value.authorization.plan)!==JSON.stringify(auth.plan))throw new Error('Unversioned cache');}
      catch{self.postMessage({type:'corrupt'});return;}
    }else{
      const raw=await fetch(`/api/races/${encodeURIComponent(message.raceId)}`);
      if(!raw.ok)throw new Error('Selected race unavailable.');
      const stored=await raw.json();if(stored.sha256!==message.entrySha256)throw new Error('Selected race changed.');
      const races=parseRaceJson(stored.data);if(races.length!==1)throw new Error('Select one race.');
      const race=resolveAnalysisRace(races[0],reference);
      if(!race.frames.length||!race.runners.length||race.distance==null)throw new Error('Inference requires recorded samples, runners and a known distance.');
      value=await prepareRace(race,reference,()=>new Promise(resolve=>setTimeout(resolve,0)));
      value.authorization={cacheKey:auth.cacheKey,plan:auth.plan};
    }
    await authorize(); // Reject policy/artifact/evidence changes during calculation.
    const packed=await compressAnalysis(value);
    self.postMessage({type:'complete',value,reference,packed},{transfer:[packed.buffer as ArrayBuffer]});
  }catch(error){self.postMessage({type:'error',error:String(error)});}
  finally{running=false;}
};
