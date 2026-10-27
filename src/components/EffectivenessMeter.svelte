<script lang="ts">
  export let score:number|null;
  export let color='var(--accent)';
  $: segments=Array.from({length:Math.max(1,Math.ceil(score??0))},(_,i)=>Math.max(0,Math.min(1,(score??0)-i)));
</script>
<span class="score-meter" role="img" aria-label={score===null?'Effectiveness unavailable':`${Math.round(score*100)}% effective`} title="100% is one fully effective proc; repeat procs add to the score.">
  {#each segments as fill}<span class="score-segment"><span class="score-fill" style:width={`${fill*100}%`} style:background={color}></span></span>{/each}
</span>
<style>
  .score-meter{display:flex;gap:0;width:100%;min-width:30px;height:7px}
  .score-meter,.score-segment,.score-fill{border-radius:0}
  .score-segment{flex:1;min-width:0;background:var(--border);overflow:hidden}
  .score-segment+.score-segment{border-inline-start:1px solid var(--text)}
  .score-fill{display:block;height:100%}
</style>
