import type { Race, RaceEvent, RunnerSample } from './data/types';
import { rankSamples, replayFinishTime } from './view-model';
import type { ReferenceData } from './data/reference';
import { hpTimeline } from './data/hp-timeline';
export type Metric = 'speed' | 'hp' | 'position' | 'lane';
export interface Observation { time: number; frameIndex: number; sample: RunnerSample }
export interface TelemetryIndex {
  extent: number; hpMax: number; laneMax: number; speedBounds: [number, number];
  byRunner: Map<string, Observation[]>; distances: Map<string, Observation[]>; monotonic: Map<string, boolean>;
}
const indexes = new WeakMap<Race, TelemetryIndex>();
const rankings = new WeakMap<Race, Map<string, number>[]>();
const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
/** Imported Race objects are immutable. Index once and never spread sample arrays
 * into calls, which would overflow the argument limit for long recordings. */
export function telemetryIndex(race: Race): TelemetryIndex {
  const cached = indexes.get(race); if (cached) return cached;
  let extent = 1, hpMax = 1, laneMax = .25, speedMin = Infinity, speedMax = -Infinity;
  const byRunner = new Map<string, Observation[]>(), distances = new Map<string, Observation[]>(), monotonic = new Map<string, boolean>();
  for (let i = 0; i < race.frames.length; i++) {
    const frame = race.frames[i];
    for (const sample of frame.runners) {
      const observation = { time: frame.time, frameIndex: i, sample };
      let list = byRunner.get(sample.runnerId);
      if (!list) byRunner.set(sample.runnerId, list = []);
      list.push(observation);
      if (finite(sample.distance)) {
        extent = Math.max(extent, sample.distance);
        let known = distances.get(sample.runnerId);
        if (!known) { distances.set(sample.runnerId, known = []); monotonic.set(sample.runnerId, true); }
        if (known.length && sample.distance < known[known.length - 1].sample.distance!) monotonic.set(sample.runnerId, false);
        known.push(observation);
      }
      if (finite(sample.hp)) hpMax = Math.max(hpMax, sample.hp);
      if (finite(sample.lane)) laneMax = Math.max(laneMax, sample.lane);
      if (finite(sample.speed) && sample.speed >= 0) { speedMin = Math.min(speedMin, sample.speed); speedMax = Math.max(speedMax, sample.speed); }
    }
  }
  const result = { extent: finite(race.distance) && race.distance > 0 ? race.distance : extent,
    hpMax, laneMax, speedBounds: [Number.isFinite(speedMin)?Math.max(0,Math.floor(speedMin)-1):0,
      Number.isFinite(speedMax)?Math.max(1,Math.ceil(speedMax)+1):1] as [number, number], byRunner, distances, monotonic };
  indexes.set(race, result); return result;
}
function adjacentKnown(a: Observation | undefined, b: Observation): boolean {
  return !!a && a.frameIndex + 1 === b.frameIndex && b.time > a.time;
}
/** Earliest observed crossing. Missing endpoints/frames and pre-recording targets
 * stay unknown; an exact recorded distance is still usable beside a gap. */
