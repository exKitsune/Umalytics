import type { Race } from './types';
import type { MotionBand, RunnerMotion } from './race-motion';
import { trace } from './effect-sampling';
import { referenceDeceleration } from './mechanics-model';

type Use = { useful:number; capped:number };
const cache=new WeakMap<RunnerMotion,Map<number,Partial<Record<keyof MotionBand,Use>>>>();

/** Resolve cap arrival inside an original retained-sample bracket. Repeatedly
 * anchoring at interpolated velocities stretches acceleration across a plateau.
 * Accept a reconstruction only when the known force/target schedule reaches a
 * cap AND agrees with the next retained velocity within its quantization. */
export function accelerationUse(race:Race,runnerId:string,motion:RunnerMotion){
  const prior=cache.get(motion);if(prior)return prior;
  const result=new Map<number,Partial<Record<keyof MotionBand,Use>>>();cache.set(motion,result);
  const rows=trace(race,runnerId),samples=motion.samples,total=race.distance;
  if(!total)return result;
  let cursor=0;
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i];
    if(b.time-a.time>2||a.sample.speed==null||b.sample.speed==null||a.sample.blockFrontRunnerIndex!==-1||b.sample.blockFrontRunnerIndex!==-1)continue;
    while(cursor<samples.length&&samples[cursor].time<a.time-1e-7)cursor++;
    const begin=cursor;let end=begin;while(end<samples.length&&samples[end].time<b.time-1e-7)end++;
    if(!samples[end]||Math.abs(samples[begin].time-a.time)>1e-7||Math.abs(samples[end].time-b.time)>1e-7)continue;
    const points=samples.slice(begin,end+1);
    if(points.some(p=>p.selfActual===null||p.hpEmpty!==false||p.startDash!==false||!p.targetActive||!p.accelerationRange||p.constraint.kind!=='none'||p.distance===null||Math.abs(p.currentSpeedDelta-points[0].currentSpeedDelta)>.00001))continue;
    for(const channel of ['min','mid','max']as const){
      let speed=points[0].selfActual!,hit=false;const steps:{time:number;use:Use}[]=[];
      for(let k=1;k<points.length;k++){
        const p=points[k-1],q=points[k],dt=q.time-p.time,target=p.targetActive![channel],force=p.accelerationRange![channel];
        let useful=0,capped=0;
        if(speed<target&&force>0){useful=Math.min(dt,(target-speed)/force);capped=dt-useful;hit||=capped>1e-8;speed=Math.min(target,speed+force*dt);}
        else if(speed>target){const deceleration=referenceDeceleration(p.distance!,total,p.pace==='pace-down');speed=Math.max(target,speed-deceleration*dt);}
        else {capped=dt;hit=true;}
        steps.push({time:p.time,use:{useful,capped}});
      }
      if(!hit||Math.abs(speed-points.at(-1)!.selfActual!)>.022)continue;
      for(const step of steps){let value=result.get(step.time);if(!value)result.set(step.time,value={});value[channel]=step.use;}
    }
  }
  return result;
}
