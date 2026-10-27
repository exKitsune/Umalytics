<script lang="ts">
  import {onMount} from 'svelte';
  import {localDate,upcomingEvents} from '../sandbox/upcoming-events';
  import data from '../sandbox/event-presets.json';
  import type {Setup} from '../sandbox/model';
  import type {ReferenceData} from '../data/reference';
  export let setup:Setup;export let reference:ReferenceData;
  let chosen='',onlyUpcoming=true,today=localDate();
  onMount(()=>{const timer=setInterval(()=>today=localDate(),60000);return()=>clearInterval(timer);});
  $: visibleEvents=Object.fromEntries(['loh','cm'].map(kind=>[kind,onlyUpcoming?upcomingEvents(data.events,kind,today):data.events.filter(p=>p.kind===kind)]));
  $: selected=data.events.find(p=>p.id===chosen&&p.courseId===setup.courseId&&['season','weather','ground','time'].every(key=>p[key as 'season'|'weather'|'ground'|'time']===null||p[key as 'season'|'weather'|'ground'|'time']===setup[key as 'season'|'weather'|'ground'|'time']));
  function apply(id:string){const preset=data.events.find(p=>p.id===id);if(!preset?.courseId||!reference.courses[preset.courseId])return;chosen=id;setup={...setup,courseId:preset.courseId,...Object.fromEntries(['season','weather','ground','time'].filter(key=>preset[key as 'season'|'weather'|'ground'|'time']!==null).map(key=>[key,preset[key as 'season'|'weather'|'ground'|'time']]))};}
</script>
<div class="event-presets">
  <div class="selects">{#each [['loh','League of Heroes'],['cm','CM presets']] as [kind,label]}<select aria-label={label} value={selected?.kind===kind?chosen:''} onchange={e=>apply(e.currentTarget.value)}><option value="">{label}…</option>{#each visibleEvents[kind] as preset}<option value={preset.id} disabled={!preset.courseId||!reference.courses[preset.courseId]} title={preset.note||undefined}>{kind==='cm'?'CM':'LoH'} {preset.number} · {preset.date} · {preset.name}{!preset.courseId?' · Course unavailable':''}</option>{/each}</select>{/each}</div>
  <label class="upcoming" title="Latest started event and the next two dates in each list."><input type="checkbox" bind:checked={onlyUpcoming}/>Only show upcoming events</label>
  {#if selected?.note}<small><a href={selected.source} target="_blank" rel="noreferrer" title="Event conditions source">{selected.note}</a></small>{/if}
</div>
<style>
.upcoming{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer}.upcoming input{margin:0;accent-color:var(--accent)}.event-presets{display:grid;gap:5px;min-width:0}.selects{display:flex;gap:8px;flex-wrap:wrap}select{width:230px;height:36px;max-width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font:inherit;font-size:12px}small{font-size:10px;max-width:450px;color:var(--muted);line-height:1.4}a{color:var(--muted);text-decoration:none}
</style>
