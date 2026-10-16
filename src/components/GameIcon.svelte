<script lang="ts">
  import { iconSource } from '../data/game-icons';
  export let name:string;
  export let label='';
  export let size=20;
  $: source=iconSource(name);
</script>
{#if source}<img class="game-icon" class:stat-icon={name.startsWith('stat-')} src={source} alt={label} title={label||undefined} style={`height:${size}px`} draggable="false"/>{/if}
<style>.game-icon{display:inline-block;width:auto;max-width:100%;object-fit:contain;vertical-align:middle;flex-shrink:0}:global(:root[data-theme=light]) .stat-icon{filter:brightness(.3)}</style>
