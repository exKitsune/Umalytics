<script lang="ts">
  import type { SkillMetric } from '../data/skill-metrics';
  export let metrics:SkillMetric[]=[];
  export let expanded=false;
  $: visible=expanded?metrics:metrics.filter(m=>m.value!==null).slice(0,4);
  const format=(value:number|string|null)=>value===null?'Unavailable':typeof value==='string'?value:Number(value.toFixed(Math.abs(value)<1?3:2)).toString();
</script>
{#if visible.length}<dl class="skill-metrics" class:expanded>{#each visible as metric}<div title={metric.value===null?metric.reason??metric.detail:metric.detail}><dt>{metric.label}</dt><dd>{format(metric.value)} {metric.unit}</dd></div>{/each}</dl>{/if}
<style>.skill-metrics{display:grid;gap:5px;margin:8px 0 0;font-size:var(--font-11);line-height:1.4}.skill-metrics>div{display:flex;align-items:baseline;gap:12px;justify-content:space-between}.skill-metrics dt{color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px;cursor:help}.skill-metrics dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}.expanded{font-size:var(--font-12);margin:16px 0;gap:8px}</style>
