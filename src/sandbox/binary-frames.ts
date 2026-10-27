import type {Frame} from '../data/types';

/** Service-owned IPC file. Decode straight into analysis frames, without
 * materializing the engine's intermediate horse objects or JSON copies. */
export function decodeSimulatorFrames(bytes:Uint8Array,runnerIds:string[]):Frame[]{
  if(bytes.byteLength<12)throw new Error('Incomplete simulator frame header.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const count=view.getUint32(4,true),horses=view.getUint32(8,true);
  if(view.getUint32(0,true)!==0x46414d55||count>100000||horses!==runnerIds.length||horses<1||horses>64||bytes.byteLength!==12+count*(8+horses*48))throw new Error('Invalid simulator frame layout.');
  let offset=12;
  const number=()=>{const value=view.getFloat64(offset,true);offset+=8;if(!Number.isFinite(value))throw new Error('Non-finite simulator frame.');return value;};
  return Array.from({length:count},()=>({time:number(),runners:runnerIds.map(runnerId=>({runnerId,distance:number(),speed:number(),hp:number(),lane:number(),temptationMode:number(),blockFrontRunnerIndex:number()}))}));
}
