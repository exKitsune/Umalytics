import type { Race, RaceCategory } from './data/types';
import { toPortableRace } from './data/share';
import { parseRaceJson } from './data/import';
import type { ReferenceData } from './data/reference';
import type { CourseInference } from './data/course-inference';
import { libraryCaption, type LibraryCaption } from './data/library-caption';
export { libraryCaption };
export type { LibraryCaption };
export const categories: { id: RaceCategory; label: string; short: string; color: string }[] = [
  { id: 'career', label: 'Career', short: 'Career', color: '#50b887' },
  { id: 'team-trials', label: 'Team Trials', short: 'Trials', color: '#67a9ec' },
  { id: 'practice', label: 'Practice and room matches', short: 'Room', color: '#b998ed' },
  { id: 'champions-meeting', label: 'Champions Meeting', short: 'CM', color: '#e7b85d' },
  { id: 'league-of-heroes', label: 'League of Heroes', short: 'LoH', color: '#db986d' },
  { id: 'other', label: 'Other races', short: 'Other', color: '#8e9ba6' },
];
export const libraryFacets: { id: string; label: string; short: string; color: string }[] = [
  categories[0], categories[1],
  { id: 'practice', label: 'Practice', short: 'Practice', color: '#7d6bd6' },
  { id: 'room', label: 'Room Match', short: 'Room Match', color: '#e15d5d' },
  categories[3], categories[4], categories[5],
];
export const categoryInfo = (category?: string) => categories.find(c => c.id === category) ?? categories[5];
export const facetInfo = (id?: string) => libraryFacets.find(item => item.id === id) ?? categoryInfo(id);
export function captureFacet(entry: { category?: string; raceMode?: 'practice' | 'room'; raceDesignation?: string; race?: { category?: string; raceMode?: 'practice' | 'room'; raceDesignation?: string } }) {
  const mode = entry.raceMode ?? entry.race?.raceMode;
  const named = entry.raceDesignation ?? entry.race?.raceDesignation;
  if (mode === 'practice' || named === 'practice-live' || named === 'practice-saved') return 'practice';
  if (mode === 'room' || named === 'room-live' || named === 'room-saved') return 'room';
  if ((entry.category ?? entry.race?.category) === 'practice') return 'room';
  return entry.category ?? entry.race?.category ?? 'other';
}
export const runnerColors = ['#4ac892','#65a9ef','#eaad5f','#ae90f1','#eb8099','#6fcbd0','#d1ce75','#df9dd0','#a2b7c5','#d48560','#83bd7b','#8c92de','#cb717c','#b7a985','#85b3ae','#c5a5e5','#9bbd62','#ccaaac'];
/** Persistent library identity keeps the accent stable as metadata loads,
 * filters change or races are reordered. No replay data needs to be opened. */
