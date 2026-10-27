<script lang="ts">
  import LibraryDialog from './LibraryDialog.svelte';
  import {saveTarget} from '../sandbox/editor';
  import {uid} from '../sandbox/model';
  export let kind:string;
  export let current:{id:string;name:string};
  export let records:{id:string;name:string}[];
  export let onSave:(name:string,id:string)=>Promise<void>;
  export let onClose:()=>void;
  let name=current.name,error='',saving=false,confirmed='';
  $: target=saveTarget(records,name,current.id);
  $: confirmation=`${target?.id??''}:${name.trim()}`;
  async function save(){
    if(!name.trim()||saving)return;
    if(target&&confirmed!==confirmation){confirmed=confirmation;return;}
    saving=true;error='';
    try{await onSave(name.trim(),target?.id??uid());onClose();}catch(e){error=String(e);}finally{saving=false;}
  }
</script>
<LibraryDialog title={`Save ${kind} As`} {onClose}>
  <form onsubmit={e=>{e.preventDefault();void save();}}>
    <label>Name<input aria-label={`${kind} name`} maxlength="160" bind:value={name} disabled={saving}/></label>
    {#if target&&confirmed===confirmation}<p class="overwrite" role="alert">“{target.name}” already exists. Overwrite this saved {kind.toLowerCase()}?</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="actions"><button type="button" disabled={saving} onclick={onClose}>Cancel</button><button class="primary" disabled={saving||!name.trim()}>{saving?'Saving…':target&&confirmed===confirmation?'Confirm overwrite':'Save As'}</button></div>
  </form>
</LibraryDialog>
<style>
label{display:grid;gap:8px;color:var(--muted);font-size:13px}input{padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);width:100%;font:inherit}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.overwrite{color:#edc17c;font-size:13px;line-height:1.5}
</style>
