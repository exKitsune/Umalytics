<script lang="ts">
  import {statColors} from '../sandbox/stat-colors';
  import {onMount} from 'svelte';
  import {readWorkspaceSession,checkpointWorkspace} from '../sandbox/session';
  const restoredSession=readWorkspaceSession().simulator;
  import {mergeJobProgress} from '../sandbox/progress';
  import {api,saveDesktopExport} from '../api';
  import {jsonDownloadName} from '../data/umalator';
  import {exportUma,importUmas} from '../sandbox/uma-transfer';
  import {loadSimulationDashboard} from '../sandbox/dashboard';
  import {type ReferenceData} from '../data/reference';


  import {type PreparedRace} from '../analysis/prepared';
  import {blankSetup,blankUma,participant,randomSeed,uid,type UmaBuild,type Setup,type Library,type Job} from '../sandbox/model';
  import {totalSkillCost} from '../data/skill-cost';

  import UmaEditor from './UmaEditor.svelte';
  import UmaScreenshotImport from './UmaScreenshotImport.svelte';
  import ScreenshotImportIcon from './ScreenshotImportIcon.svelte';
  import {syncParticipantAptitudes,replaceParticipantBuild} from '../sandbox/aptitudes';
  import EventPresets from './EventPresets.svelte';
  import SaveAsDialog from './SaveAsDialog.svelte';
  import {setupTeams,addTeam,deleteTeam} from '../sandbox/teams';
  import {onDestroy} from 'svelte';
  import UmaPortrait from './SimulatorPortrait.svelte';
  import GameIcon from './GameIcon.svelte';
  import {withOwnUnique,normalizePopularity} from '../sandbox/editor';
  import UmaLibrary from './UmaLibrary.svelte';
  import SimulatorConditions from './SimulatorConditions.svelte';
  import {impactSetup,type ImpactRequest} from '../sandbox/insights';
  import type {AutomaticSkills} from '../sandbox/automatic-skills';
  import MoodPicker from './MoodPicker.svelte';
  import RaceIconPicker from './RaceIconPicker.svelte';
  import SimSymbol from './SimSymbol.svelte';
  import SimulationResults from './SimulationResults.svelte';
  export let mode:'races'|'simulator'|'umas';
  export let reference:ReferenceData;
  export let token:string|undefined;
  export let incoming:{setup:Setup;warnings:string[]}|null=null;
  export let onOpen:(value:PreparedRace,reference:ReferenceData)=>void;
  export let onMode:(mode:'simulator'|'umas')=>void;
  export let onNavigate:(view:'setup'|'results',jobId?:string)=>void=()=>{};
  let navigationVersion=0,lastNavigation='';
  export function cancelNavigation(){navigationVersion++;opening=null;}
  export async function navigateTo(next:'setup'|'results',jobId?:string){
    cancelNavigation();const version=navigationVersion;
    if(jobId&&job?.id!==jobId){const loaded=await api<Job>(`simulator/job?id=${encodeURIComponent(jobId)}`);if(version!==navigationVersion)return;job=loaded;if(!setup.participants.length&&!restoredSession)setup=editable(structuredClone(loaded.setup));void loadImpacts();}
    if(version===navigationVersion)view=next;
  }
  $: if(initialized&&mode==='simulator'&&lastNavigation!==`${view}:${job?.id??''}`){lastNavigation=`${view}:${job?.id??''}`;onNavigate(view,job?.id);}
  let setup:Setup={...(restoredSession?.setup??blankSetup()),autoPopularity:true},library:Library={umas:[],setups:[],conditions:[],templates:[]},warnings:string[]=restoredSession?.warnings??[],seen:unknown;
  let error='',notice='',busy=false,job:Job|null=null,history:Pick<Job,'id'|'phase'|'createdAt'|'total'|'completed'|'impactSourceId'|'autoImpact'>[]=[],view:'setup'|'results'=restoredSession?.view??'setup';
  let editing:UmaBuild|null=restoredSession?.editing??null,editingSlot:number|null=restoredSession?.editingSlot??null,opening:number|null=null,conditionName='',conditionId='',setupId='',libraryView=restoredSession?.libraryView??'unfiled',importInput:HTMLInputElement;
  let saveSetupAs=false,sharedMood=5,addingTeam:number|null=restoredSession?.addingTeam??null;
  let popularityRows:Record<string,{rank:number;judges:number[]}>={},popularityError='',popularityPending=false,popularityKey='',popularityVersion=0,popularityTimer:ReturnType<typeof setTimeout>|undefined;
  $: teams=setupTeams(setup);
  $: groups=[...teams.map(t=>({...t,participants:setup.participants.filter(p=>p.team===t.id)})),{id:null,name:'Individuals',participants:setup.participants.filter(p=>p.team===null)}];
  let renamingTeam:number|null=null,teamNameDraft='';
  function renameTeam(team:{id:number;name:string}){teamNameDraft=team.name;renamingTeam=team.id;}
  function finishTeamName(id:number){if(renamingTeam!==id)return;const name=teamNameDraft.trim()||`Team ${id+1}`;setup={...setup,teams:teams.map(t=>t.id===id?{...t,name}:t)};renamingTeam=null;}
  function focusTeamName(node:HTMLInputElement){node.focus();node.select();}
  function newTeam(){setup=addTeam(setup);}
  function startTeamParticipant(team:number|null){addingTeam=team;edit(null);}
  function refreshPopularity(value:Setup,csrf:string|undefined,ready:boolean){
    const key=JSON.stringify([value,csrf,ready]);if(key===popularityKey)return;popularityKey=key;
    clearTimeout(popularityTimer);const version=++popularityVersion;popularityRows={};popularityError='';
    if(!ready||!csrf||!value.participants.length){popularityPending=false;return;}
    popularityPending=true;
    popularityTimer=setTimeout(async()=>{try{
      const result=await api<{participants:{id:string;rank:number;judges:number[]}[]}>('simulator/popularity',{setup:{...value,autoPopularity:true}},csrf);
      if(version===popularityVersion)popularityRows=Object.fromEntries(result.participants.map(p=>[p.id,p]));
    }catch(e){if(version===popularityVersion)popularityError=String(e);}finally{if(version===popularityVersion)popularityPending=false;}},200);
  }
  $: if(mode==='simulator')refreshPopularity(setup,token,initialized);
  onDestroy(()=>{clearTimeout(popularityTimer);popularityVersion++;});
  let screenshotImport=false,screenshotImportId='';
  let screenshotImporter:{clear:()=>void}|undefined;
  let actionNotice='',actionTimer:ReturnType<typeof setTimeout>|undefined;
  function notify(text:string){dismissAdded();clearTimeout(actionTimer);actionNotice=text;actionTimer=setTimeout(()=>actionNotice='',5000);}
  let addedRacer=0,addedTimer:ReturnType<typeof setTimeout>|undefined;
  const racerOrdinal=(n:number)=>`${n}${n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[n%10]??'th'}`;
  function dismissAdded(){addedRacer=0;clearTimeout(addedTimer);}
  function addFromLibrary(uma:UmaBuild){
    if(setup.participants.length>=18)return;
    addingTeam=null;addUma(uma);view='setup';addedRacer=setup.participants.length;
    clearTimeout(addedTimer);addedTimer=setTimeout(dismissAdded,5000);
  }
  $: if(mode!=='umas')dismissAdded();
  $: if(setup.moodOverride?.mode==='fixed')sharedMood=setup.moodOverride.mood;
  function sharedMoodMode(mode:'fixed'|'random',enabled:boolean){
    if(enabled)setup.moodOverride=mode==='fixed'?{mode,mood:sharedMood}:{mode};
    else delete setup.moodOverride;
    setup=setup;
  }
  function changeSharedMood(mood:number){sharedMood=mood;setup.moodOverride={mode:'fixed',mood};}
  function editable(value:Setup):Setup{return {...value,autoPopularity:true,teams:setupTeams(value),participants:normalizePopularity(value.participants).map(p=>({...p,uma:withOwnUnique(p.uma,reference)}))};}
  function addUma(uma:UmaBuild){setup.participants=[...setup.participants,{...participant(withOwnUnique(uma,reference),setup.participants.length),team:addingTeam}];}
  let stopped=false,polling=false,autoOpened='',initialized=false,lastBatchCount=100;
  $: if(initialized)checkpointWorkspace({simulator:{addingTeam,setup,warnings,view,jobId:job?.id,editing,editingSlot,libraryView}});
  $: totalRuns=setup.count*(1+(setup.variations?.builds.length??0));
  $: multiRun=setup.count!==1||!!setup.variations;
  function runMode(multi:boolean){if(multi)setup.count=Math.max(2,lastBatchCount);else{lastBatchCount=Math.max(2,setup.count);setup.count=1;}}
  let impactJob:Job|null=null,impactJobs:Job[]=[];
  let automatic:AutomaticSkills|null=null;
  const running=(j:Job|null)=>!!j&&['queued','running'].includes(j.phase);
  $: progressJob=running(impactJob)?impactJob:job;
  $: visibleHistory=history.filter(h=>!h.impactSourceId);
  $: if(incoming&&incoming!==seen){seen=incoming;setup=editable(structuredClone(incoming.setup));warnings=incoming.warnings;view='setup';}
  $: courses=Object.values(reference.courses).sort((a,b)=>a.trackName.localeCompare(b.trackName)||a.distance-b.distance);
  $: if(!setup.courseId&&courses.length)setup.courseId=courses[0].id;
  $: active=running(job)||running(impactJob);
  export async function refreshLibrary(){library=await api<Library>('simulator/library');}
  async function save(collection:keyof Library,record:unknown){library=await api<Library>('simulator/library',{collection,record},token);notice='Saved locally.';}
  function checkpointEditor(value:UmaBuild){editing=value;}
  async function saveUma(uma:UmaBuild){const importedId=screenshotImportId,imported=!!importedId&&editing?.id===importedId;await save('umas',uma);if(imported&&screenshotImportId===importedId){screenshotImporter?.clear();screenshotImportId='';}}
  async function saveTemplate(name:string,skills:UmaBuild['skills']){await save('templates',{id:uid(),name,skills});}
  async function organize(body:unknown){library=await api<Library>('simulator/library',body,token);}
  function edit(index:number|null,value?:UmaBuild){
    editingSlot=index;editing=structuredClone(value??{...blankUma(),folderId:libraryView.startsWith('folder:')?libraryView.slice(7):''});
    const saved=library.umas.find(u=>u.id===editing?.id);
    if(saved)Object.assign(editing,{folderId:saved.folderId,tags:saved.tags,favorite:saved.favorite,archived:saved.archived});
  }
  async function apply(uma:UmaBuild){try{if(mode==='umas'){editing=null;return;}else if(editingSlot!==null){setup.participants[editingSlot]=replaceParticipantBuild(setup.participants[editingSlot],uma,reference.courses[setup.courseId]);setup=setup;}else{addUma(uma);}editing=null;}catch(e){error=String(e);}}
  $: {const course=reference.courses[setup.courseId],participants=setup.participants.map(p=>syncParticipantAptitudes(p,course));if(participants.some((p,i)=>!setup.participants[i].aptitudeOverrides||!setup.participants[i].uma.aptitudes||p.surface!==setup.participants[i].surface||p.distance!==setup.participants[i].distance||p.strategyAptitude!==setup.participants[i].strategyAptitude))setup={...setup,participants};}
  function removeSlot(index:number){setup.participants=normalizePopularity(setup.participants.filter((_,i)=>i!==index).map((p,i)=>({...p,gate:i+1}))); }
  function changeGate(index:number,gate:number){if(setup.shuffleGates)return;const previous=setup.participants[index].gate,other=setup.participants.findIndex((p,i)=>i!==index&&p.gate===gate);if(other>=0)setup.participants[other].gate=previous;setup.participants[index].gate=gate;setup=setup;}
  async function run(){busy=true;error='';try{job=await api<Job>('simulator/run',{setup},token);impactJobs=[];automatic=null;view='results';if(!setup.keepSeed)setup.seed=randomSeed();await poll();}catch(e){error=String(e);}finally{busy=false;}}
  async function loadImpacts(){if(!job)return;const source=job,id=source.id,version=navigationVersion;automatic=null;const saved=await api<Job[]>(`simulator/impacts?id=${encodeURIComponent(id)}`);if(version!==navigationVersion||job?.id!==id)return;impactJobs=saved;
    if(token&&source.phase==='complete'&&source.total>1&&!source.impactSourceId&&!source.setup.variations){const state=await api<AutomaticSkills>('simulator/auto-impacts',{jobId:id},token);if(version===navigationVersion&&job?.id===id)automatic=state;}
  }
  async function refreshAutomatic(){if(!job||!automatic)return;const id=job.id,version=navigationVersion,state=await api<AutomaticSkills>(`simulator/auto-impacts?id=${encodeURIComponent(id)}`);if(version!==navigationVersion||job?.id!==id||!state)return;automatic=state;
    for(const meta of state.jobs){const previous=impactJobs.find(j=>j.id===meta.id);if(previous?.completed===meta.completed&&previous.phase===meta.phase)continue;
      const next=previous?await refreshJob(previous):await api<Job>(`simulator/job?id=${encodeURIComponent(meta.id)}&impact=1`);if(version!==navigationVersion||job?.id!==id)return;impactJobs=[...impactJobs.filter(j=>j.id!==next.id),next];}
  }
  async function toggleAutomatic(enabled:boolean){if(!job)return;try{const id=job.id,state=await api<AutomaticSkills>('simulator/auto-impacts',{jobId:id,enabled},token);if(job?.id===id)automatic=state;}catch(e){error=String(e);}}
  async function measureImpact(request:ImpactRequest){if(!job||active||busy)return;busy=true;error='';try{const source=job;const input=impactSetup(source.setup,request);impactJob=await api<Job>('simulator/run',{setup:input,impactSourceId:source.id},token);if(job?.id===source.id)impactJobs=[...impactJobs,impactJob];await poll();}catch(e){error=String(e);}finally{busy=false;}}
  async function refreshJob(previous:Job){const next=await api<Job>(`simulator/job?id=${encodeURIComponent(previous.id)}&after=${previous.runCursor??0}${previous.impactSourceId?'&impact=1':''}`);return mergeJobProgress(previous,next);}
  async function poll(){if(polling||stopped)return;const version=navigationVersion;polling=true;try{
    if(job&&running(job)){const id=job.id;const next=await refreshJob(job);if(version!==navigationVersion)return;if(job?.id===id){job=next;if(mode==='simulator'&&next.total===1&&next.phase==='complete'&&autoOpened!==id){autoOpened=id;await openRun(0);}if(next.phase==='complete'&&next.total>1)await loadImpacts();if((next as any).openError)error=(next as any).openError;}}
    if(impactJob&&running(impactJob)){const id=impactJob.id;const next=await refreshJob(impactJob);if(version!==navigationVersion||impactJob?.id!==id)return;impactJob=next;if(job?.id===next.impactSourceId)impactJobs=[...impactJobs.filter(j=>j.id!==id),next];if(next.error)error=next.error;}
    const list=await api<typeof history>('simulator/jobs');if(version!==navigationVersion||stopped)return;history=list;
    await refreshAutomatic();
  }catch(e){if(version===navigationVersion&&!stopped)error=String(e);}finally{polling=false;}}
  async function historyJob(id:string){cancelNavigation();const version=navigationVersion;error='';try{const loaded=await api<Job>(`simulator/job?id=${encodeURIComponent(id)}`);if(stopped||version!==navigationVersion)return;job=loaded;autoOpened=id;view='results';impactJobs=[];impactJob=null;automatic=null;await loadImpacts();}catch(e){if(!stopped&&version===navigationVersion)error=String(e);}}
  async function openRun(index:number){if(!job||opening!==null)return;opening=index;error='';const id=job.id,version=++navigationVersion;try{
    await api('simulator/open',{jobId:id,index},token);
    let ready=false;
    while(!stopped&&version===navigationVersion&&!ready){const status=await api<Job&{readyRuns:number[];openError?:string}>(`simulator/job?id=${encodeURIComponent(id)}&status=1`);if(status.openError)throw new Error(status.openError);ready=status.readyRuns.includes(index);if(!ready)await new Promise(resolve=>setTimeout(resolve,500));}
    if(stopped||version!==navigationVersion)return;
    const {value,refs}=await loadSimulationDashboard(id,index);if(version===navigationVersion)onOpen(value,refs);
  }catch(e){if(!stopped&&version===navigationVersion)error=String(e);}finally{if(version===navigationVersion)opening=null;}}
  async function cancel(){if(progressJob)await api('simulator/cancel',{jobId:progressJob.id},token);await poll();}
  async function download(name:string,data:unknown):Promise<boolean>{
    const bundle=data as {kind?:string;umas?:UmaBuild[];folders?:Library['folders']};
    if(bundle.kind==='umalytics-uma-library'&&bundle.umas&&bundle.umas.length>0){for(const uma of bundle.umas){if(!await download(uma.name,exportUma(uma,bundle.folders??[],reference)))return false;}if(bundle.umas.length>1)notify(`${bundle.umas.length} Umas exported.`);return true;}
    const filename=jsonDownloadName(name),content=JSON.stringify(data,null,2),label=['umalytics-uma-library','umalytics-uma'].includes((data as {kind?:string})?.kind??'')?'Uma':(data as {kind?:string})?.kind==='umalytics-simulation-results'?'Results':'Setup';
    try{
      if(token){const saved=await saveDesktopExport(filename,content,token);const folder=saved.path.replace(/[\\/][^\\/]+$/,'');notify(`${label} exported to ${/[\\/]Downloads$/i.test(folder)?'Downloads folder':folder}.`);}
      else{const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(`${label} download started.`);}
      return true;
    }catch(e){error=String(e);return false;}
  }
  async function importFile(file:File|undefined){if(!file)return;try{if(file.size>8*1024*1024)throw new Error('Simulator imports must be under 8 MB.');const value=JSON.parse(await file.text());const imported=importUmas(value,reference);if(imported){await organize({collection:'umas',action:'import',records:imported.umas,folders:imported.folders});notify(imported.umas.length===1?'Uma imported.':`${imported.umas.length} Umas imported.`);}else if(value.kind==='umalytics-setup'){const imported={...value.setup,id:uid()};await save('setups',imported);setup=editable(imported);view='setup';onMode('simulator');}else throw new Error('Choose an exported Uma or simulator setup. Import captured race JSON through the race library.');}catch(e){error=String(e);}finally{if(importInput)importInput.value='';}}
  async function saveSetup(name:string,id:string){const value={...setup,name,id};await save('setups',value);setup=value;setupId=id;}
  onMount(()=>{void (async()=>{try{await refreshLibrary();history=await api<typeof history>('simulator/jobs');const running=history.find(j=>j.id===restoredSession?.jobId)??history.find(j=>!j.autoImpact&&['running','queued'].includes(j.phase));if(running&&!job){if(running.impactSourceId){impactJob=await api<Job>(`simulator/job?id=${running.id}`);job=await api<Job>(`simulator/job?id=${running.impactSourceId}`);await loadImpacts();}else job=await api<Job>(`simulator/job?id=${running.id}`);}initialized=true;}catch(e){error=String(e);}})();const timer=setInterval(()=>{if(active||opening!==null||(automatic&&(!['complete','error','paused'].includes(automatic.phase)||automatic.activeJob)))void poll();},1000);return()=>{stopped=true;cancelNavigation();clearInterval(timer);clearTimeout(addedTimer);clearTimeout(actionTimer);};});