export function raceIdentityColor(id:string):string {
  let hash=2166136261;
  for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);
  // Avalanche the FNV hash so similar capture IDs do not produce nearby hues.
  hash=Math.imul(hash^(hash>>>16),0x85ebca6b);hash=Math.imul(hash^(hash>>>13),0xc2b2ae35);hash=(hash^(hash>>>16))>>>0;
  return `oklch(${62+(hash>>>20)%7}% ${(14+(hash>>>12)%5)/100} ${(hash%3600)/10})`;
}
export interface LibraryEntry { id: string; title: string; receivedAt: string; racedAt?: string; category?: RaceCategory; raceMode?: 'practice' | 'room'; savedReplay?: boolean; raceDesignation?: Race['raceDesignation']; synthetic?: boolean; remoteId?: string; race?: Race; raceIndex?:number; courseId?:number|null; distance?:number|null; conditions?:Race['conditions']; raceInstanceId?:number; sha256?:string; courseIdentity?:Race['courseIdentity']; courseInference?:CourseInference|null }
/** Both sidebar layouts use the same newest-import-first order. */
export function newestLibraryFirst(entries:readonly LibraryEntry[]):LibraryEntry[] {
  const clock=(entry:LibraryEntry)=>Date.parse(entry.receivedAt)||0;
  return [...entries].sort((a,b)=>clock(b)-clock(a)||b.id.localeCompare(a.id));
}
type CaptionEnvelope={data?:unknown;envelopeJson?:string;bytes:number};
type CaptionFetcher=(id:string,limit:number)=>Promise<CaptionEnvelope>;
function createCaptionDecoder() {
  let worker:Worker|null=null,workerReference:ReferenceData|null=null,sequence=0;
  const jobs=new Map<number,{resolve:(caption:LibraryCaption|null)=>void;reject:(error:Error)=>void}>();
  const dispose=()=>{worker?.terminate();worker=null;workerReference=null;for(const job of jobs.values())job.reject(new Error('Caption worker stopped.'));jobs.clear();};
  return {dispose,async decode(envelope:CaptionEnvelope,reference:ReferenceData):Promise<LibraryCaption|null>{
    // Node functional workflows have no UI thread. Browsers decode in a worker.
    if(typeof Worker==='undefined'){const data=envelope.envelopeJson===undefined?envelope.data:JSON.parse(envelope.envelopeJson).data;const races=parseRaceJson(data);return races.length===1?libraryCaption(races[0],reference):null;}
    if(!worker){worker=new Worker(new URL('./caption-worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{const job=jobs.get(event.data.id);if(!job)return;jobs.delete(event.data.id);if(event.data.error)job.reject(new Error('Race identification failed.'));else job.resolve(event.data.caption);};worker.onerror=()=>dispose();}
    if(workerReference!==reference){
      // Inference uses course segments and definitions, never the large path arrays.
      const courses=Object.fromEntries(Object.entries(reference.courses).map(([id,course])=>{const {gameGeometry,...definition}=course;return [id,definition];}));
      worker.postMessage({type:'reference',reference:{...reference,courses,simulatorSkillIds:new Set()}});workerReference=reference;
    }
    const id=++sequence;return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});worker!.postMessage({type:'race',id,data:envelope.data,envelopeJson:envelope.envelopeJson});});
  }};
}
async function fetchCaptionRace(id:string,limit:number):Promise<CaptionEnvelope> {
  const response=await fetch(`/api/races/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Race caption unavailable.');
  const declared=Number(response.headers.get('content-length'));
  if(declared>limit){await response.body?.cancel();throw new Error('Race is too large for background identification.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Race caption response is unavailable.');
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit)throw new Error('Race is too large for background identification.');chunks.push(next.value);}}
  finally {await reader.cancel();reader.releaseLock();}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
  return {envelopeJson:new TextDecoder().decode(raw),bytes:size};
}

/** Small background batches identify history labels without retaining replay telemetry. */
export function createLibraryCaptionHydrator(onCaption:(id:string,caption:LibraryCaption)=>void,fetcher:CaptionFetcher=fetchCaptionRace) {
  const decoder=createCaptionDecoder();let currentReference:ReferenceData|null=null,running=false,disposed=false;
  const states=new WeakMap<ReferenceData,{cache:Map<string,LibraryCaption>;attempted:Map<string,number>;bytes:number;requests:number;windowAt:number}>();
  const key=(entry:LibraryEntry)=>`${entry.remoteId}:${entry.sha256??entry.receivedAt}`;
  const cached=(entry:LibraryEntry,reference:ReferenceData|null):LibraryEntry=>{
    const caption=!disposed&&reference?states.get(reference)?.cache.get(key(entry)):null;
    return caption?{...entry,...caption}:entry;
  };
  const hydrate=async(entries:LibraryEntry[],reference:ReferenceData|null)=>{
    if(disposed)return;
    currentReference=reference;
    if(!reference)return;
    let state=states.get(reference);if(!state){state={cache:new Map(),attempted:new Map(),bytes:0,requests:0,windowAt:Date.now()};states.set(reference,state);}
    if(Date.now()-state.windowAt>=60000){state.bytes=0;state.requests=0;state.windowAt=Date.now();}
    for(const entry of entries){const caption=state.cache.get(key(entry));if(caption&&!disposed)onCaption(entry.id,caption);}
    if(running)return;running=true;
    try {
      let batch=0;
      for(const entry of entries){
        if(disposed||currentReference!==reference||batch>=12||state.requests>=40||state.bytes>=32*1024*1024)break;
        if(!entry.remoteId||entry.race||entry.courseId!=null&&!entry.courseInference||state.cache.has(key(entry))||Date.now()-(state.attempted.get(key(entry))??0)<60000)continue;
        state.attempted.set(key(entry),Date.now());state.requests++;batch++;
        try {
          const limit=Math.min(4*1024*1024,32*1024*1024-state.bytes);state.bytes+=limit;
          const envelope=await fetcher(entry.remoteId,limit);
          if(!Number.isSafeInteger(envelope.bytes)||envelope.bytes<0||envelope.bytes>limit)throw new Error('Caption response exceeds its limit.');
          state.bytes-=limit-envelope.bytes;
          if(disposed||currentReference!==reference)break;
          const caption=await decoder.decode(envelope,reference);if(!caption)continue;
          state.cache.set(key(entry),caption);if(!disposed&&currentReference===reference)onCaption(entry.id,caption);
        } catch { /* Leave large/invalid/offline entries available for explicit opening. */ }
      }
    } finally {running=false;}
  };
  return Object.assign(hydrate,{cached,dispose(){disposed=true;currentReference=null;decoder.dispose();}});
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('umatrace-library', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('races', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => {database=undefined;reject(req.error);};
  });
}
export async function savedRaces(): Promise<LibraryEntry[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction('races').objectStore('races').getAll();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function deleteSavedRace(id: string): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('races', 'readwrite'); tx.objectStore('races').delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error??new Error('The browser library change was interrupted.'));
  });
}
export async function raceLibraryEntry(race: Race): Promise<LibraryEntry> {
  const canonical = JSON.stringify(toPortableRace(race));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))), b => b.toString(16).padStart(2, '0')).join('');
  const entry: LibraryEntry = { id: `local-${hash}`, title: race.title, receivedAt: race.capturedAt ?? new Date().toISOString(), category: race.category, synthetic: race.synthetic, race };
  return entry;
}
export async function saveRace(race: Race): Promise<LibraryEntry> {
  const entry = await raceLibraryEntry(race);
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('races', 'readwrite'); tx.objectStore('races').put(entry);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error??new Error('The browser library change was interrupted.'));
  });
  return entry;
}
