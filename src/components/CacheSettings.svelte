<script lang="ts">
  export let serviceStatus:{running:boolean;checked:number;total:number;failed:number}|undefined=undefined;
  import type {StorageOptimizationStatus} from '../api';
  export let storageStatus:StorageOptimizationStatus|undefined=undefined;
  import type { AnalysisClient,AnalysisState } from '../analysis/client';
  import type { CacheStatus,CachePolicy } from '../analysis/store';
  export let client:AnalysisClient,status:CacheStatus,state:AnalysisState;
  export let onError:(message:string)=>void;
  let working=false;
  let refreshedOptimization=false;
  $: if(storageStatus?.phase==='complete'&&!refreshedOptimization){refreshedOptimization=true;void client.refresh().catch(()=>{});}
  async function change(patch:Partial<CachePolicy>){working=true;try{await client.policy({...status.policy,...patch});}catch(e){onError(String(e));}finally{working=false;}}
  async function clear(){working=true;try{await client.purge();}catch(e){onError(String(e));}finally{working=false;}}
</script>
<section>
  <h3>Analysis cache</h3>
  <p>{new Set(status.entries.map(entry=>entry.raceId)).size} saved analyses · {(status.bytes/1024/1024).toFixed(1)} MB saved</p>
  {#if storageStatus&&['pending','waiting','running','failed'].includes(storageStatus.phase)}
    <p class="storage-progress" role="status">
      {#if storageStatus.phase==='running'}<span class="storage-spinner" aria-hidden="true"></span>{storageStatus.stage||'Optimizing storage'}{#if storageStatus.total>0} · {storageStatus.done} / {storageStatus.total}{/if}
      {:else if storageStatus.phase==='waiting'}Storage optimization paused while the app is busy.
      {:else if storageStatus.phase==='failed'}Storage optimization will retry automatically.
      {:else}Storage optimization queued.{/if}
    </p>
  {:else if storageStatus?.phase==='complete'&&storageStatus.reclaimedBytes>=1024*1024}
    <p role="status">Storage optimized · {(storageStatus.reclaimedBytes/1024/1024).toFixed(1)} MB reclaimed</p>
  {/if}
  <label class="setting-row">Limit <select aria-label="Analysis cache limit" disabled={working} value={status.policy.mode} onchange={e=>change({mode:e.currentTarget.value as CachePolicy['mode']})}><option value="unlimited">Unlimited</option><option value="races">Most recent analyses</option><option value="size">Disk size</option></select></label>
  {#if status.policy.mode!=='unlimited'}<label class="setting-row">{status.policy.mode==='races'?'Number of races':'Maximum MB'}<input aria-label="Cache limit value" type="number" min="1" max="1000000" step="1" value={status.policy.value} disabled={working} onchange={e=>{const value=Number(e.currentTarget.value);if(Number.isInteger(value)&&value>0&&value<=1000000)change({value});}}/></label>{/if}
  <p>Saved analysis is reused when compatible. The service analyzes new captures and older races newest first, including while the app is in the tray. Opening a race takes priority over the remaining queue.</p>
  <label class="setting-row">Analyze recent races in the background <input type="checkbox" checked={status.policy.background} disabled={working} onchange={e=>change({background:e.currentTarget.checked})}/></label>
  {#if serviceStatus&&status.policy.background}<p role="status">{serviceStatus.running?'Analyzing races in the service':'Background analysis ready'} · {serviceStatus.checked} / {serviceStatus.total} checked{#if serviceStatus.failed} · {serviceStatus.failed} waiting to retry{/if}</p>{/if}
  {#if state.busy}<p role="status">{state.message}</p>{/if}
  <button disabled={working||state.busy&&!state.background} onclick={clear}>Clear analysis cache</button>
  <p class="note">Races and tags stay saved when clearing the cache. Web storage is managed by your browser.</p>
</section>
<style>section{padding:22px 0;border-bottom:1px solid var(--border)}h3{font-size:var(--font-13)}p{font-size:var(--font-11);color:var(--muted);line-height:1.5}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;font-size:var(--font-12)}input[type=number]{width:120px}.note{margin-top:12px}.storage-progress{display:flex;align-items:center;gap:7px}.storage-spinner{width:10px;height:10px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:storage-spin .8s linear infinite}@keyframes storage-spin{to{transform:rotate(360deg)}}</style>
