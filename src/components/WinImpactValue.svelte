<script lang="ts">
  import type {WinImpact} from '../sandbox/insights';
  import type {Job} from '../sandbox/model';
  export let result:WinImpact|undefined;
  export let measurement:Job|undefined=undefined;
  export let disabled=false;
  export let label='Measure';
  export let onMeasure:()=>void;
  export let onInspect:()=>void;
  const points=(n:number)=>`${n>0?'+':''}${(n*100).toFixed(1)} pp`;
  $: running=measurement&&['queued','running'].includes(measurement.phase);
  $: inspect=!!measurement||!!result;
  $: title=inspect?'Open the win-rate comparison.':'Compare complete races with and without this change.';
</script>
<button class="impact" class:positive={!running&&result&&result.low>0} class:negative={!running&&result&&result.high<0} disabled={disabled&&!inspect} {title} aria-label={inspect?`View ${label}: ${running?'measuring':result?points(result.delta):measurement?.phase}`:label} onclick={inspect?onInspect:onMeasure}>
  {#if running}<strong><i class="spinner"></i>Measuring</strong><small>{measurement!.completed} / {measurement!.total} races</small>
  {:else if result}<strong>{points(result.delta)} <span>win rate</span></strong><small>{result.n} pairs · {result.low<=0&&result.high>=0?'Uncertain':'View result →'}</small>
  {:else if measurement}<strong>{measurement.phase}</strong><small>View details →</small>
  {:else}<strong>↗ Measure</strong><small>Win-rate change</small>{/if}
</button>
<style>
  .impact{display:grid;gap:6px;padding:9px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--muted);text-align:left;font-size:12px;min-width:110px;min-height:54px}.impact strong{display:flex;align-items:center;gap:5px;font-size:14px;color:var(--text);font-weight:600;white-space:nowrap}.impact strong span{font-size:10px;font-weight:400;color:var(--muted)}.impact small{font-size:11px;font-weight:400;white-space:nowrap}.impact.positive strong{color:#83d3ac}.impact.negative strong{color:#ed97a2}.impact:hover:enabled{border-color:#8caed8;background:var(--panel-raised)}.impact:disabled{opacity:.5}.spinner{width:11px;height:11px;border:2px solid var(--border);border-top-color:#91b7ee;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
</style>
