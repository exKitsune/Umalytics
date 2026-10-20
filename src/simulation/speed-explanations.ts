import type {Race,Runner} from '../data/types';
import {runnerName,skillName,type ReferenceData} from '../data/reference';
import type {SpeedChange} from '../data/speed-changes';
import {motionIndex as m,paceModes,type DecisionEvent} from './trace';
import type {LaneBonusTick} from './lane-bonus';

/** Mirror the matched engine's one-shot slope events and inclusive boundaries.
 * The motion position is the position used by the current tick's course pass. */
export function traceSlopeGrades(rows:number[][],slopes:{start:number;length:number;slopePercent:number}[]):number[]{
  let next=0,region:number|null=null,end=0,grade=0;
  return rows.map(row=>{
    if(row[m.tick]<=1)return 0; // First moving pass has no course-event update.
    const position=Math.fround(row[m.position]);
    while(next<slopes.length&&position>=Math.fround(slopes[next].start)){
      const event=slopes[next++];
      const index=slopes.findIndex(s=>Math.sign(s.slopePercent)===Math.sign(event.slopePercent)
        &&Math.fround(s.start)<=position&&position<=Math.fround(Math.fround(s.start)+Math.fround(s.length)));
      region=index<0?null:index;
      grade=region===null?0:Math.fround(event.slopePercent);
      if(region!==null)end=Math.fround(Math.fround(slopes[region].start)+Math.fround(slopes[region].length));
    }
    if(region!==null&&position>end){region=null;grade=0;}
    return grade;
  });
}

/** Explain the executed velocity pipeline directly, including ordinary ticks
 * between skill/status transitions. No causal fitting to sampled positions. */
