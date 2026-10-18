import type {MotionSample} from '../data/race-motion';
import type {TrafficTick} from '../data/analytics';
import {trafficColor,trafficSlowdown,TRAFFIC_MIN_SLOWDOWN} from './traffic';

export interface TrafficSample extends TrafficTick {blocker:string|null}
/** Retain clear ticks too: the entire lane can answer a point query. */
export function trafficTimeline(samples:readonly MotionSample[],finish:number):TrafficSample[]{
  return samples.flatMap((sample,index)=>{
    const end=Math.min(finish,samples[index+1]?.time??finish),blocked=sample.constraint.kind==='recorded-block';
    if(!sample.blockingClamps||sample.time>=end)return [];
    return [{start:sample.time,end,blocked,near:false,blocker:blocked?sample.constraint.runnerId:null,
      selfLoss:blocked?Math.max(0,sample.blockingClamps.self):0,finalLoss:blocked?Math.max(0,sample.blockingClamps.final):0}];
  });
}
export function trafficSampleAt(ticks:readonly TrafficSample[],time:number):TrafficSample|null{
  let low=0,high=ticks.length;
  while(low<high){const mid=(low+high)>>>1;if(ticks[mid].start<=time)low=mid+1;else high=mid;}
  const tick=ticks[low-1];return tick&&time<tick.end?tick:null;
}
/** One solid color per tick, merging only identical adjacent paint. No fading
 * away of a tick's magnitude and no averaging away short collision cuts. */
export function trafficCells(ticks:readonly TrafficSample[],project:(time:number)=>number|null){
  const cells:{start:number;end:number;color:string}[]=[];
  for(const tick of ticks){
    if(trafficSlowdown(tick)<TRAFFIC_MIN_SLOWDOWN)continue;
    const start=project(tick.start),end=project(tick.end);if(start===null||end===null||end<=start)continue;
    const color=trafficColor(tick),prior=cells.at(-1);
    if(prior&&Math.abs(prior.end-start)<1e-7&&prior.color===color)prior.end=end;
    else cells.push({start,end,color});
  }
  return cells;
}

/** The results total uses exactly the tick windows painted in the traffic lane. */
export function trafficDurations(ticks:readonly TrafficSample[]){
  return ticks.reduce((sum,tick)=>{
    const duration=Math.max(0,tick.end-tick.start);
    if(tick.blocked)sum.contactSeconds+=duration;
    if(tick.blocked&&trafficSlowdown(tick)>=TRAFFIC_MIN_SLOWDOWN)sum.slowedSeconds+=duration;
    return sum;
  },{contactSeconds:0,slowedSeconds:0});
}
