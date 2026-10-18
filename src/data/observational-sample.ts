import type { Race, RunnerSample } from './types';

/** Numeric interpolation of recorded samples only. No skills or mechanics. */
export function sampleRecordedAt(race: Race, time: number): RunnerSample[] {
  const frames = race.frames;
  if (!frames.length) return [];
  if (!Number.isFinite(time) || time <= frames[0].time) return frames[0].runners.map(r => ({...r}));
  if (time >= frames.at(-1)!.time) return frames.at(-1)!.runners.map(r => ({...r}));
  let low=0, high=frames.length-1;
  while(high-low>1){const middle=(low+high)>>>1;if(frames[middle].time<=time)low=middle;else high=middle;}
  if(time===frames[low].time)return frames[low].runners.map(r=>({...r}));
  if(time===frames[high].time)return frames[high].runners.map(r=>({...r}));
  const factor=(time-frames[low].time)/(frames[high].time-frames[low].time);
  const later=new Map(frames[high].runners.map(r=>[r.runnerId,r]));
  return frames[low].runners.map(before=>{
    const after=later.get(before.runnerId);
    const lerp=(key:'distance'|'speed'|'hp'|'lane')=>before[key]==null||after?.[key]==null?null:before[key]!+(after[key]!-before[key]!)*factor;
    return {...before,distance:lerp('distance'),speed:lerp('speed'),hp:lerp('hp'),lane:lerp('lane')};
  });
}
