<script lang="ts">
  import type { Race, Runner } from '../data/types';
  import type { SkillRow } from '../data/analytics';
  import type { ReferenceData, SkillReference } from '../data/reference';
  import { effectText, skillBranchNodes, teamScaleNote, velocityKind } from '../data/skill-details';
  import ConditionRules from './ConditionRules.svelte';
  import SpeedTerm from './SpeedTerm.svelte';
  export let skill: SkillReference;
  export let skillId: number | undefined = undefined;
  export let row: SkillRow | null = null;
  export let runner: Runner | null = null;
  export let race: Race;
  export let reference: ReferenceData | null;
  export let showCode = false;
  export let onSeek: ((time: number) => void) | undefined = undefined;
  $: nodes = skillBranchNodes(skill, row);
</script>
{#if nodes.length > 1}
  <div class="branch-flow" aria-label="Skill branch flow">
    {#each nodes as node}
      {@const evaluated = row?.conditionEvaluation?.branches.find(item => item.branchIndex === node.index)}
      <article class="flow-branch" class:taken={node.taken === true} class:missed={node.taken === false} class:met={node.state === 'met'} class:unmet={node.state === 'unmet'}>
        <div class="flow-label">{node.label}{#if node.taken === true}<span>This race</span>{:else if node.taken === false}<span>Not used</span>{/if}</div>
        {#if node.precondition}
          <h4>First</h4>
          <ConditionRules expression={node.precondition} {reference} {showCode} fieldSize={race.runners.length} predicates={evaluated?.predicates ?? []} role="precondition" {onSeek}/>
          <h4>Then</h4>
        {/if}
        <ConditionRules expression={node.condition} {reference} {showCode} fieldSize={race.runners.length} predicates={evaluated?.predicates ?? []} {onSeek}/>
        <ul>
          {#each node.effects as effect}
            {@const kind = velocityKind(effect.type)}
            <li>
              {#if kind}<SpeedTerm {kind} up={effect.rawValue >= 0} text={effectText(effect, runner, skillId ?? row?.skillId)}/>
              {:else}{effectText(effect, runner, skillId ?? row?.skillId)}{/if}
              {#if teamScaleNote(runner, effect)}<small>{teamScaleNote(runner, effect)}</small>{/if}
            </li>
          {/each}
        </ul>
      </article>
    {/each}
  </div>
{/if}
<style>
  .branch-flow{display:grid;gap:8px;margin-top:10px}
  .flow-branch{padding:10px 12px 10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg);border-left:3px solid var(--border)}
  .flow-branch.taken{border-left-color:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}
  .flow-branch.missed{opacity:.72}
  .flow-label{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:var(--font-12);font-weight:650}
  .flow-label span{font-size:var(--font-10);font-weight:600;color:var(--muted)}
  .taken .flow-label span{color:var(--accent-text,var(--accent))}
  .flow-branch h4{margin:8px 0 4px;font-size:var(--font-11);color:var(--muted)}
  .flow-branch ul{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:4px}
  .flow-branch small{display:block;margin-top:2px;color:var(--muted);font-size:var(--font-10)}
</style>
