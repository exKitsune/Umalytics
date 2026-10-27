<script lang="ts">
  import {dismissDialog} from '../ui/dismiss-dialog';
  import type {ReferenceData} from '../data/reference';
  import {getSkillReference,skillName} from '../data/reference';
  import {effectText,durationText} from '../data/skill-details';
  import type {Runner} from '../data/types';
  import {skillCost} from '../data/skill-cost';
  import {skillIconKey} from '../data/game-icons';
  import GameIcon from './GameIcon.svelte';
  import ConditionRules from './ConditionRules.svelte';
  export let skillId:number,reference:ReferenceData,runner:Runner|null=null,distance:number,fieldSize:number;
  export let onClose:()=>void;
  $: skill=getSkillReference(reference,skillId);
  let code=false;
  function open(node:HTMLDialogElement){node.showModal();return {destroy:()=>node.close()};}
</script>
<dialog use:dismissDialog use:open onclose={onClose} aria-label={`${skillName(reference,skillId)} definition`}>
  <header><GameIcon name={skillIconKey(reference,skillId)} size={30}/><h3>{skillName(reference,skillId)}</h3><button aria-label="Close skill definition" onclick={onClose}>×</button></header>
  {#if skill}<p>{skill.description??''}</p><div class="facts"><span>{skill.activateLot===0?'Guaranteed when eligible':skill.activateLot===1?'Wit check required':'Activation rule unavailable'}</span>{#if skillCost(skillId).cost!==null}<b>{skillCost(skillId).cost} SP</b>{/if}</div>
    {#each skill.branches as branch,i}<section>{#if skill.branches.length>1}<h4>Variant {i+1}</h4>{/if}<ul>{#each branch.effects as effect}<li>{effectText(effect,runner,skillId)}</li>{/each}</ul><div class="facts"><span>Duration</span><b>{durationText(branch,distance)}</b></div>
    {#if branch.precondition}<h4>First</h4><ConditionRules expression={branch.precondition} {reference} {fieldSize} showCode={code}/><h4>Then</h4>{:else}<h4>Conditions</h4>{/if}<ConditionRules expression={branch.condition} {reference} {fieldSize} showCode={code}/></section>{/each}
    <footer><label><input type="checkbox" bind:checked={code}/>Condition code</label><a href={`https://gametora.com/\u0075mamusume/skill-condition-viewer?skill=${skillId}`} target="_blank" rel="noreferrer">GameTora ↗</a></footer>
  {:else}<p>Definition unavailable.</p>{/if}
</dialog>
<style>
  dialog{width:min(520px,calc(100vw - 30px));max-height:80dvh;overflow:auto;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--text);box-shadow:var(--shadow);font-size:13px}dialog::backdrop{background:#0007}header{display:flex;align-items:center;gap:10px}h3{font-size:17px;margin:0;flex:1}header button{border:0;background:none;font-size:24px;padding:0 5px}p{color:var(--muted);line-height:1.5}section{border-top:1px solid var(--border);padding:12px 0}.facts,footer{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px}.facts span{color:var(--muted)}ul{padding-left:18px;line-height:1.6;margin:0 0 10px}h4{margin:12px 0 6px;font-size:12px}footer{border-top:1px solid var(--border);padding-top:12px}label{display:flex;align-items:center;gap:6px;color:var(--muted)}
</style>
