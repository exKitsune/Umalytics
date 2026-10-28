<script lang="ts">
  import type {UpdateStatus} from '../api';
  export let status:UpdateStatus|undefined;
  $: waiting=status?.phase==='waiting-for-game'&&status.collectorChanged!==false&&status.gameActive;
  $: reopen=!!status?.reopenGameRequired;
  function focus(node:HTMLElement){const previous=document.activeElement as HTMLElement|null;node.focus();return{destroy(){previous?.focus();}};}
</script>
{#if waiting||reopen}
  <div class="collector-update-backdrop">
    <div class="collector-update-dialog" use:focus role="alertdialog" aria-modal="true" aria-labelledby="collector-update-title" tabindex="-1" onkeydown={e=>{if(e.key==='Tab'||e.key==='Escape')e.preventDefault();}}>
      <span class="collector-update-symbol" aria-hidden="true">↻</span>
      <h1 id="collector-update-title">{waiting?'Close the game to update the collector':'Confirming collector update'}</h1>
      <p>{waiting?'Close the game when you’re ready. Umalytics will update automatically.':'Checking the updated collector. This message will close automatically.'}</p>
      {#if waiting}<span class="tag">Waiting for the game to close</span>{:else}<span class="tag">Verifying collector…</span>{/if}
    </div>
  </div>
{/if}
<style>
  .collector-update-backdrop{position:fixed;inset:0;z-index:10000;background:#080d17c9;display:grid;place-items:center;padding:2rem;backdrop-filter:blur(5px)}
  .collector-update-dialog{width:min(650px,100%);padding:3rem;text-align:center;border:1px solid var(--border,#354454);border-radius:18px;background:var(--panel,#161f2b);box-shadow:0 24px 90px #0009;outline:none}
  .collector-update-symbol{font-size:3.5rem;color:var(--accent,#6bd4ac)}h1{font-size:1.7rem;margin:1rem 0}p{font-size:1.1rem;line-height:1.6;margin:0 0 1.8rem;color:var(--muted,#b5c2ce)}
</style>
