<script lang="ts">
  import type {PowerSummary} from '../simulation/power';
  import type {StatusInterval} from '../data/analytics';
  export let value:PowerSummary|undefined,intervals:StatusInterval[]=[];
  $: releases=value?.releases??intervals.filter(i=>i.kind==='release-conserve-power').map(i=>({start:i.start,end:i.end,acceleration:null}));
</script>
<div class="power-stats">
  {#if value?.accumulationSeconds!=null}<div title="Time the conserve-power accumulation clock was active, excluding interrupted and cooldown windows."><span class="tag">Conserve</span><strong>{value.accumulationSeconds.toFixed(1)} s</strong></div>{/if}
  {#if value?.gauge!=null}<small title="Stored power gauge from the simulator’s accumulation ledger. This is neither speed nor acceleration.">Gauge {value.gauge.toFixed(1)}</small>{/if}
  {#each releases as release}<div title={`Power release starts at ${release.start.toFixed(3)} s${release.end==null?'; expiry unavailable':` and expires at ${release.end.toFixed(3)} s`}.`}><span class="tag release">Release</span><strong>{release.end==null?`${release.start.toFixed(2)} s`:`${(release.end-release.start).toFixed(2)} s`}</strong></div>{#if release.acceleration!=null}<small class="bonus" title="Actual applied acceleration bonus while conserved power is released. It only increases velocity while below the target/cap.">+{release.acceleration.toFixed(3)} m/s²</small>{/if}
  {:else}<small title={value?.status==='initialPowerAtOrBelowThreshold'?'Conserve power requires starting raw power above 1200.':value?'No power-release activation occurred in this simulation.':'No power release was recorded; the inference engine cannot supply an exact gauge.'}>{value?.status==='initialPowerAtOrBelowThreshold'?'Power ≤1200':'Not released'}</small>{/each}
</div>
<style>
  .power-stats{font-variant-numeric:tabular-nums}.power-stats>div{display:flex;gap:8px;align-items:baseline;margin:3px 0;white-space:nowrap}strong{font-size:var(--font-13);font-weight:550}.tag{color:#8bc4e8;font-size:var(--font-10);font-weight:600}.release{color:#d5a3ff}small{display:block;color:var(--muted);font-size:var(--font-10);margin:2px 0;white-space:nowrap}.bonus{color:var(--accent-text)}
</style>
