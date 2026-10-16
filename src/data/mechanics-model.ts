import type { Race,Runner } from './types';
import type { CourseReference } from './reference';
import type { RunnerStatBreakdown } from './effect-types';
import { aptitudeRank,distanceAptitude } from './race-stats';
const speedStyle:Record<number,number[]>={1:[1,.98,.962],2:[.978,.991,.975],3:[.938,.998,.994],4:[.931,1,1],5:[1.063,.962,.95]};
const accelStyle:Record<number,number[]>={1:[1,1,.996],2:[.985,1,.996],3:[.975,1,1],4:[.945,1,.997],5:[1.17,.94,.956]};
export interface MechanicsContext {race:Race;runner:Runner;course:CourseReference;stats:RunnerStatBreakdown;style:number;distanceRank:number|null;surfaceRank:number|null;}
export function mechanicsContext(race:Race,runner:Runner,course:CourseReference|null,stats:RunnerStatBreakdown,style:number|null):MechanicsContext|null {
  if(!course||race.distance!==course.distance||style===null||!speedStyle[style])return null;
  const distanceKey=course.distance<=1400?'short':course.distance<=1800?'mile':course.distance<=2400?'middle':'long';
  return {race,runner,course,stats,style,distanceRank:aptitudeRank(runner.aptitudes?.[distanceKey]),surfaceRank:aptitudeRank(runner.aptitudes?.[course.surface===1?'turf':'dirt'])};
}
export function baselineTarget(ctx:MechanicsContext,distance:number):{min:number;max:number}|null {
  const {stats,course,runner}=ctx,speed=stats.stats.speed.final,wisdom=stats.stats.wisdom.final,guts=stats.stats.guts.final,power=stats.stats.power.final;
  if(speed===null||wisdom===null||power===null||guts===null||ctx.distanceRank===null)return null;
  const base=20-(course.distance-2000)/1000,phase=distance>=course.distance*2/3?2:distance>=course.distance/6?1:0;
  const term=Math.sqrt(500*speed)*distanceAptitude[ctx.distanceRank-1]*.002;
  let target=base*speedStyle[ctx.style][phase]+(phase===2?term:0);
  if(phase===2&&runner.lastSpurtDistance==null)return null;
  const spurt=runner.lastSpurtDistance!=null&&runner.lastSpurtDistance>=0&&distance>=runner.lastSpurtDistance;
  const lateTarget=target;
  if(spurt){target=(base*speedStyle[ctx.style][2]+term+.01*base)*1.05+term+(450*guts)**.597*.0001;}
  const slope=course.slopes.find(s=>distance>=s.start&&distance<s.start+s.length)?.slopePercent??0;
  if(slope>0)target-=slope*200/power;
  const minimum=.85*base+Math.sqrt(200*guts)*.001;
  const variance=wisdom/5500*Math.log10(.1*wisdom);
  // A recorded spurt start does not report the HP-selected spurt target. Bound
  // it by late target and maximum spurt, rather than silently choosing maximum.
  return {min:Math.min(30,Math.max(minimum,spurt?lateTarget-(slope>0?slope*200/power:0):target+base*(variance-.65)/100)),max:Math.min(30,Math.max(minimum,target+(spurt?0:base*variance/100)))};
}
/** Metres per second squared while self speed is above its target.
 * Pace-down uses 0.5. Otherwise the opening sixth is 1.2, the middle is 0.8, and the final third is 1. */
export function referenceDeceleration(distance: number, total: number | null, paceDown = false): number {
  if (paceDown) return 0.5;
  if (total == null || !Number.isFinite(total)) return 1;
  if (distance < total / 6) return 1.2;
  if (distance < total * 2 / 3) return 0.8;
  return 1;
}
export function baseAcceleration(ctx:MechanicsContext,distance:number,speed:number,startDash=false):number|null {
  const power=ctx.stats.stats.power.final;if(power===null||ctx.surfaceRank===null||ctx.distanceRank===null)return null;
  const phase=distance>=ctx.course.distance*2/3?2:distance>=ctx.course.distance/6?1:0;
  const slope=ctx.course.slopes.find(s=>distance>=s.start&&distance<s.start+s.length)?.slopePercent??0;
  const surface=[.1,.3,.5,.7,.8,.9,1,1.05][ctx.surfaceRank-1],distanceA=[.4,.5,.6,1,1,1,1,1][ctx.distanceRank-1];
  return (slope > 0 ? 0.0004 : 0.0006)*Math.sqrt(500*power)*accelStyle[ctx.style][phase]*surface*distanceA+(startDash?24:0);
}
export function hpReference(ctx:MechanicsContext,speed:number,distance:number):number|null {
  const guts=ctx.stats.stats.guts.final,ground=Number(ctx.race.conditions?.ground);if(guts===null||!Number.isInteger(ground)||ground<1||ground>4)return null;
  const modifier=ground===4?1.02:ground===3?ctx.course.surface===1?1.02:1.01:1;
  return 20*Math.max(0,speed-(20-(ctx.course.distance-2000)/1000)+12)**2/144*modifier*(distance>=ctx.course.distance*2/3?1+200/Math.sqrt(600*guts):1);
}
