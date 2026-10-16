import { parseRaceJson } from './data/import';
import type { ReferenceData } from './data/reference';
import { libraryCaption } from './data/library-caption';

let reference:ReferenceData|null=null;
self.onmessage=(event:MessageEvent)=>{
  if(event.data.type==='reference'){reference=event.data.reference;return;}
  if(event.data.type!=='race')return;
  try {
    const data=event.data.envelopeJson===undefined?event.data.data:JSON.parse(event.data.envelopeJson).data;
    const races=parseRaceJson(data);
    self.postMessage({id:event.data.id,caption:reference&&races.length===1?libraryCaption(races[0],reference):null});
  } catch {self.postMessage({id:event.data.id,error:true});}
};
