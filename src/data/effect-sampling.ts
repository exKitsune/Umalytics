import type { Race, RunnerSample } from './types';
const cache=new WeakMap<Race,Map<string,{time:number;sample:RunnerSample}[]>>();
export function trace(race:Race,id:string){let ids=cache.get(race);if(!ids)cache.set(race,ids=new Map());let rows=ids.get(id);if(!rows){rows=race.frames.flatMap(f=>{const sample=f.runners.find(s=>s.runnerId===id);return sample?[{time:f.time,sample}]:[];});ids.set(id,rows);}return rows;}
export function atTime(race:Race,id:string,time:number):RunnerSample|null {
  const rows=trace(race,id);if(!rows.length||time<rows[0].time||time>rows.at(-1)!.time)return null;
  let lo=0,hi=rows.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(rows[mid].time<=time)lo=mid;else hi=mid-1;}
  const a=rows[lo];if(a.time===time)return a.sample;const b=rows[lo+1];if(!b)return null;const f=(time-a.time)/(b.time-a.time);
  const lerp=(key:'distance'|'speed'|'hp'|'lane')=>a.sample[key]===null||b.sample[key]===null?null:a.sample[key]!+(b.sample[key]!-a.sample[key]!)*f;
  return {runnerId:id,distance:lerp('distance'),speed:lerp('speed'),hp:lerp('hp'),lane:lerp('lane'),
    blockFrontRunnerIndex:a.sample.blockFrontRunnerIndex===b.sample.blockFrontRunnerIndex?a.sample.blockFrontRunnerIndex:null,
    temptationMode:a.sample.temptationMode===b.sample.temptationMode?a.sample.temptationMode:null};
}
export function crossing(race:Race,id:string,distance:number):number|null {const rows=trace(race,id);for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],da=a.sample.distance,db=b.sample.distance;if(da!==null&&db!==null&&db>da&&da<=distance&&db>=distance)return a.time+(b.time-a.time)*(distance-da)/(db-da);}return rows[0]?.sample.distance===distance?rows[0].time:null;}
export function stopTime(race:Race,id:string){const runner=race.runners.find(r=>r.id===id);return Math.min(race.duration,runner?.finishTimeRaw??race.duration);}
export function observedWindow(race:Race,id:string,start:number,end:number){let distance=0,hpConsumed=0,hpRecovered=0,ds=0,hs=0;const rows=trace(race,id);for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],duration=Math.min(end,b.time)-Math.max(start,a.time);if(duration<=0)continue;const f=duration/(b.time-a.time);if(a.sample.distance!==null&&b.sample.distance!==null){distance+=(b.sample.distance-a.sample.distance)*f;ds+=duration;}if(a.sample.hp!==null&&b.sample.hp!==null){const delta=(b.sample.hp-a.sample.hp)*f;hpConsumed+=Math.max(0,-delta);hpRecovered+=Math.max(0,delta);hs+=duration;}}
  return {observedDistance:Math.abs(ds-(end-start))<1e-5?distance:null,observedHpConsumed:Math.abs(hs-(end-start))<1e-5?hpConsumed:null,observedHpRecovered:Math.abs(hs-(end-start))<1e-5?hpRecovered:null};
}
