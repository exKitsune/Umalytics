<script lang="ts">
  import {statusHelp,statusFormula,uphillHelp,downhillHelp,debuffHelp,modelHelp} from '../data/analysis-copy';
  import type { Race } from '../data/types';
  import type { RaceAnalysis } from '../data/analytics';
  import { effectiveStrategyCode } from '../data/skill-details';
  import { combinedStatusIntervals, substantialNearIntervals } from '../data/status-presentation';
  import { runnerName, type ReferenceData } from '../data/reference';
  import UmaPortrait from './UmaPortrait.svelte';
  import GameIcon from './GameIcon.svelte';
  import StrategyBadge from './StrategyBadge.svelte';
  import { onDestroy } from 'svelte';
  import { motionFor } from '../data/motion-analysis';
  import type { MotionBand, RunnerMotion } from '../data/race-motion';
  import { modeImpactsFor, type StatusModeImpact } from '../data/status-mode-impact';
  import ModeImpactSummary from './ModeImpactSummary.svelte';
  export let race:Race, reference:ReferenceData|null, analysis:RaceAnalysis, selected:string;
  export let onSelect:(id:string)=>void;
  export let compact=false;
  const f=(n:number|null|undefined,d=1)=>n==null?'—':n.toFixed(d);
  const mood=(m:number|null|undefined)=>m==null?'—':({1:'Awful',2:'Bad',3:'Normal',4:'Good',5:'Great'} as Record<number,string>)[m]??String(m);
  const range=(v:MotionBand,d=2)=>Math.abs(v.max-v.min)<10**-d?v.mid.toFixed(d):`${Math.min(v.min,v.mid,v.max).toFixed(d)} – ${Math.max(v.min,v.mid,v.max).toFixed(d)}`;
  let motions:Record<string,RunnerMotion>={}, modes:Record<string,StatusModeImpact[]>={}, hoverColumn=-1, generation=0, heavyKey='';
  const memory=new Map<string,{motions:Record<string,RunnerMotion>;modes:Record<string,StatusModeImpact[]>}>();
  function cacheKey(){return `${race.id}:${race.capturedAt??''}:${analysis.warnings.length}`;}
  function scheduleHeavy(){
    const key=cacheKey();if(key===heavyKey)return;heavyKey=key;const token=++generation,saved=memory.get(key);
    if(saved){motions=saved.motions;modes=saved.modes;return;}
    motions={};modes={};
    const ids=race.runners.map(r=>r.id);let index=0;
    const step=(deadline?:IdleDeadline)=>{
      if(token!==generation)return;
      const started=performance.now();
      while(index<ids.length&&performance.now()-started<12&&(!deadline||deadline.timeRemaining()>4)){
        const id=ids[index];
        if(!motions[id])motions[id]=motionFor(race,reference,analysis,id);
        else{modes[id]=modeImpactsFor(race,reference,analysis,id);index++;}
        motions=motions;modes=modes;
      }
      if(index<ids.length){const idle=window.requestIdleCallback;if(idle)idle(step,{timeout:250});else setTimeout(()=>step(),16);}
      else memory.set(key,{motions,modes});
    };
    step();
  }
  $: if(cacheKey()!==heavyKey)scheduleHeavy();
  onDestroy(()=>{generation++;});
  function nearbyTime(id:string){const samples=motions[id]?.samples;return samples?samples.reduce((sum,s,i)=>sum+(i&&s.nearbySlowdown?s.time-samples[i-1].time:0),0):0;}
  const mode=(id:string,kind:string)=>modes[id]?.find(s=>s.kind===kind);
  $: sorted=[...race.runners].sort((a,b)=>(a.finishOrder??99)-(b.finishOrder??99));
  $: intervals=Object.fromEntries(race.runners.map(r=>[r.id,combinedStatusIntervals(analysis.runners[r.id]?.intervals??[],{includeModels:true})]));
  const impact=(id:string,kind:string)=>analysis.runners[id]?.statusImpacts.find(s=>s.kind===kind);
  function hill(id:string,kind:'uphill'|'downhill'){
    const total=analysis.runners[id]?.hillTotals?.[kind];if(kind!=='downhill'||!total)return total;
    const observed=analysis.runners[id].hillImpacts.filter(h=>h.kind==='downhill'&&h.assessedDuration>0);
    if(!observed.length)return total;
    const sum=(key:'modeledDistanceDelta'|'modeledTimeDelta'|'modeledHpDelta')=>observed.every(h=>h[key]!==null)?observed.reduce((n,h)=>n+h[key]!,0):null;
    return {...total,modeledDistanceDelta:total.modeledDistanceDelta??sum('modeledDistanceDelta'),modeledTimeDelta:total.modeledTimeDelta??sum('modeledTimeDelta'),modeledHpDelta:total.modeledHpDelta??sum('modeledHpDelta')};
  }
  const cornerHelp='Extra corner distance versus lane 0. Time uses recorded speed, not a predicted finish-time change.';
  function powerTime(id:string){const hills=(analysis.runners[id]?.hillImpacts??[]).filter(h=>h.kind==='uphill');return hills.length&&hills.every(h=>h.powerTimeDelta!==null)?hills.reduce((sum,h)=>sum+h.powerTimeDelta!,0):null;}
  function exhaustionTime(id:string){const loss=motions[id]?.exhaustionLoss?.timeLoss;if(loss)return `${range(loss,3)}s added`;const value=analysis.runners[id]?.slowdown?.exhaustion;return value?.timeLossMin!=null&&value.timeLossMax!=null
    ?`${f(value.timeLossMin,3)}${Math.abs(value.timeLossMax-value.timeLossMin)<.0005?'':` – ${f(value.timeLossMax,3)}`}s added`:null;}
  function blockHole(motion:RunnerMotion|undefined){
    if(!motion?.samples.length)return null;
    const last=motion.samples.at(-1)!;
    const distance=motion.assessedDistanceLoss??motion.distanceLoss??last.cumulativeDistance;
    const time=motion.assessedTimeLoss??motion.timeLoss??last.cumulativeTime;
    return distance&&time?{distance,time,partial:(motion.coverage?.constrained??0)<.999}:null;
  }
  function gainTime(seconds:number|null|undefined){return seconds==null?null:`${f(Math.abs(seconds),3)} s ${seconds>=0?'saved':'lost'}`;}
  function signedSpeed(values:number[]){if(!values.length)return null;const min=Math.min(...values),max=Math.max(...values),fmt=(n:number)=>`${n>=0?'+':''}${n.toFixed(2)}`;return Math.abs(max-min)<.005?`${fmt(min)} m/s`:`${fmt(min)} to ${fmt(max)} m/s`;}
  function speedBit(id:string,kind:string){const values=(intervals[id]??[]).flatMap(s=>s.kind===kind&&s.model?.speedDelta!=null?[s.model.speedDelta]:[]);const text=signedSpeed(values);if(!text)return null;const formula=statusFormula(kind);return {text,title:formula?`${formula} → ${text}`:text};}
  function hillSpeed(id:string,kind:'uphill'|'downhill'){const text=signedSpeed((analysis.runners[id]?.hillImpacts??[]).flatMap(h=>h.kind===kind&&h.modeledSpeedDelta!=null?[h.modeledSpeedDelta]:[]));if(!text)return null;const formula=kind==='uphill'?statusFormula('uphill'):statusFormula('downhill-mode');return {text,title:formula?`${formula} → ${text}`:text};}
  function duration(id:string,kind:string){
    const source=kind==='near-slowdown'&&(intervals[id]??[]).some(i=>i.kind===kind)?substantialNearIntervals(intervals[id]??[],motionFor(race,reference,analysis,id,undefined,undefined,true).samples):(intervals[id]??[]);
    const rows=source.filter(s=>s.kind===kind);
    const known=rows.filter(r=>r.end!==null);
    return {text:known.length?`${known.reduce((n,r)=>n+r.end!-r.start,0).toFixed(1)}s`:'—',
      modeled:rows.some(r=>r.evidence==='estimated'),
      title:rows.length?statusHelp(kind):modelBlock(id)??'No active interval found.'};
  }
  function modelBlock(id:string){
    const stats=analysis.runners[id]?.statBreakdown.stats;
    if(!stats)return null;
    const courseKnown=race.courseId!=null&&reference?.courses[race.courseId]?.distance===race.distance;
    if(!courseKnown)return 'Course distance is not identified, so pace and downhill targets are withheld.';
    for(const key of ['power','guts','wisdom'] as const){
      if(stats[key].final!==null)continue;
      return stats[key].detail.match(/Final [^.]+\./)?.[0]??`${key} is unresolved, so pace and downhill targets are withheld.`;
    }
    return null;
  }
