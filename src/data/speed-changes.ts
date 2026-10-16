import type {Race,Runner} from './types';
import type {RaceAnalysis} from './analytics';
import type {RunnerMotion} from './race-motion';
import {trace,atTime,crossing} from './effect-sampling';
import {runnerName,skillName,type ReferenceData} from './reference';
import {statusLabel,substantialNearIntervals} from './status-presentation';

export interface SpeedChangeReason {label:string;evidence:'recorded'|'model'|'position';start:number;end:number;detail?:string}
export interface SpeedChange {start:number;end:number;from:number;to:number;reasons:SpeedChangeReason[]}
const activeEnd=(i:{end:number|null;estimatedEnd?:number|null;observedUntil?:number})=>i.end??i.estimatedEnd??i.observedUntil??Infinity;

/** Explain retained speed changes without making up a unique cause or splitting
 * a measured loss between correlated causes. Position evidence remains distinct
 * from a recorded block and from a supported >0.15 m/s Near deficit. */
export function explainSpeedChanges(race:Race,reference:ReferenceData,analysis:RaceAnalysis,runner:Runner,motion:RunnerMotion):SpeedChange[]{
  const rows=trace(race,runner.id),detail=analysis.runners[runner.id],course=reference.courses[race.courseId??''];
  const intervals=substantialNearIntervals(detail.intervals,motion.samples),changes:SpeedChange[]=[];
  const phaseTimes=race.distance?[{time:crossing(race,runner.id,race.distance/6),name:'Middle leg'}, {time:crossing(race,runner.id,race.distance*2/3),name:'Final leg'}]:[];
  for(let n=1;n<rows.length;n++){
    const a=rows[n-1],b=rows[n],from=a.sample.speed,to=b.sample.speed;
    if(from==null||to==null||b.time<=a.time||b.time-a.time>2||Math.abs(to-from)<.02)continue;
    const rising=to>from,points=motion.samples.filter(s=>s.time>=a.time&&s.time<=b.time),first=points[0],last=points.at(-1);
    const reasons:SpeedChangeReason[]=[],add=(label:string,evidence:SpeedChangeReason['evidence'],start=a.time,end=b.time)=>{if(!reasons.some(r=>r.label===label))reasons.push({label,evidence,start,end});};
    const continuingSince=(time:number)=>{
      if(time>=a.time-.1)return true;
      const goal=first?.trafficTargetActive?.mid;if(goal==null)return false;
      if(rising?from>=goal-.03:from<=goal+.03)return false;
      return rows.every((r,i)=>{const previous=rows[i-1];if(!previous||previous.time<time||r.time>a.time||previous.sample.speed==null||r.sample.speed==null)return true;const delta=r.sample.speed-previous.sample.speed;return rising?delta>=-.02:delta<=.02;});
    };
    for(const phase of phaseTimes)if(phase.time!=null&&phase.time<=b.time&&phase.time>=a.time-3&&continuingSince(phase.time)){
      const before=motion.samples.filter(s=>s.time<phase.time!).at(-1),after=motion.samples.find(s=>s.time>=phase.time!);
      const delta=before?.trafficTargetActive&&after?.trafficTargetActive?after.trafficTargetActive.mid-before.trafficTargetActive.mid:null;
      if(delta!=null&&Math.abs(delta)>.05&&rising===(delta>0))add(`${phase.name} ${rising?'raises':'lowers'} target`,'model',phase.time);
    }
    const spurt=detail.summary.spurtTime;if(rising&&spurt!=null&&spurt<=b.time&&a.time>=spurt-2&&first?.targetActive&&from<first.targetActive.mid-.03)add('Last-spurt acceleration','model',Math.max(a.time,spurt));
    if(first?.startDash)add('Start dash','model');
    if(!rising&&points.some(s=>s.hpEmpty))add('Exhausted','model',points.find(s=>s.hpEmpty)!.time);
    for(const p of points)if(['recorded-block','geometry-block'].includes(p.constraint.kind)){
      const other=race.runners.find(r=>r.id===p.constraint.runnerId),name=other?runnerName(reference,other):'runner ahead';
      add(`${p.constraint.kind==='recorded-block'?'Blocked by':'Collision range with'} ${name}`,p.constraint.kind==='recorded-block'?'recorded':'position',p.time);
    }
    for(const row of [a,b])if((row.sample.blockFrontRunnerIndex??-1)>=0){const other=race.runners.find(r=>r.index===row.sample.blockFrontRunnerIndex);add(`Blocked by ${other?runnerName(reference,other):'runner ahead'}`,'recorded',row.time);}
    // Being close is useful context, but it is not itself a proven speed loss.
    const mid=(a.time+b.time)/2,self=atTime(race,runner.id,mid);
    if(self?.distance!=null&&self.lane!=null&&self.speed!=null&&!rising)for(const other of race.runners){
      if(other.id===runner.id)continue;const p=atTime(race,other.id,mid);
      if(p?.distance==null||p.lane==null||p.speed==null)continue;
      const gap=p.distance-self.distance;if(gap>0&&gap<4&&Math.abs(p.lane-self.lane)<1/18&&self.speed>p.speed+.05)add(`Approaching ${runnerName(reference,other)}`,'position');
    }
    for(const interval of intervals){
      const kind=interval.kind.replace(/-model$/,''),end=activeEnd(interval);
      if(kind==='near-slowdown'&&interval.start<b.time&&end>a.time)add('Near: speed suppressed','model',Math.max(a.time,interval.start),Math.min(b.time,end));
      if(['pace-up','pace-down','speed-up','overtake','downhill-mode','dueling','spot-struggle','rushed-boost'].includes(kind)){
        const up=kind!=='pace-down';
        if(interval.start<b.time&&end>a.time&&rising===up)add(statusLabel(kind),'model',Math.max(a.time,interval.start),Math.min(b.time,end));
        if(Number.isFinite(end)&&end<=b.time&&end>=a.time-3&&rising!==up&&continuingSince(end))add(`${statusLabel(kind)} ended`,'model',end);
      }
    }
    if(course&&a.sample.distance!=null&&b.sample.distance!=null){
      const slope=(d:number)=>course.slopes.find(s=>d>=s.start&&d<s.start+s.length)?.slopePercent??0;
      const left=slope(a.sample.distance),right=slope(b.sample.distance);
      if(!rising&&right>left+.05)add('Uphill lowers target','model');
      if(rising&&left>right+.05&&left>0)add('Uphill penalty ends','model');
    }
    for(const source of race.runners)for(const activation of analysis.runners[source.id].skillActivations){
      const effects=activation.effects.filter(e=>[21,22,27,31].includes(e.type)&&((e.targetType??1)===1?source.id===runner.id:activation.targetRunnerIds.includes(runner.id)));
      if(!effects.length)continue;
      const positive=effects.some(e=>e.rawValue>0),negative=effects.some(e=>e.rawValue<0),end=activation.effectiveEnd;
      if(activation.start>=a.time-.1&&activation.start<=b.time&&(rising&&positive||!rising&&negative))add(`${skillName(reference,activation.skillId)} activated`,'recorded',activation.start);
      if(end!=null&&end>=a.time-3&&end<=b.time&&(rising&&negative||!rising&&positive)&&continuingSince(end))add(`${skillName(reference,activation.skillId)} ended`,'model',end);
    }
    // The replay retains speeds roughly a second apart, not section RNG draws.
    // A small change across a section can be compatible with wit randomness,
    // but neither a fitted section target nor a matching magnitude proves it.
    if(!reasons.length&&course&&race.distance===course.distance&&a.sample.distance!=null&&b.sample.distance!=null&&first?.trafficTargetActive&&last?.trafficTargetActive){
      const total=race.distance!,previous=rows[n-2],priorSpeed=previous?.sample.speed;
      const boundary=Array.from({length:23},(_,i)=>(i+1)*total/24).find(d=>d>a.sample.distance!&&d<=b.sample.distance!);
      const spurtDistance=runner.lastSpurtDistance,preSpurt=spurtDistance!=null?(spurtDistance<0||b.sample.distance<spurtDistance):b.sample.distance<total*2/3;
      const stableBefore=priorSpeed!=null&&a.time-previous.time<=2&&Math.abs(from-priorSpeed)<.015;
      const selfDelta=to-last.currentSpeedDelta-(from-first.currentSpeedDelta),width=(20-(total-2000)/1000)*.0065;
      const otherBoundary=[total/6,total*2/3,...course.slopes.flatMap(s=>[s.start,s.start+s.length])].some(d=>d>a.sample.distance!&&d<=b.sample.distance!);
      const clean=points.every(p=>p.trafficTargetActive&&p.evidence!=='unknown'&&p.constraint.kind==='none'&&!p.hpEmpty&&!p.startDash&&p.pace==='normal-reference'&&Math.abs(p.currentSpeedDelta-first.currentSpeedDelta)<.005&&p.downhillTargetDelta.max===0);
      const targetDelta=last.trafficTargetActive.mid-first.trafficTargetActive.mid;
      if(boundary!=null&&preSpurt&&stableBefore&&!otherBoundary&&clean&&Math.abs(selfDelta)<=width+.011&&Math.abs(targetDelta)<=width+.02){
        const moment=a.time+(b.time-a.time)*(boundary-a.sample.distance)/(b.sample.distance-a.sample.distance);
        reasons.push({label:'Possible section variation',evidence:'model',start:moment,end:b.time,
          detail:`Section ${Math.round(boundary/total*24)+1} begins at ${boundary.toFixed(1)} m (about ${moment.toFixed(2)} s). The ${Math.abs(selfDelta).toFixed(2)} m/s self-speed change fits the section-wit range (up to ${width.toFixed(3)} m/s between draws). No competing supported change was identified; the random roll is unrecorded, so this is a possible explanation.`});
      }
    }
    if(!reasons.length&&first?.trafficTargetActive&&last?.trafficTargetActive){
      const goal=first.trafficTargetActive.mid+first.currentSpeedDelta;
      if(rising&&from<goal-.05)add('Accelerating toward target','model');
      else if(!rising&&from>goal+.05)add('Settling to a lower target','model');
    }
    changes.push({start:a.time,end:b.time,from,to,reasons});
  }
  return changes;
}
