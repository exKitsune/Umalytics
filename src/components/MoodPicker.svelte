<script lang="ts">
  import GameIcon from './GameIcon.svelte';
  import {moodNames} from '../sandbox/model';
  export let value=3;
  export let disabled=false;
  export let disabledLabel='Random';
  export let label='Mood';
  export let size=20;
  export let onChange:(value:number)=>void=()=>{};
  let open=false;
  let trigger:HTMLButtonElement;
  function close(event:KeyboardEvent){if(event.key==='Escape'){open=false;event.stopPropagation();trigger.focus();}}
  $: if(disabled)open=false;
</script>
<div class="mood-picker" onfocusout={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))open=false;}}>
  {#if label}<span class="label">{label}</span>{/if}
  <button bind:this={trigger} class="trigger" style:height={`${Math.max(33,size+12)}px`} type="button" aria-label={`Mood: ${disabled?disabledLabel:moodNames[value]}`} aria-expanded={open} aria-haspopup="true" {disabled} onkeydown={close} onclick={()=>open=!open}>{#if disabled}<span>{disabledLabel}</span>{:else}<GameIcon name={`mood-${value}`} {size}/>{/if}<small>▾</small></button>
  {#if open}<div class="choices" role="group" aria-label="Choose mood">{#each [5,4,3,2,1] as rank}<button type="button" aria-label={moodNames[rank]} aria-pressed={value===rank} onkeydown={close} onclick={()=>{value=rank;onChange(rank);open=false;trigger.focus();}}><GameIcon name={`mood-${rank}`} size={Math.max(22,size)}/></button>{/each}</div>{/if}
</div>
<style>
  .mood-picker{position:relative;min-width:0}.label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}.trigger{display:flex;align-items:center;gap:4px;width:100%;height:33px;min-width:0;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 5px;font-size:11px}.trigger span{overflow:hidden;text-overflow:ellipsis}.trigger :global(.game-icon){flex-shrink:0;max-width:calc(100% - 14px)}.trigger small{flex-shrink:0;margin-left:auto;color:var(--muted)}.trigger:disabled{color:var(--muted);opacity:.65}.choices{position:absolute;top:100%;left:0;z-index:30;min-width:120px;width:max-content;padding:4px;background:var(--panel);border:1px solid var(--border);border-radius:7px;box-shadow:0 8px 24px #0005}.choices button{display:flex;justify-content:center;width:100%;align-items:center;gap:8px;border:0;background:transparent;padding:7px;font-size:12px}.choices button:hover,.choices button[aria-pressed=true]{background:var(--accent-soft)}
</style>
