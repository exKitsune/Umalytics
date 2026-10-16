<script lang="ts">
  import type { AnalysisClient,AnalysisState } from '../analysis/client';
  import type { CacheStatus,CachePolicy } from '../analysis/store';
  export let client:AnalysisClient,status:CacheStatus,state:AnalysisState;
  export let onError:(message:string)=>void;
  let working=false;
  async function change(patch:Partial<CachePolicy>){working=true;try{await client.policy({...status.policy,...patch});}catch(e){onError(String(e));}finally{working=false;}}
  async function clear(){working=true;try{await client.purge();}catch(e){onError(String(e));}finally{working=false;}}
</script>
<section>
  <h3>Analysis cache</h3>
  <p>{status.entries.length} races · {(status.bytes/1024/1024).toFixed(1)} MB saved</p>
  <label class="setting-row">Limit <select aria-label="Analysis cache limit" disabled={working} value={status.policy.mode} onchange={e=>change({mode:e.currentTarget.value as CachePolicy['mode']})}><option value="unlimited">Unlimited</option><option value="races">Newest races</option><option value="size">Disk size</option></select></label>
  {#if status.policy.mode!=='unlimited'}<label class="setting-row">{status.policy.mode==='races'?'Number of races':'Maximum MB'}<input aria-label="Cache limit value" type="number" min="1" max="1000000" step="1" value={status.policy.value} disabled={working} onchange={e=>{const value=Number(e.currentTarget.value);if(Number.isInteger(value)&&value>0&&value<=1000000)change({value});}}/></label>{/if}
  <label class="setting-row">Prepare saved races in background <input type="checkbox" checked={status.policy.background} disabled={working} onchange={e=>change({background:e.currentTarget.checked})}/></label>
  <p>{state.busy?`${state.message}${state.total?` ${state.done}/${state.total}`:''}`:status.policy.background?'Ready':'Background preparation paused'}</p>
  <button disabled={working||state.busy&&!state.background} onclick={clear}>Clear analysis cache</button>
  <p class="note">Clearing pauses background preparation. Races and tags stay saved. Web storage is managed by your browser.</p>
</section>
<style>section{padding:22px 0;border-bottom:1px solid var(--border)}h3{font-size:var(--font-13)}p{font-size:var(--font-11);color:var(--muted);line-height:1.5}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;font-size:var(--font-12)}input[type=number]{width:120px}.note{margin-top:12px}</style>
