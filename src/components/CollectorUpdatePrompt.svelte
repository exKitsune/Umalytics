<script lang="ts">
  import type {UpdateStatus} from '../api';
  export let status:UpdateStatus|undefined;
  $: waiting=status?.phase==='waiting-for-game'&&status.collectorChanged!==false&&status.gameActive;
  let dismissed=false;
  $: reopen=!!status?.reopenGameRequired;
  $: if(!reopen) dismissed=false;
  function focus(node:HTMLElement){const previous=document.activeElement as HTMLElement|null;node.focus();return{destroy(){previous?.focus();}};}
</script>
{#if waiting}
  <div class="collector-update-backdrop">
    <div class="collector-update-dialog" use:focus role="alertdialog" aria-modal="true" aria-labelledby="collector-update-title" tabindex="-1" onkeydown={e=>{if(e.key==='Tab'||e.key==='Escape')e.preventDefault();}}>
      <span class="collector-update-symbol" aria-hidden="true">↻</span>
      <h1 id="collector-update-title">Close the game to update the collector</h1>
      <p>Close the game when you’re ready. Umalytics will update automatically.</p>
      <span class="tag">Waiting for the game to close</span>
    </div>
  </div>
{:else if reopen&&!dismissed}
  <div class="collector-update-notice" role="status">
    <span>Collector update not confirmed. You can keep using the app.</span>
    <button type="button" onclick={()=>dismissed=true}>Dismiss</button>
  </div>
{/if}
<style>
  .collector-update-backdrop{position:fixed;inset:0;z-index:10000;background:#080d17c9;display:grid;place-items:center;padding:2rem;backdrop-filter:blur(5px)}
  .collector-update-dialog{width:min(650px,100%);padding:3rem;text-align:center;border:1px solid var(--border,#354454);border-radius:18px;background:var(--panel,#161f2b);box-shadow:0 24px 90px #0009;outline:none}
  .collector-update-symbol{font-size:3.5rem;color:var(--accent,#6bd4ac)}h1{font-size:1.7rem;margin:1rem 0}p{font-size:1.1rem;line-height:1.6;margin:0 0 1.8rem;color:var(--muted,#b5c2ce)}
  .collector-update-notice{position:fixed;bottom:1rem;right:1rem;z-index:10000;display:flex;gap:1rem;align-items:center;max-width:min(550px,calc(100vw - 2rem));padding:1rem;border:1px solid var(--border,#354454);border-radius:10px;background:var(--panel,#161f2b);box-shadow:0 8px 30px #0006}
</style>
