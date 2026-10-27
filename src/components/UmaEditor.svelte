<script lang="ts">
  import {tick} from 'svelte';
  import type {ReferenceData} from '../data/reference';
  import {withOwnUnique,outfitUniques,ownInherited,editorSkillName} from '../sandbox/editor';
  import SkillFilters from './SkillFilters.svelte';
  import SaveAsDialog from './SaveAsDialog.svelte';
  import {totalSkillCost} from '../data/skill-cost';
  import {statColors} from '../sandbox/stat-colors';
  import {skillSearch,isUnreleased,emptySkillFilters} from '../sandbox/search';
  import {type UmaBuild,type Library} from '../sandbox/model';
  import GameIcon from './GameIcon.svelte';
  import UmaOutfitPicker from './UmaOutfitPicker.svelte';
  import UmaLibrary from './UmaLibrary.svelte';
  import {parseTags} from '../sandbox/library';
  import {skillIconKey} from '../data/game-icons';
  import {buildAptitudes,defaultAptitudes} from '../sandbox/aptitudes';
  import UmaAptitudes from './UmaAptitudes.svelte';
  export let value:UmaBuild;
  export let reference:ReferenceData;
  export let library:Library;
  export let onApply:(value:UmaBuild)=>void;
  export let onSave:(value:UmaBuild)=>Promise<void>;
  export let onTemplate:(name:string,skills:UmaBuild['skills'])=>Promise<void>;
  export let onClose:()=>void;
  export let applyLabel='Use build';
  let draft=withOwnUnique(structuredClone(value),reference),query='',loadOpen=false,tagText=(value.tags??[]).join(', '),template='',templateName='',failure='',showUnreleased=false;
  draft.aptitudes=buildAptitudes(draft);
  if(draft.name==='New Uma')draft.name=reference.metadata.characters[draft.charaId]||'Uma';
  let filters=emptySkillFilters(),saveAs=false,closeAfterSave=false,savingBuild=false;
  const skillName=(ref:ReferenceData,id:number)=>editorSkillName(ref,id);
  $: ownUnique=outfitUniques(reference,draft.cardId).find(id=>draft.skills.some(s=>s.id===id));
  function snapshot(){const normalized=withOwnUnique(structuredClone(draft),reference);return {...normalized,aptitudes:buildAptitudes(normalized),tags:parseTags(tagText),skills:normalized.skills.map(s=>({...s,level:hasLevel(s.id)?s.level:1}))};}
  function chooseOutfit(cardId:number){if(cardId===draft.cardId)return;const automatic=draft.name===reference.metadata.characters[draft.charaId];draft=withOwnUnique({...draft,cardId,charaId:Math.floor(cardId/100),aptitudes:defaultAptitudes(cardId)},reference);if(automatic)draft.name=reference.metadata.characters[draft.charaId]||'Uma';}
  let search:HTMLInputElement;
  let visibleSkills=120;
  $: visibleSkills=(results,120);
  function loadMore(node:HTMLElement){const root=node.closest('.skill-search-results');const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))visibleSkills+=120;},{root,rootMargin:'200px'});observer.observe(node);return {destroy(){observer.disconnect();}};}
  $: results=skillSearch(reference,query,[...draft.skills.map(s=>s.id),...ownInherited(draft.cardId)],showUnreleased,filters);
  $: cost=totalSkillCost(draft.skills);
  const hasLevel=(id:number)=>id===ownUnique;
  const stats=['speed','stamina','power','guts','wisdom'] as const;

  async function add(id:number){if(draft.skills.some(s=>s.id===id))return;draft.skills=[...draft.skills,{id,level:1}];query='';await tick();search.focus();}
  async function save(close=false){if(savingBuild)return;if(close&&library.umas.some(u=>u.id===draft.id)){savingBuild=true;failure='';try{const value=snapshot();await onSave(value);onApply(value);}catch(e){failure=String(e);}finally{savingBuild=false;}return;}closeAfterSave=close;saveAs=true;}
  async function saveNamed(name:string,id:string){const value={...snapshot(),name,id};await onSave(value);draft=value;if(closeAfterSave)onApply(value);}
  function load(saved:UmaBuild){draft=withOwnUnique({...structuredClone(saved),aptitudes:buildAptitudes(saved)},reference);tagText=(saved.tags??[]).join(', ');loadOpen=false;}
  async function saveTemplate(){try{await onTemplate(templateName,draft.skills);templateName='';}catch(e){failure=String(e);}}
  function focus(node:HTMLElement){
    const previous=document.activeElement as HTMLElement;node.focus();
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=='Tab'||event.defaultPrevented)return;
      const fields=[...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
      const first=fields[0],last=fields.at(-1);if(!first||!last)return;
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===node)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    node.addEventListener('keydown',trap);
    return {destroy(){node.removeEventListener('keydown',trap);previous?.focus();}};
  }
