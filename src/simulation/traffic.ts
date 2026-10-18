import type { StatusInterval, TrafficTick } from '../data/analytics';
import { motionIndex as m } from './trace';

export const TRAFFIC_CLEAR_GAP = .25;
export const TRAFFIC_MIN_SLOWDOWN = .075;
export const TRAFFIC_MAX_SLOWDOWN = .6;
export const trafficLegend = 'The outline shows blocking contact; contact can continue without reducing speed. Color appears only for cuts of at least 0.075 m/s. White → yellow → amber → red shows increasing slowdown, reaching red at 0.6 m/s. Transparent gaps are below the threshold. The scale uses the larger of the two blocking cuts, not their sum; it is not the difference between target and current speed.';
export const trafficSlowdown=(tick:TrafficTick|null)=>Math.max(tick?.selfLoss??0,tick?.finalLoss??0);
const active=(tick:TrafficTick)=>(tick.near||tick.blocked)&&trafficSlowdown(tick)>=TRAFFIC_MIN_SLOWDOWN;

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
    const cut=traffic.reduce((sum,t)=>sum+(Math.max(t.selfLoss,t.finalLoss)>=TRAFFIC_MIN_SLOWDOWN?t.end-t.start:0),0);
    result.push({kind:'traffic',label:'Traffic',start:traffic[0].start,end:traffic.at(-1)!.end,evidence:'simulated',traffic,
      detail:`Traffic · ${blocked.toFixed(2)} s blocked · ${cut.toFixed(2)} s with a speed cut. ${trafficLegend}`});
  };
  for(let index=0;index<ticks.length;index++){
    if(!ticks[index].blocked&&!active(ticks[index]))continue;
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
  const severity=Math.min(TRAFFIC_MAX_SLOWDOWN,Math.max(TRAFFIC_MIN_SLOWDOWN,trafficSlowdown(tick)));
  const anchors=[[TRAFFIC_MIN_SLOWDOWN,[255,255,255]],[.25,[255,236,74]],[.4,[255,168,37]],[TRAFFIC_MAX_SLOWDOWN,[240,68,68]]] as const;
  const upper=anchors.findIndex(([value])=>value>=severity),[low,from]=anchors[Math.max(0,upper-1)],[high,to]=anchors[upper];
  const blend=high===low?0:(severity-low)/(high-low);
  return '#'+from.map((value,index)=>Math.round(value+(to[index]-value)*blend).toString(16).padStart(2,'0')).join('');
}
/** Interpolate sample centres instead of duplicating hard-edged tick stops.
 * Only the paint is blended; activity and measured cuts remain discrete. */
export function trafficGradient(interval:StatusInterval,project:(time:number)=>number|null){
  const stops:{x:number;color:string;opacity:number}[]=[];
  const ticks=interval.traffic??[];
  const add=(time:number,color:string,opacity:number)=>{
    const x=project(time);if(x===null)return;
    const previous=stops.at(-1),before=stops.at(-2);
    if(previous&&previous.x===x){stops[stops.length-1]={x,color,opacity};return;}
    if(previous&&before&&previous.color===color&&before.color===color&&previous.opacity===opacity&&before.opacity===opacity)previous.x=x;
    else stops.push({x,color,opacity});
  };
  if(ticks.length)add(ticks[0].start,trafficColor(ticks[0]),0);
  for(const tick of ticks){
    add((tick.start+tick.end)/2,trafficColor(tick),active(tick)?1:0);
  }
  if(ticks.length)add(ticks.at(-1)!.end,trafficColor(ticks.at(-1)!),0);
  return stops;
}
