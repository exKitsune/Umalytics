<script lang="ts">
  import { tick } from 'svelte';
  import type { Runner } from '../data/types';
  import { runnerName, type ReferenceData } from '../data/reference';
  import { runnerColors } from '../library';
  export let runners:Runner[],selected:string,reference:ReferenceData|null;
  export let includeSelected=true,extraRunnerIds:string[]=[];
  let button:HTMLButtonElement,popup:HTMLDivElement,left=0,top=0,open=false;
  $: visible=runners.filter(r=>r.id===selected?includeSelected:extraRunnerIds.includes(r.id));
  $: all=visible.length===runners.length&&runners.length>0;
  $: partial=visible.length>0&&!all;
  function toggleAll(checked:boolean){includeSelected=checked;extraRunnerIds=checked?runners.map(r=>r.id):[];}
  function toggle(id:string,checked:boolean){
    if(id===selected)includeSelected=checked;
    extraRunnerIds=checked?[...new Set([...extraRunnerIds,id])]:extraRunnerIds.filter(r=>r!==id);
  }
  async function show(){
    if(open){popup.hidePopover();return;}
    const rect=button.getBoundingClientRect();popup.showPopover();await tick();const bounds=popup.getBoundingClientRect();
    left=Math.max(8,Math.min(innerWidth-bounds.width-8,rect.right-bounds.width));
    top=Math.max(8,Math.min(innerHeight-bounds.height-8,rect.bottom+6));
  }
</script>
<div class="runner-controls">
  <label><input type="checkbox" checked={all} indeterminate={partial} onchange={e=>toggleAll(e.currentTarget.checked)}/> All runners</label>
  <button bind:this={button} aria-haspopup="dialog" aria-expanded={open} onclick={show}>Runners {visible.length}/{runners.length} ▾</button>
</div>
<div bind:this={popup} class="runner-picker" popover="auto" role="dialog" aria-label="Telemetry runners" style={`left:${left}px;top:${top}px`} ontoggle={e=>open=e.newState==='open'}>
  {#each [...runners].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||a.index-b.index) as runner}
    <label class:selected={runner.id===selected}>
      <input type="checkbox" checked={runner.id===selected?includeSelected:extraRunnerIds.includes(runner.id)} onchange={e=>toggle(runner.id,e.currentTarget.checked)}/>
      <span class="swatch" style={`background:${runnerColors[runner.index%runnerColors.length]}`}></span>
      <span>{runner.gate??runner.index+1} {runnerName(reference,runner)}{#if runner.id===selected}<small>Selected</small>{/if}</span>
    </label>
  {/each}
</div>
<style>
  .runner-controls{display:flex;align-items:center;gap:10px}.runner-controls label{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:var(--font-11)}button{padding:6px 9px;font-size:var(--font-11)}
  .runner-picker{position:fixed;margin:0;padding:7px;width:min(300px,calc(100vw - 16px));max-height:65vh;overflow:auto;border:1px solid var(--border);border-radius:7px;background:var(--panel);color:var(--text);box-shadow:0 8px 28px #0006}
  .runner-picker label{display:flex;align-items:center;gap:8px;padding:7px;border-radius:4px;cursor:pointer;font-size:var(--font-12)}.runner-picker label:hover,.runner-picker .selected{background:var(--accent-soft)}.swatch{width:9px;height:9px;border-radius:50%;flex-shrink:0}small{display:block;font-size:var(--font-9);color:var(--muted)}
</style>
