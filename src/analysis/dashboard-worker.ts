import {ungzip} from 'pako';
self.onmessage=async(event:MessageEvent)=>{
  try{
    const response=await fetch(event.data.url);
    if(!response.ok)throw new Error('Saved analysis changed or was cleared.');
    const bytes=ungzip(new Uint8Array(await response.arrayBuffer()));
    const saved=JSON.parse(new TextDecoder().decode(bytes));
    let referenceData=saved.referenceData;
    if(!referenceData&&event.data.referenceUrl){
      const response=await fetch(event.data.referenceUrl);
      if(!response.ok)throw new Error('Reference bundle is unavailable.');
      referenceData=JSON.parse(new TextDecoder().decode(ungzip(new Uint8Array(await response.arrayBuffer()))));
    }
    self.postMessage({type:'complete',saved,referenceData});
  }catch(error){self.postMessage({type:'error',error:String(error)});}
};
