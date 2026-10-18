import { api } from '../api';
export interface CachePolicy {mode:'unlimited'|'races'|'size';value:number;background:boolean}
export interface CacheEntry {key:string;raceId:string;date:string;bytes:number;revision:string}
interface StoredEntry extends CacheEntry {payload:Uint8Array}
export interface CacheStatus {policy:CachePolicy;entries:CacheEntry[];bytes:number}
export const defaultCachePolicy=():CachePolicy=>({mode:'unlimited',value:1000,background:false});
const base64=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value);};
const unbase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
let opening:Promise<IDBDatabase>|undefined;
function database(){return opening??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('umalytics-analysis',2);
  request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains('entries')){db.createObjectStore('entries',{keyPath:'key'});db.createObjectStore('options');}
    const catalog=db.createObjectStore('catalog',{keyPath:'key'}),cursor=request.transaction!.objectStore('entries').openCursor();
    cursor.onsuccess=()=>{if(cursor.result){const {payload,...entry}=cursor.result.value;catalog.put(entry);cursor.result.continue();}};
  };
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opening=undefined;reject(request.error);};
});}
function request<T>(operation:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{operation.onsuccess=()=>resolve(operation.result);operation.onerror=()=>reject(operation.error);});}
function committed(tx:IDBTransaction){return new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Cache save failed.'));});}

export class AnalysisStore {
  private writes:Promise<unknown>=Promise.resolve();
  constructor(private desktop:()=>boolean,private token:()=>string|undefined){}
  async status():Promise<CacheStatus>{
    if(this.desktop())return api('analysis-cache');
    const db=await database(),tx=db.transaction(['catalog','options']);
    const [rows,policy]=await Promise.all([request<CacheEntry[]>(tx.objectStore('catalog').getAll()),request<CachePolicy|undefined>(tx.objectStore('options').get('policy'))]);
    return {policy:policy??defaultCachePolicy(),entries:rows,bytes:rows.reduce((sum,row)=>sum+row.bytes,0)};
  }
  async get(key:string):Promise<Uint8Array|null>{
    if(this.desktop()){const result=await api<{payload:string|null}>(`analysis-cache/${key}`);return result.payload?unbase64(result.payload):null;}
    const db=await database(),row=await request<StoredEntry|undefined>(db.transaction('entries').objectStore('entries').get(key));return row?.payload??null;
  }
  change(body:Record<string,unknown>):Promise<CacheStatus>{
    const write=this.writes.catch(()=>{}).then(()=>this.write(body));this.writes=write;return write;
  }
  private async write(body:Record<string,unknown>):Promise<CacheStatus>{
    if(this.desktop())return api('analysis-cache',body,this.token());
    const db=await database(),tx=db.transaction(['entries','catalog','options'],'readwrite'),done=committed(tx),entries=tx.objectStore('entries'),catalog=tx.objectStore('catalog'),options=tx.objectStore('options');
    const policy=body.action==='policy'?body.policy as CachePolicy:await request<CachePolicy|undefined>(options.get('policy'))??defaultCachePolicy();
    const rows=await request<CacheEntry[]>(catalog.getAll());
    let remaining=rows;
    if(body.action==='purge'){entries.clear();catalog.clear();remaining=[];}
    if(body.action==='policy')options.put(policy,'policy');
    if(body.action==='revision'||body.action==='remove'||body.action==='put'){
      remaining=rows.filter(row=>body.action==='revision'?row.revision===body.revision:body.action==='remove'?row.key!==body.key:row.raceId!==body.raceId);
      const keep=new Set(remaining.map(row=>row.key));for(const row of rows)if(!keep.has(row.key)){entries.delete(row.key);catalog.delete(row.key);}
    }
    if(body.action==='put'){
      const payload=body.payload as Uint8Array;
      const row={key:body.key as string,raceId:body.raceId as string,date:body.date as string,revision:body.revision as string,bytes:payload.byteLength};
      entries.put({...row,payload});catalog.put(row);remaining.push(row);
    }
    let used=0;remaining.sort((a,b)=>b.date.localeCompare(a.date)||a.key.localeCompare(b.key));
    for(const [index,row]of remaining.entries()){used+=row.bytes;if(policy.mode==='races'&&index>=policy.value||policy.mode==='size'&&used>policy.value*1024*1024){entries.delete(row.key);catalog.delete(row.key);}}
    await done;return this.status();
  }
  put(entry:Omit<CacheEntry,'bytes'>,payload:Uint8Array){return this.change({action:'put',...entry,payload:this.desktop()?base64(payload):payload});}
}
