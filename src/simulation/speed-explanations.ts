import type {Race,Runner} from '../data/types';
import {runnerName,skillName,type ReferenceData} from '../data/reference';
import type {SpeedChange} from '../data/speed-changes';
import {motionIndex as m,paceModes,type DecisionEvent} from './trace';

/** Explain the executed velocity pipeline directly, including ordinary ticks
 * between skill/status transitions. No causal fitting to sampled positions. */
export function explainTraceSpeed(race:Race,runner:Runner,reference:ReferenceData|null,rows:number[][],events:DecisionEvent[]):SpeedChange[]{
  const changes:SpeedChange[]=[],effects=events.filter(e=>['effect-applied','effect-ended'].includes(e.kind)).sort((a,b)=>a.time-b.time);let effectIndex=0;
  for(let i=0;i<rows.length;i++){
    const r=rows[i],p=rows[i-1],start=r[m.time],end=Math.min(runner.finishTimeRaw??race.duration,rows[i+1]?.[m.time]??start+r[m.dt]);
    if(end<=start)continue;
    const from=p?.[m.speed]??0,to=r[m.speed],labels:string[]=[];
    const signed=(n:number)=>`${n>=0?'+':''}${n.toFixed(3)}`;
    if(r[m.hp]<=0)labels.push('HP-empty deceleration');
    else if(r[m.acceleration]>0)labels.push(r[m.spurt]?'Last-spurt acceleration':'Accelerating toward target');
    else if(r[m.acceleration]<0)labels.push('Settling to target');
    if(p&&Math.abs(r[m.section]-p[m.section])>.00001)labels.push(`Section roll ${signed(r[m.section])} m/s`);
    if(p&&Math.abs(r[m.base]-p[m.base])>.00001)labels.push(`${r[m.spurt]?'Spurt':'Phase'} base ${r[m.base].toFixed(3)} m/s`);
    if(p&&Math.abs(r[m.pace]-p[m.pace])>.00001)labels.push(`${paceModes[r[m.paceMode]]} ×${r[m.pace].toFixed(3)}`);
    if(p&&r[m.downhill]!==p[m.downhill])labels.push(`Downhill mode ${r[m.downhill]?'starts':'ends'}`);
    for(const [column,name] of [[m.forceIn,'Inward positioning'],[m.spotStruggle,'Spot struggle'],[m.duel,'Dueling'],[m.rushing,'Rushed']] as const){
      if(p&&r[column]!==p[column])labels.push(`${name} ${r[column]?'starts':'ends'}`);
    }
    if(p&&Math.abs(r[m.target]-p[m.target])>.00001)labels.push(`Target ${signed(r[m.target]-p[m.target])} m/s`);
    const selfCut=r[m.selfLoss],finalCut=r[m.finalLoss];
    if(selfCut>0||finalCut>0){const blocker=race.runners.find(other=>other.index===r[m.blocker]);labels.push(blocker?`Blocked by ${runnerName(reference,blocker)}`:'Speed ceiling');}
    const adjustment=r[m.skillSpeed]-r[m.selfSpeed];
    if(Math.abs(adjustment-(p?p[m.skillSpeed]-p[m.selfSpeed]:0))>.00001)labels.push(`Current-speed effects ${signed(adjustment)} m/s`);
    if(r[m.selfSpeed]>r[m.unclamped]+.00001)labels.push('Minimum-speed floor');
    while(effectIndex<effects.length&&effects[effectIndex].time<=start){const e=effects[effectIndex++];
      const name=e.skillId==='asitame'?'Power release':/^\d+$/.test(e.skillId)?skillName(reference,Number(e.skillId)):null;
      if(name&&(!('type' in e.data)||[21,22,27,31].includes(Number(e.data.type))))labels.push(`${name} ${e.kind==='effect-ended'?'ends':'applies'}`);
    }
    if(!labels.length)labels.push(Math.abs(to-from)<.00001?'Holding target speed':'Velocity adjustment');
    const detail=`Executed tick ${r[m.tick]}: target ${r[m.target].toFixed(4)} m/s (base ${r[m.base].toFixed(4)}, section ${signed(r[m.section])}, pace ×${r[m.pace].toFixed(4)}); acceleration ${signed(r[m.acceleration])} m/s² over ${r[m.dt].toFixed(4)} s. Before clamp ${r[m.unclamped].toFixed(4)} → self speed ${r[m.selfSpeed].toFixed(4)} → after current-speed effects ${r[m.skillSpeed].toFixed(4)} → final ${to.toFixed(4)} m/s. Self/final cuts ${selfCut.toFixed(4)} / ${finalCut.toFixed(4)} m/s; floor ${r[m.minimum].toFixed(4)}, ceiling ${r[m.cap].toFixed(4)} m/s. Separate clamp stages are not added as race-time loss.`;
    changes.push({start,end,from,to,reasons:[{label:[...new Set(labels)].join(' · '),evidence:'simulated',start,end,detail}]});
  }
  return changes;
}
