<script lang="ts">
  import type { HillImpact, ContributionTotal } from '../data/effect-types';
  import type { StatusModeImpact } from '../data/status-mode-impact';
  import { uphillHelp, downhillHelp } from '../data/analysis-copy';
  import ModeImpactSummary from './ModeImpactSummary.svelte';
  export let kind:'uphill'|'downhill',hills:HillImpact[],total:ContributionTotal|undefined;
  export let mode:StatusModeImpact|undefined=undefined;
  export let name:string;
  $: rows=hills.filter(h=>h.kind===kind);
  $: speedValues=rows.flatMap(h=>h.modeledSpeedDelta==null?[]:[h.modeledSpeedDelta]);
  $: speedRange=speedValues.length?[Math.min(...speedValues),Math.max(...speedValues)]:null;
  const f=(value:number|null|undefined,digits=2)=>value==null?'—':value.toFixed(digits);
  const signed=(value:number)=>`${value>0?'+':''}${value.toFixed(2)}`;
  $: help=kind==='uphill'?uphillHelp:downhillHelp;
</script>
{#if rows.length}
<div class="hill-stats" data-hill-kind={kind}>
  <div class="hill-total" aria-label={`Combined ${kind} stats for ${name}`}>
    {#if kind==='downhill'&&mode}<span>{mode.duration.toFixed(1)} s DH</span><ModeImpactSummary value={mode}/>
    {:else}
      <span class="modeled" title={help}>{f(total?.modeledDistanceDelta)} m</span>
      <small class="modeled" title={help}>{f(total?.modeledTimeDelta==null?null:Math.abs(total.modeledTimeDelta),3)} s {kind==='uphill'?'lost':'saved'}</small>
      {#if kind==='downhill'&&total?.modeledHpDelta!=null}<small>{f(-total.modeledHpDelta,1)} HP saved</small>{/if}
    {/if}
    {#if speedRange}<small title={kind==='uphill'?'Target speed loss across different hill grades. Higher power reduces the loss.':'Target speed gain while DH is active.'}>{signed(speedRange[0])}{Math.abs(speedRange[1]-speedRange[0])<.005?'':` to ${signed(speedRange[1])}`} m/s</small>{/if}
  </div>

</div>
{:else}—{/if}
<style>
  .hill-stats{font-variant-numeric:tabular-nums}small{display:block;font-size:var(--font-9);line-height:1.5}.modeled{text-decoration:underline dotted var(--muted);text-underline-offset:3px;cursor:help}
</style>
