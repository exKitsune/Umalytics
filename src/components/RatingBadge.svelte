<script lang="ts">
  import {rating} from '../data/career-display';
  export let score:number|null|undefined;export let rank:number|null|undefined=undefined;export let large=false;
  $: value=rating(score,rank);
</script>
<div class="rating" class:large title="Final career rating">
  {#if value}<img src={`./career/rank-${value.id-1}.png`} alt={`${value.label} rank`} draggable="false"/>{/if}
  {#if score!=null}<span><small>RATING</small><strong>{score.toLocaleString()}</strong></span>{/if}
</div>
<style>.rating{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}.rating img{width:44px;height:44px;object-fit:contain}.rating small{display:block;font-size:var(--font-8);letter-spacing:.09em;color:var(--muted)}.rating strong{font-size:var(--font-17);font-weight:650}.rating.large img{width:74px;height:74px}.large strong{font-size:var(--font-24)}</style>
