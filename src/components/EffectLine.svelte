<script lang="ts">
  import type { Runner } from '../data/types';
  import type { SkillRow } from '../data/analytics';
  import { getSkillReference, type ReferenceData, type SkillReference } from '../data/reference';
  import { displayedSkillBranches, effectText, velocityKind } from '../data/skill-details';
  import SpeedTerm from './SpeedTerm.svelte';
  import {postProcDefinition,postProcCondition} from '../data/post-proc';
  export let reference: ReferenceData | null;
  export let skillId: number;
  export let runner: Runner | null = null;
  export let row: SkillRow | null = null;
  export let distance:number|null=null;
  $: skill = getSkillReference(reference, skillId);
  $: listed = skill ? displayedSkillBranches(skill, row).map(branch=>{
    const originalIndex=skill!.branches.indexOf(branch);
    const definition=(originalIndex>=0?skill!.branches[originalIndex]:skill!.branches.find((b,i)=>branch.branchIndex!=null?(b.branchIndex??i)===branch.branchIndex:b.condition===branch.condition&&b.rawDuration===branch.rawDuration&&b.durationUsage===branch.durationUsage))??branch;
    return postProcDefinition(definition,runner,skillId,distance)?{...definition,branchIndex:definition.branchIndex??skill!.branches.indexOf(definition)}:branch;
  }) : [];
  $: groups = [...new Map(listed.map(branch => [branch.effects.map(effect => effectText(effect, runner, skillId)).join(' · '), branch] as [string, SkillReference['branches'][number]])).values()];
  $: observed = !!skill && skill.branches.length > 1 && listed.length < skill.branches.length;
</script>
{#if !skill}Effect data unavailable{:else}
  {#if observed}<span class="observed">This race · </span>{/if}
  {#each groups as branch, groupIndex}
    {#if groupIndex} or {/if}
    {@const conditional=postProcDefinition(branch,runner,skillId,distance)}
    {#each conditional?conditional.base.map(e=>e.effect):branch.effects as effect, effectIndex}
      {@const kind = velocityKind(effect.type)}
      {#if effectIndex} · {/if}
      {#if kind}<SpeedTerm {kind} up={effect.rawValue >= 0} text={effectText(effect, runner, skillId)}/>{:else}{effectText(effect, runner, skillId)}{/if}
    {/each}
    {#if conditional}
      {#each conditional.bonuses as bonus}
        {@const procs=row?.activations.filter(a=>a.activationEvidence==='simulated'&&(a.effectBranch===branch.branchIndex||skill.branches.length===1))??[]}
        {@const count=procs.flatMap(a=>a.effects.filter(e=>e.followUp&&e.type===bonus.effect.type)).length}
        {@const text=effectText({...bonus.effect,additionalActivateType:0},runner,skillId)}
        <span class="conditional">{postProcCondition(bonus.kind)}: {conditional.bonuses.length===1&&conditional.base.every(e=>e.effect.type===bonus.effect.type)?text.replace(/^.*? (?=[+−-]?\d)/,''):text}{#if conditional.extension>0} · +{Number(conditional.extension.toFixed(3))} s{/if}{#if bonus.limit!==null}<span class="bonus-count"> · {procs.length&&conditional.bonuses.length===1?`${count}/${bonus.limit*procs.length} bonuses`:`up to ${bonus.limit}×`}</span>{/if}</span>
      {/each}
    {/if}
  {/each}
{/if}
<style>
  .observed{color:var(--accent-text,var(--accent));font-weight:650}
  .conditional{display:block;margin-top:3px;color:#69b9e8}.bonus-count{white-space:nowrap}
</style>
