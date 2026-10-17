<script lang="ts">
  import type { StatusModeImpact } from '../data/status-mode-impact';
  import ImpactLine from './ImpactLine.svelte';
  export let value:StatusModeImpact|undefined;
  const signed=(n:number,digits:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(digits)}`;
  $: distance=value?.reachableExtraDistance??value?.assessedReachableExtraDistance;
  $: time=value?.reachableExtraTime??value?.assessedReachableExtraTime;
  $: hp=value?.reachableExtraHp??value?.assessedReachableExtraHp;
  $: bits=value&&(distance!=null||time!=null||hp!=null)?[
    ...(distance==null||Math.abs(distance)<.05?[]:[{text:`${signed(distance,1)} m`,tone:distance>0?'gain':distance<0?'loss':''}]),
    ...(time==null||Math.abs(time)<.0005?[]:[{text:`${Math.abs(time).toFixed(3)} s`,tone:time>0?'gain':time<0?'loss':''}]),
    ...(hp==null||Math.abs(hp)<.05?[]:[{text:`${Math.abs(hp).toFixed(1)} HP`,tone:hp<0?'gain':hp>0?'loss':''}]),
    ...(distance!=null&&value&&!value.complete?[{text:'partial',tone:''}]:[]),
  ]:[];
</script>
{#if bits.length}
  <ImpactLine {bits} modeled title="Difference versus the same race with this mode removed. Acceleration and traffic stay in both paths."/>
{/if}