</script>
<div class="sim-workspace" hidden={mode==='races'}>
  <input class="file-input" bind:this={importInput} type="file" accept=".json" onchange={e=>importFile(e.currentTarget.files?.[0])}/>
  <div class="sim-title"><div>{#if mode!=='umas'}<span class="eyebrow">RACE LAB</span>{/if}<h1>{mode==='umas'?'Umas':'Simulator'}</h1></div><div class="toolbar"><button onclick={()=>importInput.click()}>Import JSON</button>{#if mode==='umas'}<button onclick={()=>screenshotImport=true}><ScreenshotImportIcon size={20}/>Import Uma from Screenshots</button><button class="primary" onclick={()=>edit(null)}>＋ Create Uma</button>{:else}<button onclick={()=>{setup=blankSetup();warnings=[];view='setup';}}>New setup</button>{/if}</div></div>
  {#if error}<div class="notice error" role="alert"><span>{error}</span><button onclick={()=>error=''}>×</button></div>{/if}
  {#if notice}<div class="notice" role="status"><span>{notice}</span><button onclick={()=>notice=''}>×</button></div>{/if}
  {#if !initialized}<p class="muted">Opening local simulator library…</p>{/if}
  {#if mode==='umas'}
    <UmaLibrary {library} {reference} bind:view={libraryView} onEdit={uma=>edit(null,uma)} onMutate={organize} onExport={download} onNotify={notify} canAdd={setup.participants.length<18} onChoose={addFromLibrary}/>
  {:else}
    <div class="sim-tabs"><button class:active={view==='setup'} onclick={()=>view='setup'}>Race setup</button><button class:active={view==='results'} disabled={!job} onclick={()=>view='results'}>Results{job?` · ${job.completed??0}/${job.total}`:''}</button>{#if active}<span class="muted">Simulating in the service…</span>{/if}</div>
    {#if active||job?.phase==='failed'||job?.phase==='cancelled'||job?.phase==='interrupted'}<div class="job-progress"><progress max={progressJob?.total??1} value={progressJob?.completed??0}></progress><span>{progressJob?.impactSourceId?'Win impact · ':''}{progressJob?.completed??0} / {progressJob?.total} · {progressJob?.phase}</span>{#if active}<button onclick={cancel} title={progressJob?.impactSourceId?"Finishes the races already running; starts no more.":undefined}>Cancel</button>{/if}{#if job?.error}<p role="alert">{job.error}</p>{/if}</div>{/if}
    {#if view==='results'&&job}
      <section class="panel sim-section"><div class="sim-actions"><button onclick={()=>{setup=editable(structuredClone(job!.setup));view='setup';warnings=[];}}>Edit this setup</button><button onclick={()=>download(`${job!.setup.name}-results`,{kind:'umalytics-simulation-results',job})}>Export results</button></div><SimulationResults {job} {reference} onOpen={openRun} {opening} {impactJobs} {automatic} onAutomatic={toggleAutomatic} onMeasure={measureImpact} measuring={active||busy} canMeasure={!!token}/></section>
    {:else}
      {#if warnings.length}<details class="import-warnings" open><summary>Review imported inputs · {warnings.length} notes</summary>{#each warnings as warning}<p>{warning}</p>{/each}</details>{/if}
      <section class="panel sim-section"><div class="section-head"><h2>Race settings</h2><div class="toolbar preset-toolbar"><EventPresets bind:setup {reference}/><select aria-label="Saved race setup" bind:value={setupId}><option value="">Saved setups…</option>{#each library.setups as s}<option value={s.id}>{s.name}</option>{/each}</select><button disabled={!setupId} onclick={()=>{const s=library.setups.find(s=>s.id===setupId);if(s){setup=editable(structuredClone(s));warnings=[];}}}>Load</button><button onclick={()=>saveSetupAs=true}>Save As</button><button onclick={()=>download(setup.name,{kind:'umalytics-setup',schemaVersion:1,setup})}>Export</button></div></div>
      <SimulatorConditions bind:setup {reference}/>
      <details class="condition-presets"><summary>Condition presets</summary><div class="toolbar"><select aria-label="Condition preset" bind:value={conditionId}><option value="">Saved conditions…</option>{#each library.conditions as p}<option value={p.id}>{p.name}</option>{/each}</select><button disabled={!conditionId} onclick={()=>{const p=library.conditions.find(p=>p.id===conditionId);if(p){const {id,name,...conditions}=p;setup={...setup,...conditions};}}}>Apply</button><input placeholder="Preset name" aria-label="Preset name" bind:value={conditionName}/><button disabled={!conditionName.trim()} onclick={async()=>{try{const {courseId,weather,ground,season,time,grade}=setup;await save('conditions',{id:uid(),name:conditionName,courseId,weather,ground,season,time,grade});conditionName='';}catch(e){error=String(e);}}}>Save conditions</button></div></details></section>
      <section class="panel sim-section"><div class="section-head"><div><h2>Participants <small>{setup.participants.length} / 18</small></h2></div><div class="shared-controls"><label class="check gate-toggle"><SimSymbol name="shuffle" size={21}/><input type="checkbox" bind:checked={setup.shuffleGates}/> <span>Randomize gates</span></label><div class="shared-moods"><div class="fixed-mood"><label class="check"><input type="checkbox" checked={setup.moodOverride?.mode==='fixed'} onchange={e=>sharedMoodMode('fixed',e.currentTarget.checked)}/>All moods</label><MoodPicker label="" size={26} value={sharedMood} onChange={changeSharedMood}/></div><label class="check random-all"><input type="checkbox" checked={setup.moodOverride?.mode==='random'} onchange={e=>sharedMoodMode('random',e.currentTarget.checked)}/>Randomize mood for all</label></div></div></div>
      {#if popularityError}<p class="popularity-error" role="status">{popularityError}</p>{/if}
      <div class="team-bands">{#each groups as group (group.id??'independent')}
      <section class="team-band" style={`--team-color:${group.id===null?'#b2becb':['#78b6ed','#ef777c','#7aca9b','#e5bf65','#bca0ee'][group.id%5]}`} aria-label={group.name}>
        <div class="team-head">{#if group.id!==null}{#if renamingTeam===group.id}<input class="team-name-input" aria-label="Team name" bind:value={teamNameDraft} maxlength="80" use:focusTeamName onblur={()=>finishTeamName(group.id!)} onkeydown={e=>{if(e.key==='Enter')finishTeamName(group.id!);else if(e.key==='Escape')renamingTeam=null;}}/>{:else}<button class="team-name" aria-label={`Rename ${group.name}`} title="Rename team" onclick={()=>renameTeam({id:group.id!,name:group.name})}>{group.name}<span aria-hidden="true">✎</span></button>{/if}{:else}<strong title="Each participant races independently.">Individuals</strong>{/if}<span class="team-count">{group.participants.length} participant{group.participants.length===1?'':'s'}</span>{#if group.id!==null}<button class="delete-team" aria-label={`Delete ${group.name}`} title="Remove team; keep participants as individuals" onclick={()=>setup=deleteTeam(setup,group.id!)}>Delete team</button>{/if}</div>
      <div class="participants">{#each group.participants as p (p.id)}{@const i=setup.participants.indexOf(p)}<article class="participant">
        <div class="participant-head"><UmaPortrait uma={p.uma} size={36}/><button class="participant-name" onclick={()=>edit(i,p.uma)}><strong>{p.uma.name}</strong><small>{p.uma.skills.length} skills · {totalSkillCost(p.uma.skills).total} SP</small></button><button class="remove-participant" aria-label={`Remove participant ${i+1}`} onclick={()=>removeSlot(i)}>×</button></div>
        <div class="participant-build"><div class="mini-stats">{#each Object.entries(p.uma.stats) as [key,value]}<span style={`--stat:${statColors[key as keyof typeof statColors]}`} title={key}>{value??'—'}</span>{/each}</div><div class="aptitude-readouts">{#each [['surface','Surface'],['distance','Distance'],['strategyAptitude','Style']] as [key,label]}<div aria-label={`${label}: ${p[key as 'surface'|'distance'|'strategyAptitude']}`}><span>{label}</span><GameIcon name={`rank-${p[key as 'surface'|'distance'|'strategyAptitude']}`} size={21}/></div>{/each}</div></div>
        <div class="participant-settings"><RaceIconPicker kind="strategy" label="Strategy" value={p.strategy} onChange={strategy=>{p.strategy=Number(strategy);setup=setup;}}/><MoodPicker bind:value={p.mood} bind:random={p.randomizeMood} allowRandom disabled={!!setup.moodOverride} disabledLabel={setup.moodOverride?.mode==='fixed'?'Fixed':'Random'}/><label>Gate{#if setup.shuffleGates}<span class="random-gate"><SimSymbol name="shuffle" size={15}/>Random</span>{:else}<select value={p.gate} onchange={e=>changeGate(i,Number(e.currentTarget.value))}>{#each setup.participants as _,j}<option value={j+1}>{j+1}</option>{/each}</select>{/if}</label></div>
        <div class="participant-footer"><div class="participant-meta"><label>Team<select aria-label={`Slot ${i+1} team`} value={p.team??'solo'} onchange={e=>{p.team=e.currentTarget.value==='solo'?null:Number(e.currentTarget.value);setup=setup;}}><option value="solo">No team</option>{#each teams as team}<option value={team.id}>{team.name}</option>{/each}</select></label><div class="popularity" title={popularityRows[p.id]?`Calculated from stats, eligible skill bonuses, aptitudes and race conditions. Judges: ${popularityRows[p.id].judges.map(n=>n.toFixed(1)).join(' / ')}. Random moods and gates are recalculated for each run.`:'Popularity is recalculated for each run after mood and gate draws.'}><span>Popularity</span><strong>{popularityRows[p.id]?`#${popularityRows[p.id].rank}`:popularityPending?'…':'—'}</strong></div></div><div class="toolbar"><button onclick={()=>edit(i,p.uma)}>Edit build</button><button disabled={setup.participants.length>=18} onclick={()=>{const copy=structuredClone(p);copy.id=uid();copy.gate=copy.popularity=setup.participants.length+1;setup.participants=[...setup.participants,copy];}}>Duplicate</button></div></div>
      </article>{/each}
      {#if setup.participants.length<18}<button class="empty-slot" onclick={()=>startTeamParticipant(group.id)}><span>＋</span><strong>Add participant</strong></button>{/if}</div></section>{/each}</div><button class="add-team" disabled={teams.length>=18} onclick={newTeam}>＋ Create team</button></section>
      <section class="panel sim-section run-controls" class:batch-mode={multiRun}>
        <div class="run-modes" role="group" aria-label="Simulation mode">
          <button class:chosen={!multiRun} disabled={!!setup.variations} aria-pressed={!multiRun} onclick={()=>runMode(false)}><SimSymbol name="race" size={32}/><span><strong>Single race</strong><small>Replay · telemetry · detailed skills</small></span><b>1</b></button>
          <button class:chosen={multiRun} aria-pressed={multiRun} onclick={()=>runMode(true)}><SimSymbol name="batch" size={32}/><span><strong>Multi race</strong><small>Win rates · distributions · average gains</small></span><b>×N</b></button>
        </div>
        <div class="seed-controls"><label>Starting seed<input type="number" min="-2147483648" max="2147483647" bind:value={setup.seed}/></label><button title="Pick a new starting seed" onclick={()=>setup.seed=randomSeed()}><SimSymbol name="shuffle" size={17}/> Randomize seed</button><label class="check" title={multiRun?'Repeats the same seed sequence for the entire batch. Each race has a distinct seed.':undefined}><input type="checkbox" bind:checked={setup.keepSeed}/> Keep seed{#if multiRun}<small class="seed-hint">Same sequence per batch</small>{/if}</label></div>
        <div class="toolbar run-action">{#if multiRun}<label>Races{setup.variations?' per build':''}<input aria-label="Races" type="number" min={setup.variations?1:2} max="1000" bind:value={setup.count}/></label>{/if}<button class="primary run-button" disabled={busy||active||!setup.participants.length||!token||!Number.isInteger(setup.count)||setup.count<1||totalRuns>1000} onclick={run}><SimSymbol name={multiRun?'batch':'race'} size={22}/>{busy?'Starting…':multiRun?`Run ${totalRuns} races`:'Run single race'}</button></div>

      </section>
    {/if}
    {#if visibleHistory.length}<details class="sim-history"><summary>Simulation history · {visibleHistory.length}</summary><div class="history-list">{#each visibleHistory as h}<button onclick={()=>historyJob(h.id)}><strong>{(h as any).name??'Simulation'}</strong><small>{new Date(h.createdAt).toLocaleString()}</small><span>{h.completed}/{h.total} · {h.phase}</span></button>{/each}</div></details>{/if}
  {/if}
</div>
{#if actionNotice}<div class="added-toast" role="status" aria-atomic="true"><span class="added-check" aria-hidden="true">✓</span><span>{actionNotice}</span><button aria-label="Dismiss notification" onclick={()=>{actionNotice='';clearTimeout(actionTimer);}}>×</button></div>{:else if addedRacer&&mode==='umas'}<div class="added-toast" role="status" aria-atomic="true"><span class="added-check" aria-hidden="true">✓</span><span>Uma added to race as <strong>{racerOrdinal(addedRacer)} racer</strong></span><button aria-label="Dismiss Uma added message" onclick={dismissAdded}>×</button></div>{/if}
<UmaScreenshotImport bind:this={screenshotImporter} {reference} visible={screenshotImport} onClose={()=>screenshotImport=false} onImport={uma=>{screenshotImport=false;edit(null,uma);screenshotImportId=uma.id;}}/>
{#if editing}<UmaEditor value={editing} {reference} {library} onApply={apply} onDraft={checkpointEditor} onSave={saveUma} onTemplate={saveTemplate} onClose={()=>editing=null} applyLabel={mode==='umas'?'Save & close':'Use build'}/>{/if}
{#if saveSetupAs}<SaveAsDialog kind="Setup" current={setup} records={library.setups} onSave={saveSetup} onClose={()=>saveSetupAs=false}/>{/if}
<style>
  .participant-build{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(135px,.85fr);gap:16px;align-items:center}.aptitude-readouts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.aptitude-readouts>div{display:flex;flex-direction:column;gap:3px;align-items:center}.aptitude-readouts>div>span{font-size:10px;color:var(--muted)}.participant-footer{display:flex;gap:14px;align-items:end;flex-wrap:wrap}.participant-footer .participant-meta{flex:1;min-width:170px}.participant-footer .toolbar{gap:6px}.participant-footer .toolbar button{font-size:11px;padding:8px 10px;white-space:nowrap}.participant-head .remove-participant{padding:3px 8px;min-height:28px}.participant .mini-stats{font-size:13px;gap:6px}.participant .popularity strong{font-size:20px}@media(max-width:480px){.participant-build{grid-template-columns:1fr}.aptitude-readouts>div{flex-direction:row;justify-content:center}.participant-footer .participant-meta{min-width:150px}}

  .team-bands{display:grid;gap:18px}.team-band{border:1px solid var(--border);border-left:4px solid var(--team-color);border-radius:10px;overflow:visible;background:var(--panel)}.team-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 12px;min-height:42px;background:color-mix(in srgb,var(--team-color) 8%,var(--panel));border-bottom:1px solid var(--border)}.team-name,.team-name-input{font-size:14px;font-weight:650;line-height:20px;max-width:min(340px,65vw);padding:3px 8px;border:1px solid transparent;background:transparent;color:var(--team-color);border-radius:5px}.team-name{display:flex;align-items:center;gap:10px;text-align:left;overflow-wrap:anywhere}.team-name:hover{background:color-mix(in srgb,var(--team-color) 12%,transparent);border-color:color-mix(in srgb,var(--team-color) 40%,transparent)}.team-name span{font-size:12px;opacity:.55}.team-name-input{width:220px;border-color:var(--team-color)}.team-head>strong{font-size:14px;color:var(--team-color);padding:3px 8px}.team-count{margin-right:auto;color:var(--muted);font-size:11px}.delete-team{font-size:11px;padding:4px 8px}.team-band .participants{padding:16px}.team-band .empty-slot{min-height:120px}.team-band .empty-slot>span{font-size:22px}.participant-meta{display:flex;align-items:end;gap:14px;justify-content:space-between}.participant-meta label{flex:1}.popularity{display:grid;gap:5px;text-align:right;font-size:11px;color:var(--muted)}.popularity strong{font-size:22px;color:var(--text);font-variant-numeric:tabular-nums}.popularity-error{font-size:12px;color:#e5bf65;margin:0}.add-team{justify-self:stretch;display:flex;align-items:center;justify-content:center;min-height:46px;font-size:14px;font-weight:650;color:var(--accent-text);background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px}.add-team:hover{background:color-mix(in srgb,var(--accent) 22%,var(--panel))}

  .participant-head{gap:12px}.participant-head>button:last-child{flex-shrink:0}
  .added-toast{position:fixed;right:24px;bottom:24px;z-index:300;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 48px);padding:13px 15px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:10px;background:var(--panel-raised);box-shadow:0 6px 24px #0005;color:var(--text);font-size:13px}.added-check{color:#a6dbad;font-size:20px}.added-toast button{border:0;background:transparent;color:var(--muted);padding:2px 5px;font-size:20px;line-height:1}
 .preset-toolbar{align-items:flex-start;flex-wrap:wrap}.preset-toolbar>select{width:230px;height:36px;font-size:12px;padding:8px}.participant:focus-within{z-index:40}.seed-hint{font-size:10px;color:var(--muted);font-weight:400}

  .sim-workspace{padding:28px;display:grid;gap:22px;max-width:1700px;width:100%;margin:0 auto}.sim-workspace[hidden]{display:none}.sim-title{display:flex;justify-content:space-between;align-items:center;gap:20px}h1{margin:6px 0;font-size:32px}h2{margin:0;font-size:18px}h2 small{font-size:13px;color:var(--muted);font-weight:400}.sim-section{overflow:visible;padding:22px;display:grid;gap:20px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}.section-head .toolbar{flex-wrap:wrap}label{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:12px}.check{flex-direction:row;align-items:center;white-space:nowrap;gap:7px;color:var(--text)}input,select{min-width:0;padding:9px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}input[type=checkbox]{accent-color:var(--accent)}.condition-presets summary,.sim-history summary{cursor:pointer;font-size:12px;color:var(--muted)}.condition-presets .toolbar{margin-top:14px;flex-wrap:wrap}.participants{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,410px),1fr));gap:14px}.participant{position:relative;min-width:0;background:var(--bg);padding:12px;border:1px solid var(--border);border-radius:10px;display:grid;gap:10px}.participant-head{display:flex;justify-content:space-between;align-items:center;min-width:0}.participant-name{background:transparent;border:0;padding:0;text-align:left;min-width:0}.participant-name strong{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis}.participant-name small{font-size:10px;color:var(--muted);display:block;margin-top:3px}.mini-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;font-variant-numeric:tabular-nums;text-align:center;font-size:15px}.mini-stats span{border-bottom:2px solid var(--stat);padding-bottom:5px}.participant-settings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.participant-settings select{width:100%;padding:7px 4px}.participant .toolbar button{flex:1;font-size:12px}.empty-slot{min-height:300px;border:1px dashed var(--border);background:transparent;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;border-radius:10px}.empty-slot>span{font-size:28px;color:var(--accent-text)}.run-controls{grid-template-columns:1fr auto;align-items:end}.seed-controls{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.seed-controls .check{height:38px}.run-controls .toolbar{align-items:end}.run-controls .toolbar input{width:90px}.run-button{height:39px;min-width:130px}.sim-tabs{display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border);padding-bottom:12px}.sim-tabs button{border:0;background:transparent}.sim-tabs button.active{background:var(--accent-soft);color:var(--accent-text)}.sim-tabs span{margin-left:auto;font-size:12px}.job-progress{display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:12px}.job-progress progress{flex:1;accent-color:var(--accent)}.job-progress p{width:100%;color:#efaa83}.sim-actions{display:flex;gap:8px}.participant-name{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:2px}.participant-name strong{white-space:normal;overflow-wrap:anywhere}.history-list{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}.history-list button{display:grid;gap:6px;text-align:left}.history-list small,.history-list span{color:var(--muted);font-size:11px}.import-warnings{border:1px solid #af8854;border-radius:8px;padding:14px;font-size:12px;color:#d9b478}.import-warnings summary{cursor:pointer}.import-warnings p{margin:6px 0}@media(max-width:1100px){.sim-workspace{padding:18px}.run-controls{grid-template-columns:1fr}.sim-title{align-items:flex-start}.sim-title .toolbar{flex-wrap:wrap}}

  .preset-toolbar{align-items:flex-start}
  .shared-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.shared-moods{display:flex;align-items:stretch;border:1px solid var(--border);border-radius:9px;background:var(--bg)}.fixed-mood{display:flex;align-items:center;gap:8px;padding:6px 10px}.fixed-mood :global(.mood-picker){width:112px}.random-all{padding:10px;border-left:1px solid var(--border)}.section-head{flex-wrap:wrap}
  .gate-toggle{border:1px solid var(--border);padding:11px 15px;border-radius:9px;background:var(--bg);gap:10px}.random-gate{display:flex;align-items:center;gap:6px;min-height:33px;padding:6px;color:var(--muted);background:var(--panel);opacity:.6;border:1px solid var(--border);border-radius:6px;font-size:11px}.run-controls{--run-color:#80cadc;border-top:3px solid var(--run-color)}.run-controls.batch-mode{--run-color:#b4a0ee}.run-modes{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:12px}.run-modes button{display:flex;gap:14px;align-items:center;text-align:left;padding:17px;border:1px solid var(--border);background:var(--bg);border-radius:10px;color:var(--muted)}.run-modes button:first-child{--mode-color:#80cadc}.run-modes button:last-child{--mode-color:#b4a0ee}.run-modes button.chosen{border-color:var(--mode-color);background:color-mix(in srgb,var(--mode-color) 9%,var(--bg));color:var(--mode-color)}.run-modes strong{display:block;font-size:16px;color:var(--text)}.run-modes small{display:block;margin-top:5px;font-size:11px;font-weight:400;color:var(--muted)}.run-modes b{margin-left:auto;font-size:25px;opacity:.7}.run-button{display:flex;gap:10px;align-items:center;justify-content:center;background:var(--run-color);color:#15191c;border-color:var(--run-color);height:43px}.seed-controls>button{display:flex;gap:6px;align-items:center}.run-action{justify-content:flex-end}@media(max-width:720px){.run-modes{grid-template-columns:1fr}.gate-toggle{width:100%}.run-modes button{padding:12px}}
</style>
