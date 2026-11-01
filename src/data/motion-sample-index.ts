import type {RunnerMotion,MotionSample} from './race-motion';

const indices=new WeakMap<RunnerMotion,ReadonlyMap<number,MotionSample>>();
/** Analysis paths are immutable for their owning race; share exact-time lookup. */
export function motionSampleIndex(motion:RunnerMotion):ReadonlyMap<number,MotionSample>{
  let index=indices.get(motion);
  if(!index){index=new Map(motion.samples.map(sample=>[sample.time,sample]));indices.set(motion,index);}
  return index;
}
