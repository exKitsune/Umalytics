import type { StatusInterval, TrafficTick } from '../data/analytics';
import { motionIndex as m } from './trace';

export const TRAFFIC_CLEAR_GAP = .25;
export const TRAFFIC_MIN_SLOWDOWN = .001;
export const TRAFFIC_MAX_SLOWDOWN = .6;
export const trafficLegend = 'The bottom lane colors the speed cut at each simulator tick. Hover anywhere along it for the blocking state and speed cut at that moment. Contact without a cut stays transparent. A cut can last just one tick; acceleration afterward is visible in the speed graph and is not a new blocking cut. Color appears at 0.001 m/s, with white → yellow → amber → red reaching red at 0.6 m/s. Smaller cuts stay transparent. Results show slowed time using these same colored ticks; contact time also includes ticks with no speed cut. The scale uses the larger of the two blocking cuts, not their sum or the gap between target and current speed.';
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
