<script lang="ts">
  import {statusHelp,statusFormula,statusColor,uphillHelp,downhillHelp,debuffHelp,modelHelp} from '../data/analysis-copy';
  import type { Race } from '../data/types';
  import type { RaceAnalysis } from '../data/analytics';
  import { preparedFor } from '../analysis/prepared';
  import { effectiveStrategyCode } from '../data/skill-details';
  import { combinedStatusIntervals, substantialNearIntervals } from '../data/status-presentation';
  import { runnerName, type ReferenceData } from '../data/reference';
  import UmaPortrait from './UmaPortrait.svelte';
  import GameIcon from './GameIcon.svelte';
  import StrategyBadge from './StrategyBadge.svelte';
  import type { MotionBand, RunnerMotion } from '../data/race-motion';
  import type { StatusModeImpact } from '../data/status-mode-impact';
  import ModeImpactSummary from './ModeImpactSummary.svelte';
  import ImpactLine, { type ImpactBit } from './ImpactLine.svelte';
  import SpurtSpeed from './SpurtSpeed.svelte';
  import HillStats from './HillStats.svelte';
  import PodiumTrophy from './PodiumTrophy.svelte';
  import { atTime } from '../data/effect-sampling';
  import { spurtDisplayGroups } from '../data/spurt-comparison';
  export let race:Race, reference:ReferenceData|null, analysis:RaceAnalysis, selected:string;
  export let onSelect:(id:string)=>void;
  export let compact=false;
  const f=(n:number|null|undefined,d=1)=>n==null?'—':n.toFixed(d);
  const mood=(m:number|null|undefined)=>m==null?'—':({1:'Awful',2:'Bad',3:'Normal',4:'Good',5:'Great'} as Record<number,string>)[m]??String(m);
  const range=(v:MotionBand,d=2)=>Math.abs(v.max-v.min)<10**-d?v.mid.toFixed(d):`${Math.min(v.min,v.mid,v.max).toFixed(d)} – ${Math.max(v.min,v.mid,v.max).toFixed(d)}`;
  $: prepared=preparedFor(analysis);
  $: motions=Object.fromEntries(Object.entries(prepared?.runners??{}).map(([id,r])=>[id,r.motion])) as Record<string,RunnerMotion>;
  $: modes=Object.fromEntries(Object.entries(prepared?.runners??{}).map(([id,r])=>[id,r.modes])) as Record<string,StatusModeImpact[]>;
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
  function blockHole(motion:RunnerMotion|undefined){
    const loss=motion?.trafficLoss;
    return loss?.distanceLoss&&loss.timeLoss?{distance:loss.distanceLoss,time:loss.timeLoss,partial:(loss.coverage??0)<.999}:null;
  }
  function exhaustion(id:string){
    const time=analysis.runners[id]?.summary.hpZeroTime,loss=motions[id]?.exhaustionLoss;
    if(time==null)return null;
    const episode=loss?.episodes[0],min=episode?.onsetMin??time,max=episode?.onsetMax??time;
    const remaining=(t:number)=>{const distance=atTime(race,id,t)?.distance;return distance==null||race.distance==null?null:Math.max(0,race.distance-distance);};
    const first=remaining(min),last=remaining(max),mid=remaining((min+max)/2);
    return {onset:{min,mid:(min+max)/2,max},remaining:first==null||last==null||mid==null?null:{min:last,mid,max:first},loss,partial:loss?.coverage!=null&&loss.coverage<.999};
  }
  function emptyHpView(id:string){
    const exhausted=exhaustion(id);
    if(!exhausted)return null;
    const known=exhausted.loss?.distanceLoss&&exhausted.loss.timeLoss;
    return {
      when:`Empty ${range(exhausted.onset,1)}s${exhausted.remaining?` · ${range(exhausted.remaining,0)} m left`:''}`,
      metres:known?`−${range(exhausted.loss!.distanceLoss!)} m`:null,
      time:known?`−${range(exhausted.loss!.timeLoss!,3)} s`:null,
      fallback:known?null:motions[id]?'Loss unavailable':'Calculating loss…',
      modeled:!!known,
      partial:!!(known&&exhausted.partial),
    };
  }
  const signed=(n:number,d=1)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(d)}`;
  function signedSpeed(values:number[]){if(!values.length)return null;const min=Math.min(...values),max=Math.max(...values),fmt=(n:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(2)}`;return Math.abs(max-min)<.005?`${fmt(min)} m/s`:`${fmt(min)}–${fmt(max)} m/s`;}
  function speedBit(id:string,kind:string){const values=(intervals[id]??[]).flatMap(s=>s.kind===kind&&s.model?.speedDelta!=null?[s.model.speedDelta]:[]);const text=signedSpeed(values);if(!text)return null;const formula=statusFormula(kind);return {text,title:formula?`${formula} → ${text}`:text};}
  function duration(id:string,kind:string){
    const source=kind==='near-slowdown'&&prepared?.runners[id]?substantialNearIntervals(intervals[id]??[],prepared.runners[id].inferredMotion.samples):(intervals[id]??[]);
    const rows=source.filter(s=>s.kind===kind);
    const known=rows.filter(r=>r.end!==null);
    return {text:known.length?`${known.reduce((n,r)=>n+r.end!-r.start,0).toFixed(1)}s`:'—',
      modeled:rows.some(r=>r.evidence==='estimated'),
      title:analysis.source==='simulation'?'Duration from actual simulator state ticks.':rows.length?statusHelp(kind):modelBlock(id)??'No active interval found.'};
  }
  function statusFact(id:string,kind:string,tag?:string){
    const d=duration(id,kind),gain=speedBit(id,kind);
    return {tag,duration:d.text,speed:gain?.text??null,empty:d.text==='—',modeled:d.modeled,title:gain?`${d.title} ${gain.title}`:d.title};
  }
  const signTone=(n:number):NonNullable<ImpactBit['tone']>=>n>0?'gain':n<0?'loss':'';
  function extraBits(value:{modeledExtraDistance:number|null;modeledExtraTime:number|null;modeledExtraHp:number|null}|undefined){
    if(!value)return [];
    const bits:ImpactBit[]=[];
    if(value.modeledExtraDistance!=null&&Math.abs(value.modeledExtraDistance)>=.05)bits.push({text:`${signed(value.modeledExtraDistance,1)} m`,tone:signTone(value.modeledExtraDistance)});
    if(value.modeledExtraTime!=null&&Math.abs(value.modeledExtraTime)>=.0005)bits.push({text:`${Math.abs(value.modeledExtraTime).toFixed(3)} s`,tone:signTone(value.modeledExtraTime)});
    if(value.modeledExtraHp!=null&&Math.abs(value.modeledExtraHp)>=.05)bits.push({text:`${Math.abs(value.modeledExtraHp).toFixed(1)} HP`,tone:signTone(-value.modeledExtraHp)});
    return bits;
  }
  function rushedBits(id:string){
    const value=impact(id,'rushed'),bits=extraBits(value),duration=analysis.runners[id]?.summary.rushedDuration??0;
    if(duration>0&&value?.modeledExtraDistance!=null&&value.modeledExtraDistance<.05)bits.unshift({text:'No gain',tone:''});
    return bits;
  }
  function stolenTotal(id:string){
    const incoming=analysis.runners[id]?.receivedDebuffTotals?.modeledHpDelta;
    const rushed=impact(id,'rushed')?.modeledExtraHp;
    if(incoming==null&&rushed==null)return null;
    return (incoming??0)+(rushed??0);
  }
  function hpView(s:{hpStart:number|null;hpFinish:number|null;hpUsed:number|null;hpRecovered:number|null}|undefined,stolenHp:number|null|undefined){
    if(!s)return null;
    const whole=(v:number|null|undefined)=>v==null?'—':String(Math.round(v));
    return {
      finish:whole(s.hpFinish),
      start:whole(s.hpStart),
      percent:s.hpStart&&s.hpFinish!=null?(s.hpFinish/s.hpStart*100).toFixed(1):null,
      spent:whole(s.hpUsed),
      gained:s.hpRecovered==null?'—':`+${Math.round(s.hpRecovered)}`,
      stolen:stolenHp==null?'—':stolenHp===0?'0':`${stolenHp>0?'−':'+'}${Math.round(Math.abs(stolenHp))}`,
    };
  }
  function startQuality(delay:number|null|undefined){
    if(delay==null)return null;
    if(delay<.02)return {label:'Great start',tone:'great'};
    if(delay<=.04)return {label:'Good start',tone:'good'};
    if(delay>.08)return {label:'Late start',tone:'late'};
    return {label:'Poor start',tone:'poor'};
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
  $: resultSlots={
    spurtStages:sorted.some(r=>{const value=prepared?.runners[r.id]?.spurt;return value?spurtDisplayGroups(value).length>1:false;}),
  };
  function pinFinish(node:HTMLElement){
    const head=node.querySelector('thead th');
    if(!head)return;
    const apply=()=>node.style.setProperty('--finish-w',`${head.getBoundingClientRect().width}px`);
    const ro=new ResizeObserver(apply);
    ro.observe(head);apply();
    return {destroy(){ro.disconnect();}};
  }
  function hoverCol(node:HTMLTableElement){
    const set=(event:Event)=>{
      const cell=(event.target as HTMLElement).closest('th,td') as HTMLTableCellElement|null;
      if(!cell||!node.contains(cell))return;
      const index=String(cell.cellIndex);
      if(node.dataset.col!==index)node.dataset.col=index;
    };
    const clear=()=>{if('col' in node.dataset)delete node.dataset.col;};
    const blur=(event:FocusEvent)=>{if(!node.contains(event.relatedTarget as Node|null))clear();};
    node.addEventListener('pointerover',set);
    node.addEventListener('pointerleave',clear);
    node.addEventListener('focusin',set);
    node.addEventListener('focusout',blur);
    return {destroy(){
      node.removeEventListener('pointerover',set);
      node.removeEventListener('pointerleave',clear);
      node.removeEventListener('focusin',set);
      node.removeEventListener('focusout',blur);
    }};
  }
</script>
{#snippet statusCell(row:{tag?:string;duration:string;speed:string|null;empty:boolean;modeled:boolean;title:string}, value:{modeledExtraDistance:number|null;modeledExtraTime:number|null;modeledExtraHp:number|null}|undefined)}
  <div class="fact" class:empty={row.empty} title={row.title}>{#if row.tag}<span class="tag">{row.tag}</span>{/if}<strong class:modeled={row.modeled}>{row.duration}</strong>{#if row.speed}<span class="aside">{row.speed}</span>{/if}</div>
  <ImpactLine bits={extraBits(value)} modeled title={modelHelp}/>
{/snippet}
{#snippet modeCell(row:{tag?:string;duration:string;speed:string|null;empty:boolean;modeled:boolean;title:string}, id:string, kind:string)}
  <div class="fact" class:empty={row.empty} title={row.title} style={row.empty?undefined:`--status:${statusColor(kind)}`}>{#if row.tag}<span class="tag status-tag">{row.tag}</span>{/if}<strong class="status-value" class:modeled={row.modeled}>{row.duration}</strong>{#if row.speed}<span class="aside">{row.speed}</span>{/if}</div>
  {#if !row.empty}{#if !modes[id]}<span class="note">Calculating gains…</span>{:else if mode(id,kind)}<ModeImpactSummary value={mode(id,kind)}/>{:else}<span class="note">Gain unavailable</span>{/if}{/if}
{/snippet}
<section class="panel field-stats" class:compact>
  <div class="panel-heading"><strong>Race results</strong><span class="muted">{analysis.source==='simulation'?'Select a runner':'Select a runner · dotted values use models'}</span></div>
  <div class="field-scroll" use:pinFinish><table use:hoverCol data-col="">
    <thead><tr>{#each ['Finish','Uma','Time','Start delay','Last spurt','HP','Dueling','Uphill','Downhill','Corner loss','PU / SU','PD / OT','Spot struggle','Rushed','Debuffs received','Blocked / Near'] as heading}<th title={heading==='Downhill'?downhillHelp:heading==='Uphill'?uphillHelp:heading==='PU / SU'?'Pace up / Speed up (front runners).':heading==='PD / OT'?'Pace down / Overtake (front runners).':heading==='Spot struggle'?'Spot struggle':heading==='Start delay'?'Recorded gate delay versus the 0–100 ms draw.':undefined}>{heading}</th>{/each}</tr></thead>
    <tbody>{#each sorted as r}
      {@const s=analysis.runners[r.id]?.summary}
      {@const duel=statusFact(r.id,'dueling')}
      {@const pu=statusFact(r.id,'pace-up','PU')}
      {@const pd=statusFact(r.id,'pace-down','PD')}
      {@const ss=statusFact(r.id,'spot-struggle')}
      {@const style=effectiveStrategyCode(r,analysis.runners[r.id]?.skillRows??[])}
      {@const front=style===1||style===5}
      {@const su=statusFact(r.id,'speed-up','SU')}
      {@const ot=statusFact(r.id,'overtake','OT')}
      {@const near=duration(r.id,'near-slowdown')}
      {@const uphill=hill(r.id,'uphill')}
      {@const downhill=hill(r.id,'downhill')}
      {@const debuffs=analysis.runners[r.id]?.receivedDebuffTotals}
      {@const corners=analysis.runners[r.id]?.cornerPath}
      {@const motion=motions[r.id]}{@const hole=blockHole(motion)}
      {@const hp=hpView(s,stolenTotal(r.id))}
      {@const empty=emptyHpView(r.id)}
      <tr class:row-selected={selected===r.id} onclick={()=>onSelect(r.id)}>
        <td class="finish"><span class="finish-mark"><span class="finish-place">{r.finishOrder??'—'}</span>{#if r.finishOrder===1||r.finishOrder===2||r.finishOrder===3}<PodiumTrophy place={r.finishOrder} size={15}/>{/if}</span></td>
        <td><button class="result-runner" onclick={()=>onSelect(r.id)}><UmaPortrait runner={r} size={38}/><span><strong><span class="result-gate" title="Starting gate">{r.gate??r.index+1}</span>{runnerName(reference,r)}</strong><small class="result-badges"><StrategyBadge runner={{...r,strategyCode:style}}/>{#if r.mood!=null}<GameIcon name={`mood-${r.mood}`} label={`${mood(r.mood)} mood`} size={19}/>{/if}</small></span></button></td>
        <td><div class="fact"><strong>{f(s?.rawTime,3)}</strong><span class="unit">s</span></div><span class="note">{s?.finishGapDistance==null?'':`${s.finishGapDistance>=0?'+':''}${f(s.finishGapDistance)} m`}</span></td>
        <td>{#if s?.startDelay==null}—{:else}{@const quality=startQuality(s.startDelay)}<div class="fact" title="Recorded gate delay versus the 0–100 ms draw."><strong>{f(s.startDelay*1000,1)}</strong><span class="unit">/ 100 ms</span></div>{#if quality}<span class={`verdict start-${quality.tone}`}>{quality.label}</span>{/if}{/if}</td>
        <td><SpurtSpeed value={prepared?.runners[r.id]?.spurt} startDistance={s?.spurtDistance} name={runnerName(reference,r)} reserveStages={resultSlots.spurtStages}/></td>
        <td class="hp-cell" class:empty-hp={s?.hpFinish!=null&&s.hpFinish<=0}>{#if hp}<div class="hp-main"><div class="hp-final"><strong>{hp.finish}</strong><span class="hp-max">/ {hp.start}</span>{#if hp.percent}<small>{hp.percent}%</small>{/if}</div><div class="hp-flow" title="HP spent, gained from recoveries, and stolen by incoming debuffs and rushed drain."><span>{hp.spent}</span><span class="hp-gain">{hp.gained}</span><span class="hp-loss">{hp.stolen}</span></div><div class="hp-legend"><span>spent</span><span>gained</span><span>stolen</span></div></div>{/if}{#if empty}<div class="hp-empty"><small title="When HP first reaches zero; ranges reflect the gap between replay samples.">{empty.when}</small>{#if empty.metres}<small class:modeled={empty.modeled} title="Distance lost after HP runs out, keeping traffic and skill timings the same. Earlier spurt delay is excluded.">{empty.metres}</small><small class:modeled={empty.modeled} title="Equivalent travel time lost after HP runs out. Earlier spurt delay is excluded.">{empty.time}{#if empty.partial} · partial{/if}</small>{:else}<small>{empty.fallback}</small>{/if}</div>{/if}</td>
        <td>{@render statusCell(duel, impact(r.id,'dueling'))}</td>
        <td><HillStats kind="uphill" hills={analysis.runners[r.id]?.hillImpacts??[]} total={uphill} name={runnerName(reference,r)}/></td>
        <td><HillStats kind="downhill" hills={analysis.runners[r.id]?.hillImpacts??[]} total={downhill} mode={mode(r.id,'downhill-mode')} name={runnerName(reference,r)}/></td>
        <td>{#if corners?.assessedExtraDistance!=null}<div class="fact"><strong class="modeled" title={cornerHelp}>+{f(corners.extraDistance??corners.assessedExtraDistance,2)}</strong><span class="unit">m</span></div>{@const cornerBits=[corners.assessedEquivalentTime!=null?`${f(corners.equivalentTime??corners.assessedEquivalentTime,3)} s`:'',corners.extraDistance===null?'path partial':'',corners.equivalentTime===null?'time partial':''].filter(Boolean)}{#if cornerBits.length}<span class="note modeled" title={cornerHelp}>{cornerBits.join(' · ')}</span>{/if}{:else}<span title="Course path or lane data unavailable.">—</span>{/if}</td>
        <td>{#if front}{@render modeCell(su, r.id, 'speed-up')}{:else}{@render modeCell(pu, r.id, 'pace-up')}{/if}</td>
        <td>{#if front}{@render modeCell(ot, r.id, 'overtake')}{:else}{@render modeCell(pd, r.id, 'pace-down')}{/if}</td>
        <td>{@render statusCell(ss, impact(r.id,'spot-struggle'))}</td>
        <td><div class="fact" class:empty={!s?.rushedDuration}><strong>{f(s?.rushedDuration)}</strong><span class="unit">s</span></div><ImpactLine bits={rushedBits(r.id)} modeled title={modelHelp}/></td>
        <td>{#if debuffs?.intervals}<div class="fact"><strong class="modeled" title={debuffHelp}>{debuffs.modeledHpDelta==null?'—':f(debuffs.modeledHpDelta,0)}</strong><span class="unit">HP</span></div><ImpactLine bits={[...(debuffs.modeledDistanceDelta==null?[]:[{text:`${signed(debuffs.modeledDistanceDelta,1)} m`,tone:signTone(debuffs.modeledDistanceDelta)}]),...(debuffs.modeledTimeDelta==null?[]:[{text:`${Math.abs(debuffs.modeledTimeDelta).toFixed(3)} s`,tone:signTone(-debuffs.modeledTimeDelta)}])]} modeled title={debuffHelp}/>{:else}—{/if}</td>
        <td><div class="fact" title="Time with a recorded blocker. Speed loss is measured separately."><strong>{f(s?.blockedDuration)}</strong><span class="unit">s blocked</span>{#if near.text!=='—'}<span class="aside" title={near.title}>{near.text} near</span>{/if}</div>{#if hole}<ImpactLine bits={[{text:`${range(hole.distance)} m`,tone:'loss' as const},{text:`${range(hole.time,3)} s`,tone:'loss' as const},...(hole.partial?[{text:'partial',tone:'' as const}]:[])]} modeled title="Distance lost around traffic, including recovery. Pace modes, skills and slopes are kept the same."/>{:else if prepared?.runners[r.id]?.blocking}{@const clamps=prepared.runners[r.id].blocking!}<span class="note" title="Maximum actual speed reductions at separate self-speed and final-speed clamp stages. Not a counterfactual distance or finish-time loss.">Clamps {clamps.maximumSelfClamp.toFixed(2)} / {clamps.maximumFinalClamp.toFixed(2)} m/s</span>{:else}<span class="note">{motion?'Loss unavailable':'Calculating loss…'}</span>{/if}</td>
      </tr>
    {/each}</tbody>
  </table></div>
</section>
<style>
  .compact .field-scroll{max-height:560px}
  .field-scroll{max-height:1040px;overflow:auto;scrollbar-width:thin;--finish-w:3.4em}
  table{width:max-content;min-width:100%}th{font-size:var(--font-10)}td{font-size:var(--font-12);padding:20px 10px;vertical-align:middle;height:auto}
  tbody tr{cursor:pointer}tbody tr:hover td{background:color-mix(in srgb,#000 14%,var(--panel))}
  th:hover{background:color-mix(in srgb,#000 12%,var(--panel))}
  table:global([data-col="0"]) :is(th,td):nth-child(1),table:global([data-col="1"]) :is(th,td):nth-child(2),table:global([data-col="2"]) :is(th,td):nth-child(3),table:global([data-col="3"]) :is(th,td):nth-child(4),table:global([data-col="4"]) :is(th,td):nth-child(5),table:global([data-col="5"]) :is(th,td):nth-child(6),table:global([data-col="6"]) :is(th,td):nth-child(7),table:global([data-col="7"]) :is(th,td):nth-child(8),table:global([data-col="8"]) :is(th,td):nth-child(9),table:global([data-col="9"]) :is(th,td):nth-child(10),table:global([data-col="10"]) :is(th,td):nth-child(11),table:global([data-col="11"]) :is(th,td):nth-child(12),table:global([data-col="12"]) :is(th,td):nth-child(13),table:global([data-col="13"]) :is(th,td):nth-child(14),table:global([data-col="14"]) :is(th,td):nth-child(15),table:global([data-col="15"]) :is(th,td):nth-child(16){background:color-mix(in srgb,#000 10%,var(--panel))}
  td:nth-child(1),th:nth-child(1){position:sticky;left:0;background:var(--panel);z-index:2}
  th:nth-child(1){z-index:4}
  td:nth-child(2){position:sticky;left:var(--finish-w);background:var(--panel);z-index:2;min-width:175px;border-right:1px solid var(--border)}
  th:nth-child(2){position:sticky;left:var(--finish-w);z-index:4;background:var(--panel)}
  tbody tr:hover td:nth-child(1),tbody tr:hover td:nth-child(2){background:color-mix(in srgb,#000 14%,var(--panel))}
  tr.row-selected td,tr.row-selected td:nth-child(1),tr.row-selected td:nth-child(2),table:global([data-col]) tr.row-selected td{background:var(--accent-soft)}
  tr.row-selected:hover td,tr.row-selected:hover td:nth-child(1),tr.row-selected:hover td:nth-child(2),table:global([data-col]) tr.row-selected:hover td{background:color-mix(in srgb,#000 12%,var(--accent-soft))}
  .fact{display:flex;align-items:baseline;gap:6px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .fact strong{font-size:var(--font-14);font-weight:600}
  .fact.empty strong{color:var(--muted);font-weight:500;font-size:var(--font-12)}
  .tag{font-size:var(--font-11);font-weight:700;letter-spacing:.04em;color:var(--muted)}
  .status-tag{color:var(--status)}
  .unit,.aside,.note{color:var(--muted);font-size:var(--font-11);font-weight:550}
  .aside{white-space:nowrap}
  .note,.verdict{display:block;margin-top:2px;line-height:1.35;white-space:nowrap}
  .verdict{font-size:var(--font-10)}
  td span.modeled,td strong.modeled,.note.modeled{display:inline}
  .result-runner{display:flex;gap:10px;justify-content:flex-start;width:100%;background:none;border:0;padding:0;text-align:left}
  .result-runner strong{display:flex;align-items:center;gap:6px;font-size:var(--font-13);font-weight:550}.result-gate{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border:1px solid var(--border);border-radius:4px;background:var(--panel-raised);color:var(--text);font-size:var(--font-12);font-variant-numeric:tabular-nums}.result-runner small{font-size:var(--font-10)}.finish{font-size:var(--font-15);font-weight:650;white-space:nowrap}
  .finish-mark{display:inline-flex;align-items:center;gap:5px;min-height:18px}
  .finish-place{display:inline-block;min-width:1.15em;text-align:right;font-variant-numeric:tabular-nums}
  .finish :global(.podium-trophy){width:15px;height:16px}
  .empty-hp .hp-final strong{color:#e28f7f}.muted{font-size:var(--font-10)}td small{font-size:var(--font-10);line-height:1.5}
  .hp-cell{display:flex;align-items:flex-start;gap:12px;min-width:9em}
  .hp-empty{display:flex;flex-direction:column;gap:1px;padding-top:1px;white-space:nowrap}
  .hp-empty small{line-height:1.35}
  .hp-final{display:flex;align-items:baseline;gap:6px;font-variant-numeric:tabular-nums}
  .hp-final strong{font-size:var(--font-15);font-weight:600}.hp-max{color:var(--muted);font-weight:550}.hp-final small{color:var(--muted);margin-left:2px}
  .hp-flow,.hp-legend{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:3px;font-variant-numeric:tabular-nums}
  .hp-flow{font-weight:550}.hp-gain{color:#6dce86}.hp-loss{color:#e28f7f}
  .hp-legend{color:var(--muted);font-size:var(--font-9);line-height:1.2}
  .start-great{color:#6dce86;font-weight:650}.start-good{color:var(--text);font-weight:650}.start-poor{color:#e2c04a;font-weight:650}.start-late{color:#ef7474;font-weight:650}
  .modeled{text-decoration:underline dotted var(--muted);text-underline-offset:4px;cursor:help}
  td :global(.impact-line){margin-top:3px}
.result-badges{display:flex;align-items:center;gap:5px;margin-top:5px}.result-runner{gap:7px}.result-runner strong{font-size:var(--font-12)}td:nth-child(2){min-width:175px}
</style>
