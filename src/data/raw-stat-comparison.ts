import type {CourseReference} from './reference';
import type {Runner,RunnerStats} from './types';
import {aptitudeRank,distanceAptitude,styleAptitude} from './race-stats';

export const rawStatKeys=['speed','stamina','power','guts','wisdom'] as const;
export const comparisonKeys=[...rawStatKeys,'distance','surface','strategyAptitude'] as const;
export type ComparisonKey=typeof comparisonKeys[number];
export interface RawStatProfile {id:string;name:string;stats:RunnerStats;distance:number|null;surface:number|null;strategyAptitude:number|null;strategy:number|null;mood:number|null;moods?:{mood:number;weight:number}[];charaId?:number|null;cardId?:number|null}
export interface RawContext {course:CourseReference;ground:number;strategy:number;mood:number}
export function rawProfile(runner:Runner,course:CourseReference):RawStatProfile{
  const length=course.distance<=1400?'short':course.distance<=1800?'mile':course.distance<=2400?'middle':'long';
  const style=({1:'front',2:'pace',3:'late',4:'end',5:'front'} as const)[runner.strategyCode as 1];
  return {id:runner.id,name:runner.name,charaId:runner.charaId,cardId:runner.cardId,stats:runner.stats??{speed:null,stamina:null,power:null,guts:null,wisdom:null},distance:aptitudeRank(runner.aptitudes?.[length]),surface:aptitudeRank(runner.aptitudes?.[course.surface===2?'dirt':'turf']),strategyAptitude:style?aptitudeRank(runner.aptitudes?.[style]):null,strategy:runner.strategyCode??null,mood:runner.mood??null};
}
const speedStyle=[[0,0,0],[1,.98,.962],[.978,.991,.975],[.938,.998,.994],[.931,1,1],[1.063,.962,.95]];
const accelStyle=[[0,0,0],[1,1,.996],[.985,1,.996],[.975,1,1],[.945,1,.997],[1.17,.94,.956]];
const hpStyle=[0,.95,.89,1,.995,.86];
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
type Stats=Record<typeof rawStatKeys[number],number>;
export function adjustedRawStats(profile:RawStatProfile,context:RawContext):Stats{
  for(const key of rawStatKeys)if(profile.stats[key]==null||!Number.isFinite(profile.stats[key])||profile.stats[key]!<1||profile.stats[key]!>2000)throw Error(`${profile.name}: ${key==='wisdom'?'Wit':key} is missing or outside 1–2000.`);
  for(const key of ['distance','surface','strategyAptitude'] as const)if(!Number.isInteger(profile[key])||profile[key]!<1||profile[key]!>8)throw Error(`${profile.name}: ${key} aptitude is missing.`);
  if(![1,2,3,4,5].includes(context.strategy)||![1,2,3,4,5].includes(context.mood)||![1,2,3,4].includes(context.ground)||![1,2].includes(context.course.surface))throw Error('Choose known strategy, mood and ground conditions.');
  const stats=Object.fromEntries(rawStatKeys.map(k=>{const raw=profile.stats[k]!;return [k,clamp((raw>1200?1200+(raw-1200)/2:raw)*(1+.02*(context.mood-3)),1,2000)];})) as Stats;
  const thresholds=context.course.courseSetStatus.map(id=>stats[rawStatKeys[id-1]]);
  if(thresholds.some(v=>v===undefined))throw Error('Unsupported course stat threshold.');
  const track=thresholds.length?thresholds.reduce((sum,v)=>sum+(v>900?1.2:v>600?1.15:v>300?1.1:1.05),0)/thresholds.length:1;
  stats.speed=clamp(stats.speed*track-(context.ground===4?50:0),1,2000);
  stats.power=clamp(stats.power-(context.course.surface===2?(context.ground===2?50:100):(context.ground===1?0:50)),1,2000);
  stats.wisdom=clamp(stats.wisdom*styleAptitude[profile.strategyAptitude!-1],1,2000);
  return stats;
}
interface VelocityMass {weight:number;speed:number;on:boolean}
interface Path {duelWarmup:number;duelUsed:boolean;duelActive:boolean;duelTime:number;x:number;t:number;hp:number;mass:VelocityMass[];shadow:number;dash:boolean;hill:number;check:number;downTime:number;downGain:number;carry:number;phaseTimes:number[];samples:{distance:number;speed:number}[]}
interface Plan {start:number;speed:number;weight:number}
export interface RawProjection {duelTime:number;duelTarget:number;time:number;finishSpeed:number;hp:number;initialHp:number;spurtStart:number;spurtSpeed:number;downTime:number;downGain:number;carry:number;phaseTimes:number[];samples:{distance:number;speed:number}[];stats:Stats;maxSpurt:number;acceleration:number}

