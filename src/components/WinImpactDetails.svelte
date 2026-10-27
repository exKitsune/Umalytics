<script lang="ts">
  import {dismissDialog} from '../ui/dismiss-dialog';
  import {impactTarget,targetKey,type WinImpact,type ImpactTarget} from '../sandbox/insights';
  import type {Job} from '../sandbox/model';
  import WinImpactConfidence from './WinImpactConfidence.svelte';
  import {meanConfidence} from '../sandbox/mean-confidence';
  $: timeInterval=result?meanConfidence(result.timeSaved):null;
  export let result:WinImpact|undefined;
  export let measurement:Job|undefined;
  export let target:ImpactTarget;
  export let title:string;
  export let runnerName:string;
  export let count:number;
  export let starting=false;
  export let disabled=false;
  export let onMeasure:()=>void;
  export let onClose:()=>void;
  $: running=starting||!!measurement&&['queued','running'].includes(measurement.phase);
  $: skill=target.kind==='skill';
  $: before=skill?'With skill':'Original stats';
  $: baseCompleted=measurement?.runs.filter(r=>(r.variantIndex??0)===0).length??0;
  $: measuredBuild=measurement?.setup.participants.find(p=>p.id===measurement?.setup.variations?.participantId)?.uma;
  $: measuredIndex=measuredBuild?(measurement?.setup.variations?.builds.findIndex(build=>{const t=impactTarget(measuredBuild!,build);return t&&targetKey(t)===targetKey(target);})??-1)+1:0;
  $: changedCompleted=measurement?.runs.filter(r=>measuredIndex>0&&r.variantIndex===measuredIndex).length??0;
  $: after=skill?'Without skill':'Changed stats';
  const rate=(n:number)=>`${(n*100).toFixed(1)}%`;
  const points=(n:number)=>`${n>0?'+':''}${(n*100).toFixed(1)}`;
  function show(node:HTMLDialogElement){node.showModal();return {destroy:()=>node.close()};}
