<script lang="ts">
  export let place:number;
  export let size=18;
  const metals:{[place:number]:{name:string;fill:string}}={1:{name:'Gold',fill:'#e8c547'},2:{name:'Silver',fill:'#c5cdd4'},3:{name:'Bronze',fill:'#c4844a'}};
  $: metal=metals[place];
</script>
{#if metal}
  <span class="podium-trophy" title={`${metal.name} trophy`} aria-label={`${place}${place===1?'st':place===2?'nd':'rd'} · ${metal.name.toLowerCase()} trophy`}>
    <svg viewBox="0 0 20 22" width={size} height={size*22/20} aria-hidden="true">
      <path fill={metal.fill} d="M4.2 2.4h11.6v2.4c0 .6-.2 2.6-1.5 4.3-1.2 1.7-2.9 2.6-4.3 2.6s-3.1-.9-4.3-2.6C4.4 7.4 4.2 5.4 4.2 4.8V2.4Z"/>
      <path fill={metal.fill} d="M4.2 3.6H2.4c-.7 0-1.3.6-1.3 1.3 0 2.1 1.3 3.8 3.1 4.3"/>
      <path fill={metal.fill} d="M15.8 3.6h1.8c.7 0 1.3.6 1.3 1.3 0 2.1-1.3 3.8-3.1 4.3"/>
      <path fill={metal.fill} d="M9.1 11.6h1.8v3.6H9.1z"/>
      <path fill={metal.fill} d="M6.4 16.2h7.2v1.2H6.4z"/>
      <path fill={metal.fill} d="M4.8 18h10.4v2.2H4.8z"/>
    </svg>
  </span>
{/if}
<style>
.podium-trophy{display:inline-flex;align-items:center;justify-content:center;width:15px;height:16px;line-height:0;flex:none;overflow:hidden;vertical-align:middle}
.podium-trophy svg{display:block;width:100%;height:100%}
</style>