/** Deterministic course-only expectation. A velocity distribution retains
 * downhill momentum; its probability mass is split at one-second checks.
 * All paths use mean course position and HP, so this is an approximation to
 * race outcomes, not an execution or reconstruction of GlobalSim. */
export function projectRawStats(profile:RawStatProfile,context:RawContext,step=.1,earliestDuel=false):RawProjection{
  const stats=adjustedRawStats(profile,context),{course,strategy}=context,d=course.distance;
  if(!Number.isFinite(d)||d<=0||d>10000)throw Error('Course distance unavailable.');
  if(!Number.isFinite(step)||step<.01||step>.25)throw Error('Invalid integration step.');
  const base=20-(d-2000)/1000,late=d*2/3,minimum=.85*base+Math.sqrt(200*stats.guts)*.001;
  const speedTerm=Math.sqrt(500*stats.speed)*distanceAptitude[profile.distance!-1]*.002;
  const targets=speedStyle[strategy].map((c,i)=>base*c+(i===2?speedTerm:0));
  const maximum=(targets[2]+.01*base)*1.05+speedTerm+(450*stats.guts)**.597*.0001;
  const accel=.0006*Math.sqrt(500*stats.power)*[.1,.3,.5,.7,.8,.9,1,1.05][profile.surface!-1]*[.4,.5,.6,1,1,1,1,1][profile.distance!-1];
  const section=base*(stats.wisdom/5500*Math.log10(.1*stats.wisdom)-.325)/100;
  const initialHp=d+.8*hpStyle[strategy]*stats.stamina,gutsCost=1+200/Math.sqrt(600*stats.guts);
  const groundCost=context.ground===4?1.02:context.ground===3?(course.surface===1?1.02:1.01):1;
  const drain=(v:number,phase:number,on=false)=>20*(v-base+12)**2/144*groundCost*(phase===2?gutsCost:1)*(on?.4:1);
  const entry=Math.min(1,stats.wisdom*.0004);
  const finalStraight=course.corners.length?course.straights.at(-1):undefined;
  const duelTarget=(200*stats.guts)**.708*.0001,duelAccel=(160*stats.guts)**.59*.0001;
  const average=(mass:VelocityMass[])=>mass.reduce((sum,m)=>sum+m.weight*m.speed,0);
  function merge(mass:VelocityMass[]){
    const bins=new Map<number,VelocityMass>();
    for(const m of mass){if(m.weight<1e-10)continue;const key=Math.round(m.speed/.025)*2+Number(m.on),found=bins.get(key);if(found){const w=found.weight+m.weight;found.speed=(found.weight*found.speed+m.weight*m.speed)/w;found.weight=w;}else bins.set(key,{...m});}
    const out=[...bins.values()],total=out.reduce((s,m)=>s+m.weight,0);for(const m of out)m.weight/=total;return out;
  }
  function advance(path:Path,until:number,plan:Plan){
    let iterations=0;
    while(path.x<until-1e-7&&iterations++<20000){
      const phase=path.x<d/6?0:path.x<late?1:2;
      const hill=course.slopes.findIndex(s=>path.x>=s.start-1e-8&&path.x<s.start+s.length-1e-8),slope=course.slopes[hill]?.slopePercent??0;
      if(hill!==path.hill){path.mass=merge(path.mass.map(m=>({...m,on:false})));path.hill=hill;path.check=path.t;}
      if(slope<0&&path.t>=path.check-1e-8){
        path.mass=merge(path.mass.flatMap(m=>{const chance=m.on?.8:entry;return [{weight:m.weight*chance,speed:m.speed,on:true},{weight:m.weight*(1-chance),speed:m.speed,on:false}];}));path.check=path.t+1;
      }
      // An eligible partner can enter the straight up to 3 m ahead.
      const duelProximity=earliestDuel&&finalStraight&&path.x>=Math.max(0,finalStraight.start-3)-1e-8&&path.x<finalStraight.end;
      const inDuelStraight=earliestDuel&&finalStraight&&path.x>=finalStraight.start-1e-8&&path.x<finalStraight.end;
      if(inDuelStraight&&!path.duelUsed&&path.duelWarmup>=2-1e-8&&path.hp>=initialHp*.15){path.duelUsed=true;path.duelActive=true;}
      if(path.duelActive&&path.hp<initialHp*.05)path.duelActive=false;
      const spurt=path.x>=plan.start,rawTarget=spurt?plan.speed:targets[phase]+section;
      const target=path.hp<=0?minimum:rawTarget-(slope>0?slope*200/stats.power:0)+(path.duelActive?duelTarget:0);
      const v=average(path.mass);
      const boundary=Math.min(until,...[d/6,late,plan.start,...(earliestDuel&&finalStraight?[Math.max(0,finalStraight.start-3),finalStraight.start,finalStraight.end]:[]),...course.slopes.flatMap(s=>[s.start,s.start+s.length])].filter(x=>x>path.x+1e-7));
      let dt=Math.min(step,(boundary-path.x)/Math.max(3,v),slope<0?Math.max(1e-6,path.check-path.t):step);
      if(duelProximity&&!path.duelUsed&&path.duelWarmup<2)dt=Math.min(dt,2-path.duelWarmup);
      // Start dash has a hard speed boundary. Letting an integration tick
      // overshoot it produces spurious metres of gain for tiny Power changes.
      if(path.dash)dt=Math.min(dt,Math.max(1e-9,(.85*base-v)/(24+accel*accelStyle[strategy][phase]*(slope>0?2/3:1))));
      const update=(speed:number,ceiling:number,elapsed=dt)=>{const goal=clamp(ceiling,minimum,30),acceleration=path.hp<=0?1.2:speed>goal?[1.2,.8,1][phase]:accel*accelStyle[strategy][phase]*(slope>0?2/3:1)+(path.dash?24:0)+(path.duelActive?duelAccel:0);const next=speed>goal?Math.max(goal,speed-acceleration*elapsed):Math.min(goal,speed+acceleration*elapsed);return path.dash?next:Math.max(minimum,next);};
      const ceiling=(m:VelocityMass)=>target+(m.on&&slope<0&&path.hp>0?.3-slope/10:0);
      const travel=(elapsed:number)=>(v+path.mass.reduce((s,m)=>s+m.weight*update(m.speed,ceiling(m),elapsed),0))*.5*elapsed;
      if(travel(dt)>boundary-path.x){let lo=0,hi=dt;for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(travel(mid)>boundary-path.x)hi=mid;else lo=mid;}dt=(lo+hi)/2;}
      const previous=v;let cost=0,onMass=0;
      for(const m of path.mass){m.speed=update(m.speed,target+(m.on&&slope<0&&path.hp>0?.3-slope/10:0));cost+=m.weight*drain(m.speed,phase,m.on&&slope<0);if(m.on)onMass+=m.weight;}
      const after=average(path.mass),dx=(previous+after)*.5*dt;
      path.shadow=update(path.shadow,target);
      const benefit=Math.max(0,after-path.shadow)*dt;
      if(slope<0){path.downTime+=onMass*dt;path.downGain+=benefit;}else path.carry+=benefit;
      if(duelProximity)path.duelWarmup+=dt;
      if(path.duelActive)path.duelTime+=dt;
      path.hp=Math.max(0,path.hp-cost*dt);path.phaseTimes[phase]+=dt;path.t+=dt;path.x+=dx;
      if(Math.abs(path.x-boundary)<1e-6)path.x=boundary;
      if(path.dash&&after>=.85*base-1e-8)path.dash=false;
      if(!path.samples.length||path.x-path.samples.at(-1)!.distance>=8||path.x>=until-1e-6)path.samples.push({distance:path.x,speed:after});
    }
    if(iterations>=20000)throw Error('Course comparison did not converge.');
    return path;
  }
  const prefix=advance({duelWarmup:0,duelUsed:false,duelActive:false,duelTime:0,x:0,t:.05,hp:initialHp,mass:[{weight:1,speed:3,on:false}],shadow:3,dash:true,hill:-2,check:0,downTime:0,downGain:0,carry:0,phaseTimes:[.05,0,0],samples:[{distance:0,speed:3}]},late,{start:d,speed:maximum,weight:1});
  // Reproduce the analytic candidate structure (60 m buffer, 30 m start grid,
  // 0.1 m/s targets). Average the Wit lottery instead of drawing random seeds.
  const remaining=Math.max(0,d-late-60),plans:Plan[]=[];
  if(prefix.hp>=remaining/maximum*drain(maximum,2))plans.push({start:late,speed:maximum,weight:1});
  else if(prefix.hp>=remaining/targets[2]*drain(targets[2],2)){
    const candidates:{start:number;speed:number;time:number}[]=[];
    for(let speed=maximum;speed>targets[2]&&candidates.length<102;speed-=.1){
      for(let sprint=remaining;sprint>0;sprint-=30){const slow=(remaining-sprint)/targets[2],fast=sprint/speed,start=d-60-sprint;if(prefix.hp>=slow*drain(targets[2],2)+fast*drain(speed,2)&&start<d-100){candidates.push({start:Math.max(late,start),speed,time:slow+fast});break;}}
    }
    candidates.sort((a,b)=>a.time-b.time);
    const chance=clamp(Math.ceil(15+.05*stats.wisdom)/100,0,1);let left=1;
    candidates.forEach((candidate,i)=>{const weight=i===candidates.length-1?left:left*chance;left-=weight;if(weight>1e-7)plans.push({...candidate,weight});});
  }
  if(!plans.length)plans.push({start:d,speed:maximum,weight:1});
  const weightSum=plans.reduce((s,p)=>s+p.weight,0);for(const p of plans)p.weight/=weightSum;
  const tails=plans.map(plan=>({plan,path:advance(structuredClone(prefix),d,plan)}));
  const sum=(fn:(path:Path,plan:Plan)=>number)=>tails.reduce((s,{path,plan})=>s+plan.weight*fn(path,plan),0);
  const sampleAt=(path:Path,distance:number)=>{const i=path.samples.findIndex(s=>s.distance>=distance);if(i<0)return path.samples.at(-1)!.speed;if(i===0)return path.samples[0].speed;const a=path.samples[i-1],b=path.samples[i];return a.speed+(b.speed-a.speed)*(distance-a.distance)/(b.distance-a.distance);};
  return {duelTime:sum(p=>p.duelTime),duelTarget,time:sum(p=>p.t),finishSpeed:sum(p=>average(p.mass)),hp:sum(p=>p.hp),initialHp,spurtStart:sum((p,plan)=>plan.start),spurtSpeed:sum((p,plan)=>plan.speed),downTime:sum(p=>p.downTime),downGain:sum(p=>p.downGain),carry:sum(p=>p.carry),phaseTimes:[0,1,2].map(i=>sum(p=>p.phaseTimes[i])),samples:Array.from({length:121},(_,i)=>({distance:d*i/120,speed:sum(p=>sampleAt(p,d*i/120))})),stats,maxSpurt:maximum,acceleration:accel};
}

