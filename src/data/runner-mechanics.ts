import type {Race,Runner} from './types';
import type {RunnerStatBreakdown} from './effect-types';
import type {CourseReference} from './reference';
import {aptitudeRank,distanceAptitude} from './race-stats';

export interface MechanicFact {label:string;value:number|null;unit:string;formula:string;detail:string}
const speedRates:Record<number,number[]>={1:[1,.98,.962],2:[.978,.991,.975],3:[.938,.998,.994],4:[.931,1,1],5:[1.063,.962,.95]};
const accelerationRates:Record<number,number[]>={1:[1,1,.996],2:[.985,1,.996],3:[.975,1,1],4:[.945,1,.997],5:[1.17,.94,.956]};
/** Readable baseline formulae, separate from the executed float32 tick state. */
export function runnerMechanics(race:Race,runner:Runner,course:CourseReference|null,stats:RunnerStatBreakdown){
  const bound=(v:number|null)=>v===null?null:Math.max(1,Math.min(2000,v));
  const d=race.distance??course?.distance,s=stats.stats,spd=bound(s.speed.final),pow=bound(s.power.final),guts=bound(s.guts.final),wit=bound(s.wisdom.final),stamina=bound(s.stamina.final);
  const distanceKey=d==null?null:d<=1400?'short':d<=1800?'mile':d<=2400?'middle':'long';
  const rank=distanceKey?aptitudeRank(runner.aptitudes?.[distanceKey]):null,surface=course?aptitudeRank(runner.aptitudes?.[course.surface===1?'turf':'dirt']):null;
  const style=runner.strategyCode??0,rates=speedRates[style],accels=accelerationRates[style];
  const b=d==null?null:20-(d-2000)/1000,a=rank===null?null:distanceAptitude[rank-1];
  const term=spd===null||a===null?null:Math.sqrt(500*spd)*a*.002;
  const phase=[0,1,2].map(i=>b===null||!rates||i===2&&term===null?null:b*rates[i]+(i===2?term!:0));
  const maximum=b===null||phase[2]===null||term===null||guts===null?null:(phase[2]+.01*b)*1.05+term+(450*guts)**.597*.0001;
  const ground=surface===null?null:[.1,.3,.5,.7,.8,.9,1,1.05][surface-1],distAccel=rank===null?null:[.4,.5,.6,1,1,1,1,1][rank-1];
  const acceleration=[0,1,2].map(i=>pow===null||!accels||ground===null||distAccel===null?null:.0006*Math.sqrt(500*pow)*accels[i]*ground*distAccel);
  const maxRoll=wit===null||wit<=0||b===null?null:b*(wit/5500*Math.log10(.1*wit))/100;
  const fmt=(v:number|null|undefined)=>v==null?'?':Number(v.toFixed(4)).toString();
  const fact=(label:string,value:number|null,unit:string,formula:string,detail:string):MechanicFact=>({label,value,unit,formula,detail});
  const speed=[fact('Course base speed',b,'m/s',`B = 20 − (${d??'?'} − 2000) / 1000`,'Course distance sets B; individual speed stats enter the final-leg term.'),
    ...['Early leg','Middle leg','Final leg'].map((name,i)=>fact(name+' base target',phase[i],'m/s',`B × ${rates?.[i]??'?'}${i===2?' + T':''}`,`Style coefficient ${rates?.[i]??'unknown'}. Excludes section randomness, skills, slopes and pace modes.${i===2?` T = √(500 × ${fmt(spd)}) × ${fmt(a)} × 0.002 = ${fmt(term)} m/s.`:''}`)),
    fact('Maximum spurt base',maximum,'m/s',`(final-leg base + 0.01 × B) × 1.05 + T + (450 × ${fmt(guts)})^0.597 × 0.0001`,'Theoretical maximum before active effects. HP and the spurt decision can select a lower target; the actual selected target is shown separately.'),
    fact('Minimum speed',b===null||guts===null?null:.85*b+Math.sqrt(200*guts)*.001,'m/s',`0.85 × B + √(200 × ${fmt(guts)}) × 0.001`,'The post-start speed floor. Start-dash and finish handling use their own rules.'),
    fact('Start-dash ceiling',b===null?null:.85*b,'m/s','0.85 × B','Start dash ends on reaching this self-speed threshold.')];
  const accel=['Early leg','Middle leg','Final leg'].map((name,i)=>fact(name+' acceleration',acceleration[i],'m/s²',`0.0006 × √(500 × ${fmt(pow)}) × ${accels?.[i]??'?'} × ${fmt(ground)} × ${fmt(distAccel)}`,'Flat-course baseline: power × style × surface aptitude × distance aptitude. Uphill uses 0.0004 instead of 0.0006; active acceleration effects are added afterward.'));
  const other=[fact('Starting HP budget',d==null||stamina===null||stats.startingHp.strategyCoefficient===null?null:d+.8*stamina*stats.startingHp.strategyCoefficient,'HP',`${d??'?'} + 0.8 × ${fmt(stamina)} × ${fmt(stats.startingHp.strategyCoefficient)}`,'Distance plus stamina × running-style capacity. Actual starting HP appears above.'),
    fact('Final-leg HP multiplier',guts===null||guts<=0?null:1+200/Math.sqrt(600*guts),'×',`1 + 200 / √(600 × ${fmt(guts)})`,'Guts multiplier applied to ordinary HP drain in the final leg; lower is better. Other active HP modifiers are separate.'),
    fact('Expected section adjustment',maxRoll===null||b===null?null:maxRoll-b*.00325,'m/s',`B × (wit / 5500 × log10(0.1 × wit)) / 100 − B × 0.00325`,'Expected value of a section draw, not the actual roll. The matched section table below uses the executed values.'),
    fact('Lowest section adjustment',maxRoll===null||b===null?null:maxRoll-b*.0065,'m/s','section maximum − B × 0.0065','Lower bound for the section-speed random modifier.'),
    fact('Highest section adjustment',maxRoll,'m/s',`B × (${fmt(wit)} / 5500 × log10(0.1 × ${fmt(wit)})) / 100`,'Upper bound for the section-speed random modifier. Section modifiers stop during the selected last spurt.')];
  return {speed,accel,other};
}