export function explainTraceSpeed(race:Race,runner:Runner,reference:ReferenceData|null,rows:number[][],events:DecisionEvent[],laneBonus:LaneBonusTick[]=[]):SpeedChange[]{
  const changes:SpeedChange[]=[],effects=events.filter(e=>['effect-applied','effect-ended'].includes(e.kind)).sort((a,b)=>a.time-b.time);let effectIndex=0;
  const grades=traceSlopeGrades(rows,reference?.courses[race.courseId??-1]?.slopes??[]);
  const initialPower=events.find(e=>e.kind==='initial-stats')?.data.power;
  const applied=effects.filter(e=>e.kind==='effect-applied').map(e=>{
    const expected=e.time+Number(e.data.duration);
    return {start:e.time,end:Number(e.data.duration)<0?Infinity:effects.find(x=>x.kind==='effect-ended'&&x.skillId===e.skillId&&x.sequence>e.sequence&&x.time>=expected-.001&&x.time<=expected+.2)?.time??expected,
      type:Number(e.data.type),skillId:e.skillId,value:Number(e.data.modifier)};
  });
  const powerEffects=applied.filter(e=>e.type===3&&e.start>0);
  const movementTypes=new Set([1,3,4,21,22,27,28,31]);
  const movementIds=new Set(effects.filter(e=>e.kind==='effect-applied'&&movementTypes.has(Number(e.data.type))).map(e=>e.skillId));
  const effectName=(id:string)=>id==='asitame'?'Power release':id==='staminasyoubu'?'Stamina limit break':/^\d+$/.test(id)?skillName(reference,Number(id)):null;
  let previousUphill=0,previousDownhill=0;
  for(let i=0;i<rows.length;i++){
    const r=rows[i],p=rows[i-1],start=r[m.time],end=Math.min(runner.finishTimeRaw??race.duration,rows[i+1]?.[m.time]??start+r[m.dt]);
    if(end<=start)continue;
    const from=p?.[m.speed]??0,to=r[m.speed],labels:string[]=[];
    const signed=(n:number)=>`${n>=0?'+':''}${n.toFixed(3)}`;
    if(r[m.hp]<=0)labels.push(to<from-.00001?'HP-empty deceleration':'HP empty · minimum speed');
    else if(r[m.unclamped]>(p?.[m.selfSpeed]??0)+.00001)labels.push(r[m.spurt]?'Last-spurt acceleration':'Accelerating toward target');
    else if(p&&r[m.unclamped]<p[m.selfSpeed]-.00001)labels.push('Settling to lower target');
    const lane=laneBonus[i],priorLane=laneBonus[i-1];
    if(lane?.active)labels.push(`${lane.skillIds.map(id=>skillName(reference,id)).join(' / ')} lane bonus${lane.bonus===null?'':` +${lane.bonus.toFixed(3)} m/s`}`);
    else if(lane?.active===false&&priorLane?.active)labels.push(`${priorLane.skillIds.map(id=>skillName(reference,id)).join(' / ')} lane bonus ends${priorLane.bonus===null?'':` (−${priorLane.bonus.toFixed(3)} m/s target)`}`);
    for(const e of applied.filter(e=>e.start<start&&start<e.end)){
      const name=effectName(e.skillId);if(!name)continue;
      if(e.type===31&&r[m.hp]>0&&r[m.acceleration]>0)labels.push(`${name} ${signed(e.value)} m/s² acceleration`);
      else if(e.type===27&&r[m.hp]>0)labels.push(`${name} ${signed(e.value)} m/s target`);
      else if([21,22].includes(e.type))labels.push(`${name} ${signed(e.value)} m/s current speed`);
    }
    const power=typeof initialPower==='number'?Math.min(2000,Math.max(1,initialPower+powerEffects.filter(e=>start>=e.start&&start<e.end).reduce((n,e)=>n+e.value,0))):null;
    const grade=grades[i],uphill=r[m.hp]>0&&grade>0?(power===null?null:Math.fround(grade*(200/Math.fround(power)))):0;
    if(uphill===null||uphill>0)labels.push(`Uphill${uphill===null?'':` −${uphill.toFixed(3)} m/s target`}${r[m.acceleration]>0?'; lower base acceleration':''}`);
    else if(previousUphill>0)labels.push(r[m.hp]>0?`Uphill penalty ends (+${previousUphill.toFixed(3)} m/s target)`:'HP-empty target replaces hill adjustment');
    previousUphill=uphill??0;
    const downhill=r[m.hp]>0&&grade<0&&r[m.downhill]===1?.3+Math.abs(grade)/10:0;
    if(downhill>0)labels.push(`Downhill boost +${downhill.toFixed(3)} m/s target`);
    else if(previousDownhill>0)labels.push(`Downhill boost ends (−${previousDownhill.toFixed(3)} m/s target)`);
    previousDownhill=downhill;
    if(p&&r[m.spurt]!==p[m.spurt])labels.push(`Last spurt ${r[m.spurt]?'starts':'ends'}`);
    if(p&&Math.abs(r[m.section]-p[m.section])>.00001)labels.push(`Section target ${signed(r[m.section])} m/s`);
    if(p&&Math.abs(r[m.base]-p[m.base])>.00001)labels.push(`${r[m.spurt]?'Spurt':'Phase'} base ${r[m.base].toFixed(3)} m/s`);
    if(p&&(Math.abs(r[m.pace]-p[m.pace])>.00001||r[m.paceMode]!==p[m.paceMode]))labels.push(r[m.paceMode]===0?`${paceModes[p[m.paceMode]]} ends`:`${paceModes[r[m.paceMode]]} ×${r[m.pace].toFixed(3)}`);
    if(p&&r[m.downhill]!==p[m.downhill])labels.push(`Downhill mode ${r[m.downhill]?'starts':'ends'}`);
    for(const [column,name] of [[m.forceIn,'Inward positioning'],[m.spotStruggle,'Spot struggle'],[m.duel,'Dueling']] as const){
      if(p&&r[column]!==p[column])labels.push(`${name} ${r[column]?'starts':'ends'}`);
    }
    if(p&&(r[m.rushing]>0)!==(p[m.rushing]>0))labels.push(`Rushed ${r[m.rushing]>0?'starts':'ends'}`);
    if(r[m.rushing]===4)labels.push('Rushed target speed ×1.040');
    else if(p?.[m.rushing]===4)labels.push('Rushed speed boost ends');
    if(r[m.forceIn]===1)labels.push(`Inward positioning +${r[m.forceInCoefficient].toFixed(3)} m/s target`);
    const selfCut=r[m.selfLoss],finalCut=r[m.finalLoss];
    if(selfCut>0||finalCut>0){const blocker=race.runners.find(other=>other.index===r[m.blocker]);labels.push(blocker?`Blocked by ${runnerName(reference,blocker)}`:'Speed ceiling');}
    else if(p&&Math.max(p[m.selfLoss],p[m.finalLoss])>0)labels.push(p[m.blocker]>=0?'Traffic speed cut ends':'Speed ceiling no longer limiting');
    const adjustment=r[m.skillSpeed]-r[m.selfSpeed];
    if(Math.abs(adjustment-(p?p[m.skillSpeed]-p[m.selfSpeed]:0))>.00001)labels.push(`Current-speed effects ${signed(adjustment)} m/s`);
    if(r[m.selfSpeed]>r[m.unclamped]+.00001)labels.push('Minimum-speed floor');
    while(effectIndex<effects.length&&effects[effectIndex].time<=start){const e=effects[effectIndex++];
      const name=effectName(e.skillId),type=Number(e.data.type),modifier=Number(e.data.modifier);
      // Expiry callbacks have no type. Consult the applied effects so a
      // vision-only expiry cannot masquerade as a cause of a velocity change.
      if(name&&(e.kind==='effect-ended'?movementIds.has(e.skillId):movementTypes.has(type))){
        const magnitude=e.kind==='effect-applied'&&Number.isFinite(modifier)?
          type===31?` · ${signed(modifier)} m/s² acceleration`:type===27?` · ${signed(modifier)} m/s target`:
          [21,22].includes(type)?` · ${signed(modifier)} m/s current speed`:type===28?' · lane movement':'':'';
        labels.push(`${name} ${e.kind==='effect-ended'?'ends':'applies'}${magnitude}`);
      }
    }
    if(p&&Math.abs(r[m.target]-p[m.target])>.00001)labels.push(`Target ${signed(r[m.target]-p[m.target])} m/s`);
    if(!labels.length)labels.push(Math.abs(to-from)<.00001?'Speed steady':'Velocity adjustment');
    const detail=`Executed tick ${r[m.tick]}: target ${r[m.target].toFixed(4)} m/s (base ${r[m.base].toFixed(4)}, section ${signed(r[m.section])}, pace ×${r[m.pace].toFixed(4)}); acceleration ${signed(r[m.acceleration])} m/s² over ${r[m.dt].toFixed(4)} s. Before clamp ${r[m.unclamped].toFixed(4)} → self speed ${r[m.selfSpeed].toFixed(4)} → after current-speed effects ${r[m.skillSpeed].toFixed(4)} → final ${to.toFixed(4)} m/s. Self/final cuts ${selfCut.toFixed(4)} / ${finalCut.toFixed(4)} m/s; floor ${r[m.minimum].toFixed(4)}, ceiling ${r[m.cap].toFixed(4)} m/s. Separate clamp stages are not added as race-time loss.`;
    changes.push({start,end,from,to,reasons:[{label:[...new Set(labels)].join(' · '),evidence:'simulated',start,end,detail}]});
  }
  return changes;
}
