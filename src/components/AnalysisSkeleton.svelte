<script lang="ts">
  import type { Race } from '../data/types';
  import RaceConditions from './RaceConditions.svelte';
  export let part:'workspace'|'runner'|'details'='workspace';
  export let title='';
  export let conditions:Race['conditions']=undefined;
  export let runners=9;
  export let message='Preparing race…';
</script>

{#snippet runnerPlaceholder()}
  <div class="panel skeleton-runner" aria-hidden="true">
    <div class="runner-top"><span class="bone caption"></span><div class="identity"><span class="bone portrait"></span><div><span class="bone name"></span><span class="bone caption"></span></div></div><div class="actions"><span class="bone"></span><span class="bone"></span></div></div>
    <div class="numbers">{#each Array(4) as _}<div><span class="bone caption"></span><span class="bone number"></span></div>{/each}</div>
    <div class="build">{#each Array(5) as _}<span class="bone number"></span>{/each}</div>
    <div class="facts"><span class="bone"></span><span class="bone"></span><span class="bone"></span></div>
    <div class="skeleton-heading"><span class="bone caption"></span></div>
    <div class="skills">{#each Array(8) as _}<span class="bone skill"></span>{/each}</div>
  </div>
{/snippet}

{#snippet detailPlaceholder()}
  <div class="panel skeleton-telemetry" aria-hidden="true"><div class="skeleton-heading"><span class="bone name"></span><span class="bone caption"></span></div><div class="plot"><span class="bone"></span><span class="bone"></span><span class="bone"></span><span class="bone"></span></div></div>
{/snippet}

{#if part==='workspace'}
  <div class="analysis-layout analysis-skeleton" aria-busy="true">
    <div class="analysis-main">
      <div class="race-heading"><div><div class="eyebrow"><span class="bone caption"></span></div><h1>{title}</h1><RaceConditions {conditions}/><div class="course-line bone"></div></div><div class="bone export"></div></div>
      <div class="tag-line" aria-hidden="true"><span class="bone caption"></span><span class="bone tag-input"></span></div>
      <div class="panel skeleton-results" aria-hidden="true"><div class="skeleton-heading"><strong>Race results</strong><span class="bone caption"></span></div><div class="result-body" style={`height:${Math.min(560,36+Math.max(1,runners)*96)}px`}><div class="result-head">{#each Array(6) as _}<span class="bone"></span>{/each}</div>{#each Array(Math.min(6,Math.max(1,runners))) as _}<div class="result-row"><span class="bone portrait"></span><span class="bone name"></span>{#each Array(4) as _}<span class="bone"></span>{/each}</div>{/each}</div></div>
      <div class="panel skeleton-replay" aria-hidden="true"><div class="skeleton-heading"><strong>Race replay</strong><span class="bone caption"></span></div><div class="replay-controls"><span class="bone name"></span><span class="bone name"></span><span class="bone caption"></span></div><div class="marker-controls"><span class="bone name"></span><span class="bone name"></span></div><div class="replay-stage"><span class="bone track"></span><span class="bone minimap"></span></div><div class="transport-placeholder"><span class="bone play"></span><span class="bone scrubber"></span><span class="bone caption"></span></div></div>
      {@render detailPlaceholder()}
    </div>
    <div class="analysis-side">{@render runnerPlaceholder()}</div>
  </div>
{:else if part==='runner'}
  <div aria-busy="true">{@render runnerPlaceholder()}</div>
{:else}
  <div aria-busy="true">{@render detailPlaceholder()}</div>
{/if}
<span class="loading-status" role="status">{message}</span>

<style>
  .bone{display:block;flex:none;background:color-mix(in srgb,var(--muted) 13%,var(--panel));border-radius:4px;height:12px;width:60px;animation:breathe 1.8s ease-in-out infinite}.caption{width:90px;height:10px}.name{width:140px;height:14px;max-width:100%}.portrait{width:38px;height:38px;border-radius:7px}.number{height:26px;width:65px;max-width:100%}.skeleton-heading{height:46px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px;border-bottom:1px solid var(--border);font-size:var(--font-12)}.skeleton-heading strong{font-weight:600}.race-heading h1{margin-top:10px}.course-line{height:14px;width:170px;margin-top:8px}.export{width:110px;height:31px}.tag-line{display:flex;align-items:center;gap:8px;height:33px;margin-top:-8px}.tag-line .caption{width:25px}.tag-input{width:min(450px,80%);height:31px}.result-body{overflow:hidden}.result-head,.result-row{display:flex;align-items:center;gap:25px;padding:10px 14px;border-bottom:1px solid var(--border);min-width:650px}.result-head{height:36px}.result-row{height:96px}.result-row .name{width:140px}.skeleton-replay{container-type:inline-size}.replay-controls{display:flex;flex-wrap:wrap;align-items:center;gap:18px;padding:12px 18px;min-height:55px;border-bottom:1px solid var(--border)}.marker-controls{display:flex;align-items:center;gap:14px;min-height:35px;padding:8px 18px;border-bottom:1px solid var(--border)}.replay-stage{position:relative;height:clamp(728px,65cqw,884px);overflow:hidden}.track{position:absolute;left:0;top:42%;width:100%;height:140px;transform:rotate(-12deg);opacity:.5}.minimap{position:absolute;right:12px;top:38px;width:210px;height:100px;border:1px solid var(--border);background:var(--panel-raised);border-radius:8px}.transport-placeholder{display:flex;align-items:center;gap:12px;padding:14px 18px;border-top:1px solid var(--border)}.play{width:38px;height:34px}.scrubber{flex:1;height:5px}.runner-top{padding:13px;border-bottom:1px solid var(--border)}.identity{display:flex;gap:10px;align-items:center;margin-top:12px}.identity .portrait{width:48px;height:48px}.identity .name{margin-bottom:10px}.actions{display:flex;gap:6px;margin-top:10px}.actions .bone{flex:1;height:30px}.numbers{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 8px;padding:18px 14px}.numbers .caption{margin-bottom:10px;width:50px}.build{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:20px 13px;background:var(--bg);border-block:1px solid var(--border)}.facts{display:flex;gap:8px;padding:24px 14px}.facts .bone{flex:1;min-width:0}.skills{padding:12px;display:grid;gap:8px}.skill{height:42px;width:100%}.plot{height:340px;padding:30px 20px;display:flex;flex-direction:column;justify-content:space-between}.plot .bone{width:100%;height:1px}.loading-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}@keyframes breathe{50%{opacity:.45}}@media(prefers-reduced-motion:reduce){.bone{animation:none}}
</style>
