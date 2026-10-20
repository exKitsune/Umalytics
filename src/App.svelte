<script lang="ts">
  import { onMount } from 'svelte';
  import {collectorStatus} from './collector-status';
  import {formatRaceTime} from './data/race-time';
  import { importRace, parseRaceJson, sampleAt } from './data';
  import type { Race, RaceCategory } from './data/types';
  import { toPortableRace } from './data/share';
  import { loadReferenceData, getCourse, runnerName, runnerOutfit, skillName, type ReferenceData } from './data/reference';
  import { buildUmalatorExport, jsonDownloadName, umaDownloadName } from './data/umalator';
  import { categories, captureFacet, facetInfo, libraryFacets, runnerColors, saveRace, savedRaces, deleteSavedRace, createLibraryCaptionHydrator, type LibraryEntry } from './library';
  import { api, saveDesktopExport, revealDesktop, defaultSettings, type Health, type CollectionSettings, type CertificateStatus } from './api';
  import { browserPreferences, migrateBrowserStorage, saveDesktopRace, raceForExport, THEME_KEY } from './desktop-storage';
  import AnalysisDetails from './components/AnalysisDetails.svelte';
  import AppUpdates from './components/AppUpdates.svelte';
  import { rankSamples, runnerGap } from './view-model';
  import RaceTrack from './components/RaceTrack.svelte';
  import RaceConditions from './components/RaceConditions.svelte';
  import Telemetry from './components/Telemetry.svelte';
  import CurveReplay from './components/CurveReplay.svelte';
  import RunnerPanel from './components/RunnerPanel.svelte';
  import FieldStats from './components/FieldStats.svelte';
  import RaceTeams from './components/RaceTeams.svelte';
  import SkillMatrix from './components/SkillMatrix.svelte';
  import SkillDetails from './components/SkillDetails.svelte';
  import AnalysisFaq from './components/AnalysisFaq.svelte';
  import { FONT_SCALE_KEY, MIN_FONT_SCALE, MAX_FONT_SCALE, normalizeFontScale } from './typography';
  let faqOpen=false;
  import type { RaceAnalysis } from './data/analytics';
  import { AnalysisClient, type AnalysisState } from './analysis/client';
  import { preparedFor } from './analysis/prepared';
  import { AnalysisStore, defaultCachePolicy, type CacheStatus } from './analysis/store';
  import CacheSettings from './components/CacheSettings.svelte';
  import DeferredPanel from './components/DeferredPanel.svelte';
  import AnalysisSkeleton from './components/AnalysisSkeleton.svelte';
  import { normalizeTags, withinDateRange, readRaceTags, type RaceTags } from './library-filters';
  import { courseCaption, conditionsCaption, captionInference } from './race-display';
  import { inferCourse } from './data/course-inference';
  import { sampleRecordedAt } from './data/observational-sample';
  import {analysisNotice} from './simulation/presentation';
  import {recordedDashboard} from './analysis/recorded';
  import SidebarUpdate from './components/SidebarUpdate.svelte';
  import type { AnalysisGateReportSummary } from './simulation/contracts';
  import type { PreparedRace } from './analysis/prepared';
  import { resolveCourseIdentity } from './data/course-detection';
  let skillDetail:number|null=null;
  let skillDetailRunner:string|null=null;
  function openSkill(id:number,runnerId=selected){playing=false;skillDetailRunner=runnerId;skillDetail=id;}
  const browserSettings=browserPreferences();
  let desktopSession=location.port==='4317'||'__TAURI_INTERNALS__' in window;
  let storageReady=!desktopSession;
  let migrationRunning=false;
  let migrationAttemptAt=0;
  let migrationError='';
  let reference: ReferenceData|null = null;
  let library: LibraryEntry[] = [];
  let race: Race|null = null;
  let recordedRace:Race|null=null;
  let activeId = '';
  let pendingRemoval = '';
  let pendingCertRemoval = false;
  let downloadPromptOpen = false;
  let dropActive = false;
  let dragDepth = 0;
  const DOWNLOAD_URL = 'https://github.com/exKitsune/Umalytics/releases/latest';
  let selected = '';
  let runnerSelectionTouched=false;
  function selectRunner(id:string){selected=id;runnerSelectionTouched=true;}
  function selectDefaultRunner(value:Race){
    if(!runnerSelectionTouched||!value.runners.some(r=>r.id===selected))selected=(value.runners.find(r=>r.finishOrder===1)??value.runners[0])?.id??'';
  }
  let time = 0;
  let playing = false;
  let playbackSpeed = 1;
  let sidebarCollapsed=localStorage.getItem('umalytics.library-collapsed')==='true';
  function toggleLibrary(){sidebarCollapsed=!sidebarCollapsed;localStorage.setItem('umalytics.library-collapsed',String(sidebarCollapsed));}
  let search = '';
  let filter = 'all';
  let theme = browserSettings.theme;
  let fontScale = browserSettings.fontScale;
  let health: Health|null = null;
  let healthReconnecting=false;
  let settings = defaultSettings();
  let certificate: CertificateStatus|null = null;
  let settingsOpen = false;
  let following = true;
  let message = '';
  let error = '';
  let busy = false;
  let importing = false;
  let removingId = '';
  let libraryRevision = 0;
  let input: HTMLInputElement;
  let polling = false;
  let nextOffset: number|null = null;
  let totalRemote = 0;
  let detailTab = 'skills';
  let exportDraft = '';
  let previousFocus: HTMLElement|null = null;
  let selectionRequest = 0;
  let analysis:RaceAnalysis|null=null;
  let analysisGate:AnalysisGateReportSummary|null=null;
  let historical:PreparedRace|null=null;
  let analysisState:AnalysisState={busy:false,background:false,done:0,total:0,message:'Ready'};
  let cacheStatus:CacheStatus={policy:defaultCachePolicy(),entries:[],bytes:0};
  let raceTags:RaceTags=readRaceTags(),tagDraft='',tagFilter='',dateFrom='',dateTo='';
  let referenceReady=false,historyLoading=false,historyLoaded=false,disposed=false;
  const analysisClient=new AnalysisClient(new AnalysisStore(()=>desktopSession,()=>health?.csrfToken),{
    token:()=>health?.csrfToken,
    gate:(value,id)=>{if(activeId===id)analysisGate=value;},
    recorded:id=>{if(activeId===id){analysis=null;historical=null;race=recordedRace;}},
    historical:(value,id)=>{if(activeId===id)historical=value;},
    reference:value=>reference=value,
    parsed:(value,id)=>{if(activeId!==id)return;race=value;recordedRace=value;selectDefaultRunner(value);},
    base:(value,result,id)=>{if(activeId!==id)return;race=value;analysis=result;},
    ready:(value,id)=>{if(activeId!==id)return;race=value.race;analysis=value.analysis;selectDefaultRunner(race);},
    state:value=>analysisState=value,cache:value=>cacheStatus=value,error:value=>error=value,
  });
  $: analysisClient.useService(health?.analysisService===true);
  $: analysisClient.setLibrary(library,{});
  $: if(race&&!analysis&&!analysisState.busy){const value=recordedDashboard(race);race=value.race;analysis=value.analysis;}
  $: analysisClient.setPaused(playing);
  $: selectedReady=!!analysis&&!!preparedFor(analysis)?.runners[selected];
  $: allTags=[...new Set(Object.values(raceTags).flat())].sort((a,b)=>a.localeCompare(b));
  $: tagDraft=(raceTags[activeId]??[]).join(', ');
  $: if(settingsOpen)void analysisClient.refresh().catch(e=>error=String(e));
  const hydrateCaptions=createLibraryCaptionHydrator((id,caption)=>{
    const old=library.find(e=>e.id===id);if(!old||old.race)return;
    if(old.courseId===caption.courseId&&old.distance===caption.distance&&old.courseInference===caption.courseInference&&old.courseIdentity?.source===caption.courseIdentity?.source)return;
    library=library.map(e=>e.id===id?{...e,...caption}:e);
  });
  $: collecting = !healthReconnecting && health?.proxy?.state==='running' && settings.collectionEnabled && certificate?.trusted;
  $: gameConnected=!healthReconnecting&&health?.proxy?.gameConnected===true;
  $: setupSettled=totalRemote>0||library.some(e=>!e.synthetic&&(!!e.remoteId||e.id.startsWith('capture-')));
  $: setupAttention=desktopSession&&!setupSettled;
  $: collectorLabel=collectorStatus(health,desktopSession,healthReconnecting,settings,certificate);
  function modalFocus(node:HTMLElement) {
    previousFocus=document.activeElement as HTMLElement;node.focus();
    const handler=(e:KeyboardEvent)=>{if(e.key==='Escape'){closeSettings();return;}if(e.key!=='Tab')return;const elements=Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]'));const first=elements[0],last=elements.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===node)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}};
    node.addEventListener('keydown',handler);return {destroy(){node.removeEventListener('keydown',handler);previousFocus?.focus()}};
  }
  $: document.documentElement.dataset.theme = theme;
  $: document.documentElement.style.setProperty('--font-scale',String(fontScale/100));
  $: visible = library.filter(entry => (filter==='all'||captureFacet(entry)===filter) && withinDateRange(entry.race?.racedAt??entry.racedAt??entry.receivedAt,dateFrom,dateTo) && (!tagFilter||(raceTags[entry.id]??[]).includes(tagFilter)) && search.toLowerCase().trim().split(/\s+/).every(term=>`${courseCaption(entry.race??entry,reference)} ${conditionsCaption(entry.race??entry)} ${facetInfo(captureFacet(entry)).label} ${(raceTags[entry.id]??[]).join(' ')}`.toLowerCase().includes(term))).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
  $: identityRace = race ? resolveCourseIdentity(race,reference) : null;
  $: inferredCourse = analysis && analysis.source!=='simulation' && analysis.source!=='recorded' && identityRace ? inferCourse(identityRace,reference) : null;
  $: candidateCourse = getCourse(reference,identityRace?.courseId??inferredCourse?.courseId??null);
  $: course = candidateCourse && race?.distance && candidateCourse.distance!==race.distance ? null : candidateCourse;
  $: analysisRace = race;
  $: samples = analysisRace ? (analysis ? sampleAt(analysisRace,time,reference) : sampleRecordedAt(analysisRace,time)) : [];
  $: ranks = race ? rankSamples(race,samples,time) : new Map<string,number>();
  $: runner = race?.runners.find(r=>r.id===selected) ?? null;
  $: selectedSample = samples.find(s=>s.runnerId===selected);
  $: selectedGap = analysisRace ? runnerGap(analysisRace,samples,selected) : null;
  $: selectedEvents = race?.events.filter(e=>e.runnerId===selected) ?? [];
  $: uma = analysis && runner && analysisRace ? buildUmalatorExport(runner,analysisRace,reference) : null;
  const fmt = (n:number|null|undefined, decimals=0) => n==null?'—':n.toFixed(decimals);
  const date = formatRaceTime;
  const tell = (text:string) => {message=text;error='';};
  function merge(entries:LibraryEntry[]) {const byId=new Map(library.map(e=>[e.id,e]));for(const e of entries)byId.set(e.id,e);library=[...byId.values()];}
  function setRace(value:Race,id:string) {const entry=library.find(e=>e.id===id)??{id,title:value.title,receivedAt:value.capturedAt??new Date().toISOString(),race:value};if(!library.some(e=>e.id===id)&&id==='demo')merge([entry]);void selectEntry(entry);}
  function clearRace() {
    ++selectionRequest;activeId='';race=null;recordedRace=null;analysis=null;analysisGate=null;historical=null;selected='';
    time=0;playing=false;skillDetail=null;runnerSelectionTouched=false;analysisClient.clearSelection();
  }
  async function removeRace(entry:LibraryEntry) {
    if(importing||removingId)return;
    pendingRemoval='';removingId=entry.id;++libraryRevision;
    const wasSelected=activeId===entry.id||activeId.startsWith(`${entry.id}:`);
    if(wasSelected)clearRace();
    try {
      if(entry.remoteId){if(!health?.csrfToken)throw new Error('Open the desktop app to delete a collected race.');await api('races/delete',{id:entry.remoteId},health.csrfToken);}
      if(!entry.remoteId&&entry.id.startsWith('local-')){if(desktopSession)throw new Error('Wait for the desktop library to finish moving your saved races.');await deleteSavedRace(entry.id);}
      library=library.filter(item=>item.id!==entry.id&&!item.id.startsWith(`${entry.id}:`));
      analysisClient.forget(entry.id);analysisClient.setLibrary(library,{});
    } catch(e){removingId='';if(wasSelected&&!activeId)void selectEntry(entry,true);error=String(e);}
    finally{removingId='';++libraryRevision;}
  }
  async function selectEntry(entry:LibraryEntry,force=false) {
    if(removingId===entry.id||(!force&&entry.id===activeId))return;
    const request=++selectionRequest;error='';activeId=entry.id;race=entry.race??null;recordedRace=race;analysis=null;analysisGate=null;historical=null;selected='';runnerSelectionTouched=false;time=0;playing=false;skillDetail=null;
    try {if(referenceReady)await analysisClient.open(entry);}catch(e){if(request===selectionRequest)error=String(e);}
  }
  async function saveTags(){
    const tags=normalizeTags(tagDraft),next={...raceTags};if(tags.length)next[activeId]=tags;else delete next[activeId];
    try{if(desktopSession){if(!health?.csrfToken)throw new Error('Desktop settings are unavailable.');await api('preferences',{raceTags:next},health.csrfToken);}else localStorage.setItem('umalytics-race-tags',JSON.stringify(next));raceTags=next;tagDraft=tags.join(', ');}catch(e){error=String(e);}
  }
  function sidebarCourse(entry:LibraryEntry){const caption=courseCaption(entry.race??entry,reference);return caption.replace(/\s*[·]?\s*\d[\d,]*\s*m\b/i,'').replace(/^[\s·]+|[\s·]+$/g,'');}
  function sidebarDistance(entry:LibraryEntry){const id=entry.race?.courseId??entry.courseId;return (id?reference?.courses[id]?.distance:null)??entry.race?.distance??entry.distance;}
  async function importFiles(files:FileList|File[]|null) {
    if(importing||removingId||!files||!files.length)return;
    const picked=Array.from(files).filter(file=>/\.(json|jsonl|msgpack|mpk|har)$/i.test(file.name));
    if(!picked.length){error='Drop a race JSON file.';return;}
    importing=true;++libraryRevision;error='';let count=0;
    try {if(desktopSession&&(!storageReady||!health?.csrfToken))throw new Error('Desktop library is unavailable. Your file has not been imported; try again when it reconnects.');for(const file of picked){if(file.size>64*1024*1024)throw new Error(`${file.name} exceeds 64 MB.`);const parsed=await importRace(await file.arrayBuffer(),file.name);for(const r of parsed){const entry=desktopSession?await saveDesktopRace(r,health!.csrfToken!):await saveRace(r);merge([entry]);setRace(r,entry.id);count++;}}tell(`Imported ${count} race${count===1?'':'s'}.`);}catch(e){error=String(e)}finally{importing=false;++libraryRevision;if(input)input.value='';}
  }
  function isFileDrag(e:DragEvent){return !!e.dataTransfer&&[...e.dataTransfer.types].includes('Files');}
  function onDragEnter(e:DragEvent){if(!isFileDrag(e))return;e.preventDefault();dragDepth++;dropActive=true;}
  function onDragOver(e:DragEvent){if(!isFileDrag(e))return;e.preventDefault();e.dataTransfer!.dropEffect='copy';dropActive=true;}
  function onDragLeave(e:DragEvent){if(!isFileDrag(e))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dropActive=false;}
  function onDrop(e:DragEvent){e.preventDefault();dragDepth=0;dropActive=false;void importFiles(e.dataTransfer?.files??null);}
  function download(text:string,name:string) {const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function saveJsonFile(filename:string,content:string,label:string) {
    try {if(health?.mode==='desktop'&&health.csrfToken){const saved=await saveDesktopExport(filename,content,health.csrfToken);tell(saved.revealed?`${label} saved · shown in Explorer.`: `${label} saved: ${saved.path}`);}else{download(content,filename);tell(`${label} downloaded.`);}}catch(e){error=String(e)}
  }
  async function exportRace() {
    const recorded=recordedRace??analysisRace;if(!recorded)return;
    const entry=library.find(item=>item.id===activeId);
    try{
      const original=await raceForExport(entry,recorded);
      const filename=jsonDownloadName(courseCaption(original,reference),(original.capturedAt??'').replace(/[:.]/g,'-')||'race');
      await saveJsonFile(filename,JSON.stringify(toPortableRace(original),null,2),'Race JSON');
    }catch(e){error=String(e);}
  }
  async function exportAnalysis() {
    const gate=analysisGate;
    if(!gate)return;
    try{
      const simulationDetail=gate.mode==='verified_simulation'?await analysisClient.simulatedDetails():null;
      if(analysisGate!==gate||(gate.mode==='verified_simulation'&&!simulationDetail)){error='Simulation authorization changed. Reopen this race before exporting.';return;}
      await saveJsonFile('versioned-analysis.json',JSON.stringify({schemaVersion:1,source:gate.mode==='inference_plan'?'Inferred':gate.mode==='verified_simulation'?'Simulated':'Recorded diagnostics',
        notice:analysisNotice(gate),gate:simulationDetail??gate,analysis:historical??(analysis?preparedFor(analysis):null)},null,2),'Versioned analysis');
    }catch{error='Analysis export is no longer authorized. Reopen this race.';}
  }
  async function downloadUmaJson() {
    if(!runner||!analysisRace)return;
    if(!uma?.json){error=uma?.missing.length?`Uma JSON needs ${uma.missing.join(', ')}.`:'Uma JSON is unavailable.';return;}
    await saveJsonFile(umaDownloadName(runner,analysisRace,reference),uma.json,'Uma JSON');
  }
  function openSettings(){exportDraft=settings.exportDirectory??'';pendingCertRemoval=false;message='';settingsOpen=true;}
  function closeSettings(){settingsOpen=false;pendingCertRemoval=false;}
  function requestAutoCollection(){if(desktopSession)openSettings();else downloadPromptOpen=true;}
  async function revealFolder(target:'data'|'exports') {
    if(!health?.csrfToken)return;
    try{const saved=await revealDesktop(target,health.csrfToken);tell(saved.revealed?'Opened in Explorer.':saved.path);}catch(e){error=String(e)}
  }
  async function saveExportFolder(path:string|null) {
    await updateSettings({exportDirectory:path});
    exportDraft=settings.exportDirectory??'';
  }
  async function uninstallCertificate() {if(!certificate?.sha256||!health?.csrfToken)return;busy=true;try{await api('certificate/uninstall',{sha256:certificate.sha256},health.csrfToken);pendingCertRemoval=false;await refreshCertificate();tell('Capture certificate removed.');}catch(e){error=String(e)}finally{busy=false}}
  async function installAvailableUpdate() {
    const current=health;if(!current?.csrfToken)return;openSettings();busy=true;
    try{health={...current,update:await api('update/install',{},current.csrfToken)};tell('Installing update…');}catch(e){error=String(e)}finally{busy=false}
  }
  async function setTheme(value:'dark'|'light') {try{if(desktopSession){if(!storageReady||!health?.csrfToken)throw new Error('Desktop preferences are unavailable. Try again when it reconnects.');const result=await api<{theme:'dark'|'light'}>('preferences',{theme:value},health.csrfToken);theme=result.theme;}else{localStorage.setItem(THEME_KEY,value);theme=value;}}catch(e){error=String(e);}}
  async function saveFontScale(value=fontScale) {
    fontScale=normalizeFontScale(value);
    try {
      if(desktopSession){
        if(!storageReady||!health?.csrfToken)throw new Error('Desktop preferences are unavailable. Try again when it reconnects.');
        await api('preferences',{fontScale},health.csrfToken);
      }else localStorage.setItem(FONT_SCALE_KEY,String(fontScale));
    }catch(e){error=String(e);}
  }
  async function copy(text:string,success:string) {try{await navigator.clipboard.writeText(text);tell(success)}catch{error='Clipboard is unavailable. Use the download button instead.'}}
  async function loadPage(offset=0) {
    const revision=libraryRevision;
    const page=await api<{races:{id:string;title?:string;category?:RaceCategory;receivedAt:string;racedAt?:string;raceMode?:'practice'|'room';savedReplay?:boolean;raceDesignation?:Race['raceDesignation'];filename:string;courseId?:number|null;distance?:number|null;conditions?:Race['conditions'];raceInstanceId?:number;sha256?:string;courseIdentity?:Race['courseIdentity']}[];total:number;nextOffset:number|null}>(`races?summary=1&limit=200&offset=${offset}`);
    if(disposed||importing||removingId||revision!==libraryRevision)return false;
    const entries=page.races.map(r=>({id:r.id.startsWith('local-')?r.id:`capture-${r.id}`,remoteId:r.id,title:r.title??r.filename,category:r.category,receivedAt:r.receivedAt,racedAt:r.racedAt,raceMode:r.raceMode,savedReplay:r.savedReplay,raceDesignation:r.raceDesignation,courseId:r.courseId,distance:r.distance,conditions:r.conditions,raceInstanceId:r.raceInstanceId,sha256:r.sha256,courseIdentity:r.courseIdentity}));
    const newest=entries[0], isNew=newest&&!library.some(e=>e.id===newest.id);
    merge(entries.map(e=>{const old=library.find(old=>old.id===e.id);return {...hydrateCaptions.cached(e,reference),...(old?.race?{race:old.race,title:old.race.title,category:old.race.category}:{})}}));totalRemote=page.total;
    void hydrateCaptions(library,reference);
    if(offset>0 || !historyLoaded) nextOffset=page.nextOffset;
    if(offset===0&&newest&&(!activeId||(following&&isNew&&!playing)))await selectEntry(newest);
    if(offset===0&&!historyLoaded&&!historyLoading)void loadHistory();
    return true;
  }
  async function loadHistory(){historyLoading=true;try{while(nextOffset!==null&&!disposed){const offset=nextOffset;if(!await loadPage(offset))return;await new Promise(resolve=>setTimeout(resolve,30));}historyLoaded=true;}catch(e){error=`History could not be loaded: ${e}`;}finally{historyLoading=false;}}
  let healthPolling=false;
  async function prepareDesktopStorage(){if(storageReady||migrationRunning||importing||!health?.csrfToken||Date.now()-migrationAttemptAt<5000)return;migrationRunning=true;migrationAttemptAt=Date.now();try{const preferences=await migrateBrowserStorage(health.csrfToken);theme=preferences.theme;fontScale=normalizeFontScale(preferences.fontScale);raceTags=preferences.raceTags??{};library=library.filter(entry=>!entry.id.startsWith('local-')||entry.remoteId);storageReady=true;migrationError='';}catch{migrationError='Your browser library is still being moved to Umalytics. Originals are saved; retrying shortly.';}finally{migrationRunning=false;}}
  async function pollHealth(){if(!['localhost','127.0.0.1'].includes(location.hostname)||healthPolling)return;healthPolling=true;try{health=await api<Health>('health');healthReconnecting=false;certificate=health.certificate??null;if(health.mode==='desktop'&&desktopSession)await prepareDesktopStorage();}catch{healthReconnecting=true;}finally{healthPolling=false;}}
  async function poll() {
    if(!['localhost','127.0.0.1'].includes(location.hostname))return;
    if(polling)return;polling=true;
    try {await pollHealth();if(!healthReconnecting&&health?.mode==='desktop'){settings=await api<CollectionSettings>('settings');if(storageReady)await loadPage();}}catch{/* A library/settings failure does not invalidate collector health. */}finally{polling=false;}
  }
  async function updateSettings(patch:Partial<CollectionSettings>) {if(!health?.csrfToken)return;busy=true;try{const result=await api<CollectionSettings>('settings',patch,health.csrfToken);settings=result;tell('Collection settings saved.');await poll();}catch(e){error=String(e)}finally{busy=false}}
  async function refreshCertificate() {try{certificate=await api<CertificateStatus>('certificate');tell(certificate.trusted?'Certificate is trusted for your Windows user.':'Certificate is not trusted.');}catch(e){error=String(e)}}
  async function installCertificate() {if(!certificate?.sha256||!health?.csrfToken)return;busy=true;try{await api('certificate/install',{sha256:certificate.sha256},health.csrfToken);await refreshCertificate();}catch(e){error=String(e)}finally{busy=false}}
  function seek(t:number) {time=Math.max(0,Math.min(race?.duration??0,t));}
  function togglePlay(){if(!race)return;if(time>=race.duration)time=0;playing=!playing;}
  function keydown(e:KeyboardEvent){if(downloadPromptOpen){if(e.key==='Escape')downloadPromptOpen=false;return;}if(e.defaultPrevented||settingsOpen||skillDetail!==null||(e.target instanceof HTMLElement&&['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)))return;if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.code==='ArrowRight'){seek(time+1)}else if(e.code==='ArrowLeft'){seek(time-1)}}
  function dismissPopups(event:PointerEvent){analysisClient.interacting();const node=event.target as HTMLElement|null;if(!node)return;if(pendingRemoval&&!node.closest('.race-delete'))pendingRemoval='';}
  onMount(()=>{
    let cancelled=false;
    loadReferenceData().then(async data=>{if(!cancelled){reference=data;await analysisClient.configure(data);if(cancelled)return;referenceReady=true;void hydrateCaptions(library,reference);const entry=library.find(e=>e.id===activeId);if(entry)await selectEntry(entry,true);}}).catch(e=>error=String(e));
    if(!desktopSession)savedRaces().then(entries=>{if(cancelled||desktopSession)return;entries=entries.map(entry=>{if(!entry.race||entry.race.distance)return entry;try{return {...entry,race:parseRaceJson(entry.race)[0]}}catch{return entry}});merge(entries);if(!race&&entries.length)selectEntry(entries.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt))[0]);}).catch(e=>error=`Local library unavailable: ${e}`);
    poll();const healthTimer=setInterval(pollHealth,1000);const timer=setInterval(poll,5000);let previous=performance.now(),animation=0;
    const step=(now:number)=>{if(playing&&race){time=Math.min(race.duration,time+Math.min(.15,(now-previous)/1000)*playbackSpeed);if(time>=race.duration)playing=false;}previous=now;animation=requestAnimationFrame(step)};animation=requestAnimationFrame(step);
    return()=>{cancelled=true;disposed=true;analysisClient.dispose();clearInterval(timer);clearInterval(healthTimer);cancelAnimationFrame(animation);hydrateCaptions.dispose()};
  });
</script>
<svelte:window onkeydown={keydown} onpointerdown={dismissPopups} onpointermove={e=>{if(e.buttons)analysisClient.interacting();}} onwheel={()=>analysisClient.interacting()} ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}/>
<input class="file-input" bind:this={input} type="file" accept=".json,.jsonl,.msgpack,.mpk,.har" multiple onchange={e=>importFiles(e.currentTarget.files)}/>
<svelte:head><title>Umalytics — {collectorLabel}</title></svelte:head>
<div class="app-shell" class:library-collapsed={sidebarCollapsed}>
  {#if dropActive}<div class="drop-overlay" aria-hidden="true"><strong>Drop race JSON</strong><span>It will be imported into this library</span></div>{/if}
  <aside class="sidebar">
    <div class="sidebar-brand"><div class="brand"><span class="brand-mark">u<span>↗</span></span>{#if !sidebarCollapsed}<div>Umalytics<small>RACE WORKSPACE</small></div>{/if}</div><button class="library-collapse" aria-label={sidebarCollapsed?'Expand race library':'Collapse race library'} title={sidebarCollapsed?'Expand race library':'Collapse race library'} aria-expanded={!sidebarCollapsed} onclick={toggleLibrary}>{sidebarCollapsed?'›':'‹'}</button></div>
    <button class="primary import-button" onclick={()=>input.click()} disabled={importing||!!removingId} aria-label="Import race JSON" title="Import race JSON">＋{#if !sidebarCollapsed} Import race JSON{/if}</button>
    {#if !sidebarCollapsed}
    <p class="import-hint">or drop a race JSON anywhere in this window</p>
    <div class="library-heading"><span>RACE LIBRARY</span><span>{visible.length} / {Math.max(library.length,totalRemote)}</span></div>
    <input class="search" type="search" placeholder="Search races…" aria-label="Search races" bind:value={search}/>
    <div class="filter-chips"><button class:active={filter==='all'} onclick={()=>filter='all'}>All</button>{#each libraryFacets as c}<button class:active={filter===c.id} title={c.label} onclick={()=>filter=c.id}><i style={`background:${c.color}`}></i>{c.short}</button>{/each}</div>
    <details class="library-filters"><summary>Date &amp; tags{dateFrom||dateTo||tagFilter?' · filtered':''}</summary><label>From<input type="date" aria-label="Race date from" bind:value={dateFrom} max={dateTo||undefined}/></label><label>To<input type="date" aria-label="Race date to" bind:value={dateTo} min={dateFrom||undefined}/></label><label>Tag<select aria-label="Filter by tag" bind:value={tagFilter}><option value="">All tags</option>{#each allTags as tag}<option value={tag}>{tag}</option>{/each}</select></label><button onclick={()=>{dateFrom='';dateTo='';tagFilter='';}}>Clear filters</button></details>
    {/if}
    <div class="race-list">
      {#each (sidebarCollapsed?library:visible) as entry (entry.id)}
        {@const category=facetInfo(captureFacet(entry))}
        {@const inference=captionInference(entry.race??entry,reference)}
        {@const manuallySelected=(entry.race?.courseIdentity??entry.courseIdentity)?.source==='manual'}
        {@const entryInferred=!manuallySelected&&((entry.race?.courseIdentity??entry.courseIdentity)?.source==='skill-conditions'||!!inference?.trackId||!!inference?.courseId)}
        {#if sidebarCollapsed}<button class="race-mini" class:chosen={activeId===entry.id} aria-current={activeId===entry.id?'true':undefined} aria-label={`${courseCaption(entry.race??entry,reference)} · ${date(entry.race?.racedAt??entry.racedAt??entry.receivedAt)}`} title={`${courseCaption(entry.race??entry,reference)}
${date(entry.race?.racedAt??entry.racedAt??entry.receivedAt)}`} style={`--category:${category.color}`} onclick={()=>selectEntry(entry)}><svg viewBox="0 0 32 20" aria-hidden="true"><rect x="2" y="3" width="28" height="14" rx="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M22 2v16" stroke="currentColor" stroke-dasharray="2 2"/></svg><small>{entry.synthetic?'Demo':category.id==='room'?'Room':category.short}</small></button>{:else}
        <div class="race-row"><button class="race-card" class:chosen={activeId===entry.id} aria-current={activeId===entry.id?'true':undefined} style={`--category:${category.color}`} onclick={()=>selectEntry(entry)}><span class="race-card-top"><span class="category-label">{entry.synthetic?'Demo':category.short}</span><span title="Race time in your local timezone">{date(entry.race?.racedAt??entry.racedAt??entry.receivedAt)}</span></span><strong>{sidebarCourse(entry)}</strong><span class="race-distance">{sidebarDistance(entry)?.toLocaleString()??'Unknown'} m</span>{#if raceTags[entry.id]?.length}<span class="race-tags">{#each raceTags[entry.id] as tag}<span>{tag}</span>{/each}</span>{/if}<small>{conditionsCaption(entry.race??entry)||'Conditions unknown'}</small>{#if entryInferred}<small title="Course identified from equipped skills.">Inferred from skills</small>{:else if manuallySelected}<small>Course selected</small>{/if}{#if entry.race}<small class="race-card-count">{entry.race.runners.length} runners</small>{/if}</button>{#if pendingRemoval===entry.id}<button class="race-delete confirm" disabled={importing||!!removingId} onclick={()=>removeRace(entry)}>Remove</button>{:else}<button class="race-delete" disabled={importing||!!removingId} aria-label={`Remove ${courseCaption(entry.race??entry,reference)}`} onclick={()=>pendingRemoval=entry.id}>×</button>{/if}</div>{/if}
      {/each}
      {#if !(sidebarCollapsed ? library : visible).length}<div class="library-empty">Your races will appear here.<br/>Import JSON, drop a file, or enable collection.</div>{/if}
      {#if historyLoading}<small role="status">Loading history…</small>{:else if nextOffset!==null}<button class="load-more" onclick={loadHistory}>Load older races</button>{/if}
    </div>
    <div class="sidebar-bottom">{#if !sidebarCollapsed}<label class="check"><input type="checkbox" bind:checked={following}/> Follow new races</label>
      {#if health?.update?.availableVersion}<SidebarUpdate status={health.update} disabled={!health.csrfToken||busy} onInstall={installAvailableUpdate}/>{/if}
      {/if}<button onclick={openSettings} aria-label="Settings" title="Settings"><span>⚙</span>{#if !sidebarCollapsed} Settings{/if}</button>
    </div>
  </aside>
  <main>
    <header class="topbar"><div><span class="breadcrumb">Workspace</span><span class="slash">/</span><strong>Race analysis</strong>{#if analysisGate?.mode==='verified_simulation'}<small class="analysis-source" title={analysis?.source==='simulation'?'All supported recorded fields match.':'Analysis estimated from the recorded race.'}>Simulation matched</small>{:else if analysisGate?.mode==='inference_plan'}<small class="analysis-source" title={analysis?.source==='simulation'?'All supported recorded fields match.':'Analysis estimated from the recorded race.'}>Inferred analysis</small>{/if}</div><div class="toolbar"><button onclick={()=>faqOpen=true}>FAQ</button><span class="connection"><i class="status-dot" class:live={gameConnected} class:ready={collecting&&!gameConnected}></i>{collectorLabel}</span><button class="icon-button" aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`} title="Toggle theme" onclick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?'☀':'☾'}</button></div></header>
    {#if migrationError}<div class="notice" role="status">{migrationError}</div>{/if}
    {#if error||message}<div class="notice" class:error={!!error} role="status"><span>{error||message}</span><button aria-label="Dismiss message" onclick={()=>{message='';error=''}}>×</button></div>{/if}
    {#if activeId && analysisState.busy && !analysisState.background && !analysis}
      <div class="workspace"><AnalysisSkeleton title={courseCaption(race??library.find(e=>e.id===activeId)??{},reference)} conditions={race?.conditions??library.find(e=>e.id===activeId)?.conditions} runners={race?.runners.length??9} message={analysisState.message}/></div>
    {:else if race && analysisRace}
      <div class="workspace">
        {#if analysis?.source==='recorded'}<p class="muted">Recorded data · unavailable analysis fields are left blank.</p>{/if}
        {#if analysis}<div class="analysis-layout"><div class="analysis-main">
        <div class="race-heading"><div class="race-heading-meta"><div class="eyebrow"><i style={`background:${facetInfo(captureFacet(race)).color}`}></i>{race.synthetic?'SAMPLE RACE':facetInfo(captureFacet(race)).label.toUpperCase()}<span>·</span>{race.runners.length} RUNNERS<span>·</span>{race.duration.toFixed(2)} S</div><h1>{courseCaption(analysisRace,reference)}</h1><RaceConditions conditions={race.conditions}/><div class="race-datetimes">{#if analysisRace.racedAt??analysisRace.capturedAt}<span>Recorded at <time>{date(analysisRace.racedAt??analysisRace.capturedAt??'')}</time></span>{/if}{#if library.find(e=>e.id===activeId)?.receivedAt}<span>Saved at <time>{date(library.find(e=>e.id===activeId)?.receivedAt??'')}</time></span>{/if}</div></div><RaceTeams race={analysisRace} {reference} {selected} onSelect={selectRunner}/></div><form class="race-tag-editor" onsubmit={e=>{e.preventDefault();void saveTags();}}><label for="race-tags">Tags</label><input id="race-tags" aria-label="Race tags" placeholder="Add tags, separated by commas" bind:value={tagDraft}/><button type="submit">Save tags</button><button type="button" class="export-race" onclick={exportRace}>Export race JSON</button></form>
        <FieldStats race={analysisRace} {reference} {analysis} {selected} compact onSelect={selectRunner}/>
        <div class="primary-replay">
          <CurveReplay race={analysisRace} {course} {reference} {selected} {time} {analysis} {fontScale} onSelect={selectRunner} onSeek={seek}>
            <div slot="minimap" aria-label="Course minimap"><RaceTrack race={analysisRace} {samples} {course} {reference} {selected} compact onSelect={selectRunner}/></div>
            <div class="transport main-transport"><button class="play-button" aria-label={playing?'Pause replay':'Play replay'} onclick={togglePlay}>{playing?'Ⅱ':'▶'}</button><button class="icon-button" aria-label="Restart replay" onclick={()=>{time=0;playing=false}}>↺</button><span class="time">{time.toFixed(1)}<small> / {race.duration.toFixed(1)}s</small></span><input aria-label="Replay time" type="range" min="0" max={race.duration} step=".05" bind:value={time}/><select aria-label="Playback speed" bind:value={playbackSpeed}><option value={.25}>¼×</option><option value={.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></div>
          </CurveReplay>
        </div>
          {#if selectedReady}<DeferredPanel identity={activeId} label="Telemetry"><Telemetry race={analysisRace} {course} {reference} {analysis} {selected} {time} sample={selectedSample} gap={selectedGap} onSeek={seek}/></DeferredPanel>
          <DeferredPanel identity={activeId} label="Runner skills"><SkillMatrix race={analysisRace} {reference} {analysis} {selected} onSeek={seek} onSkill={openSkill}/></DeferredPanel>{:else}<AnalysisSkeleton part="details" message={analysisState.message}/>{/if}
          {#if race.warnings.length||inferredCourse||['manual','skill-conditions'].includes(analysisRace.courseIdentity?.source??'')}<details class="panel race-data-notes"><summary>Race data notes · {race.frames.length} frames · {race.events.length} events</summary>{#each race.warnings as warning}<p>{warning}</p>{/each}<p>{analysisRace.courseIdentity?.source==='manual'?'Course selected manually.':analysisRace.courseIdentity?.source==='skill-conditions'?'Course inferred from recorded skill activations.':`Course source: ${analysisRace.courseIdentity?.source??(race.courseId?'recorded':'unknown')}.`}</p>{#if inferredCourse}<p>{inferredCourse.courseId?'Skill evidence identifies one compatible course.':inferredCourse.trackId?'Skill evidence identifies the venue. The surface is still unassigned.':'Course candidates from recorded skill evidence.'}</p>{#each inferredCourse.evidence as evidence}<p>{evidence}</p>{/each}{#if inferredCourse.candidateCourseIds.length}<p>Compatible candidates:</p><ul>{#each inferredCourse.candidateCourseIds as id}<li>{reference?.courses[id]?.name??`Course ${id}`}</li>{/each}</ul>{/if}{/if}</details>{/if}
          {#if analysisGate}<AnalysisDetails report={analysisGate} frames={race.frames.length} events={race.events.length} courseSource={analysisRace.courseIdentity?.source??(race.courseId?'recorded':'unknown')} onExport={exportAnalysis}/>{/if}
        </div>
        {#if runner&&selectedReady}<div class="analysis-side"><RunnerPanel {runner} race={analysisRace} {course} {reference} {analysis} {time} sample={selectedSample} gap={selectedGap} onSkill={id=>openSkill(id)} onSeek={seek} onDownload={()=>void downloadUmaJson()}/></div>{:else}<div class="analysis-side"><AnalysisSkeleton part="runner" message="Preparing runner…"/></div>{/if}
        </div>{/if}
        {#if analysisGate&&!analysis}<AnalysisDetails report={analysisGate} frames={race.frames.length} events={race.events.length} courseSource={analysisRace.courseIdentity?.source??(race.courseId?'recorded':'unknown')} onExport={exportAnalysis}/>{/if}
      </div>
    {:else if activeId}<div class="workspace">{#if analysisState.busy&&!analysisState.background}<AnalysisSkeleton title={courseCaption(library.find(e=>e.id===activeId)??{},reference)} conditions={library.find(e=>e.id===activeId)?.conditions} message="Opening race…"/>{:else}<section class="panel"><h2>Recorded replay unavailable</h2><p>{error||'This file could not be decoded. Select another race or import a supported replay.'}</p></section>{/if}</div>{:else}<div class="empty-workspace"><span class="empty-symbol">↗</span><div class="eyebrow">RACE ANALYSIS</div><h1>Explore your races.</h1><p>Collect races as you play, or drop a race JSON anywhere in this window.<br/>View stats, skills, and replay data.</p><div class="toolbar"><button class="primary" onclick={()=>input.click()}>Import race JSON</button></div><button class="setup-cta" onclick={requestAutoCollection}>Set up auto collection</button><div class="empty-features"><span>LOCAL COLLECTION</span><span>PORTABLE JSON</span><span>RUNNER COMPARISON</span></div></div>{/if}
    <footer><span>Umalytics <span class="muted">/ Steam Global</span></span><span>Race data stays on this computer · <a href="data/NOTICE.txt" target="_blank">Data sources</a></span></footer>
  </main>
</div>
{#if settingsOpen}<div class="modal-backdrop" role="presentation" onkeydown={e=>{if(e.key==='Escape')closeSettings();}} onclick={(event)=>{if(event.target===event.currentTarget)closeSettings();}}><div class="settings-modal" use:modalFocus role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1"><div class="modal-title"><div class="eyebrow">UMALYTICS</div><h2>Settings</h2><button class="icon-button" aria-label="Close settings" onclick={closeSettings}>×</button></div><div class="settings-body">
      {#if error||(message&&settingsOpen)}<div class="notice" class:error={!!error} role="status">{error||message}</div>{/if}
      {#snippet certSection()}
      <section class:setup-attention={setupAttention}>
        <div class="setting-row"><h3>Capture certificate</h3><span class="tag" class:trusted={certificate?.trusted}>{certificate?.trusted?'Trusted':certificate?.exists?'Not trusted':'Unavailable'}</span></div>
        <p>Approve the Windows prompt once to enable capture. The certificate is trusted by apps under your Windows user; Umalytics only inspects the game API.</p>
        {#if certificate?.sha1}<code class="fingerprint">SHA-1 {certificate.sha1}</code>{/if}
        <div class="toolbar">
          <button onclick={refreshCertificate} disabled={!health}>Check installation</button>
          {#if certificate?.trusted}
            {#if pendingCertRemoval}
              <button class="danger" onclick={uninstallCertificate} disabled={busy||!health?.csrfToken}>{busy?'Waiting for Windows…':'Confirm remove'}</button>
              <button onclick={()=>pendingCertRemoval=false}>Cancel</button>
            {:else}
              <button class="danger" onclick={()=>pendingCertRemoval=true} disabled={busy||!health?.csrfToken}>Remove certificate</button>
            {/if}
          {:else}
            <button class="primary" onclick={installCertificate} disabled={!certificate?.exists||busy||!health?.csrfToken}>{busy?'Waiting for Windows…':'Install certificate'}</button>
          {/if}
        </div>
      </section>
      {/snippet}
      {#snippet steamSection()}
      <section class:setup-attention={setupAttention}>
        <h3>Steam setup</h3>
        <p>Paste this into the game’s Steam Launch Options. The game will use the proxy without a console window.</p>
        {#if health?.launchOption}<code class="launch-option">{health.launchOption}</code><button onclick={()=>copy(health!.launchOption!,'Steam launch option copied.')}>Copy launch option</button>{:else}<p class="muted">Open the desktop app to get the launch option.</p>{/if}
        <small>The launcher starts collection. Clear this option to launch normally.</small>
      </section>
      {/snippet}
      {#if desktopSession}
        <section>
          <h3>Background collection</h3>
          <p>Closing the window keeps collecting. Use Exit in the tray menu to stop Umalytics.</p>
          <div class="setting-row"><div><strong>Collect races</strong><small>Only game API traffic is inspected.</small></div><input aria-label="Enable background collection" type="checkbox" checked={settings.collectionEnabled} disabled={!health?.csrfToken||busy} onchange={e=>updateSettings({collectionEnabled:e.currentTarget.checked})}/></div>
          {#each categories as c}<label class="setting-row"><span><i style={`background:${c.color}`}></i>{c.label}</span><input type="checkbox" checked={settings.categories[c.id]} disabled={!health?.csrfToken||busy} onchange={e=>updateSettings({categories:{...settings.categories,[c.id]:e.currentTarget.checked}})}/></label>{/each}
          <label class="setting-row"><span>Start collection when I sign in</span><input type="checkbox" checked={settings.startAtLogin??false} disabled={!health?.csrfToken||busy} onchange={e=>updateSettings({startAtLogin:e.currentTarget.checked})}/></label>
          <small>All types are on by default. Changes affect new captures. Saved races stay in the library.</small>
        </section>
        {#if !setupSettled}{@render certSection()}{@render steamSection()}{/if}
      {/if}
      <section>
        <h3>Appearance</h3>
        <div class="theme-switch" role="group" aria-label="Appearance">
          <button type="button" class:active={theme==='dark'} onclick={()=>setTheme('dark')}><span class="theme-icon" aria-hidden="true">☾</span>Dark</button>
          <button type="button" class:active={theme==='light'} onclick={()=>setTheme('light')}><span class="theme-icon" aria-hidden="true">☀</span>Light</button>
        </div>
        <div class="font-scale-setting"><label for="font-scale">Text size <output for="font-scale">{fontScale}%</output></label><div class="font-scale-control"><input id="font-scale" type="range" min={MIN_FONT_SCALE} max={MAX_FONT_SCALE} step="5" aria-label="Text size" aria-valuetext={`${fontScale}%`} bind:value={fontScale} onchange={()=>saveFontScale()}/><button onclick={()=>saveFontScale(100)}>Reset</button></div><small>Telemetry graph text stays the same size.</small></div>
      </section>
      {#if desktopSession}
        <AppUpdates csrfToken={health?.csrfToken}/>
      {:else}
        <section><h3>Reference data</h3><p>Game names, course paths and skill data are included with this viewer.</p><a href="data/NOTICE.txt" target="_blank" rel="noreferrer">Sources and licenses ↗</a></section>
      {/if}
      <section>
        <h3>About</h3>
        {#if desktopSession}
          <a href="https://exkitsune.github.io/Umalytics/" target="_blank" rel="noreferrer">Web viewer ↗</a>
          <p>Import replay JSON in your browser. You can also drop a race JSON onto this window.</p>
        {:else}
          <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Download the Windows app ↗</a>
          <p>This web viewer opens race JSON in your browser, including files you drop onto the window. Auto collection only works in the desktop app.</p>
        {/if}
      </section>
      {#if desktopSession}
        <section>
          <h3>Downloads</h3>
          <p>Race JSON and Uma JSON are saved here, then shown in Explorer.</p>
          <label class="export-folder"><span class="muted">Folder</span><input aria-label="JSON download folder" bind:value={exportDraft} disabled={!health?.csrfToken||busy}/></label>
          <div class="toolbar"><button onclick={()=>saveExportFolder(exportDraft)} disabled={!health?.csrfToken||busy||!exportDraft.trim()}>Save folder</button><button onclick={()=>saveExportFolder(null)} disabled={!health?.csrfToken||busy}>Use Downloads folder</button><button onclick={()=>revealFolder('exports')} disabled={!health?.csrfToken}>Open folder</button></div>
          <small>{settings.downloadsDirectory?`Downloads folder: ${settings.downloadsDirectory}`:'Uses your Windows Downloads folder unless you choose another path.'}</small>
        </section>
        {#if health?.dataDirectory}<section><h3>Saved data</h3><button class="saved-data-path" onclick={()=>revealFolder('data')} disabled={!health?.csrfToken}><code class="launch-option">{health.dataDirectory}</code></button><small>Click to open this folder in Explorer. Race imports, preferences, certificates and collection history are saved here.</small></section>{/if}
        <CacheSettings serviceStatus={health?.analysisBackground} client={analysisClient} status={cacheStatus} state={analysisState} onError={value=>error=value}/>
        {#if setupSettled}{@render certSection()}{@render steamSection()}{/if}
        <section>
          <h3>Uninstall</h3>
          <details><summary>Uninstall instructions</summary><ol><li>Use <strong>Remove certificate</strong> above. Approve the Windows prompt. The certificate is named “Umalytics Local Capture” under Current User Trusted Root Certification Authorities.</li><li>Turn off <strong>Start collection when I sign in</strong> if it is enabled.</li><li>Clear the game’s Steam Launch Options.</li><li>Optional: delete the Saved data folder to remove races, settings and the capture certificate key.</li><li>Choose <strong>Exit Umalytics and stop collection</strong> in the tray menu.</li><li>Delete <code>Umalytics.exe</code>.</li></ol></details>
        </section>
      {/if}
    </div><div class="modal-footer"><span class="muted">{health?.mode==='desktop'?'Background collector connected':'Static viewer · import / export available'}</span><button onclick={closeSettings}>Done</button></div></div></div>{/if}
{#if downloadPromptOpen}<div class="modal-backdrop" role="presentation" onclick={(event)=>{if(event.target===event.currentTarget)downloadPromptOpen=false;}}><div class="download-prompt" role="dialog" aria-modal="true" aria-label="Download Umalytics" tabindex="-1"><h2>Auto collection needs the desktop app</h2><p>This website can open race JSON, including files you drop here. Capturing races from the game only works if you download the Windows app.</p><div class="toolbar"><a class="button primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Download Umalytics</a><button onclick={()=>downloadPromptOpen=false}>Close</button></div></div></div>{/if}

{#if faqOpen}<AnalysisFaq onClose={()=>faqOpen=false}/>{/if}
{#if skillDetail!==null&&analysisRace&&analysis}<SkillDetails onFaq={()=>{skillDetail=null;faqOpen=true}} skillId={skillDetail} {reference} race={analysisRace} {analysis} runner={analysisRace.runners.find(r=>r.id===(skillDetailRunner??selected))??null} onClose={()=>skillDetail=null} onSeek={seek}/>{/if}

<style>
  .analysis-source{font-size:var(--font-10);color:var(--muted);font-weight:400;margin-left:16px;white-space:nowrap}
</style>
