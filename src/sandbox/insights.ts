import type {Job,Setup,UmaBuild,RunSummary} from './model';
import {distribution} from './results';
import {STAT_STEP,STAT_RANGE} from './stat-trend';

export const statKeys=['speed','stamina','power','guts','wisdom'] as const;
export type StatKey=typeof statKeys[number];
export type ImpactTarget={kind:'skill';skillId:number}|{kind:'stat';stat:StatKey;delta:number};
export type ImpactExperiment=ImpactTarget|{kind:'stat-range';stat:StatKey;deltas:number[]};
export interface ImpactRequest {participantId:string;target:ImpactExperiment;count:number}
const skills=(b:UmaBuild)=>b.skills.map(s=>`${s.id}:${s.level??1}`).sort().join(',');

/** Recognize only a single isolated change; arbitrary saved builds are not a
 * measurement of any one skill or stat. Names and memos are cosmetic. */
export function impactTarget(base:UmaBuild,other:UmaBuild):ImpactTarget|null {
  if(['charaId','cardId','fans','careerWins'].some(k=>base[k as keyof UmaBuild]!==other[k as keyof UmaBuild]))return null;
  const changed=statKeys.filter(k=>base.stats[k]!==other.stats[k]);
  if(changed.length===1&&skills(base)===skills(other)){
    const stat=changed[0],a=base.stats[stat],b=other.stats[stat];
    return a!=null&&b!=null?{kind:'stat',stat,delta:b-a}:null;
  }
  if(changed.length)return null;
  const removed=base.skills.filter(s=>!other.skills.some(o=>o.id===s.id));
  if(removed.length!==1||skills({...base,skills:base.skills.filter(s=>s.id!==removed[0].id)})!==skills(other))return null;
  return {kind:'skill',skillId:removed[0].id};
}
export const targetKey=(t:ImpactTarget)=>t.kind==='skill'?`skill:${t.skillId}`:`stat:${t.stat}:${t.delta}`;
/** Keep a new, unfinished measurement distinct from an older saved result. */
export function impactJobsByTarget(jobs:Job[],participantId:string){
  const found=new Map<string,Job>();
  for(const job of [...jobs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
    const variants=job.setup.variations,base=job.setup.participants.find(p=>p.id===participantId)?.uma;
    if(!base||variants?.participantId!==participantId)continue;
    for(const build of variants.builds){const target=impactTarget(base,build);if(target)found.set(targetKey(target),job);}
  }
  return found;
}
export function statRange(base:number,low=-STAT_RANGE,high=STAT_RANGE){
  const start=Math.ceil(low/STAT_STEP)*STAT_STEP;
  return Array.from({length:Math.max(0,Math.floor((high-start)/STAT_STEP)+1)},(_,i)=>start+i*STAT_STEP).filter(d=>d!==0&&base+d>=1&&base+d<=2000);
}
export function impactSetup(source:Setup,request:ImpactRequest):Setup {
  if(!Number.isInteger(request.count)||request.count<5||request.count>500)throw new Error('Choose 5–500 samples per value.');
  const setup=structuredClone(source),p=setup.participants.find(p=>p.id===request.participantId);
  if(!p)throw new Error('Participant is no longer in this race.');
  const t=request.target;
  const targets:ImpactTarget[]=t.kind==='stat-range'?t.deltas.map(delta=>({kind:'stat',stat:t.stat,delta})): [t];
  if(!targets.length||targets.length>20||new Set(targets.map(targetKey)).size!==targets.length)throw new Error('Choose 1–20 distinct changes.');
  if(request.count*(targets.length+1)>1000)throw new Error(`Choose at most ${Math.floor(1000/(targets.length+1))} samples per value for this range (1,000 races per batch).`);
  setup.variations={participantId:p.id,builds:targets.map(target=>{
    const build=structuredClone(p.uma);
    if(target.kind==='skill'){
      if(!build.skills.some(s=>s.id===target.skillId))throw new Error('Skill is not equipped.');
      build.skills=build.skills.filter(s=>s.id!==target.skillId);build.name=`${build.name} · without skill ${target.skillId}`;
    }else{
      const before=build.stats[target.stat];
      if(before==null||!Number.isInteger(target.delta)||!target.delta||before+target.delta<1||before+target.delta>2000)throw new Error('Stat change must stay between 1 and 2000.');
      build.stats[target.stat]=before+target.delta;build.name=`${build.name} · ${target.delta>0?'+':''}${target.delta} ${target.stat}`;
    }
    return build;
  })};
  setup.count=request.count;return setup;
}

const engineSeed=(seed:number)=>Math.min(Math.abs(seed),2147483647);
const pairKey=(r:RunSummary)=>JSON.stringify([engineSeed(r.seed),r.moods,r.gates]);
/** Exact baseline context, excluding only cosmetics and sampling controls. */
export function impactContext(job:Job){
  const s=job.setup,e=job.engine as Job['engine']&{data_sha256?:string;decisionTraceSchema?:string;instrumentationSha256?:string}|undefined;
  return JSON.stringify({engine:e?[e.version,e.profile,e.artifact_sha256,e.data_sha256,e.decisionTraceSchema,e.instrumentationSha256]:null,reference:job.referenceKey,
    conditions:[s.courseId,s.weather,s.ground,s.season,s.time,s.grade,s.shuffleGates,s.moodOverride??null],
    participants:s.participants.map(p=>({id:p.id,race:[p.surface,p.distance,p.strategyAptitude,p.strategy,p.mood,p.randomizeMood,p.gate,p.team,p.popularity],
      uma:[p.uma.charaId,p.uma.cardId,p.uma.fans,p.uma.careerWins,statKeys.map(k=>p.uma.stats[k]),skills(p.uma)]}))});
}
// Two 97.5% Wilson intervals give a conservative, approximate 95% bound on
// the difference of gained-win and lost-win proportions (Bonferroni).
function wilson(k:number,n:number){const z=2.2414027276,p=k/n,d=1+z*z/n,m=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,m-h),Math.min(1,m+h)];}
function impactEstimate(gained:number,lost:number,n:number) {
  const [gainLo,gainHi]=wilson(gained,n),[lossLo,lossHi]=wilson(lost,n);
  return {n,delta:(gained-lost)/n,low:gainLo-lossHi,high:gainHi-lossLo};
}
export function winImpacts(jobs:Job[],participantId:string){
  type Pair={original:RunSummary['runners'][number];changed:RunSummary['runners'][number]};
  const groups=new Map<string,{target:ImpactTarget;pairs:Map<string,Pair>;jobId:string}>();
  const context=jobs[0]?impactContext(jobs[0]):null;
  for(const job of [...jobs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
    if(impactContext(job)!==context)continue;
    const variants=job.setup.variations,base=job.setup.participants.find(p=>p.id===participantId)?.uma;
    if(!base||variants?.participantId!==participantId)continue;
    const baseline=new Map(job.runs.filter(r=>(r.variantIndex??0)===0).map(r=>[pairKey(r),r]));
    variants.builds.forEach((build,index)=>{
      const target=impactTarget(base,build);if(!target)return;
      const key=targetKey(target),group=groups.get(key)??{target,pairs:new Map<string,Pair>(),jobId:job.id};
      group.jobId=job.id;groups.set(key,group);
      for(const run of job.runs.filter(r=>r.variantIndex===index+1)){
        const sample=pairKey(run),original=baseline.get(sample)?.runners.find(r=>r.id===participantId),changed=run.runners.find(r=>r.id===participantId);
        if(!original||!changed||!Number.isFinite(original.place)||!Number.isFinite(changed.place)||group.pairs.has(sample))continue;
        group.pairs.set(sample,{original,changed});
      }
    });
  }
  const found=new Map<string,WinImpact>();
  for(const [key,group] of groups){
    const rows=[...group.pairs.values()],n=rows.length;if(!n)continue;
    const {target,jobId}=group,sign=target.kind==='skill'?1:-1;
    let gained=0,lost=0,baseWins=0,changedWins=0,basePodiums=0,changedPodiums=0;
    for(const {original:a,changed:b} of rows){
      const aw=Number(a.place===1),bw=Number(b.place===1),delta=(aw-bw)*sign;
      baseWins+=aw;changedWins+=bw;gained+=Number(delta>0);lost+=Number(delta<0);
      basePodiums+=Number(a.place<=3);changedPodiums+=Number(b.place<=3);
    }
    const skillId=target.kind==='skill'?target.skillId:null;
    const skillSamples=rows.flatMap(r=>r.original.skills.filter(s=>s.id===skillId));
    const checks=skillSamples.reduce((n,s)=>n+s.checks,0),passed=skillSamples.reduce((n,s)=>n+s.passed,0);
    found.set(key,{target,...impactEstimate(gained,lost,n),baseRate:baseWins/n,changedRate:changedWins/n,gained,lost,jobId,
      baseWins,changedWins,podiumDelta:(basePodiums-changedPodiums)*sign/n,
      timeSaved:distribution(rows.map(r=>Number.isFinite(r.changed.time)&&Number.isFinite(r.original.time)?(r.changed.time-r.original.time)*sign:null)),
      skill:skillSamples.length?{n:skillSamples.length,activation:skillSamples.filter(s=>s.activated).length/skillSamples.length,
        checks,passed,reliability:checks?passed/checks:null,gain:distribution(skillSamples.map(s=>s.gain)),carryover:distribution(skillSamples.map(s=>s.carryover??null)),effectiveness:distribution(skillSamples.map(s=>s.effectiveness))}:null});
  }
  return found;
}
export interface WinImpact {
  target:ImpactTarget;n:number;delta:number;low:number;high:number;baseRate:number;changedRate:number;gained:number;lost:number;jobId:string;
  baseWins:number;changedWins:number;podiumDelta:number;timeSaved:ReturnType<typeof distribution>;
  skill:{n:number;activation:number;checks:number;passed:number;reliability:number|null;gain:ReturnType<typeof distribution>;carryover:ReturnType<typeof distribution>;effectiveness:ReturnType<typeof distribution>}|null;
}

/** Only plot cohorts that actually compared this stat. Each point retains its
 * own paired baseline; range extensions can have a different random sample. */
export function statCurve(jobs:Job[],participantId:string,stat:StatKey){
  const impacts=winImpacts(jobs,participantId);
  return [...impacts.values()].filter(r=>r.target.kind==='stat'&&r.target.stat===stat).map(r=>({...r,offset:(r.target as Extract<ImpactTarget,{kind:'stat'}>).delta})).sort((a,b)=>a.offset-b.offset);
}

/** Descriptive splits of actual draws, never causal estimates. Resolve by
 * participant ID against the saved roster, not sorted finishing positions. */
export function conditionSplits(runs:RunSummary[],setup:Setup,participantId:string,key:'gates'|'moods'){
  const index=setup.participants.findIndex(p=>p.id===participantId);if(index<0)return [];
  const groups=new Map<number,{value:number;n:number;wins:number;top3:number;times:number[]}>();
  for(const run of runs){const value=run[key]?.[index],runner=run.runners.find(r=>r.id===participantId);
    if(!Number.isInteger(value)||value<1||value>(key==='moods'?5:setup.participants.length)||!runner||!Number.isFinite(runner.place))continue;
    const row=groups.get(value)??{value,n:0,wins:0,top3:0,times:[]};row.n++;row.wins+=Number(runner.place===1);row.top3+=Number(runner.place<=3);if(Number.isFinite(runner.time))row.times.push(runner.time);groups.set(value,row);
  }
  return [...groups.values()].sort((a,b)=>a.value-b.value).map(r=>({...r,win:r.wins/r.n,podium:r.top3/r.n,time:distribution(r.times)}));
}