</script>
<section class="panel field-stats" class:compact>
  <div class="panel-heading"><strong>Race results</strong><span class="muted">Select a runner · dotted values use models</span></div>
  <div class="field-scroll"><table data-col={hoverColumn}>
    <thead><tr>{#each ['Finish','Uma','Time','Start delay','Last spurt','HP finish / start','Dueling','Uphill','Downhill','Outer corners','PU / SU','PD / OT','Spot struggle','Rushed','Debuffs received','Blocked / nearby','Top / mean speed','HP spent / gained'] as heading,index}<th class:column-hot={hoverColumn===index} title={heading==='Downhill'?downhillHelp:heading==='Uphill'?uphillHelp:heading==='PU / SU'?'Pace up / Speed up (front runners).':heading==='PD / OT'?'Pace down / Overtake (front runners).':heading==='Spot struggle'?'Spot struggle':undefined} onmouseenter={()=>hoverColumn=index} onmouseleave={()=>hoverColumn=-1}>{heading}</th>{/each}</tr></thead>
    <tbody>{#each sorted as r}
      {@const s=analysis.runners[r.id]?.summary}
      {@const duel=duration(r.id,'dueling')}
      {@const dh=duration(r.id,'downhill-mode')}
      {@const pu=duration(r.id,'pace-up')}
      {@const pd=duration(r.id,'pace-down')}
      {@const ss=duration(r.id,'spot-struggle')}
      {@const style=effectiveStrategyCode(r,analysis.runners[r.id]?.skillRows??[])}
      {@const front=style===1||style===5}
      {@const su=duration(r.id,'speed-up')}
      {@const ot=duration(r.id,'overtake')}
      {@const uphill=hill(r.id,'uphill')}{@const power=powerTime(r.id)}
      {@const downhill=hill(r.id,'downhill')}
      {@const debuffs=analysis.runners[r.id]?.receivedDebuffTotals}
      {@const corners=analysis.runners[r.id]?.cornerPath}
      {@const motion=motions[r.id]}{@const hole=blockHole(motion)}
      <tr class:row-selected={selected===r.id} onclick={()=>onSelect(r.id)} onmouseover={e=>{const cell=(e.target as HTMLElement).closest('td');hoverColumn=cell?cell.cellIndex:-1;}} onfocusin={e=>{const cell=(e.target as HTMLElement).closest('td');hoverColumn=cell?cell.cellIndex:-1;}} onmouseleave={()=>hoverColumn=-1}>
        <td class="finish" class:column-hot={hoverColumn===0}>{r.finishOrder??'—'}</td>
        <td><button class="result-runner" onclick={()=>onSelect(r.id)}><UmaPortrait runner={r} size={38}/><span><strong><span class="result-gate" title="Starting gate">{r.gate??r.index+1}</span>{runnerName(reference,r)}</strong><small class="result-badges"><StrategyBadge runner={{...r,strategyCode:style}}/>{#if r.mood!=null}<GameIcon name={`mood-${r.mood}`} label={`${mood(r.mood)} mood`} size={19}/>{/if}</small></span></button></td>
        <td>{f(s?.rawTime,3)}s<small>+{f(s?.finishGapDistance)}m</small></td>
        <td>{f(s?.startDelay==null?null:s.startDelay*1000,1)}ms</td>
        <td>{s?.spurtDistance===-1?'None':`${f(s?.spurtDistance)}m`}<small>Delay {f(s?.spurtDelayDistance)}m</small><small>{f(s?.spurtSpeed,2)} m/s</small>{#if s?.hpZeroTime!=null}<small class="empty-hp" title="When the 1.2 m/s² empty-HP deceleration begins. The first sample that already reads zero can be later.">Exhausted at {f(s.hpZeroTime,2)}s</small>{#if motion?.exhaustionLoss?.distanceLoss}<small class="modeled" title="Distance the exhausted curve did not travel versus a healthy target.">{range(motion.exhaustionLoss.distanceLoss)} m lost</small>{/if}{#if motion&&exhaustionTime(r.id)}<small class="modeled" title="Equivalent added time in the assessed HP-zero window versus healthy target-speed scenarios, with known blocking and skill effects held fixed. This is not a causal finish-time loss.">{exhaustionTime(r.id)}</small>{/if}{/if}</td>
        <td class:empty-hp={s?.hpFinish!=null&&s.hpFinish<=0}>{f(s?.hpFinish)} / {f(s?.hpStart,0)}<small>{s?.hpStart&&s.hpFinish!=null?`${(s.hpFinish/s.hpStart*100).toFixed(1)}%`:''}</small></td>
        <td><span class:modeled={duel.modeled} title={duel.title}>{duel.text}</span>{#if speedBit(r.id,'dueling')}{@const gain=speedBit(r.id,'dueling')!}<small title={gain.title}>{gain.text}</small>{/if}{#if impact(r.id,'dueling')}{@const value=impact(r.id,'dueling')!}<small class="modeled" title={modelHelp}>{value.modeledExtraDistance==null?'— m':`${value.modeledExtraDistance>=0?'+':''}${f(value.modeledExtraDistance)} m`}</small><small class="modeled" title={modelHelp}>{gainTime(value.modeledExtraTime)??'— s'}</small>{#if value.modeledExtraHp!==null}<small class="modeled" title={modelHelp}>{f(Math.abs(value.modeledExtraHp))} extra HP {value.modeledExtraHp<0?'saved':'spent'}</small>{/if}{/if}</td>
        <td>{#if uphill?.intervals}<span class="modeled" title={uphillHelp}>{uphill.modeledDistanceDelta==null?'— m':`${uphill.modeledDistanceDelta>=0?'+':''}${f(uphill.modeledDistanceDelta)} m`}</span><span class="modeled" title={uphillHelp}>{uphill.modeledTimeDelta==null?'— s':`${f(Math.abs(uphill.modeledTimeDelta),3)}s ${uphill.modeledTimeDelta>=0?'lost':'saved'}`}</span>{#if hillSpeed(r.id,'uphill')}{@const loss=hillSpeed(r.id,'uphill')!}<small title={loss.title}>{loss.text}</small>{/if}{#if power!==null}<small class="modeled" title="Time saved or lost uphill compared with 1000 power.">{Math.abs(power).toFixed(3)}s {power<0?'saved':'lost'}<br/>vs 1000 power</small>{/if}{:else}—{/if}</td>
        <td><span class:modeled={dh.modeled} title={dh.title}>{dh.text}</span>{#if hillSpeed(r.id,'downhill')}{@const gain=hillSpeed(r.id,'downhill')!}<small class="modeled" title={gain.title}>{gain.text}</small>{/if}{#if mode(r.id,'downhill-mode')}<ModeImpactSummary value={mode(r.id,'downhill-mode')}/>{:else if downhill?.intervals}<small class="modeled" title={downhillHelp}>{downhill.modeledDistanceDelta==null?'— m':`${downhill.modeledDistanceDelta>=0?'+':''}${f(downhill.modeledDistanceDelta)} m`}</small><small class="modeled" title={downhillHelp}>{downhill.modeledTimeDelta==null?'— s':`${f(Math.abs(downhill.modeledTimeDelta),3)} s ${downhill.modeledTimeDelta>=0?'lost':'saved'}`}</small>{#if downhill.modeledHpDelta!=null}<small class="modeled" title={downhillHelp}>{f(-downhill.modeledHpDelta)} HP saved</small>{/if}{/if}</td>
        <td>{#if corners?.assessedExtraDistance!=null}<span class="modeled" title={cornerHelp}>+{f(corners.extraDistance??corners.assessedExtraDistance,2)} m</span>{#if corners.assessedEquivalentTime!=null}<small class="modeled" title={cornerHelp}>{f(corners.equivalentTime??corners.assessedEquivalentTime,3)}s equivalent</small>{/if}{#if corners.extraDistance===null}<small>Path partial · {Math.round((corners.coverage??0)*100)}% assessed</small>{/if}{#if corners.equivalentTime===null}<small>Time partial · {Math.round((corners.timeCoverage??0)*100)}% assessed</small>{/if}{:else}<span title="Course path or lane data unavailable.">—</span>{/if}</td>
        <td>{#if front}<span class="mode-name" class:modeled={su.modeled} title={su.title}>SU {su.text}</span>{#if speedBit(r.id,'speed-up')}{@const gain=speedBit(r.id,'speed-up')!}<small title={gain.title}>{gain.text}</small>{/if}{#if su.text!=='—'}{#if !modes[r.id]}<small>Calculating gains…</small>{:else if mode(r.id,'speed-up')}<ModeImpactSummary value={mode(r.id,'speed-up')}/>{:else}<small>Gain unavailable</small>{/if}{/if}{:else}<span class="mode-name" class:modeled={pu.modeled} title={pu.title}>PU {pu.text}</span>{#if speedBit(r.id,'pace-up')}{@const gain=speedBit(r.id,'pace-up')!}<small title={gain.title}>{gain.text}</small>{/if}{#if pu.text!=='—'}{#if !modes[r.id]}<small>Calculating gains…</small>{:else if mode(r.id,'pace-up')}<ModeImpactSummary value={mode(r.id,'pace-up')}/>{:else}<small>Gain unavailable</small>{/if}{/if}{/if}</td>
        <td>{#if front}<span class="mode-name" class:modeled={ot.modeled} title={ot.title}>OT {ot.text}</span>{#if speedBit(r.id,'overtake')}{@const gain=speedBit(r.id,'overtake')!}<small title={gain.title}>{gain.text}</small>{/if}{#if ot.text!=='—'}{#if !modes[r.id]}<small>Calculating gains…</small>{:else if mode(r.id,'overtake')}<ModeImpactSummary value={mode(r.id,'overtake')}/>{:else}<small>Gain unavailable</small>{/if}{/if}{:else}<span class="mode-name" class:modeled={pd.modeled} title={pd.title}>PD {pd.text}</span>{#if speedBit(r.id,'pace-down')}{@const gain=speedBit(r.id,'pace-down')!}<small title={gain.title}>{gain.text}</small>{/if}{#if pd.text!=='—'}{#if !modes[r.id]}<small>Calculating gains…</small>{:else if mode(r.id,'pace-down')}<ModeImpactSummary value={mode(r.id,'pace-down')}/>{:else}<small>Gain unavailable</small>{/if}{/if}{/if}</td>
        <td><span class:modeled={ss.modeled} title={ss.title}>{ss.text}</span>{#if speedBit(r.id,'spot-struggle')}{@const gain=speedBit(r.id,'spot-struggle')!}<small title={gain.title}>{gain.text}</small>{/if}{#if impact(r.id,'spot-struggle')}{@const value=impact(r.id,'spot-struggle')!}<small class="modeled" title={modelHelp}>{value.modeledExtraDistance==null?'— m':`${value.modeledExtraDistance>=0?'+':''}${f(value.modeledExtraDistance)} m`}</small><small class="modeled" title={modelHelp}>{gainTime(value.modeledExtraTime)??'— s'}</small>{#if value.modeledExtraHp!==null}<small class="modeled" title={modelHelp}>{f(Math.abs(value.modeledExtraHp))} extra HP {value.modeledExtraHp<0?'saved':'spent'}</small>{/if}{/if}</td>
        <td>{f(s?.rushedDuration)}s{#if impact(r.id,'rushed')}{@const value=impact(r.id,'rushed')!}<small class="modeled" title={modelHelp}>{value.modeledExtraDistance==null?'— m':`${value.modeledExtraDistance>=0?'+':''}${f(value.modeledExtraDistance)} m`}</small><small class="modeled" title={modelHelp}>{gainTime(value.modeledExtraTime)??'— s'}</small>{#if value.modeledExtraHp!==null}<small class="modeled" title={modelHelp}>{f(Math.abs(value.modeledExtraHp))} extra HP {value.modeledExtraHp<0?'saved':'spent'}</small>{/if}{/if}</td>
        <td>{#if debuffs?.intervals}<span class="modeled" title={debuffHelp}>{debuffs.modeledHpDelta===null?'—':`${f(debuffs.modeledHpDelta)} HP`}</span><small class="modeled" title={debuffHelp}>{debuffs.modeledDistanceDelta==null?'— m':`${f(Math.abs(debuffs.modeledDistanceDelta))} m ${debuffs.modeledDistanceDelta<=0?'lost':'gained'}`}</small><small class="modeled" title={debuffHelp}>{debuffs.modeledTimeDelta==null?'— s':`${f(Math.abs(debuffs.modeledTimeDelta),3)} s ${debuffs.modeledTimeDelta>=0?'lost':'saved'}`}</small>{:else}—{/if}</td>
        <td>{f(s?.blockedDuration)}s blocked{#if duration(r.id,'near-slowdown').text!=='—'}<small title={duration(r.id,'near-slowdown').title}>{duration(r.id,'near-slowdown').text} near</small>{/if}{#if motion?.trafficLoss?.duration}<small title="Includes braking before a block and speed recovery afterward.">{f(motion.trafficLoss.duration)}s slowed</small>{/if}{#if nearbyTime(r.id)>.05}<small>{nearbyTime(r.id).toFixed(1)}s nearby</small>{/if}{#if hole}<small class="modeled" title="Distance the capped curve did not travel versus the same simulation with blocking removed.">{range(hole.distance)} m lost{#if hole.partial} · partial{/if}</small><small class="modeled" title="Time matching that distance. This is the hole between the two curves, not a predicted finish time.">{range(hole.time,3)} s lost</small>{:else}<small>Comparing the unblocked curve…</small>{/if}</td>
        <td>{f(s?.maxSpeed,2)} / {f(s?.meanSpeed,2)}<small>m/s</small></td>
        <td>{f(s?.hpUsed)} / +{f(s?.hpRecovered)}</td>
      </tr>
    {/each}</tbody>
  </table></div>
</section>
<style>
  .compact .field-scroll{max-height:560px}
  .field-scroll{max-height:1040px;overflow:auto;scrollbar-width:thin}
  table{width:max-content;min-width:100%}th{font-size:var(--font-9)}td{font-size:var(--font-11);padding:9px 10px;vertical-align:middle}
  tbody tr{cursor:pointer}tbody tr:hover td{background:color-mix(in srgb,#000 14%,var(--panel))}
  th:hover{background:color-mix(in srgb,#000 12%,var(--panel))}
  table[data-col="0"] :is(th,td):nth-child(1),table[data-col="1"] :is(th,td):nth-child(2),table[data-col="2"] :is(th,td):nth-child(3),table[data-col="3"] :is(th,td):nth-child(4),table[data-col="4"] :is(th,td):nth-child(5),table[data-col="5"] :is(th,td):nth-child(6),table[data-col="6"] :is(th,td):nth-child(7),table[data-col="7"] :is(th,td):nth-child(8),table[data-col="8"] :is(th,td):nth-child(9),table[data-col="9"] :is(th,td):nth-child(10),table[data-col="10"] :is(th,td):nth-child(11),table[data-col="11"] :is(th,td):nth-child(12),table[data-col="12"] :is(th,td):nth-child(13),table[data-col="13"] :is(th,td):nth-child(14),table[data-col="14"] :is(th,td):nth-child(15),table[data-col="15"] :is(th,td):nth-child(16),table[data-col="16"] :is(th,td):nth-child(17),table[data-col="17"] :is(th,td):nth-child(18){background:color-mix(in srgb,#000 10%,var(--panel))}
  td:nth-child(2){position:sticky;left:0;background:var(--panel);z-index:1;min-width:200px;border-right:1px solid var(--border)}
  th:nth-child(2){position:sticky;left:0;z-index:3}tbody tr:hover td:nth-child(2){background:color-mix(in srgb,#000 14%,var(--panel))}
  tr.row-selected td,tr.row-selected td:nth-child(2),table[data-col] tr.row-selected td{background:var(--accent-soft)}
  tr.row-selected:hover td,tr.row-selected:hover td:nth-child(2),table[data-col] tr.row-selected:hover td{background:color-mix(in srgb,#000 12%,var(--accent-soft))}
  .mode-name{display:block;font-weight:700;color:var(--text);font-size:var(--font-12);letter-spacing:.02em}
  .result-runner{display:flex;gap:10px;justify-content:flex-start;width:100%;background:none;border:0;padding:0;text-align:left}
  .result-runner strong{display:flex;align-items:center;gap:6px;font-size:var(--font-12);font-weight:550}.result-gate{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border:1px solid var(--border);border-radius:4px;background:var(--panel-raised);color:var(--text);font-size:var(--font-11);font-variant-numeric:tabular-nums}.result-runner small{font-size:var(--font-9)}.finish{font-size:var(--font-14);font-weight:650}
  .empty-hp{color:#e28f7f}.muted{font-size:var(--font-9)}td small{font-size:var(--font-9);line-height:1.5}
  .modeled{text-decoration:underline dotted var(--muted);text-underline-offset:4px;cursor:help}
  td :global(small.mode-figure){font-size:var(--font-11);color:var(--text);line-height:1.4}
  td span.modeled{display:block;font-size:var(--font-11);line-height:1.5}
.result-badges{display:flex;align-items:center;gap:5px;margin-top:5px}.result-runner{gap:7px}.result-runner strong{font-size:var(--font-11)}td:nth-child(2){min-width:175px}td{padding:7px 8px}
</style>
