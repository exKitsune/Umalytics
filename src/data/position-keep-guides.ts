import type {Race} from './types';
import type {RaceAnalysis} from './analytics';
import {atTime} from './effect-sampling';
import {effectiveStrategyCode} from './skill-details';

export interface PositionKeepGuide {id:'PD'|'PU'|'SU'|'OT';gap:number;threshold:number;detail:string}
export interface PositionKeepGuideSpan {id:PositionKeepGuide['id'];start:number;end:number}
export interface PositionKeepGuideSample {time:number;guides:PositionKeepGuide[]}

export function positionKeepGuideTimeline(race:Race,analysis:RaceAnalysis,selected:string):PositionKeepGuideSample[]{
  return race.frames.flatMap(frame=>{
    const guides=positionKeepGuides(race,analysis,selected,frame.time);
    return guides.length?[{time:frame.time,guides}]:[];
  });
}
/** Axis keys remain available outside the mode window. Only hover lines are
 * restricted to eligible sections; use the nearest preceding valid reference. */
export function positionKeepMarkerGuides(samples:PositionKeepGuideSample[],time:number):PositionKeepGuide[]{
  let low=0,high=samples.length;
  while(low<high){const mid=(low+high)>>>1;if(samples[mid].time<=time)low=mid+1;else high=mid;}
  return samples[Math.max(0,low-1)]?.guides??[];
}

/** Reference thresholds, not recovered native mode state. Coordinates use the
 * same signed leader/second gap as telemetry, even when the pacer/peer differs. */
export function positionKeepGuides(race:Race,analysis:RaceAnalysis,selected:string,time:number):PositionKeepGuide[]{
  const distance=race.distance,self=atTime(race,selected,time),runner=race.runners.find(r=>r.id===selected);
  if(!distance||!runner||self?.distance==null||self.distance>=distance*10/24||self.temptationMode!==0)return [];
  const field=race.runners.map(r=>({runner:r,distance:atTime(race,r.id,time)?.distance,style:effectiveStrategyCode(r,analysis.runners[r.id]?.skillRows??[])}));
  if(field.some(r=>r.distance==null||r.style==null))return [];
  const own=field.find(r=>r.runner.id===selected)!,others=field.filter(r=>r!==own);
  if(!others.length)return [];
  const second=Math.max(...others.map(r=>r.distance!)),style=own.style!,window='Sections 1–10. Reference threshold; mode checks are not recorded.';
  if(style===1||style===5){
    const peers=others.filter(r=>r.style===style),fronts=field.filter(r=>r.style===1).length;
    const su=style===5?17.5:fronts===1?12.5:4.5;
    const result:PositionKeepGuide[]=[{id:'SU',gap:-su,threshold:su,detail:`Speed Up stop · ${su.toFixed(1)} m ahead of second. Guide shown while first. ${window}`}];
    if(peers.length){
      const ot=style===5?27.5:10,peer=Math.max(...peers.map(r=>r.distance!)),gap=second-peer-ot;
      result.push({id:'OT',gap,threshold:ot,detail:`Overtake stop · ${ot.toFixed(1)} m ahead of the next ${style===5?'Runaway':'Front Runner'}. Guide shown while not first. ${Math.abs(gap+ot)>.01?`Currently ${gap.toFixed(1)} m on the overall gap scale. `:''}${window}`});
    }
    return result;
  }
  const priority=(s:number)=>s===5?0:s,forward=field.reduce((best,r)=>priority(r.style!)<priority(best)?r.style!:best,style);
  const pacer=field.filter(r=>r.style===forward).sort((a,b)=>b.distance!-a.distance!)[0];
  // A self-pacer cannot supply an independent following-distance reference.
  if(!pacer||pacer===own)return [];
  const factor=1+.0008*(distance-1000),range=style===2?[3,5*factor]:style===3?[6.5*factor,7*factor]:style===4?[7.5*factor,8*factor]:null;
  if(!range)return [];
  const shift=second-pacer.distance!,context=`Uses the leading forward-strategy runner as pacemaker. ${Math.abs(shift)>.01?'Adjusted to the overall gap scale. ':''}${window}`;
  return [{id:'PD',gap:shift+range[0],threshold:range[0],detail:`Pace Down start · closer than ${range[0].toFixed(1)} m behind pacemaker, without a speed skill. ${context}`},
    {id:'PU',gap:shift+range[1],threshold:range[1],detail:`Pace Up start · farther than ${range[1].toFixed(1)} m behind pacemaker, after a wit check. ${context}`}];
}

/** Visible portions of a threshold guide, not inferred active mode intervals.
 * Split at interpolated passes and the exact end of section 10. */
export function positionKeepGuideSpans(race:Race,analysis:RaceAnalysis,selected:string):PositionKeepGuideSpan[]{
  if(!race.distance)return [];
  const limit=race.distance*10/24,spans:PositionKeepGuideSpan[]=[],last=new Map<PositionKeepGuide['id'],PositionKeepGuideSpan>();
  for(let i=1;i<race.frames.length;i++){
    const a=race.frames[i-1],b=race.frames[i],sa=atTime(race,selected,a.time),sb=atTime(race,selected,b.time);
    if(sa?.distance==null||sb?.distance==null||b.time<=a.time||sa.distance>=limit)continue;
    const cuts=[0,1],delta=sb.distance-sa.distance;
    if(delta>0&&sb.distance>limit)cuts.push((limit-sa.distance)/delta);
    for(const runner of race.runners){
      if(runner.id===selected)continue;
      const pa=atTime(race,runner.id,a.time)?.distance,pb=atTime(race,runner.id,b.time)?.distance;
      if(pa==null||pb==null)continue;
      const da=sa.distance-pa,db=sb.distance-pb;
      if(da*db<0)cuts.push(da/(da-db));
    }
    const sorted=[...new Set(cuts)].sort((x,y)=>x-y);
    for(let j=1;j<sorted.length;j++){
      const start=a.time+(b.time-a.time)*sorted[j-1],end=a.time+(b.time-a.time)*sorted[j],mid=(start+end)/2;
      const self=atTime(race,selected,mid),guides=positionKeepGuides(race,analysis,selected,mid);
      const first=race.runners.every(r=>r.id===selected||(atTime(race,r.id,mid)?.distance??Infinity)<=self!.distance!);
      for(const guide of guides){
        if(guide.id==='SU'&&!first||guide.id==='OT'&&first)continue;
        const prior=last.get(guide.id);
        if(prior&&Math.abs(prior.end-start)<1e-7)prior.end=end;
        else{const span={id:guide.id,start,end};spans.push(span);last.set(guide.id,span);}
      }
    }
  }
  return spans;
}
