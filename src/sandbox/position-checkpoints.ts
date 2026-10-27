import type {AnalyticsSample} from '../data/analytics';

export const positionCheckpoints=[
  {key:'Position · early end',label:'End of early race',distance:(length:number)=>length/6},
  // GlobalSim uses ten whole-metre sections, rather than rounding 10/24 once.
  {key:'Position · keep end',label:'End of position keep',distance:(length:number)=>Math.floor(length/24)*10},
  {key:'Position · halfway',label:'Halfway',distance:(length:number)=>length/2},
  {key:'Position · late start',label:'Late race start',distance:(length:number)=>length*2/3},
] as const;

/** Standing on the first recorded frame at/after this runner crosses each
 * boundary. Ranks are discrete: never interpolate a fractional place. */
export function checkpointPositions(samples:Pick<AnalyticsSample,'distance'|'rank'>[],length:number|null){
  let cursor=0;
  return Object.fromEntries(positionCheckpoints.map(checkpoint=>{
    if(length===null||!Number.isFinite(length)||length<=0)return [checkpoint.key,null];
    const boundary=checkpoint.distance(length);
    while(cursor<samples.length&&(samples[cursor].distance===null||samples[cursor].distance!<boundary))cursor++;
    const sample=samples[cursor],first=samples[0];
    // A truncated recording starting after the boundary cannot establish it.
    const crossed=first?.distance!=null&&first.distance<=boundary;
    const rank=sample?.rank;
    return [checkpoint.key,crossed&&rank!=null&&Number.isInteger(rank)&&rank>0?rank:null];
  }));
}
