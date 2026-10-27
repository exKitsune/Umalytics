import {checkpointPositions} from './position-checkpoints';
import {runnerAptitudes} from './aptitudes';
import {engineTeams} from './editor';
import type {PreparedRace} from '../analysis/prepared';
import type {Race} from '../data/types';
import type {ReferenceData} from '../data/reference';
import {skillCost} from '../data/skill-cost';
import type {Setup,RunSummary,RunnerSummary} from './model';
import {strategyNames} from './model';
import {normalizeRaceMetrics,metricMode,modeOccurred} from './race-metrics';

export function initialRace(setup:Setup,run:Omit<RunSummary,'runners'>,jobId:string,engineVersion:string,reference:ReferenceData):Race {
  const course=reference.courses[setup.courseId];
  return {id:`sim-${jobId}-${run.index}`,title:setup.name,source:'normalized',sourceLabel:'Custom simulation',synthetic:false,
    sandbox:{jobId,runIndex:run.index,seed:run.seed,engineVersion},randomSeed:run.seed,category:'practice',
    distance:course.distance,courseId:setup.courseId,laneDistanceMax:course.laneMax,duration:0,frames:[],events:[],warnings:[],
    conditions:{weather:String(setup.weather),ground:String(setup.ground),season:String(setup.season),timeOfDay:String(setup.time)},grade:setup.grade,
    runners:setup.participants.map((p,index)=>({id:p.id,index,gate:run.gates[index],name:p.uma.name,buildName:p.uma.name,charaId:p.uma.charaId,cardId:p.uma.cardId,trainer:p.trainer??null,
      stats:p.uma.stats,skills:p.uma.skills,mood:run.moods[index],strategy:strategyNames[p.strategy],strategyCode:p.strategy,teamGroup:engineTeams(setup.participants)[index],
      popularity:p.popularity,fanCount:p.uma.fans,raceWinCount:p.uma.careerWins,finishOrder:null,finishTime:null,
      aptitudes:runnerAptitudes(p,course)}))};
}
export function summarize(value:PreparedRace,run:Omit<RunSummary,'runners'>):RunSummary {
  return {...run,runners:value.race.runners.map(r=>{
    const a=value.analysis.runners[r.id],p=value.runners[r.id],s=a.summary;
    const inactive=a.skillActivations.length===0?0:null;
    const noRelease=p.power&&p.power.releases.length===0?0:null;
    return {id:r.id,name:r.name,slot:r.index+1,place:r.finishOrder!,time:r.finishTimeRaw!,hp:s.hpFinish,traffic:s.blockedDuration??0,
      exhausted:s.hpZeroTime!==null,fullSpurt:(p.spurt.shortfall?.mid??Infinity)<.001&&(p.spurt.delaySeconds??Infinity)<.1,
      gain:p.totals.benefit?.distance?.mid??inactive,gainTime:p.totals.benefit?.time?.mid??inactive,carryover:p.totals.benefit?.carryoverDistance?.mid??inactive,
      power:p.powerBenefit?.distance?.mid??noRelease,powerTime:p.powerBenefit?.time?.mid??noRelease,effectiveness:p.totals.score,
      metrics:normalizeRaceMetrics({...checkpointPositions(a.samples??[],value.race.distance),'Start delay · s':s.startDelay,'HP spent':s.hpUsed,'HP recovered':s.hpRecovered,'Starting HP':s.hpStart,'Uphill gain · m':a.hillTotals.uphill.modeledDistanceDelta,
        'Downhill gain · m':a.hillTotals.downhill.modeledDistanceDelta,'Corner loss · m':a.cornerPath.extraDistance,'Rushed · s':s.rushedDuration,
        'Last-spurt start · m':s.spurtDistance,'Traffic loss · m':a.slowdown.blocking.distanceLoss,'Exhaustion loss · m':a.slowdown.exhaustion.distanceLoss,
        ...Object.fromEntries(p.modes.map(mode=>[`${mode.kind} gain · m`,mode.reachableExtraDistance]))}),
      skills:a.skillRows.filter(row=>row.equipped).map(row=>{
        const total=p.totals.skills.find(t=>t.skillId===row.skillId),impact=p.impacts[row.skillId];
        const checks=row.simulation?.wit.filter(e=>e.data.checked===true)??[];
        return {id:row.skillId,activated:row.activationCount>0,checks:checks.length,passed:checks.filter(e=>e.data.passed===true).length,
          effectiveness:total?.score??null,gain:row.activationCount?impact?.distance?.mid??null:0,time:row.activationCount?impact?.time?.mid??null:0,
          carryover:row.activationCount?impact?.carryoverDistance?.mid??null:0,carryoverTime:row.activationCount?impact?.carryoverTime?.mid??null:0,cost:skillCost(row.skillId).cost};
      })} satisfies RunnerSummary;
  })};
}
export function distribution(values:(number|null)[]){
  const rows=values.filter((v):v is number=>v!=null&&Number.isFinite(v)).sort((a,b)=>a-b),n=rows.length;
  if(!n)return {n,mean:null,median:null,p10:null,p90:null,standardError:null};
  const mean=rows.reduce((a,b)=>a+b,0)/n;
  const quantile=(q:number)=>{const i=(n-1)*q,j=Math.floor(i);return rows[j]+(rows[Math.ceil(i)]-rows[j])*(i-j);};
  return {n,mean,median:quantile(.5),p10:quantile(.1),p90:quantile(.9),standardError:n>1?Math.sqrt(rows.reduce((s,v)=>s+(v-mean)**2,0)/(n-1)/n):null};
}
/** Pool runner-race observations, not per-runner means or medians. */
export function lobbyMetrics(runs:RunSummary[]){
  const records=runs.flatMap(run=>run.runners).flatMap(r=>r.metrics&&Object.keys(r.metrics).length?[normalizeRaceMetrics(r.metrics)]:[]);
  return Object.fromEntries([...new Set(records.flatMap(r=>Object.keys(r)))].map(key=>[key,distribution(records.map(r=>Object.hasOwn(r,key)?r[key]:metricMode(key)?0:null))]));
}
export function aggregate(runs:RunSummary[]){
  return (runs[0]?.runners??[]).map(r=>{
    const rows=runs.map(run=>run.runners.find(x=>x.id===r.id)).filter((x):x is RunnerSummary=>!!x),n=rows.length;
    const placements=Array.from({length:runs[0].runners.length},(_,i)=>rows.filter(x=>x.place===i+1).length/n);
    const rate=(key:'exhausted'|'fullSpurt')=>{const known=rows.filter(r=>r[key]!=null);return known.length?known.filter(r=>r[key]).length/known.length:null;};
    const number=(key:'time'|'hp'|'traffic'|'gain'|'gainTime'|'carryover'|'power'|'powerTime'|'effectiveness')=>distribution(rows.map(x=>x[key]));
    const skills=r.skills.map(s=>{const paired=rows.flatMap(r=>{const skill=r.skills.find(v=>v.id===s.id);return skill?[{runner:r,skill}]:[];}),values=paired.map(p=>p.skill),checks=values.reduce((n,s)=>n+s.checks,0),passed=values.reduce((n,s)=>n+s.passed,0),gain=distribution(values.map(s=>s.gain));
      const activated=paired.filter(p=>p.skill.activated),winsWhenActivated=activated.filter(p=>p.runner.place===1).length;
      return {id:s.id,n:values.length,activation:activated.length/values.length,activatedRaces:activated.length,winsWhenActivated,winRateWhenActivated:activated.length?winsWhenActivated/activated.length:null,checks,passed,reliability:checks?passed/checks:null,
        effectiveness:distribution(values.map(s=>s.effectiveness)),gain,time:distribution(values.map(s=>s.time)),
        carryover:distribution(values.map(s=>s.carryover??null)),carryoverTime:distribution(values.map(s=>s.carryoverTime??null)),
        carryoverRecorded:values.every(s=>s.carryover!==undefined),
        carryoverPaired:values.every(s=>(s.gain==null)===(s.carryover==null)),
        per100Sp:s.cost&&gain.mean!=null?gain.mean*100/s.cost:null};
    }).sort((a,b)=>(b.gain.mean??-Infinity)-(a.gain.mean??-Infinity)||a.id-b.id);
    const measurements=rows.map(r=>r.metrics&&Object.keys(r.metrics).length?normalizeRaceMetrics(r.metrics):null);
    const keys=[...new Set(measurements.flatMap(m=>Object.keys(m??{})))];
    const metrics=keys.map(key=>{
      const mode=metricMode(key),known=measurements.filter((m):m is NonNullable<typeof m>=>m!==null);
      const occurred=mode?known.filter(m=>modeOccurred(m,mode)):null;
      // Missing modes in a full summary did not occur. Explicitly unavailable
      // estimates and outcome-only runs must never turn into zero gains.
      const values=measurements.map(m=>m===null?null:Object.hasOwn(m,key)?m[key]:mode?0:null);
      return {key,...distribution(values),occurred:occurred?.length??null,occurrenceSamples:mode?known.length:0,
        whenActive:distribution(occurred?.map(m=>m[key]??null)??[])};
    });
    return {id:r.id,name:r.name,slot:r.slot,n,placements,win:placements[0],top2:placements.slice(0,2).reduce((a,b)=>a+b,0),podium:placements.slice(0,3).reduce((a,b)=>a+b,0),place:distribution(rows.map(r=>r.place)),time:number('time'),hp:number('hp'),traffic:number('traffic'),gain:number('gain'),gainTime:number('gainTime'),carryover:number('carryover'),power:number('power'),powerTime:number('powerTime'),effectiveness:number('effectiveness'),exhaustion:rate('exhausted'),fullSpurt:rate('fullSpurt'),skills,
      metrics};
  }).sort((a,b)=>b.win-a.win||b.podium-a.podium||a.place.mean!-b.place.mean!);
}