</script>
<dialog use:dismissDialog use:show onclose={onClose} aria-label={`${runnerName} · ${title} win impact`}>
  <header><div><span class="eyebrow">WIN IMPACT · {runnerName}</span><h2>{title}</h2></div><button class="close" aria-label="Close win impact" onclick={onClose}>×</button></header>
  <p class="intro">{skill?'How often does this Uma win with this skill, compared with removing it?':'How often does this Uma win after this stat change, compared with the original stats?'}</p>
  {#if running}<div class="progress" role="status"><div><strong>{starting?'Starting measurement…':'Measuring win impact…'}</strong><span>{starting?0:measurement?.completed??0} / {starting?count*2:measurement?.total??count*2} races</span></div><progress max={measurement?.total??count*2} value={starting?0:measurement?.completed??0}></progress><div class="version-progress"><span>{before}: {baseCompleted} / {measurement?.setup.count??count}</span><span>{after}: {changedCompleted} / {measurement?.setup.count??count}</span></div><small>{result?`${result.n} unique pairs in total, including previous runs.`:'The comparison appears as matching races finish.'}</small></div>{/if}
  {#if result}
    <div class="analysis-layout"><div class="outcomes">
    <div class="comparison">{#each [{label:before,rate:result.baseRate,color:'#91b7ee'},{label:after,rate:result.changedRate,color:'#f0bb72'}] as version}<div style={`--version:${version.color}`}><span>{version.label}</span><strong>{rate(version.rate)}<small>win rate</small></strong><div class="rate-track"><b style:width={`${version.rate*100}%`}></b></div><small>{Math.round(version.rate*result.n)} wins / {result.n} races</small></div>{/each}</div>
    <div class="difference" class:positive={result.low>0} class:negative={result.high<0}><span>{skill?'Skill contribution':'Change in win rate'}{running?' · so far':''}</span><strong>{points(result.delta)} <small>percentage points</small></strong><p>{before} {rate(result.baseRate)} {skill?'−':'→'} {after.toLowerCase()} {rate(result.changedRate)}</p></div>
    <div class="secondary"><span title="Mean paired time saved, including races where the winner stayed the same. The approximate 95% interval describes sampling uncertainty; it does not validate the engine.">Finish-time gain <b>{result.timeSaved.mean===null?'—':`${result.timeSaved.mean.toFixed(3)} s`}</b>{#if timeInterval}<small class="time-ci">95% CI: {timeInterval.low.toFixed(3)} to {timeInterval.high.toFixed(3)} s · {result.timeSaved.n} pairs</small>{/if}</span><span title={skill?"Top-three finish rate with this skill minus the rate without it, in percentage points.":"Top-three finish rate with changed stats minus the original rate, in percentage points."}>Top-3 rate change <b>{points(result.podiumDelta)} pp</b></span></div>
    <div class="pair-counts"><span><b>{result.gained}</b> gained wins</span><span><b>{result.lost}</b> lost wins</span><span><b>{result.n-result.gained-result.lost}</b> unchanged win outcomes</span></div>
    </div><div class="outcomes"><WinImpactConfidence {result} {running}/>

    </div></div>
    <p class="method">Win impact includes activation reliability. Each pair compares one race with and without the change.</p>
  {:else if !running}<p class="empty">{measurement?'No complete race pairs are available for this measurement.':'No measurement is available yet.'}</p>{/if}
  {#if measurement&&!running&&measurement.phase!=='complete'}<p class="interrupted">Measurement {measurement.phase}.{result?' The comparison uses only the completed pairs.':''}</p>{/if}
  {#if measurement?.error}<p role="alert">{measurement.error}</p>{/if}
  <footer><span>{result?`${result.n} unique pairs · ${result.n*2} compared runs`:''}</span><label>Pairs to add<input aria-label="Additional skill pairs" type="number" min="5" max="500" step="5" bind:value={count}/></label><button class="primary" disabled={disabled||running} onclick={onMeasure}>Add {count} pairs · {count*2} races</button></footer>
</dialog>
<style>
  .time-ci{display:block;margin-top:6px;color:var(--text);font-size:12px}
  dialog{width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:26px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 90px #0007}dialog::backdrop{background:#091018a8}header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}h2{font-size:24px;margin:8px 0 0}.eyebrow{font-size:11px;color:#91b7ee;letter-spacing:.08em}.close{border:0;background:transparent;font-size:25px;line-height:1;padding:0 5px}.intro{font-size:14px;line-height:1.6;color:var(--muted);margin:16px 0 20px}.analysis-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start}.outcomes{min-width:0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:14px}.comparison>div{padding:14px;background:var(--bg);border:1px solid var(--border);border-top:3px solid var(--version);border-radius:8px;display:grid;gap:9px}.comparison>div>span{font-size:14px}.comparison strong{font-size:26px;font-weight:600;color:var(--version)}.comparison strong small{font-size:12px;font-weight:400;margin-left:7px;color:var(--muted)}.comparison>div>small{font-size:13px;color:var(--muted)}.rate-track{height:8px;background:color-mix(in srgb,var(--text) 8%,transparent);border-radius:4px;overflow:hidden}.rate-track b{display:block;height:100%;background:var(--version);transition:width .2s}.difference{margin:14px 0;padding:14px;border-radius:8px;background:var(--panel-raised);border:1px solid var(--border);display:grid;gap:8px}.difference>span{font-size:13px;color:var(--muted)}.difference strong{font-size:32px;font-weight:600}.difference strong small{font-size:14px;font-weight:400}.difference p{font-size:12px;margin:0;color:var(--muted)}.difference.positive strong{color:#83d3ac}.difference.negative strong{color:#ed97a2}.method{font-size:13px;line-height:1.6;color:var(--muted);margin:7px 0}.secondary{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:15px;font-size:12px;color:var(--muted)}.secondary b{color:var(--text);margin-left:5px}footer label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}footer input{width:65px;padding:6px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text)}.pair-counts{display:flex;flex-wrap:wrap;gap:16px;padding:16px 0;font-size:12px;color:var(--muted)}.pair-counts b{color:var(--text);font-size:16px;margin-right:3px}.method{font-size:12px}.progress{padding:15px;margin-bottom:18px;border:1px solid #91b7ee66;border-radius:8px;background:var(--bg)}.progress>div{display:flex;justify-content:space-between;gap:10px;font-size:13px}.progress progress{display:block;width:100%;height:6px;margin:12px 0;accent-color:#91b7ee}.progress .version-progress{font-size:12px;color:var(--muted);margin-bottom:10px}.progress small{color:var(--muted);font-size:12px}footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid var(--border)}footer>span{font-size:12px;color:var(--muted)}footer button{padding:10px 14px;font-size:13px}.interrupted{color:#f0bb72;font-size:13px}.empty{font-size:14px;color:var(--muted)}@media(max-width:800px){.analysis-layout{grid-template-columns:minmax(0,1fr);gap:8px}}@media(max-width:500px){dialog{padding:18px}.comparison{gap:8px}.comparison>div{padding:12px}.comparison strong{font-size:25px}.comparison strong small{display:block;margin:4px 0 0}}
</style>
