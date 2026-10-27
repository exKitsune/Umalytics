<script lang="ts">
  import {emptySkillFilters,effectFilters,type SkillFilters} from '../sandbox/search';
  import GameIcon from './GameIcon.svelte';
  export let filters:SkillFilters=emptySkillFilters();
  export let showUnreleased=false;
  const groups=[
    {key:'rarity',name:'Rarity',color:'#b6a9d6',options:[['white','White'],['gold','Gold'],['inherited','Inherited'],['evolved','Evolved']]},
    {key:'strategy',name:'Strategy',color:'#79d5a1',options:[[1,'Front'],[2,'Pace'],[3,'Late'],[4,'End']]},
    {key:'distance',name:'Distance',color:'#7eacee',options:[[1,'Sprint'],[2,'Mile'],[3,'Medium'],[4,'Long']]},
    {key:'surface',name:'Surface',color:'#bfdb71',options:[[1,'Turf'],[2,'Dirt']]},
    {key:'phase',name:'Phase',color:'#edaa72',options:[['opening','Opening'],['middle','Middle'],['late','Late'],['spurt','Spurt'],['corner','F. corner'],['straight','F. straight']]},
  ] as const;
  function selected(key:keyof SkillFilters,value:string|number){return (filters[key] as (number|string)[]).includes(value);}
  function toggle(key:keyof SkillFilters,value:string|number){const current=filters[key] as (string|number)[];filters={...filters,[key]:selected(key,value)?current.filter(v=>v!==value):[...current,value]};}
  $: count=Object.values(filters).reduce((n,values)=>n+values.length,0);
</script>
<div class="filters">
  <div class="groups">{#each groups as group}<fieldset style={`--group:${group.color}`}><legend>{group.name}</legend><div>{#each group.options as [id,name]}<button type="button" class:selected={selected(group.key,id)} aria-pressed={selected(group.key,id)} onclick={()=>toggle(group.key,id)}>{name}</button>{/each}</div></fieldset>{/each}</div>
  <fieldset><legend>Effect</legend><div class="effects">{#each effectFilters as effect}<button type="button" class:selected={selected('effect',effect.id)} aria-label={`Filter: ${effect.name}`} title={effect.name} aria-pressed={selected('effect',effect.id)} onclick={()=>toggle('effect',effect.id)}><GameIcon name={`skill-${effect.icon}`} size={26}/></button>{/each}</div></fieldset>
  <div class="bottom"><label><input type="checkbox" bind:checked={showUnreleased}/>Show unreleased</label>{#if count}<button onclick={()=>filters=emptySkillFilters()}>Clear {count} filters</button>{/if}</div>
</div>
<style>
.filters{display:grid;gap:12px;padding:13px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}.groups{display:flex;flex-wrap:wrap;gap:12px 18px}fieldset{padding:0;margin:0;border:0;min-width:0}legend{color:var(--group,var(--muted));text-transform:uppercase;font-size:10px;font-weight:600;letter-spacing:.07em;margin-bottom:6px}fieldset>div{display:flex;gap:4px;flex-wrap:wrap}button{font-size:11px;padding:4px 7px;background:var(--panel);color:var(--muted);border:1px solid var(--border);border-radius:5px}button.selected{background:var(--accent-soft);border-color:var(--accent);color:var(--text)}.effects button{padding:3px;line-height:1;display:grid;place-items:center}.bottom{display:flex;justify-content:space-between;align-items:center;gap:8px}.bottom label{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}input{accent-color:var(--accent)}
</style>
