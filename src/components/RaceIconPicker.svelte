<script lang="ts">
  import GameIcon from './GameIcon.svelte';
  import StrategyBadge from './StrategyBadge.svelte';
  import {strategyNames} from '../sandbox/model';
  export let kind:'aptitude'|'strategy';
  export let label:string;
  export let value:string|number;
  export let onChange:(value:string|number)=>void;
  let open=false;
  let trigger:HTMLButtonElement;
  $: options=kind==='aptitude'?'SABCDEFG'.split(''):[5,1,2,3,4];
  const name=(option:string|number)=>kind==='aptitude'?String(option):strategyNames[Number(option)];
  function choose(option:string|number){onChange(option);open=false;trigger.focus();}
  function keys(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();open=false;trigger.focus();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    if(!open){open=true;return;}
    const buttons=Array.from(trigger.parentElement!.querySelectorAll<HTMLButtonElement>('.choices button'));
    const current=buttons.indexOf(event.target as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();
  }
  function focusChoice(node:HTMLDivElement){node.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus();}
</script>
<div class="icon-picker" onfocusout={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))open=false;}}>
  <span class="label">{label}</span>
  <button bind:this={trigger} class="trigger" type="button" aria-label={`${label}: ${name(value)}`} aria-expanded={open} aria-haspopup="true" onkeydown={keys} onclick={()=>open=!open}>
    {#if kind==='aptitude'}<GameIcon name={`rank-${value}`} size={23}/>{:else}<StrategyBadge runner={{strategyCode:Number(value),strategy:strategyNames[Number(value)]}} compact/>{/if}<small>▾</small>
  </button>
  {#if open}<div class="choices" use:focusChoice role="group" aria-label={`Choose ${label.toLowerCase()}`}>{#each options as option}<button type="button" aria-label={name(option)} aria-pressed={value===option} onkeydown={keys} onclick={()=>choose(option)}>{#if kind==='aptitude'}<GameIcon name={`rank-${option}`} size={26}/>{:else}<StrategyBadge runner={{strategyCode:Number(option),strategy:strategyNames[Number(option)]}} compact/>{/if}</button>{/each}</div>{/if}
</div>
<style>
  .icon-picker{position:relative;min-width:0}.label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}.trigger{display:flex;align-items:center;gap:3px;width:100%;height:33px;min-width:0;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 5px}.trigger small{margin-left:auto;flex-shrink:0;color:var(--muted)}.choices{position:absolute;top:calc(100% + 3px);left:0;z-index:30;min-width:max(100%,100px);padding:4px;background:var(--panel);border:1px solid var(--border);border-radius:7px;box-shadow:0 8px 24px #0005}.choices button{display:flex;justify-content:center;width:100%;align-items:center;border:0;background:transparent;padding:7px 9px;border-radius:4px}.choices button:hover,.choices button[aria-pressed=true]{background:var(--accent-soft)}.choices button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
</style>
