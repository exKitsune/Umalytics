<script lang="ts">
  import type { SlowdownAnalysis } from '../data/effect-types';
  export let value:SlowdownAnalysis|undefined;
  export let kind:'blocking'|'exhaustion';
  $: low=value?.distanceLossMin??value?.assessedDistanceLossMin??null;
  $: high=value?.distanceLossMax??value?.assessedDistanceLossMax??null;
  $: partial=value?.distanceLossMin==null&&low!=null;
  $: loss=value?.distanceLoss!=null?value.distanceLoss.toFixed(2):low!=null&&high!=null?Math.abs(high-low)<.005?low.toFixed(2):`${low.toFixed(2)}–${high.toFixed(2)}`:null;
  $: help=kind==='blocking'?'Distance lost while another runner limits speed.':'Distance lost while out of HP.';
</script>
{#if loss!==null&&value&&value.duration>0}<span class="loss" title={`${help} Calculated with the other known effects held fixed.${low!=null&&high!=null&&high-low>.005?' Range compares low and high target speeds.':''}`}>{loss} m lost{#if partial}<small>partial</small>{/if}</span>{/if}
{#if partial&&value?.coverageRate!=null}<small class="coverage">{Math.round(value.coverageRate*100)}% assessed</small>{/if}
{#if loss===null&&value&&value.duration>0}<span class="unavailable" title="The replay does not resolve enough of the target speed or blocking state to calculate lost distance.">Loss unavailable</span>{/if}
<style>
.loss{display:block;text-decoration:underline dotted var(--muted);text-underline-offset:3px;cursor:help;font-variant-numeric:tabular-nums}.loss small{display:inline;margin-left:5px;color:var(--muted);font-size:var(--font-9)}.coverage{display:block;color:var(--muted);font-size:var(--font-9);margin-top:3px}.unavailable{color:var(--muted);text-decoration:underline dotted;cursor:help}
</style>
