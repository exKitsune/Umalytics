import {compareRawStats,type RawContext,type RawStatProfile} from '../data/raw-stat-comparison';
self.onmessage=(event:MessageEvent<{id:number;reference:RawStatProfile;comparison:RawStatProfile;context:Pick<RawContext,'course'|'ground'>}>)=>{
  const {id,reference,comparison,context}=event.data;
  try{self.postMessage({id,result:compareRawStats(reference,comparison,context)});}
  catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
