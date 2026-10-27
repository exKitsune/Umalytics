<script lang="ts">
  import {tick} from 'svelte';
  import {outfitUniques} from '../sandbox/editor';
  import {isOutfitReleased} from '../sandbox/outfit-release';
  import type {ReferenceData} from '../data/reference';
  import UmaPortrait from './SimulatorPortrait.svelte';
  export let reference:ReferenceData;
  export let cardId:number;
  export let onSelect:(cardId:number)=>void;
  let open=false,query='',showUnreleased=false,search:HTMLInputElement;
  $: charaId=Math.floor(cardId/100);
  $: choices=Object.entries(reference.metadata.outfits).map(([id,outfit])=>({id:Number(id),outfit,name:reference.metadata.characters[Math.floor(Number(id)/100)]??'Unknown Uma'})).filter(c=>(showUnreleased||isOutfitReleased(c.id))&&outfitUniques(reference,c.id).length>0).filter(c=>`${c.name} ${c.outfit}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
  async function toggle(){open=!open;if(open){query='';await tick();search?.focus();}}
</script>
<div class="outfit-picker">
  <button class="selection" type="button" aria-label="Choose Uma and outfit" aria-expanded={open} onclick={toggle}>
    <UmaPortrait uma={{charaId,cardId}}/>
    <span><strong>{reference.metadata.characters[charaId]??'Choose Uma'}</strong><span>{reference.metadata.outfits[cardId]??'Choose outfit'}</span></span><b class:expanded={open}>⌄</b>
  </button>
  {#if open}<div class="picker-options" role="group" aria-label="Uma and outfit choices">
    <input bind:this={search} type="search" aria-label="Search Uma and outfits" placeholder="Search Uma or outfit…" bind:value={query} onkeydown={e=>{if(e.key==='Escape'){e.stopPropagation();open=false;}}}/>
    <label class="release-filter"><input type="checkbox" aria-label="Show unreleased Umas" bind:checked={showUnreleased}/>Show unreleased</label>
    <div class="choices">{#each choices as c (c.id)}<button class:chosen={c.id===cardId} aria-pressed={c.id===cardId} onclick={()=>{onSelect(c.id);open=false;}}><UmaPortrait uma={{charaId:Math.floor(c.id/100),cardId:c.id}} size={42}/><span><strong>{c.name}</strong><small>{c.outfit}</small></span>{#if c.id===cardId}<b>✓</b>{/if}</button>{/each}{#if !choices.length}<p>No matching outfits.</p>{/if}</div>
  </div>{/if}
</div>
<style>
  .selection,.choices button{justify-content:flex-start}.release-filter{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:12px;color:var(--muted)}.release-filter input{width:auto;accent-color:var(--accent)}
  .outfit-picker{min-width:0}.selection{width:100%;display:flex;align-items:center;gap:15px;text-align:left;background:linear-gradient(110deg,var(--accent-soft),var(--bg));border:1px solid var(--border);border-radius:10px;padding:14px;white-space:normal}.selection>span{display:grid;gap:5px;min-width:0}.selection strong{font-size:20px;color:var(--text)}.selection span span{font-size:12px;color:var(--muted)}.selection>b{margin-left:auto;font-size:25px;color:var(--accent-text);transition:transform .15s}.selection>b.expanded{transform:rotate(180deg)}.picker-options{border:1px solid var(--border);border-radius:9px;padding:10px;margin-top:7px;background:var(--bg)}input{width:100%;padding:10px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px}.choices{max-height:270px;overflow:auto;margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}.choices button{display:flex;align-items:center;gap:10px;text-align:left;padding:8px;background:var(--panel);white-space:normal}.choices span{display:grid;gap:4px;min-width:0}.choices strong{font-size:12px}.choices small{font-size:10px;color:var(--muted)}.choices .chosen{border-color:var(--accent);background:var(--accent-soft)}.choices b{margin-left:auto;color:var(--accent-text)}.choices p{font-size:12px;color:var(--muted)}@media(max-width:600px){.choices{grid-template-columns:1fr}}
</style>
