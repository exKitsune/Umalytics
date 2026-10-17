<script lang="ts">
  import type { EffectUtilization } from '../data/effect-types';
  export let effect:EffectUtilization;
  export let expanded=false;
  const percentage=(value:number)=>Math.round(Math.max(0,Math.min(1,value))*100);
  $: label=({'target-speed':'Speed','acceleration':'Acceleration','current-speed':'Direct speed'} as const)[effect.kind];
  $: scored=effect.scoringConvention==='target-speed-half-credit';
  $: total=effect.activeDuration;
  $: unknown=total===null?null:Math.max(0,total-effect.assessedDuration);
  $: full=effect.fullyEffectiveDuration??(scored?0:effect.usefulDuration??0);
  $: half=scored?effect.acceleratingDuration??0:0;
  $: wasted=effect.wastedDuration??(scored?effect.belowBaselineDuration??0:0);
  $: score=effect.assessedDuration>0?effect.usefulAmongAssessed:null;
  $: carry=effect.carryoverEfficiency??0;
  $: carryMeters=effect.carryoverDistance??0;
  $: scenario=effect.scenarioUtilization;
  $: coverage=effect.coverageRate??0;
  $: result=score===null?'Unavailable':scenario&&coverage>0&&percentage(scenario.min/coverage)!==percentage(scenario.max/coverage)?`${percentage(scenario.min/coverage)}–${percentage(scenario.max/coverage)}% effective`:`${percentage(score)}% effective`;
</script>
<div class="effect-use" class:expanded data-effect-kind={effect.kind}>
  <div class="heading"><span title={scored?'Earlier speed skills reach full credit first. Later skills get half credit while accelerating from normal speed toward their ceiling. Blocked time and speed below normal count as zero.':undefined}>{label}</span><strong>{result}{#if carryMeters>0.05} <b class="carry-figure">Carryover gain +{carryMeters.toFixed(2)} m</b>{/if}{#if carry>0.02} <b class="carry-figure">+{Math.round(carry*100)}%</b>{/if}</strong></div>
  <div class="times">
    {#if scored&&effect.usefulDuration!==null}<span>{full.toFixed(2)} s full</span>
      {#if half>.0001}<span>{half.toFixed(2)} s half</span>{/if}
      {#if wasted>.0001}<span>{wasted.toFixed(2)} s wasted</span>{/if}
    {:else if effect.usefulDuration!==null}<span>{effect.usefulDuration.toFixed(2)} s useful</span>{/if}
    {#if effect.kind==='acceleration'&&effect.cappedDuration!==null}<span title="Extra acceleration was not needed at the speed cap.">{effect.cappedDuration.toFixed(2)} s at cap</span>{/if}
    {#if effect.blockedDuration!==null&&effect.blockedDuration>.0001}<span>{effect.blockedDuration.toFixed(2)} s blocked</span>{/if}
    {#if effect.afterFinishDuration>.0001}<span>{effect.afterFinishDuration.toFixed(2)} s after finish</span>{/if}
    {#if unknown!==null&&unknown>.0001}<span class="unknown-time" title="This portion cannot yet be assessed.">{unknown.toFixed(2)} s unknown</span>{/if}
  </div>
</div>
<style>
.effect-use{margin-top:8px;font-size:var(--font-11);line-height:1.4}.effect-use:first-child{margin-top:0}.heading{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;color:var(--muted)}strong{color:var(--text);font-weight:550;font-variant-numeric:tabular-nums}.carry-figure{display:inline-block;margin-left:8px;color:#8ec8f0;font-size:var(--font-13);font-weight:750;letter-spacing:.01em}.times{display:flex;gap:3px 9px;flex-wrap:wrap;margin-top:4px;color:var(--muted);font-variant-numeric:tabular-nums}.unknown-time{text-decoration:underline dotted;text-underline-offset:2px;cursor:help}.expanded{margin-top:13px;font-size:var(--font-12)}.expanded .times{font-size:var(--font-11);margin-top:5px}
</style>
