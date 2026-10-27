export const STAT_PAIRS=100;
export const STAT_STEP=50;
export const STAT_RANGE=200;
export const nextStatOffset=(edge:number,direction:number)=>direction<0?(Math.ceil(edge/STAT_STEP)-1)*STAT_STEP:(Math.floor(edge/STAT_STEP)+1)*STAT_STEP;
const MAX_VALUES=9; // One shared baseline + nine variants fits 1,000 races.
export interface TrendPoint {offset:number;delta:number;n:number}

export function statMeasurementBatch(offsets:number[],points:TrendPoint[]){
  const count=new Map(points.map(p=>[p.offset,p.n]));
  return [...offsets].sort((a,b)=>(count.get(a)??0)-(count.get(b)??0)||a-b).slice(0,MAX_VALUES).sort((a,b)=>a-b);
}

/** Weighted least squares, anchored at the unchanged build (0, 0). Fit a
 * straight line with sparse data, a quadratic with four measured values.
 * This descriptive fit has no confidence-band or extrapolation semantics. */
export function statTrend(points:TrendPoint[]){
  const valid=points.filter(p=>p.offset!==0&&p.n>0&&[p.offset,p.delta,p.n].every(Number.isFinite));
  if(new Set(valid.map(p=>p.offset)).size<2)return null;
  const scale=Math.max(...valid.map(p=>Math.abs(p.offset))),weight=Math.max(...valid.map(p=>p.n));
  let s2=0,s3=0,s4=0,t1=0,t2=0;
  for(const p of valid){const x=p.offset/scale,w=p.n/weight;s2+=w*x*x;s3+=w*x*x*x;s4+=w*x*x*x*x;t1+=w*x*p.delta;t2+=w*x*x*p.delta;}
  const determinant=s2*s4-s3*s3,quadratic=new Set(valid.map(p=>p.offset)).size>=4&&determinant>1e-10;
  const a=quadratic?(t1*s4-t2*s3)/determinant:t1/s2,b=quadratic?(t2*s2-t1*s3)/determinant:0;
  const low=Math.min(0,...valid.map(p=>p.offset)),high=Math.max(0,...valid.map(p=>p.offset));
  return {kind:quadratic?'Quadratic':'Linear',points:Array.from({length:81},(_,i)=>{
    const offset=low+(high-low)*i/80,x=offset/scale;
    return {offset,delta:Math.max(-1,Math.min(1,a*x+b*x*x))};
  })};
}