export function timeAtDistance(race: Race, runnerId: string, distance: number): number | null {
  if (!Number.isFinite(distance)) return null;
  const index = telemetryIndex(race), points = index.distances.get(runnerId) ?? [];
  if (!points.length) return null;
  let i = 0;
  if (index.monotonic.get(runnerId)) {
    let lo = 0, hi = points.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].sample.distance! < distance) lo = mid + 1; else hi = mid; }
    i = lo;
  }
  for (; i < points.length; i++) {
    const current = points[i], d = current.sample.distance!, previous = points[i - 1];
    if (d === distance) return current.time;
    if (d > distance && previous && previous.sample.distance! < distance && adjacentKnown(previous, current))
      return previous.time + (current.time - previous.time) * (distance - previous.sample.distance!) / (d - previous.sample.distance!);
    if (index.monotonic.get(runnerId)) return null;
  }
  return null;
}
/** Playback's endpoint holding is unsuitable for analytical event placement. */
export function distanceAtTime(race: Race, runnerId: string, time: number): number | null {
  if (!Number.isFinite(time)) return null;
  const points = telemetryIndex(race).byRunner.get(runnerId) ?? [];
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].time < time) lo = mid + 1; else hi = mid; }
  const b = points[lo], a = points[lo - 1];
  if (b?.time === time) return finite(b.sample.distance) ? b.sample.distance : null;
  if (!b || !adjacentKnown(a, b) || !finite(a?.sample.distance) || !finite(b.sample.distance)) return null;
  return a.sample.distance + (b.sample.distance - a.sample.distance) * (time - a.time) / (b.time - a.time);
}
export function skillProcEvents(race: Race, runnerId: string): RaceEvent[] {
  return race.events.filter(e => e.runnerId === runnerId && (e.type === 3 || e.type === '3') &&
    (e.skillId===null || (finite(e.skillId) && e.skillId > 0)) && Number.isFinite(e.time));
}
/** One rank computation per frame, cached across metrics/axis changes. */
function frameRanks(race: Race): Map<string, number>[] {
  let values = rankings.get(race);
  if (!values) { values = race.frames.map(f => rankSamples(race, f.runners, f.time)); rankings.set(race, values); }
  return values;
}
export interface PlotPoint { x: number; y: number }
export interface TimedPlotValue {time:number;value:number|null|undefined}
/** The replay can retain runout after an individual runner finishes. */
export function telemetryEndTime(race:Race,runnerId:string):number {
  const runner=race.runners.find(r=>r.id===runnerId),recorded=runner?replayFinishTime(runner):null;
  const crossing=race.distance!=null?timeAtDistance(race,runnerId,race.distance):null;
  return Math.min(race.duration,recorded??Infinity,crossing??Infinity);
}
/** Clip before projecting/reducing, retaining instant jumps and unknown gaps. */
export function timedPlotPath(race:Race,runnerId:string,axis:'distance'|'time',points:readonly TimedPlotValue[],x:(v:number)=>number,y:(v:number)=>number,digits=2):string {
  const end=telemetryEndTime(race,runnerId),parts:string[]=[],segment:PlotPoint[]=[];
  let previous:TimedPlotValue|undefined,previousX=-Infinity;
  const flush=()=>{if(segment.length)parts.push(reducePlotSegment(segment).map((p,i)=>`${i?'L':'M'}${p.x.toFixed(digits)},${p.y.toFixed(digits)}`).join(' '));segment.length=0;previousX=-Infinity;};
  const append=(point:TimedPlotValue)=>{
    const xv=axis==='time'?point.time:distanceAtTime(race,runnerId,point.time);
    if(!finite(point.value)||!finite(xv)){flush();return;}
    if(xv<previousX)flush();
    segment.push({x:x(axis==='distance'&&race.distance!=null?Math.min(race.distance,xv):xv),y:y(point.value)});previousX=xv;
  };
  for(const point of points){
    if(point.time>end){
      if(previous&&previous.time<end&&point.time>previous.time&&finite(previous.value)&&finite(point.value))append({time:end,value:previous.value+(point.value-previous.value)*(end-previous.time)/(point.time-previous.time)});
      break;
    }
    append(point);previous=point;
  }
  flush();return parts.join(' ');
}
/** Preserve endpoints/min/max per horizontal bucket and never join unknown gaps. */
export function reducePlotSegment(points: PlotPoint[], buckets = 1200): PlotPoint[] {
  if (points.length <= buckets * 4) return points;
  const minX = points[0].x, maxX = points[points.length - 1].x;
  if (maxX <= minX) {
    let min=0,max=0;
    for(let i=1;i<points.length;i++){if(points[i].y<points[min].y)min=i;if(points[i].y>points[max].y)max=i;}
    return [...new Set([0,min,max,points.length-1])].sort((a,b)=>a-b).map(i=>points[i]);
  }
  const output: PlotPoint[] = [];
  let start = 0;
  while (start < points.length) {
    const bucket = Math.floor((points[start].x - minX) / (maxX - minX) * buckets);
    let end = start + 1, min = start, max = start;
    while (end < points.length && Math.floor((points[end].x - minX) / (maxX - minX) * buckets) === bucket) {
      if (points[end].y < points[min].y) min = end;
      if (points[end].y > points[max].y) max = end;
      end++;
    }
    for (const i of [...new Set([start, min, max, end - 1])].sort((a, b) => a - b)) output.push(points[i]);
    start = end;
  }
  return output;
}
export function metricPaths(race: Race, metric: Metric, axis: 'distance' | 'time', x: (v: number) => number, y: (v: number) => number, reference: ReferenceData | null = null) {
  const index = telemetryIndex(race), ranks = metric === 'position' ? frameRanks(race) : null;
  return race.runners.map(runner => {
    if (metric === 'hp') {
      return {runner,path:timedPlotPath(race,runner.id,axis,hpTimeline(race,runner.id,reference).map(p=>({time:p.time,value:p.hp})),x,y,1)};
    }
    const points:TimedPlotValue[]=[];let previousFrame=-2;
    for (const point of index.byRunner.get(runner.id) ?? []) {
      const value = ranks ? ranks[point.frameIndex].get(runner.id) : metric === 'lane' ? point.sample.lane : point.sample[metric as 'speed' | 'hp'];
      if(previousFrame+1!==point.frameIndex)points.push({time:point.time,value:null});
      points.push({time:point.time,value});previousFrame=point.frameIndex;
    }
    return {runner,path:timedPlotPath(race,runner.id,axis,points,x,y,1)};
  });
}
