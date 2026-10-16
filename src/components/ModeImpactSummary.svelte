<script lang="ts">
  import type { StatusModeImpact } from '../data/status-mode-impact';
  export let value:StatusModeImpact|undefined;
  const format=(mid:number,digits:number,signed=false)=>`${signed&&mid>0?'+':''}${mid.toFixed(digits)}`;
  $: distance=value?.reachableExtraDistance??value?.assessedReachableExtraDistance;
  $: time=value?.reachableExtraTime??value?.assessedReachableExtraTime;
  $: hp=value?.reachableExtraHp??value?.assessedReachableExtraHp;
</script>
{#if value&&(distance!=null||time!=null||hp!=null)}
  <small class="mode-figure" title="Difference versus the same race with this mode removed. Acceleration and traffic stay in both paths.">{distance==null?'—':`${format(distance,2,true)} m ${distance>=0?'gained':'lost'}`}{#if distance!=null&&!value.complete} · partial{/if}</small>
  <small class="mode-figure" title="Time matching that distance difference.">{time==null?'—':`${format(Math.abs(time),3)} s ${time>=0?'saved':'lost'}`}</small>
  <small class="mode-figure" title="Change in running HP cost with this mode.">{hp==null?'— HP':`${format(Math.abs(hp),1)} HP ${hp<0?'saved':'spent'}`}</small>
{/if}
<style>
  small{display:block;font-size:var(--font-11);line-height:1.45;font-variant-numeric:tabular-nums;color:var(--text);cursor:help}
</style>
