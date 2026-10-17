<script lang="ts">
  import type { StatusModeImpact } from '../data/status-mode-impact';
  import ImpactLine, { type ImpactBit } from './ImpactLine.svelte';
  export let value:StatusModeImpact|undefined;
  const tone=(n:number):NonNullable<ImpactBit['tone']>=>n>0?'gain':n<0?'loss':'';
  const signed=(n:number,digits:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(digits)}`;
  $: distance=value?.reachableExtraDistance??value?.assessedReachableExtraDistance;
  $: time=value?.reachableExtraTime??value?.assessedReachableExtraTime;
  $: hp=value?.reachableExtraHp??value?.assessedReachableExtraHp;
  $: bits=(value&&(distance!=null||time!=null||hp!=null)?[
    ...(distance==null||Math.abs(distance)<.05?[]:[{text:`${signed(distance,1)} m`,tone:tone(distance)}]),
    ...(time==null||Math.abs(time)<.0005?[]:[{text:`${Math.abs(time).toFixed(3)} s`,tone:tone(time)}]),
    ...(hp==null||Math.abs(hp)<.05?[]:[{text:`${Math.abs(hp).toFixed(1)} HP`,tone:tone(-hp)}]),
    ...(distance!=null&&value&&!value.complete?[{text:'partial',tone:'' as const}]:[]),
  ]:[]) as ImpactBit[];
</script>
{#if bits.length}
  <ImpactLine {bits} modeled title="Difference versus the same race with this mode removed. Acceleration and traffic stay in both paths."/>
{/if}