</script>
<div class="modal-backdrop" role="presentation" onclick={e=>{if(e.target===e.currentTarget)onClose();}} onkeydown={e=>{if(e.key==='Escape')onClose();}}>
  <div class="uma-editor" role="dialog" aria-modal="true" aria-label="Edit Uma" tabindex="-1" use:focus>
    <header><div><span class="eyebrow">UMA BUILD</span><h2>{draft.name}</h2></div><button class="icon-button" aria-label="Close Uma editor" onclick={onClose}>×</button></header>
    <div class="editor-scroll">
      {#if failure}<p class="notice error" role="alert">{failure}</p>{/if}
      <details class="load-library" bind:open={loadOpen}><summary>Load saved Uma</summary>{#if loadOpen}<UmaLibrary {library} {reference} picker onChoose={load}/>{/if}</details>
      <div class="editor-columns"><section class="build-column" aria-label="Uma details">
      <UmaOutfitPicker {reference} cardId={draft.cardId} onSelect={chooseOutfit}/>

      <div class="build-stats">{#each stats as stat}<label style={`--stat:${statColors[stat]}`}><span><GameIcon name={`stat-${stat}`} size={25}/>{stat==='wisdom'?'Wit':stat.charAt(0).toUpperCase()+stat.slice(1)}</span><input type="number" min="1" max="2000" step="1" bind:value={draft.stats[stat]} aria-label={`Base ${stat}`}/><i aria-hidden="true"><b style:width={`${Math.min(100,Math.max(0,(draft.stats[stat]??0)/20))}%`}></b></i></label>{/each}</div>
      <UmaAptitudes value={draft.aptitudes!} onChange={(key,grade)=>{draft.aptitudes={...draft.aptitudes!,[key]:grade};}}/>
      <section class="equipped-panel" aria-label="Equipped skills">
      <div class="skill-editor-heading"><h3>Equipped skills <small>{draft.skills.length}</small></h3><span>{cost.total.toLocaleString()} SP{cost.unknown?' + unknown costs':''}</span></div>
      <div class="owned-skills">{#each draft.skills as s (s.id)}<div class="owned-skill" class:unique={s.id===ownUnique} class:unsupported={reference.engineSkillIds?.has(String(s.id))===false}><GameIcon name={skillIconKey(reference,s.id)} size={24}/><span>{skillName(reference,s.id)}{#if reference.engineSkillIds?.has(String(s.id))===false}<small>Unsupported by installed engine</small>{/if}</span>{#if hasLevel(s.id)}<label>Lv<input type="number" min="1" max="6" bind:value={s.level} aria-label={`${skillName(reference,s.id)} level`}/></label>{/if}{#if s.id===ownUnique}<span class="unique-lock" title="This outfit’s unique skill" aria-label="Unique skill locked">◆</span>{:else}<button aria-label={`Remove ${skillName(reference,s.id)}`} onclick={()=>draft.skills=draft.skills.filter(x=>x.id!==s.id)}>×</button>{/if}</div>{/each}</div>
      </section>
      </section><section class="skills-column" aria-label="Uma skills">
      <label>Memo<textarea rows="2" maxlength="10000" placeholder="Build notes, intended races, comparisons…" bind:value={draft.memo}></textarea></label>
      <div class="organization"><label>Folder<select aria-label="Save Uma in folder" bind:value={draft.folderId}><option value="">Dorm</option>{#each library.folders??[] as folder}<option value={folder.id}>{folder.name}</option>{/each}</select></label><label>Tags<input aria-label="Uma tags" placeholder="Sprint, Ready…" bind:value={tagText}/></label><label class="favorite-check" class:on={draft.favorite}><input type="checkbox" bind:checked={draft.favorite}/>★ Favorite</label></div>
      <details><summary>Skill condition inputs</summary><div class="editor-grid"><label>Fans<input type="number" min="0" max="9007199254740991" bind:value={draft.fans}/></label><label>Career wins<input type="number" min="0" max="1000" bind:value={draft.careerWins}/></label></div></details>
      <SkillFilters bind:filters bind:showUnreleased/>
      {#if !ownUnique}<p class="notice error">Unique skill data is unavailable for this outfit. Choose another outfit before saving or running.</p>{/if}
      <div class="skill-search"><input bind:this={search} type="search" bind:value={query} placeholder="Find skill or unique skill’s Uma…" title="Enter adds the first result; Tab returns to search after adding." aria-label="Search skills" onkeydown={e=>{if(e.key==='Enter'&&results[0]){e.preventDefault();void add(results[0].id);}}}/><small>{results.length} skills</small></div>
      <div class="skill-search-results" role="group" aria-label="Available skills">{#each results.slice(0,visibleSkills) as item (item.id)}<button onclick={()=>add(item.id)} onkeydown={e=>{if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();search.focus();}}}><GameIcon name={skillIconKey(reference,item.id)} size={26}/><span class="search-copy">{item.name}{#if isUnreleased(item.skill)}<em>Unreleased</em>{/if}<small>{item.skill.description??''}</small></span>{#if item.supported===false}<span class="unsupported-label">Unsupported</span>{/if}</button>{/each}{#if visibleSkills<results.length}<button class="more-skills" use:loadMore onclick={()=>visibleSkills+=120}>Show more · {visibleSkills} / {results.length}</button>{/if}{#if !results.length}<p>No matching skills.</p>{/if}</div>
      <details><summary>Skill templates</summary><div class="editor-load"><select aria-label="Skill template" bind:value={template}><option value="">Choose a template…</option>{#each library.templates as t}<option value={t.id}>{t.name}</option>{/each}</select><button disabled={!template} onclick={()=>{const t=library.templates.find(t=>t.id===template);if(t)draft=withOwnUnique({...draft,skills:structuredClone(t.skills)},reference);}}>Replace skills</button></div><div class="editor-load"><input placeholder="Template name" aria-label="New skill template name" bind:value={templateName}/><button disabled={!templateName.trim()} onclick={saveTemplate}>Save template</button></div></details>
      </section></div>
    </div>
    <footer><span class="muted">Race settings can override saved aptitudes.</span><div><button disabled={!ownUnique||savingBuild} onclick={()=>save()}>Save As</button><button class="primary" disabled={!ownUnique||savingBuild} onclick={()=>applyLabel==='Save & close'?save(true):onApply(snapshot())}>{applyLabel}</button></div></footer>
  </div>
</div>
{#if saveAs}<SaveAsDialog kind="Uma" allowDuplicateNames current={draft} records={library.umas} onSave={saveNamed} onClose={()=>saveAs=false}/>{/if}
<style>
  .uma-editor{width:min(2100px,97vw);height:min(1500px,94dvh);max-height:94dvh;background:var(--panel);border:1px solid var(--border);border-radius:14px;display:flex;flex-direction:column;box-shadow:0 24px 100px #0008}
  .uma-editor header,.uma-editor footer{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;gap:12px;flex:none;height:auto;max-height:none}
  .uma-editor header{border-bottom:1px solid var(--border)}h2{margin:3px 0 0}h3{margin:0}small{color:var(--muted);font-weight:400}
  .editor-scroll{flex:1;min-height:0;overflow:auto;padding:16px 24px;display:flex;flex-direction:column;gap:16px}
  .load-library{flex:none;padding:10px 12px;border:1px solid var(--border);border-radius:8px;max-height:40vh;overflow:auto}
  .editor-columns{display:grid;grid-template-columns:minmax(480px,30%) minmax(0,1fr);gap:24px;flex:1;min-height:0}
  .build-column>*{flex:none}.build-column{display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;overflow:auto;padding-right:4px}
  .skills-column{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0}
  .skills-column>*{flex:none}
  .editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}input,select,textarea{border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);padding:9px;min-width:0;width:100%;font:inherit}
  .build-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}
  .build-stats label{padding:10px 7px;background:color-mix(in srgb,var(--stat) 6%,var(--bg));border:1px solid color-mix(in srgb,var(--stat) 40%,var(--border));border-radius:9px;color:var(--stat)}
  .build-stats label>span{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600}
  .build-stats input{font-size:22px;font-variant-numeric:tabular-nums;background:var(--bg);border-color:transparent;color:var(--text);padding:7px 3px}
  .build-stats i{display:block;width:100%;height:4px;border-radius:3px;background:var(--border);overflow:hidden}.build-stats i b{display:block;height:100%;background:var(--stat)}
  .organization{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end}.favorite-check{grid-column:1/-1;display:flex;flex-direction:row;align-items:center;gap:6px;color:var(--muted)}.favorite-check.on{color:#e6bd60}.favorite-check input{width:auto;accent-color:var(--accent)}
  .editor-load{display:flex;gap:8px}.editor-load select,.editor-load input{flex:1}.editor-load button{white-space:nowrap}
  .skill-editor-heading{display:flex;justify-content:space-between;align-items:center}.skill-editor-heading>span{color:#f0cf77;font-weight:600;font-size:13px}
  .build-column .equipped-panel{flex:1;min-height:280px;display:flex;flex-direction:column;gap:12px;padding:14px;border:1px solid var(--border);border-radius:10px;background:color-mix(in srgb,var(--bg) 88%,#000);box-shadow:inset 0 2px 8px #0002}.equipped-panel .skill-editor-heading{flex:none}.owned-skills{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));align-content:start;gap:7px;overflow:auto;padding:1px 4px 1px 1px;scrollbar-gutter:stable}
  .owned-skill{display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:7px;padding:6px 8px;font-size:12px;background:color-mix(in srgb,var(--accent) 3%,var(--bg))}
  .owned-skill>span{flex:1;min-width:0}.owned-skill small{display:block;color:#e6a45d}.owned-skill label{flex-direction:row;align-items:center;font-size:11px}.owned-skill input{width:46px;padding:4px}.owned-skill button{padding:3px 7px}
  .owned-skill.unique{border-color:#d1b478;background:linear-gradient(120deg,#d6b05b15,var(--bg))}.unique-lock{color:#e9c77b;font-size:14px;flex:none!important}.unsupported{border-color:#b2843b}
  .skill-search{display:flex;align-items:center;gap:12px}.skill-search input{flex:1;min-width:160px}.skill-search>small{font-size:10px;max-width:190px;line-height:1.5}
  .skills-column .skill-search-results{flex:1;min-height:100px;overflow:auto;border:1px solid var(--border);border-radius:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));grid-auto-rows:min-content;align-content:start}
  .skill-search-results button{width:100%;min-width:0;display:flex;align-items:center;justify-content:flex-start;text-align:left;gap:9px;padding:9px 10px;border:0;border-bottom:1px solid var(--border);border-right:1px solid var(--border);border-radius:0;background:transparent;min-height:72px}
  .skill-search-results .more-skills{grid-column:1/-1;justify-content:center;min-height:35px;color:var(--muted);font-size:11px}.skill-search-results button:hover{background:var(--panel-raised)}.skill-search-results .search-copy{min-width:0;flex:1;white-space:normal;overflow-wrap:anywhere;font-size:12px}
  .search-copy small{display:-webkit-box;line-clamp:2;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;line-height:1.4;margin-top:4px}
  .search-copy em{font-style:normal;font-size:9px;margin-left:6px;color:#d9af7c}.unsupported-label{color:#e6a45d;font-size:9px;flex:none}.skill-search-results>p{grid-column:1/-1;padding:14px;font-size:12px;color:var(--muted)}
  .uma-editor footer{border-top:1px solid var(--border);font-size:11px;flex-wrap:wrap}.uma-editor footer div{display:flex;gap:8px}summary{cursor:pointer;color:var(--muted);font-size:12px}details[open]>summary{margin-bottom:12px}
  @media(max-width:1150px){.editor-columns{min-height:auto;grid-template-columns:1fr}.editor-scroll{display:block}.editor-columns{margin-top:16px}.build-column{overflow:visible}.skills-column .skill-search-results{flex:none;max-height:none;height:480px}.build-stats{max-width:750px}.build-column .equipped-panel{min-height:0;flex:none}.owned-skills{flex:none;max-height:clamp(280px,45dvh,560px)}.uma-editor{height:94dvh}}
  @media(max-width:650px){.uma-editor header,.uma-editor footer,.editor-scroll{padding:12px}.editor-columns{gap:18px}.build-stats{gap:4px}.build-stats label{padding:8px 4px}.build-stats label>span{flex-direction:column;gap:3px}.build-stats input{font-size:18px;padding:7px 0}.skill-search>small{display:none}.skill-search-results{grid-template-columns:1fr!important}.organization{gap:8px}}
</style>
