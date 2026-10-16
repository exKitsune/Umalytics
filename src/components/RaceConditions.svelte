<script lang="ts">
  import type { Race } from '../data/types';
  import GameIcon from './GameIcon.svelte';
  export let conditions:Race['conditions'];
  const weather=['Sunny','Cloudy','Rainy','Snowy'],ground=['Firm','Good','Soft','Heavy'],season=['Spring','Summer','Autumn','Winter','Spring'];
  function code(value:string|null|undefined,names:string[]){if(value==null)return null;const n=Number(value);if(Number.isInteger(n)&&n>=1&&n<=names.length)return n;const match=names.findIndex(name=>name.toLowerCase()===value.toLowerCase());return match<0?null:match+1;}
  $: w=code(conditions?.weather,weather);
  $: s=code(conditions?.season,season);
  $: g=code(conditions?.ground,ground);
</script>
<div class="condition-icons" aria-label="Race conditions">
  {#if conditions?.weather}<span>{#if w}<GameIcon name={`weather-${w}`} size={25}/>{/if}{w?weather[w-1]:conditions.weather}</span>{/if}
  {#if conditions?.ground}<span class="ground">{g?ground[g-1]:conditions.ground}</span>{/if}
  {#if conditions?.season}<span>{#if s}<GameIcon name={`season-${s===5?1:s}`} size={25}/>{/if}{s?season[s-1]:conditions.season}</span>{/if}
  {#if !conditions?.weather&&!conditions?.ground&&!conditions?.season}<span>Conditions unknown</span>{/if}
</div>
<style>.condition-icons{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;color:var(--muted);font-size:var(--font-11);margin:7px 0 4px}.condition-icons>span{display:inline-flex;align-items:center;gap:5px}.ground{border-inline:1px solid var(--border);padding:0 12px}</style>