/** Paired finishing-time differences use identical starting seeds, mood and
 * gate schedules. Downstream RNG decisions may diverge when a build changes. */
export function comparisons(runs:RunSummary[],participantId:string){
  const baseline=new Map(runs.filter(r=>(r.variantIndex??0)===0).map(r=>[r.seed,r]));
  return [...new Set(runs.map(r=>r.variantIndex??0))].map(index=>{
    const group=runs.filter(r=>(r.variantIndex??0)===index),runner=aggregate(group).find(r=>r.id===participantId);
    const deltas=group.flatMap(r=>{const a=r.runners.find(x=>x.id===participantId),b=baseline.get(r.seed)?.runners.find(x=>x.id===participantId);return a&&b?[a.time-b.time]:[];});
    return {index,label:group[0].variantLabel??'Baseline',runner,delta:distribution(deltas)};
  });
}

/** Only compare opponents actually present together in each completed run. */
export function headToHead(runs:RunSummary[],participantId:string){
  const opponents=new Map<string,{id:string;name:string;slot?:number;n:number;ahead:number;ties:number}>();
  for(const run of runs){
    const selected=run.runners.find(r=>r.id===participantId);
    if(!selected||!Number.isFinite(selected.place))continue;
    for(const other of run.runners){
      if(other.id===participantId||!Number.isFinite(other.place))continue;
      const row=opponents.get(other.id)??{id:other.id,name:other.name,slot:other.slot,n:0,ahead:0,ties:0};
      row.n++;if(selected.place<other.place)row.ahead++;else if(selected.place===other.place)row.ties++;
      opponents.set(other.id,row);
    }
  }
  return [...opponents.values()].map(r=>({...r,rate:r.ahead/r.n})).sort((a,b)=>b.rate-a.rate||a.name.localeCompare(b.name));
}
