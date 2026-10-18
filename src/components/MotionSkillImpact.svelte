<script lang="ts">
  import type { MotionSkillImpact } from '../data/motion-skill-impact';
  import type { MotionBand } from '../data/race-motion';
  import EffectUtilization from './EffectUtilization.svelte';
  export let value:MotionSkillImpact;
  export let expanded=false;
  const amount=(b:MotionBand,digits:number)=>`${b.mid>=0?'+':''}${b.mid.toFixed(digits)}`;
  const saved=(b:MotionBand)=>-b.mid;
</script>
<div class="motion-impact" class:expanded>
  {#each value.effects as effect}<EffectUtilization {effect} {expanded}/>{/each}
  <div class="stats">
    {#if value.distance}<span title="Distance gained from this skill.">{amount(value.distance,2)} m gained</span>{/if}
    {#if value.time}<span title="Equivalent travel time saved or lost.">{Math.abs(saved(value.time)).toFixed(3)} s {saved(value.time)>=0?'saved':'lost'}</span>{/if}
    {#if value.blockedDistance&&value.blockedDistance.mid>.005}<span title="Skill benefit lost to traffic.">{amount(value.blockedDistance,2)} m lost to traffic</span>{/if}
  </div>
  {#if value.coverage<.999}<small>{Math.round(value.coverage*100)}% assessed</small>{/if}
  {#if value.carryoverDistance&&value.carryoverDistance.mid>.005}<div class="carryover"><small>Carryover gain</small><div class="stats"><span class="carry-figure">{amount(value.carryoverDistance,2)} m</span>{#if value.carryoverEfficiency!==null}<span class="carry-figure" title="Extra benefit retained after the speed effect ends.">+{Math.round(value.carryoverEfficiency*100)}%</span>{/if}{#if value.carryoverTime}<span class="carry-figure">{Math.abs(-value.carryoverTime.mid).toFixed(3)} s saved</span>{/if}{#if !value.carryoverComplete}<span>Partial</span>{/if}</div></div>{/if}
  {#if expanded}{#if value.carryoverDistance&&value.carryoverDistance.mid>.005}<p class="basis">Retained speed from speed effects. Acceleration gains count as direct gain. Included in the distance above.</p>{/if}{#if value.coverage<.999&&value.reasons.length}<p class="basis">{value.reasons[0]}</p>{/if}{/if}
</div>
<style>.motion-impact{font-size:var(--font-11);margin-top:6px;line-height:1.4}.stats{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:6px;font-variant-numeric:tabular-nums}small,.basis{font-size:var(--font-11);color:var(--muted)}.basis{margin:8px 0 0}.carryover{border-top:1px solid var(--border);margin-top:8px;padding-top:6px}.carry-figure{color:#8ec8f0;font-weight:750}.expanded{font-size:var(--font-13);margin-top:0}</style>
