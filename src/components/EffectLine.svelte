<script lang="ts">
  import type { Runner } from '../data/types';
  import { getSkillReference, type ReferenceData, type SkillReference } from '../data/reference';
  import { effectText, velocityKind } from '../data/skill-details';
  import SpeedTerm from './SpeedTerm.svelte';
  export let reference: ReferenceData | null;
  export let skillId: number;
  export let runner: Runner | null = null;
  $: skill = getSkillReference(reference, skillId);
  $: groups = [...new Map((skill?.branches ?? []).map(branch => [branch.effects.map(effect => effectText(effect, runner, skillId)).join(' · '), branch] as [string, SkillReference['branches'][number]])).values()];
</script>
{#if !skill}Effect data unavailable{:else}
  {#each groups as branch, groupIndex}
    {#if groupIndex} or {/if}
    {#each branch.effects as effect, effectIndex}
      {@const kind = velocityKind(effect.type)}
      {#if effectIndex} · {/if}
      {#if kind}<SpeedTerm {kind} up={effect.rawValue >= 0} text={effectText(effect, runner, skillId)}/>{:else}{effectText(effect, runner, skillId)}{/if}
    {/each}
  {/each}
{/if}
