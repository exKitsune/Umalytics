<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  export let csrfToken:string|undefined;
  type UpdateStatus={phase:'idle'|'checking'|'available'|'downloading'|'waiting-for-game'|'restarting'|'error';currentVersion:string;availableVersion:string|null;checkedAt:string|null;nextCheckAt:string|null;downloadBytes:number;downloadTotal:number;error:string|null;gameActive:boolean;canInstall:boolean};
  let status:UpdateStatus|null=null;
  let error='';
  let busy=false;
  let reconnecting=false;
  $: working=busy||!!status&&['checking','downloading','waiting-for-game','restarting'].includes(status.phase);
  $: progress=status&&status.downloadTotal>0?Math.min(100,Math.round(status.downloadBytes/status.downloadTotal*100)):null;
  $: label=reconnecting?'Reconnecting to Umalytics…':status?.phase==='checking'?'Checking for updates…':status?.phase==='downloading'?`Downloading update${progress===null?'…':` · ${progress}%`}`:status?.phase==='waiting-for-game'?(status.gameActive?'Update ready. Close Uma to finish updating.':'Preparing to restart safely…'):status?.phase==='restarting'?'Restarting Umalytics…':status?.phase==='available'?`Version ${status.availableVersion} is available.`:status?.phase==='idle'&&status.checkedAt?'Umalytics is up to date.':'';
  let polling=false;
  let restartWaitUntil=0;
  async function refresh(){if(polling)return;polling=true;try{status=await api<UpdateStatus>('update/status');restartWaitUntil=0;reconnecting=false;error='';}catch{
    // A fast download can finish and stop the collector between status polls.
    // Keep a bounded reconnect grace period even if we missed "restarting".
    if(working){
      if(!restartWaitUntil)restartWaitUntil=Date.now()+90000;
      reconnecting=true;
      if(Date.now()<restartWaitUntil)error='';
      else error='Umalytics did not reconnect. Reopen the app.';
    }else error='Update service is unavailable. Reopen Umalytics to try again.';
  }finally{polling=false;}}
  async function action(kind:'check'|'install'){if(!csrfToken)return;busy=true;error='';try{status=await api<UpdateStatus>(`update/${kind}`,{},csrfToken);}catch(e){error=String(e);}finally{busy=false;}}
  onMount(()=>{void refresh();const timer=setInterval(()=>{void refresh()},2000);return()=>clearInterval(timer);});
</script>
<section>
  <div class="setting-row"><h3>App updates</h3>{#if status}<span class="tag">v{status.currentVersion}</span>{/if}</div>
  <p>Umalytics checks hourly for a new version. It never installs an update until you click Update, including while a race is being captured.</p>
  {#if error||status?.error}<p role="status" class="update-error">{error||status?.error}</p>{:else if label}<p role="status">{label}</p>{/if}
  {#if status?.phase==='downloading'}<progress aria-label="Update download" value={progress??undefined} max="100"></progress>{/if}
  <div class="toolbar">{#if status?.canInstall}<button class="primary" onclick={()=>action('install')} disabled={!csrfToken||working}>Update</button>{:else}<button onclick={()=>action('check')} disabled={!csrfToken||working}>Check for updates</button>{/if}<a href="/api/licenses" target="_blank" rel="noreferrer">Licenses ↗</a></div>
  <small>If the game is running, Update waits until it closes. Saved races and preferences stay in your Umalytics folder.</small>
</section>
<style>progress{width:100%;height:.5rem;margin:0 0 1rem;accent-color:var(--accent,#50b887)}.update-error{color:var(--danger,#e28282)}</style>
