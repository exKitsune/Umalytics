import type { StatusInterval, TrafficTick } from '../data/analytics';
import { motionIndex as m } from './trace';

export const TRAFFIC_CLEAR_GAP = .25;
export const trafficLegend = 'Bright yellow: nearby, 0 m/s cut. Amber: 0.5 m/s. Red: 1 m/s or more. Each point uses the larger of the two blocking cuts, never their sum. Faded sections are brief clear gaps.';
const active=(tick:TrafficTick)=>tick.near||tick.blocked;

/** Group display labels, never infer a blocked/near state across a clear gap. */
export function trafficIntervals(rows:readonly number[][],finish:number):StatusInterval[]{
  const ticks:TrafficTick[]=rows.flatMap((row,index)=>{
    const start=row[m.time],end=Math.min(finish,start+row[m.dt],rows[index+1]?.[m.time]??finish);
    if(start>=finish||end<=start)return [];
    const blocked=row[m.blocker]>=0;
    return [{start,end,blocked,near:row[m.nearFrontSeconds]>0||row[m.nearBehindSeconds]>0,
      // Without a blocker the engine still has a global speed ceiling. That
      // ceiling is not a traffic loss and must not color a slowdown band.
      selfLoss:blocked?Math.max(0,row[m.selfLoss]):0,finalLoss:blocked?Math.max(0,row[m.finalLoss]):0}];
  });
  const result:StatusInterval[]=[];
  let first=-1,last=-1;
  const flush=()=>{
    if(first<0)return;
    const traffic=ticks.slice(first,last+1);
    const blocked=traffic.reduce((sum,t)=>sum+(t.blocked?t.end-t.start:0),0);
    const cut=traffic.reduce((sum,t)=>sum+(Math.max(t.selfLoss,t.finalLoss)>0?t.end-t.start:0),0);
    result.push({kind:'traffic',label:'Traffic',start:traffic[0].start,end:traffic.at(-1)!.end,evidence:'simulated',traffic,
      detail:`Traffic · ${blocked.toFixed(2)} s blocked · ${cut.toFixed(2)} s with a speed cut. ${trafficLegend}`});
  };
  for(let index=0;index<ticks.length;index++){
    if(!active(ticks[index]))continue;
    if(first<0)first=index;
    else if(ticks[index].start-ticks[last].end>TRAFFIC_CLEAR_GAP+1e-6){flush();first=index;}
    last=index;
  }
  flush();return result;
}

export function trafficAt(interval:StatusInterval,time:number):TrafficTick|null {
  const ticks=interval.traffic;
  if(!ticks?.length)return null;
  let low=0,high=ticks.length;
  while(low<high){const mid=(low+high)>>>1;if(ticks[mid].start<=time)low=mid+1;else high=mid;}
  const tick=ticks[low-1];
  return tick&&time<tick.end?tick:null;
}
export function trafficActive(interval:StatusInterval,time:number):boolean {
  const tick=trafficAt(interval,time);return !!tick&&active(tick);
}
export function trafficColor(tick:TrafficTick|null):string {
  const severity=Math.min(1,Math.max(tick?.selfLoss??0,tick?.finalLoss??0));
  const from=severity<.5?[255,243,79]:[255,176,46],to=severity<.5?[255,176,46]:[240,68,68];
  const blend=severity<.5?severity*2:(severity-.5)*2;
  return '#'+from.map((value,index)=>Math.round(value+(to[index]-value)*blend).toString(16).padStart(2,'0')).join('');
}
/** Sharp tick boundaries preserve clear gaps; colors change with actual loss. */
export function trafficGradient(interval:StatusInterval,project:(time:number)=>number|null){
  const stops:{x:number;color:string;opacity:number}[]=[];
  for(const tick of interval.traffic??[]){
    const start=project(tick.start),end=project(tick.end);
    if(start===null||end===null)continue;
    const color=trafficColor(tick),opacity=active(tick)?1:.08,previous=stops.at(-1);
    // Constant spans need two stops, not thousands of identical SVG nodes.
    if(previous&&previous.x===start&&previous.color===color&&previous.opacity===opacity)previous.x=end;
    else stops.push({x:start,color,opacity},{x:end,color,opacity});
  }
  return stops;
}
