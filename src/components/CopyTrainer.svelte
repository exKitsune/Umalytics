<script lang="ts">
export let value:string|null|undefined;let state='';let timer:ReturnType<typeof setTimeout>|undefined;
import {onDestroy} from 'svelte';onDestroy(()=>clearTimeout(timer));
async function copy(){if(!value)return;try{await navigator.clipboard.writeText(value);state='Copied';}catch{state='Select the ID to copy';}clearTimeout(timer);timer=setTimeout(()=>state='',2000);}
</script>
{#if value}<span class="trainer-copy"><code>{value.replace(/(\d)(?=(\d{3})+$)/g,'$1 ')}</code><button type="button" onclick={copy} title="Copy trainer ID" aria-label="Copy trainer ID">{state==='Copied'?'✓':'⧉'}</button>{#if state}<small role="status">{state}</small>{/if}</span>{/if}
<style>.trainer-copy{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:var(--font-11)}code{font:inherit;user-select:all;font-variant-numeric:tabular-nums}button{padding:3px 6px;min-width:26px;border:0;background:transparent;font-size:var(--font-15)}small{font-size:var(--font-10)}</style>
