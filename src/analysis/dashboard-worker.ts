import {ungzip} from 'pako';
self.onmessage=async(event:MessageEvent)=>{
  try{
    const response=await fetch(event.data.url);
    if(!response.ok)throw new Error('Saved analysis changed or was cleared.');
    const bytes=ungzip(new Uint8Array(await response.arrayBuffer()));
    self.postMessage({type:'complete',bytes},{transfer:[bytes.buffer]});
  }catch(error){self.postMessage({type:'error',error:String(error)});}
};
