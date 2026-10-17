<script lang="ts">
  import type { Runner } from '../data/types';
  import type { SkillRow } from '../data/analytics';
  import { getSkillReference, type ReferenceData, type SkillReference } from '../data/reference';
  import { displayedSkillBranches, effectText, velocityKind } from '../data/skill-details';
  import SpeedTerm from './SpeedTerm.svelte';
  export let reference: ReferenceData | null;
  export let skillId: number;
  export let runner: Runner | null = null;
  export let row: SkillRow | null = null;
  $: skill = getSkillReference(reference, skillId);
  $: listed = skill ? displayedSkillBranches(skill, row) : [];
  $: groups = [...new Map(listed.map(branch => [branch.effects.map(effect => effectText(effect, runner, skillId)).join(' · '), branch] as [string, SkillReference['branches'][number]])).values()];
  $: observed = !!skill && skill.branches.length > 1 && listed.length < skill.branches.length;
</script>
{#if !skill}Effect data unavailable{:else}
  {#if observed}<span class="observed">This race · </span>{/if}
  {#each groups as branch, groupIndex}
    {#if groupIndex} or {/if}
    {#each branch.effects as effect, effectIndex}
      {@const kind = velocityKind(effect.type)}
      {#if effectIndex} · {/if}
      {#if kind}<SpeedTerm {kind} up={effect.rawValue >= 0} text={effectText(effect, runner, skillId)}/>{:else}{effectText(effect, runner, skillId)}{/if}
    {/each}
  {/each}
{/if}
<style>
  .observed{color:var(--accent-text,var(--accent));font-weight:650}
</style>
