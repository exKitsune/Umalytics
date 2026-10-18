<script lang="ts">
  import type { SkillMetric } from '../data/skill-metrics';
  export let metrics:SkillMetric[]=[];
  export let expanded=false;
  $: visible=expanded?metrics:metrics.filter(m=>m.value!==null).slice(0,4);
  function meaning(label:string){
    const name=label.split(' · ')[0];
    if(name.endsWith(' stat'))return `${name.replace(' stat','')} added by the skill`;
    return ({'Late target coefficient':'Final-leg target-speed bonus','Maximum spurt coefficient':'Maximum-spurt target bonus',
      'Initial acceleration coefficient':'Starting acceleration bonus','Uphill mitigation per 1%':'Speed loss prevented on a 1% uphill',
      'Minimum speed coefficient':'Speed-floor bonus','Mean section target coefficient':'Average wit-based speed bonus',
      'Starting HP contribution':'Starting HP added','Late HP drain change':'Change in final-leg HP drain',
      'Downhill entry chance change':'Extra chance to enter downhill mode','Vision modifier':'Change in viewing distance',
      'Lane speed modifier':'Sideways speed bonus','Target-lane setting':'Preferred lane offset','Sampled lane travel':'Lateral distance travelled while active',
      'Rushed chance modifier':'Change in the chance of rushing','Rushed reset timer':'New rushed countdown',
      'Rushed observed after activation':'Remaining rushed duration','Gate delay override':'Replacement gate delay',
      'Gate delay multiplier':'Gate-delay multiplier','Gate delay saved':'Time saved leaving the gate','Inferred raw gate draw':'Estimated gate delay before skills',
      'Same-frame gold candidates':'Gold skills activated at the same moment'} as Record<string,string>)[name]??name;
  }
  const format=(value:number|string|null)=>value===null?'Unavailable':typeof value==='string'?value:Number(value.toFixed(Math.abs(value)<1?3:2)).toString();
</script>
{#if visible.length}<dl class="skill-metrics" class:expanded>{#each visible as metric}<div title={`${meaning(metric.label)}: ${format(metric.value)}${metric.value!==null&&metric.unit?` ${metric.unit}`:''}`}><dt>{metric.label}</dt><dd>{format(metric.value)} {metric.unit}</dd></div>{/each}</dl>{/if}
<style>.skill-metrics{display:grid;gap:5px;margin:8px 0 0;font-size:var(--font-11);line-height:1.4}.skill-metrics>div{display:flex;align-items:baseline;gap:12px;justify-content:space-between}.skill-metrics dt{color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px;cursor:help}.skill-metrics dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}.expanded{font-size:var(--font-12);margin:16px 0;gap:8px}</style>
