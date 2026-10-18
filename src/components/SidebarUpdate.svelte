<script lang="ts">
  import type { UpdateStatus } from '../api';
  export let status:UpdateStatus;
  export let disabled=false;
  export let onInstall:()=>void;
  $: pending=['downloading','restarting','waiting-for-game'].includes(status.phase);
  $: label=status.phase==='waiting-for-game'?'Update ready':status.phase==='downloading'?'Downloading…':status.phase==='restarting'?'Restarting…':'Update available';
  $: detail=status.phase==='waiting-for-game'?'Installs after the game closes':status.phase==='downloading'?'Preparing the new version':status.phase==='restarting'?'Umalytics will reopen':`Version ${status.availableVersion}`;
</script>
<div class="sidebar-update">
  <button class:pending disabled={disabled||pending||status.canInstall===false} onclick={onInstall} title={detail} aria-label={`${label} · ${detail}`}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/></svg>
    <span><strong>{label}</strong><small>{detail}</small></span>
    {#if !pending}<span class="arrow" aria-hidden="true">↗</span>{/if}
  </button>
</div>
<style>
  .sidebar-update{margin-top:12px}
  button{width:100%;padding:10px;gap:9px;text-align:left;white-space:normal;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));background:var(--accent-soft);color:var(--accent-text,var(--accent));border-radius:7px;justify-content:flex-start}
  button:hover:not(:disabled){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,var(--sidebar))}
  button.pending:disabled{opacity:1;cursor:default}svg{width:19px;height:19px;flex:none}span{min-width:0}strong{display:block;font-size:var(--font-12);font-weight:600}small{display:block;font-size:var(--font-9);color:var(--muted);margin-top:3px;line-height:1.4;overflow-wrap:anywhere}.arrow{margin-left:auto;font-size:var(--font-16);flex:none}
</style>
