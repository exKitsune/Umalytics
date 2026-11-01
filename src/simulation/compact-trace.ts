import type {DecisionTrace,DecisionEvent} from './trace';

export const COMPACT_TRACE_SCHEMA='umalytics-decisions-v2';
const core=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,32];
const states=[23,28,29,30,31,34,35,40,41];
const columns=['tick','time','horseIndex','dt','position','hp','lane','targetSpeed','baseTarget','sectionModifier','paceCoefficient','acceleration','unclampedSelfSpeed','blockingCap','minimumSpeed','blockerIndex','blockerGap','selfSpeed','skillAdjustedSpeed','actualSpeed','selfClampLoss','finalClampLoss','phase','lastSpurt','spurtStart','spurtSpeed','spurtResult','spurtCalculations','rushing','downhill','paceMode','forceIn','forceInCoefficient','laneTarget','spotStruggle','duel','conservePower','blockedFrontSeconds','blockedSideSeconds','blockedAllSeconds','nearFrontSeconds','nearBehindSeconds','overtakeTargetSeconds'];
const cache=new WeakMap<object,DecisionTrace>();
const invalid=():never=>{throw new Error('Invalid compact simulator trace.');};
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const same=(a:unknown,b:number[])=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);

/** Expand exact ticks for the existing calculations. No state interpolation,
 * formula reconstruction or changes to the immutable wire payload. */
export function expandTrace(input:unknown):DecisionTrace {
  const t=input as Record<string,any>;
  if(t?.schema!==COMPACT_TRACE_SCHEMA)return input as DecisionTrace;
  const saved=cache.get(t);if(saved)return saved;
  const n=t.motionCount,encoded=t.motionData;
  if(t.complete!==true||t.dropped!==0||!integer(n,1,100000)||t.motionEncoding!=='f64le-base64'||!same(t.motionIndices,core)||!same(t.stateIndices,states))invalid();
  const length=n*core.length*8;
  if(typeof encoded!=='string'||encoded.length!==4*Math.ceil(length/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))invalid();
  let bytes:Uint8Array;
  try{bytes=typeof Buffer!=='undefined'?Buffer.from(encoded,'base64'):Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{invalid();}
  if(bytes!.byteLength!==length)invalid();
  const view=new DataView(bytes!.buffer,bytes!.byteOffset,bytes!.byteLength);
  if(!Array.isArray(t.strings)||t.strings.length>100000||t.strings.some((s:unknown)=>typeof s!=='string')||t.strings.reduce((n:number,s:string)=>n+s.length,0)>2*1024*1024||!Array.isArray(t.events)||t.events.length>250000||!Array.isArray(t.states)||t.states.length>100000)invalid();
  let previous=0,observations=0;
  const events:DecisionEvent[]=t.events.map((r:unknown[])=>{
    if(!Array.isArray(r)||r.length!==13||r.slice(0,7).some(v=>!finite(v)||v<0)||!integer(r[0],previous+1,Number.MAX_SAFE_INTEGER)||!integer(r[1],r[0],Number.MAX_SAFE_INTEGER)||Number(r[3])-Number(r[2])+1!==r[6]||Number(r[5])<Number(r[4])||r[7]!==null&&!integer(r[7],0,63)||![8,9,11].every(i=>integer(r[i],0,t.strings.length-1))||!integer(r[10],0,Number.MAX_SAFE_INTEGER)||!r[12]||typeof r[12]!=='object'||Array.isArray(r[12]))invalid();
    previous=Number(r[0]);observations+=Number(r[6]);
    return {sequence:r[0],lastSequence:r[1],tick:r[2],lastTick:r[3],time:r[4],lastTime:r[5],count:r[6],horseIndex:r[7],stage:t.strings[Number(r[8])],skillId:t.strings[Number(r[9])],detail:r[10],kind:t.strings[Number(r[11])],data:r[12]} as DecisionEvent;
  });
  const histories=new Map<number,number[][]>();
  for(const r of t.states){
    if(!Array.isArray(r)||r.length!==12||!r.every(finite)||!integer(r[0],0,Number.MAX_SAFE_INTEGER)||r[1]<0||!integer(r[2],0,63)||![3,5,7,8,9,10,11].every(i=>r[i]===0||r[i]===1)||!integer(r[4],0,4)||!integer(r[6],0,5))invalid();
    const history=histories.get(r[2])??[];if(history.length&&r[0]<=history.at(-1)![0])invalid();history.push(r);histories.set(r[2],history);
  }
  const cursors=new Map<number,number>(),ticks=new Map<number,number>(),motion:number[][]=[];
  for(let i=0,offset=0;i<n;i++){
    const r=Array(43).fill(0);
    for(const column of core){const v=view.getFloat64(offset,true);offset+=8;if(!Number.isFinite(v))invalid();r[column]=v;}
    const horse=r[2],tick=r[0];
    if(!integer(horse,0,63)||!integer(tick,0,Number.MAX_SAFE_INTEGER)||tick<=(ticks.get(horse)??-1)||r[3]<=0||r[20]<0||r[21]<0||!integer(r[15],-1,63))invalid();ticks.set(horse,tick);
    const history=histories.get(horse)??[];let index=cursors.get(horse)??0;
    while(index<history.length&&history[index][0]<=tick){if(history[index][0]!==tick||history[index][1]!==r[1])invalid();index++;}
    if(!index)invalid();cursors.set(horse,index);
    states.forEach((column,i)=>r[column]=history[index-1][i+3]);motion.push(r);
  }
  if(histories.size!==ticks.size||[...histories].some(([horse,history])=>cursors.get(horse)!==history.length)||observations+n!==t.observations)invalid();
  const result={schema:'umalytics-decisions-v1',complete:true,dropped:0,observations:t.observations,events,motion,motionColumns:columns} as DecisionTrace;
  cache.set(t,result);return result;
}