/** Each side isolates its own stat advantage. Never borrow the other runner's
 * strategy or mood: A(actual) minus A(with B's input), then the converse for B. */
export function compareRawStats(reference:RawStatProfile,comparison:RawStatProfile,context:Pick<RawContext,'course'|'ground'>){
  return {left:statAdvantage(reference,comparison,context),right:statAdvantage(comparison,reference,context)};
}
function statAdvantage(subject:RawStatProfile,other:RawStatProfile,context:Pick<RawContext,'course'|'ground'>){
  const moods=subject.moods?.length?subject.moods:[{mood:subject.mood!,weight:1}];
  if(moods.some(m=>!Number.isFinite(m.weight)||m.weight<=0))throw Error('Invalid mood distribution.');
  const totalWeight=moods.reduce((s,m)=>s+m.weight,0);
  const project=(p:RawStatProfile,duel=false)=>{
    const values=moods.map(m=>({weight:m.weight/totalWeight,value:projectRawStats(p,{...context,strategy:subject.strategy!,mood:m.mood},.1,duel)}));
    const result={...values[0].value};
    for(const key of ['duelTime','duelTarget','time','finishSpeed','initialHp','hp','spurtStart','spurtSpeed','downTime','downGain','carry','maxSpurt','acceleration'] as const)result[key]=values.reduce((s,m)=>s+m.weight*m.value[key],0);
    return result;
  };
  const base=project(subject);
  const gain=(projection:RawProjection)=>({time:projection.time-base.time,distance:(projection.time-base.time)*base.finishSpeed,spurtSpeed:base.maxSpurt-projection.maxSpurt});
  const rows=comparisonKeys.map(key=>{
    const same=rawStatKeys.includes(key as typeof rawStatKeys[number])?subject.stats[key as keyof RunnerStats]===other.stats[key as keyof RunnerStats]:subject[key as 'distance']===other[key as 'distance'];
    const profile=structuredClone(subject);
    if(rawStatKeys.includes(key as typeof rawStatKeys[number]))profile.stats[key as keyof RunnerStats]=other.stats[key as keyof RunnerStats];else profile[key as 'distance']=other[key as 'distance'];
    const changed=same?base:project(profile);
    let dueling:null|{time:number;distance:number;duration:number;otherDuration:number;targetSpeed:number;otherTargetSpeed:number}=null;
    if(key==='guts'){
      const ownDuel=project(subject,true),otherDuel=same?ownDuel:project(profile,true);
      const time=(otherDuel.time-ownDuel.time)-(changed.time-base.time);
      dueling={time,distance:time*base.finishSpeed,duration:ownDuel.duelTime,otherDuration:otherDuel.duelTime,targetSpeed:ownDuel.duelTarget,otherTargetSpeed:otherDuel.duelTarget};
    }
    return {key,...gain(changed),substitutedSpurt:changed.maxSpurt,dueling};
  });
  const changed=project({...subject,stats:other.stats,distance:other.distance,surface:other.surface,strategyAptitude:other.strategyAptitude});
  const total=gain(changed),interaction={time:total.time-rows.reduce((s,r)=>s+r.time,0),distance:total.distance-rows.reduce((s,r)=>s+r.distance,0)};
  return {base,changed,total,rows,interaction};
}
