import type { Race, Runner, RunnerSample } from './types';
import type { RaceAnalysis } from './analytics';
import type { MechanicsContext } from './mechanics-model';
import { baseAcceleration, referenceDeceleration } from './mechanics-model';
import { distanceAptitude } from './race-stats';
import { atTime } from './effect-sampling';
import { effectValue } from './effect-value';
import { startDashStateAt } from './mechanics-effects';
export const inFrontCollisionRange = (gap:number,laneGap:number) => gap>0&&gap<2&&laneGap<=(1-.6*gap/2)*.75/18;
/** A horse in front is matched to her speed or occupies the front-collision area. A horse behind her, one she is
 * pulling away from, or one running clearly faster on her own pace is not a
 * hold. The ahead band is 4 m within one horse lane; a closer horse can sit a
 * little wider, up to the side-block lane width, but still has to be in front. */
export function proximityPressure(race:Race,runnerId:string,sample:RunnerSample):boolean|null{
  if(sample.blockFrontRunnerIndex==null||sample.distance==null||sample.lane==null||sample.speed==null)return null;
  if(sample.blockFrontRunnerIndex>=0)return false;
  const index=race.frames.findIndex(frame=>frame.runners.includes(sample));
  const frame=index<0?undefined:race.frames[index];
  if(!frame)return null;
  const previous=index>0?race.frames[index-1].runners.find(runner=>runner.runnerId===runnerId):undefined;
  const dt=previous?frame.time-race.frames[index-1].time:0;
  const climbing=previous?.speed!=null&&dt>0&&dt<=2&&sample.speed-previous.speed>0.15*dt;
  let missing=false,held=false;
  for(const other of race.runners){
    if(other.id===runnerId)continue;
    const neighbor=frame.runners.find(runner=>runner.runnerId===other.id);
    if(!neighbor||neighbor.distance==null||neighbor.lane==null){missing=true;continue;}
    const gap=neighbor.distance-sample.distance,lane=Math.abs(neighbor.lane-sample.lane);
    const inFront=gap>0&&(gap<4&&lane<1/18||gap<1.05&&lane<2/18);
    if(!inFront||neighbor.speed==null){if(inFront)missing=true;continue;}
    const matched=sample.speed<=neighbor.speed+.05&&neighbor.speed-sample.speed<=.15;
    // A close cap can slow her while she is still faster than the horse ahead,
    // and while she is accelerating back out of that cap.
    if(!inFrontCollisionRange(gap,lane)&&(climbing||!matched))continue;
    held=true;
  }
  return held?true:missing?null:false;
}
export function frontBlockCapAt(race:Race,runner:Runner,time:number):{cap:number|null;blocked:boolean;detail:string} {
  const sample=atTime(race,runner.id,time),index=sample?.blockFrontRunnerIndex;
  if(index===-1)return {cap:null,blocked:false,detail:'Recorded no front block.'};
  if(index==null)return {cap:null,blocked:false,detail:'Front-block state unavailable.'};
  const front=race.runners.find(r=>r.index===index),other=front?atTime(race,front.id,time):null;
  if(!sample||sample.distance===null||!other||other.distance===null||other.speed===null||other.speed<=0)return {cap:null,blocked:true,detail:'Blocker speed or position unavailable.'};
  const gap=other.distance-sample.distance;
  if(gap<0||gap>2.1)return {cap:null,blocked:true,detail:'Recorded block geometry cannot resolve the cap.'};
  return {cap:other.speed*(.988+.012*Math.max(0,Math.min(1,gap/2))),blocked:true,detail:'Reference recorded-front speed cap0.988–1.0×front actual speed over0–2m gap.'};
}
export function movementAt(race:Race,analysis:Pick<RaceAnalysis,'runners'>,runner:Runner,time:number):{current:number;target:number;accel:number;unknown:boolean} {
  const result={current:0,target:0,accel:0,unknown:false};
  for(const source of race.runners)for(const a of analysis.runners[source.id].skillActivations){
    if(time<a.start||a.effectiveEnd!==null&&time>=a.effectiveEnd)continue;
    for(const e of a.effects){if(![1,3,4,5,21,22,27,28,31,35].includes(e.type))continue;
      const foreign=(e.targetType??1)!==1;
      if(!foreign&&source.id!==runner.id)continue;
      if(foreign){if(source.teamGroup!=null&&runner.teamGroup!=null&&source.teamGroup===runner.teamGroup)continue;
        const event=race.events.find(e=>e.skillId===a.skillId&&e.time===a.start&&(e.runnerId===source.id||e.runnerId===null&&e.params[0]===source.index));
        if(!Number.isInteger(event?.params[4])){result.unknown=true;continue;}if(!a.targetRunnerIds.includes(runner.id))continue;}
      if(a.start===0&&a.timingKind==='passive'&&[1,3,4,5].includes(e.type))continue;
      const value=effectValue(source,a.referenceSkillId??a.skillId,e);
      if(a.effectiveEnd===null||value===null||![21,22,27,31].includes(e.type)){result.unknown=true;continue;}
      if([21,22].includes(e.type))result.current+=value;else if(e.type===27)result.target+=value;else result.accel+=value;
    }
  }
  return result;
}
export function referenceMotionAt(ctx:MechanicsContext,analysis:Pick<RaceAnalysis,'runners'>,time:number,distance:number,self:number) {
  const mods=movementAt(ctx.race,analysis,ctx.runner,time),dash=startDashStateAt(ctx.race,analysis,ctx.runner.id,time);
  const accel=baseAcceleration(ctx,distance,self,dash===true);if(mods.unknown||accel===null)return null;
  const modes=new Map<string,number>(),pace=new Map<string,number>();let speed=0,extraAccel=0,boost=false;
  for(const i of analysis.runners[ctx.runner.id].intervals){if(time<i.start||time>=(i.end??i.estimatedEnd??i.observedUntil??i.start))continue;
    if(i.kind==='rushed-boost')boost=true;
    if(i.kind.endsWith('-model')){const key=i.kind.replace(/-model$/,'');
      if(['pace-up','pace-down','speed-up','overtake'].includes(key)){
        const multiplier=i.model?.speedMultiplier,allowed=key==='pace-down'?[.915,.945]:key==='overtake'?[1.05]:[1.04];
        if(multiplier==null||!allowed.some(n=>Math.abs(n-multiplier)<1e-6)||pace.has(key)&&Math.abs(pace.get(key)!-multiplier)>1e-6)return null;
        pace.set(key,multiplier);
      }else if(i.model?.speedDelta!=null){if(modes.has(key)&&Math.abs(modes.get(key)!-i.model.speedDelta)>1e-5)return null;modes.set(key,i.model.speedDelta);}}}
  if(pace.size>1||boost&&pace.size>0)return null;
  if(pace.size>0){const kind=[...pace.keys()][0],front=ctx.style===1||ctx.style===5;
    if(dash===true||front!==['speed-up','overtake'].includes(kind))return null;}
  if(distance<ctx.course.distance*10/24&&dash!==true&&pace.size===0)return null;
  // Apply the mode coefficient to the base strategy target only. Section wit,
  // terrain and skill offsets remain additive, before the final floor/cap.
  // Early phases do not require the unused final-speed stat.
  const stats=ctx.stats.stats,base=20-(ctx.course.distance-2000)/1000,phase=distance>=ctx.course.distance*2/3?2:distance>=ctx.course.distance/6?1:0;
  const coefficients:Record<number,number[]>={1:[1,.98,.962],2:[.978,.991,.975],3:[.938,.998,.994],4:[.931,1,1],5:[1.063,.962,.95]};
  const wisdom=stats.wisdom.final,guts=stats.guts.final,power=stats.power.final,rawSpeed=stats.speed.final;
  if(wisdom===null||guts===null||power===null||phase===2&&(rawSpeed===null||ctx.distanceRank===null)||!coefficients[ctx.style])return null;
  const speedTerm=phase===2?Math.sqrt(500*rawSpeed!)*distanceAptitude[ctx.distanceRank!-1]*.002:0;
  let baseLow=base*coefficients[ctx.style][phase]+speedTerm,baseHigh=baseLow;
  if(phase===2&&ctx.runner.lastSpurtDistance==null)return null;
  const spurt=ctx.runner.lastSpurtDistance!=null&&ctx.runner.lastSpurtDistance>=0&&distance>=ctx.runner.lastSpurtDistance;
  if(spurt)baseHigh=(baseLow+.01*base)*1.05+speedTerm+(450*guts)**.597*.0001;
  const variance=wisdom/5500*Math.log10(.1*wisdom),slope=ctx.course.slopes.find(s=>distance>=s.start&&distance<s.start+s.length)?.slopePercent??0;
  const terrain=slope>0?-slope*200/power:0,multiplier=boost?1.04:[...pace.values()][0]??1;
  speed=[...modes.values()].reduce((n,v)=>n+v,0);
  if(modes.has('dueling')){const guts=ctx.stats.stats.guts.final;if(guts===null)return null;extraAccel=(160*guts)**.59*.0001;}
  const minimum=.85*base+Math.sqrt(200*guts)*.001;
  return {min:Math.min(30,Math.max(minimum,baseLow*multiplier+(spurt?0:base*(variance-.65)/100)+terrain+speed+mods.target)),
    max:Math.min(30,Math.max(minimum,baseHigh*multiplier+(spurt?0:base*variance/100)+terrain+speed+mods.target)),accel:Math.max(0,accel+mods.accel+extraAccel),current:mods.current,minimum};
}
/** Exact area for a constant target/acceleration over one integration step,
 * including a fractional within-step arrival at the speed ceiling. */
export function advanceSelfArea(speed:number,target:number,accel:number,dt:number,distance:number,totalDistance:number) {
  const increasing=speed<target,rate=increasing?accel:referenceDeceleration(distance,totalDistance);
  if(speed===target||rate===0)return {speed,travel:speed*dt};
  const ramp=Math.min(dt,Math.abs(target-speed)/rate),end=speed+(increasing?1:-1)*rate*ramp;
  return {speed:end,travel:(speed+end)/2*ramp+end*(dt-ramp)};
}
export function advanceSelf(speed:number,target:number,accel:number,dt:number,distance:number,totalDistance:number) {
  return speed<target?Math.min(target,speed+accel*dt):Math.max(target,speed-referenceDeceleration(distance,totalDistance)*dt);
}
