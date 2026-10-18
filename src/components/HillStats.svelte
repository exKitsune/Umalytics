<script lang="ts">
  import type { HillImpact, ContributionTotal } from '../data/effect-types';
  import type { StatusModeImpact } from '../data/status-mode-impact';
  import { uphillHelp, downhillHelp } from '../data/analysis-copy';
  import ModeImpactSummary from './ModeImpactSummary.svelte';
  import ImpactLine, { type ImpactBit } from './ImpactLine.svelte';
  export let kind:'uphill'|'downhill',hills:HillImpact[],total:ContributionTotal|undefined;
  export let mode:StatusModeImpact|undefined=undefined;
  export let name:string;
  $: rows=hills.filter(h=>h.kind===kind);
  $: speedValues=rows.flatMap(h=>h.modeledSpeedDelta==null?[]:[h.modeledSpeedDelta]);
  $: speedRange=speedValues.length?[Math.min(...speedValues),Math.max(...speedValues)]:null;
  const signed=(value:number,digits=2)=>`${value>0?'+':value<0?'−':''}${Math.abs(value).toFixed(digits)}`;
  $: help=kind==='uphill'?uphillHelp:downhillHelp;
  $: speedText=speedRange?`${signed(speedRange[0])}${Math.abs(speedRange[1]-speedRange[0])<.005?'':`–${signed(speedRange[1])}`} m/s`:null;
  $: costBits=(kind==='downhill'&&mode?[]:[
    ...(total?.modeledTimeDelta==null?[]:[{text:`${Math.abs(total.modeledTimeDelta).toFixed(3)} s`,tone:kind==='uphill'?'loss':'gain'}]),
    ...(kind==='downhill'&&total?.modeledHpDelta!=null?[{text:`${Math.abs(total.modeledHpDelta).toFixed(1)} HP`,tone:total.modeledHpDelta<=0?'gain':'loss'}]:[]),
  ]) as ImpactBit[];
</script>
{#if rows.length||mode?.source==='simulation'&&mode.duration>0}
<div class="hill-stats" data-hill-kind={kind} aria-label={`Combined ${kind} stats for ${name}`}>
  {#if kind==='downhill'&&mode}
    <div class="fact"><span class="tag">DH</span><strong class:modeled={mode.source!=='simulation'} title={mode.source==='simulation'?'Duration from actual simulator state ticks.':help}>{mode.duration.toFixed(1)}s</strong>{#if speedText}<span class="aside" title="Target speed gain while DH is active.">{speedText}</span>{/if}</div>
    <ModeImpactSummary value={mode}/>
  {:else}
    <div class="fact"><strong class="modeled" title="Calculated movement difference from the uphill speed penalty, holding the replay context fixed. The adjacent speed is the target modifier, not metres lost.">{total?.modeledDistanceDelta==null?'—':signed(total.modeledDistanceDelta,2)} m</strong>{#if speedText}<span class="aside" title={kind==='uphill'?'Target speed loss across different hill grades. Higher power reduces the loss.':'Target speed gain while DH is active.'}>{speedText}</span>{/if}</div>
    <ImpactLine bits={costBits} modeled title={kind==='uphill'?'Fixed-context comparison removing the uphill penalty.':'Fixed-context downhill-mode comparison.'}/>
  {/if}
</div>
{:else}—{/if}
<style>
  .hill-stats{font-variant-numeric:tabular-nums}
  .fact{display:flex;align-items:baseline;gap:8px;white-space:nowrap}
  .fact strong{font-size:var(--font-14);font-weight:600}
  .tag{font-size:var(--font-11);font-weight:700;letter-spacing:.04em;color:var(--muted)}
  .aside{color:var(--muted);font-size:var(--font-11);font-weight:550}
  .modeled{text-decoration:underline dotted var(--muted);text-underline-offset:3px;cursor:help}
</style>
