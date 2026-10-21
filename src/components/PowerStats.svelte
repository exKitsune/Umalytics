<script lang="ts">
  import type {PowerSummary} from '../simulation/power';
  import type {StatusInterval} from '../data/analytics';
  export let available=true;
  export let benefit:import('../data/motion-benefit').MotionBenefit|undefined;
  export let value:PowerSummary|undefined,intervals:StatusInterval[]=[];
  $: releases=value?.releases??intervals.filter(i=>i.kind==='release-conserve-power').map(i=>({start:i.start,end:i.end,acceleration:null}));
</script>
<div class="power-stats">
  {#if !available||(!value&&!releases.length)}<small title="Power accumulation and release require a matched simulator trace.">—</small>{:else}
  {#if value?.accumulationSeconds!=null}<div title="Time spent building stored power."><span class="tag">Conserve</span><strong>{value.accumulationSeconds.toFixed(1)} s</strong></div>{/if}
  {#if value?.gauge!=null}<small title="Stored power available for release.">Gauge {value.gauge.toFixed(1)}</small>{/if}
  {#each releases as release}<div title={`Power release starts at ${release.start.toFixed(3)} s${release.end==null?'; expiry unavailable':` and expires at ${release.end.toFixed(3)} s`}.`}><span class="tag release">Release</span><strong>{release.end==null?`${release.start.toFixed(2)} s`:`${(release.end-release.start).toFixed(2)} s`}</strong></div>{#if release.acceleration!=null}<small class="bonus" title="Acceleration supplied by stored power.">+{release.acceleration.toFixed(3)} m/s²</small>{/if}
  {:else}<small title={value?.status==='initialPowerAtOrBelowThreshold'?'Power reserve unavailable.':value?'No power release.':'No power release recorded.'}>{value?.status==='initialPowerAtOrBelowThreshold'?'Power ≤1200':'Not released'}</small>{/each}
  {#if benefit?.distance&&benefit.time}<div class="power-gain" title="Movement gained from releasing stored power."><strong>{benefit.distance.mid>=0?'+':''}{benefit.distance.mid.toFixed(2)} m</strong><small>{Math.abs(benefit.time.mid).toFixed(3)} s {benefit.time.mid<=0?'saved':'lost'}</small></div>{#if benefit.coverage<.999||!benefit.carryoverComplete}<small>Partial comparison</small>{/if}{/if}
{/if}
</div>
<style>
  .power-stats{font-variant-numeric:tabular-nums}.power-stats>div{display:flex;gap:8px;align-items:baseline;margin:3px 0;white-space:nowrap}strong{font-size:var(--font-13);font-weight:550}.tag{color:#8bc4e8;font-size:var(--font-10);font-weight:600}.release{color:#ff923e}.power-gain{color:var(--accent-text)}.power-gain small{color:inherit}small{display:block;color:var(--muted);font-size:var(--font-10);margin:2px 0;white-space:nowrap}.bonus{color:var(--accent-text)}
</style>
