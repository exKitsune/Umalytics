<script lang="ts">
  import {onMount} from 'svelte';
  export let x:number,y:number;
  export let onSave:()=>void;
  export let onClose:()=>void;
  let menu:HTMLDivElement,button:HTMLButtonElement;
  onMount(()=>{const box=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-box.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-box.height-8))}px`;button.focus();});
</script>
<svelte:window onpointerdown={e=>{if(!menu?.contains(e.target as Node))onClose();}} onkeydown={e=>{if(e.key==='Escape'){e.preventDefault();onClose();}}}/>
<div bind:this={menu} class="runner-save-menu" role="menu" style:left={`${x}px`} style:top={`${y}px`}>
  <button bind:this={button} role="menuitem" onclick={onSave}>Save Uma to Dorm</button>
</div>
<style>
  .runner-save-menu{position:fixed;z-index:1000;padding:5px;background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px #0005}
  button{border:0;background:transparent;color:var(--text);padding:9px 12px;border-radius:5px;font:inherit;text-align:left}button:hover,button:focus-visible{background:var(--accent-soft)}
</style>
