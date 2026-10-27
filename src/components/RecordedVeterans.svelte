<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../api';
  import type {ReferenceData} from '../data/reference';
  import {formatRaceTime} from '../data/race-time';
  import {scenarioName} from '../data/career-display';
  import {totalSkillCost} from '../data/skill-cost';
  import {statColors} from '../sandbox/stat-colors';
  import {veteranRows,veteranBuild,filterVeterans,emptyVeteranFilters,veteranMarkers,veteranFilterCount,sparkColor,aptitudeTypes,type VeteranSnapshot} from '../sandbox/veterans';
  import type {UmaBuild} from '../sandbox/model';
  import UmaPortrait from './SimulatorPortrait.svelte';
  import RatingBadge from './RatingBadge.svelte';
  import StarRating from './StarRating.svelte';
  import CareerModal from './CareerModal.svelte';
  import LibraryIcon from './LibraryIcon.svelte';
  import VeteranFilters from './VeteranFilters.svelte';
  export let reference:ReferenceData;
  export let picker=false;
  export let onChoose:(uma:UmaBuild)=>void;
  export let onCopy:(uma:UmaBuild)=>Promise<void>;
  export let onCount:(count:number)=>void=()=>{};
  let snapshot:VeteranSnapshot={schemaVersion:1,capturedAt:null,count:0,veterans:[]};
  let loading=true,working=false,error='',selected='';
  let filter=emptyVeteranFilters(),filtersOpen=false;
  let copied=new Set<string>(),copying='',stopped=false;
  const stats=['speed','stamina','power','guts','wisdom'] as const;
  const labels=['Speed','Stamina','Power','Guts','Wit'];
  $: rows=veteranRows(snapshot,reference);
  $: characters=[...new Map(rows.map(r=>[r.runner.charaId!,r.name])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  $: shown=filterVeterans(rows,filter);
  $: sparkOptions=[...new Map(rows.flatMap(r=>[...r.sparks,...r.originSparks]).map(f=>[f.group,f])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  $: aptitudeSort=aptitudeTypes.find(([name])=>name.toLowerCase()===filter.sort);
  $: filterCount=veteranFilterCount(filter);
  function sortChanged(){filter.sortDetail='';filter.direction=['name','memo','favorites'].includes(filter.sort)?'asc':'desc';}
  function clearFilters(){filter={...emptyVeteranFilters(),sort:filter.sort,direction:filter.direction,sortDetail:filter.sortDetail,sortParents:filter.sortParents};}
  $: chosen=rows.find(r=>r.id===selected);
  async function refresh(){
    if(working||stopped)return;working=true;
    try{
      const next=await api<VeteranSnapshot>(`veterans${snapshot.capturedAt?`?after=${encodeURIComponent(snapshot.capturedAt)}`:''}`);
      if(stopped)return;
      if(!next.unchanged)snapshot=next;
      onCount(next.count);error='';
    }catch(e){if(!stopped)error=String(e);}finally{loading=false;working=false;}
  }
  async function copy(row:typeof rows[number]){
    copying=row.id;error='';
    try{await onCopy(veteranBuild(row));copied=new Set([...copied,row.id]);}catch(e){error=String(e);}finally{copying='';}
  }
  onMount(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);return()=>{stopped=true;clearInterval(timer);};});
</script>
<section class="recorded-veterans" aria-label="Recorded Veterans" aria-busy={loading}>
  <div class="snapshot-heading"><div><h2>Veterans <span>{snapshot.count}</span></h2><div class="snapshot-info">{#if snapshot.capturedAt}<span>Recorded <time datetime={snapshot.capturedAt}>{formatRaceTime(snapshot.capturedAt)}</time></span>{/if}<span>Open the Veterans list in-game to refresh this list.</span></div></div><button disabled={working} onclick={refresh} aria-label="Refresh recorded Veterans"><LibraryIcon name="refresh" size={16}/>Refresh</button></div>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if loading}<p class="empty">Loading recorded Veterans…</p>
  {:else if !snapshot.capturedAt}<div class="empty"><LibraryIcon name="race" size={32}/><p>Open the Veterans list in the game while collection is running.</p></div>
  {:else}
    <div class="filters">
      <input type="search" aria-label="Search recorded Veterans" placeholder="Search Umas, skills, sparks, memos…" bind:value={filter.query}/>
      <select aria-label="Filter recorded character" bind:value={filter.character}><option value="">All characters</option>{#each characters as [id,name]}<option value={String(id)}>{name}</option>{/each}</select>
      <div class="sort-controls"><select aria-label="Sort recorded Veterans" bind:value={filter.sort} onchange={sortChanged}><option value="recent">Career date</option><option value="rating">Rating</option><option value="sparks">Sparks</option><option value="skills">Skills · count</option><option value="track">Track</option><option value="distance">Distance</option><option value="strategy">Style</option><option value="name">Name</option><option value="memo">Memo</option><option value="favorites">Favorite icons</option><optgroup label="Stats">{#each stats as stat,i}<option value={stat}>{labels[i]}</option>{/each}</optgroup></select><button class="sort-direction" aria-label={filter.direction==='desc'?'Descending order':'Ascending order'} title={filter.sort==='recent'?(filter.direction==='desc'?'Newest career first':'Oldest career first'):(filter.direction==='desc'?'Descending order':'Ascending order')} onclick={()=>filter.direction=filter.direction==='desc'?'asc':'desc'}><svg class:ascending={filter.direction==='asc'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6"/></svg></button></div>
      {#if aptitudeSort}<select aria-label="Sort aptitude" value={filter.sortDetail||aptitudeSort[1][0][0]} onchange={e=>filter.sortDetail=e.currentTarget.value}>{#each aptitudeSort[1] as [key,label]}<option value={key}>{label}</option>{/each}</select>{/if}
      {#if filter.sort==='sparks'}<select aria-label="Sort spark" bind:value={filter.sortDetail}><option value="">Total stars</option>{#each sparkOptions as spark}<option value={spark.group}>{spark.name}</option>{/each}</select><label class="sort-origin"><input type="checkbox" bind:checked={filter.sortParents}/>Include origin legacies</label>{/if}
      <button class="open-filters" onclick={()=>filtersOpen=true}>Filters{#if filterCount}<b>{filterCount}</b>{/if}</button>
    </div>
    {#if filterCount}<div class="filter-count">{shown.length} / {snapshot.count}<button onclick={clearFilters}>Clear filters</button></div>{/if}
    <div class="veteran-cards">
      {#each shown as row (row.id)}{@const cost=totalSkillCost(row.career.skills??[])}
        <article class="veteran-card">
          <div class="card-heading"><button class="identity" onclick={()=>selected=row.id} aria-label={`View ${row.name} career`}><UmaPortrait uma={row.runner} size={60}/><span><strong>{row.name}</strong><small>{row.outfit}</small></span></button>{#if row.marker!==null&&row.marker>0}<span class="favorite-marker" title={veteranMarkers[row.marker]??`Marker ${row.marker}`}>{#if veteranMarkers[row.marker]}<img src={`./veterans/marker-${row.marker}.png`} alt={veteranMarkers[row.marker]}/>{:else}{row.marker}{/if}</span>{/if}</div>
          {#if row.epithet}<span class="epithet">{row.epithet}</span>{/if}
          <div class="rating-row"><RatingBadge score={row.career.score} rank={row.career.rank}/>{#if row.career.stars!=null}<StarRating count={row.career.stars}/>{/if}</div>
          <div class="stats">{#each stats as stat,i}<span style={`--stat:${statColors[stat]}`} title={labels[i]}><img src={`./career/support-type-${i}.png`} alt={labels[i]}/><strong>{row.career.stats[stat]??'—'}</strong></span>{/each}</div>
          <div class="facts"><span>{row.career.skills?.length??0} skills · {cost.total.toLocaleString()} SP{cost.unknown?' + ?':''}</span>{#if row.career.scenarioId!=null}<small>{scenarioName(row.career.scenarioId)}</small>{/if}</div>
          <div class="memo"><span>Memo</span><p>{row.memo||'—'}</p></div>
          <div class="card-sparks" aria-label={`${row.name} own sparks`}>{#each row.sparks.filter(f=>[1,2,3].includes(f.type)).sort((a,b)=>a.type-b.type) as spark}<span title={`${spark.stars??"—"}★ ${spark.name}`} style={`--spark:${sparkColor(spark.type)}`}><b>{spark.stars??'—'}★</b>{spark.name}</span>{/each}{#if !row.sparks.length}<span class="no-sparks">Sparks —</span>{/if}</div>
          <div class="actions"><button onclick={()=>selected=row.id}>Career</button>{#if picker}<button class="primary" onclick={()=>onChoose(veteranBuild(row))}>Load Uma</button>{:else}<button disabled={!!copying||copied.has(row.id)} onclick={()=>copy(row)}><LibraryIcon name="copy" size={14}/>{copied.has(row.id)?'Copied to Dorm':copying===row.id?'Copying…':'Copy to Dorm'}</button>{/if}</div>
        </article>
      {/each}
    </div>
    {#if !shown.length}<p class="empty">{snapshot.count?'No Veterans match these filters.':'The last recorded roster is empty.'}</p>{/if}
  {/if}
</section>
{#if filtersOpen}<VeteranFilters bind:filter {rows} count={shown.length} onClose={()=>filtersOpen=false}/>{/if}
{#if chosen}<CareerModal runner={chosen.runner} race={{runners:rows.map(r=>r.runner)}} {reference} onClose={()=>selected=''}/>{/if}
<style>
  .recorded-veterans{min-width:0;display:grid;gap:17px}.snapshot-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.snapshot-heading h2{font-size:20px;margin:0}.snapshot-heading h2 span{color:var(--accent-text);font-size:14px;margin-left:7px}.snapshot-info{display:flex;flex-wrap:wrap;gap:5px 18px;color:var(--muted);font-size:11px;margin-top:6px}.snapshot-heading button,.actions button{display:flex;align-items:center;justify-content:center;gap:7px;font-size:12px}
  .filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.filters>input{flex:1;min-width:160px}.filters select{max-width:210px}.sort-controls{display:flex;align-items:stretch;gap:6px;flex:none}.sort-controls select{min-width:135px;max-width:155px}.sort-direction{width:36px;min-height:36px;flex:none;padding:0;border-radius:6px;line-height:1}.sort-direction svg{display:block}.sort-direction svg.ascending{transform:rotate(180deg)}.sort-origin{display:flex;gap:5px;align-items:center;color:var(--muted);font-size:11px}.sort-origin input{accent-color:var(--accent)}.open-filters{display:flex;gap:7px;align-items:center;font-size:12px}.open-filters b{color:var(--accent-text)}input,select{padding:9px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit;font-size:12px}.filter-count{display:flex;gap:12px;align-items:center;color:var(--muted);font-size:12px}.filter-count button{padding:4px 8px;border:0;background:transparent;font-size:11px}
  .veteran-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:14px}.veteran-card{padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--panel);display:flex;flex-direction:column;gap:12px;min-width:0}.card-heading{display:flex;align-items:center;gap:9px}.identity{display:flex;flex:1;align-items:center;justify-content:flex-start;gap:10px;padding:0;border:0;background:transparent;text-align:left;min-width:0}.identity>span{min-width:0;display:grid;gap:5px}.identity strong{font-size:15px;overflow-wrap:anywhere}.identity small{font-size:11px;color:var(--muted);line-height:1.4}.favorite-marker{flex:none;align-self:flex-start}.favorite-marker img{width:27px;height:27px;object-fit:contain}.epithet{font-size:11px;color:#e9c87e;background:#c3942620;border-left:2px solid #c7a048;padding:4px 8px;line-height:1.5}.rating-row{display:flex;align-items:center;justify-content:space-between}
  .stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;text-align:center}.stats span{display:grid;justify-items:center;gap:4px;padding:5px 0;border-bottom:2px solid var(--stat);background:color-mix(in srgb,var(--stat) 6%,transparent);border-radius:4px 4px 0 0}.stats img{width:22px;height:22px;object-fit:contain}.stats strong{font-size:15px;font-weight:550;font-variant-numeric:tabular-nums}.facts{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;color:var(--muted);font-size:11px}.facts small{font-size:10px}.memo{display:flex;align-items:baseline;gap:9px;font-size:11px;color:var(--muted)}.memo>span{flex:none;font-size:10px}.memo p{margin:0;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}.card-sparks{display:flex;gap:5px;min-width:0}.card-sparks>span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:5px 7px;border-radius:4px;background:color-mix(in srgb,var(--spark) 7%,var(--bg));font-size:11px;line-height:1.4;min-width:0;border-bottom:2px solid color-mix(in srgb,var(--spark) 50%,transparent)}.card-sparks>span:nth-child(-n+2){flex-shrink:0}.card-sparks b{color:var(--spark);white-space:nowrap;margin-right:5px}.card-sparks .no-sparks{color:var(--muted)}.actions{display:flex;gap:8px;margin-top:auto}.actions button:last-child{flex:1}.empty{padding:35px 12px;text-align:center;color:var(--muted);font-size:13px}.error{color:#ed8e86;font-size:12px}
</style>
