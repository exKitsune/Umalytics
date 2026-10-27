<script lang="ts">
  import type { RunnerAnalysis } from '../data/analytics';
  import type { MotionSkillImpact } from '../data/motion-skill-impact';
  import { skillImpactSummary } from '../data/skill-impact';
  import { activationDurationText } from '../data/skill-details';
  import SkillImpact from './SkillImpact.svelte';
  export let detail:RunnerAnalysis;
  export let skillId:number;
  export let motion:MotionSkillImpact|null=null;
  export let expanded=false;
  export let onSeek:(time:number)=>void;
  $: row=detail.skillRows.find(row=>row.skillId===skillId);
  $: repeated=(row?.activations.length??0)>1;
  $: total=skillImpactSummary(detail,skillId);
  $: procs=(row?.activations??[]).map(activation=>{
    const impact=detail.skillImpacts.find(i=>i.skillId===skillId&&i.start===activation.start);
    return {activation,impact:impact?{...impact,activations:1}:null};
  });
</script>
{#if repeated}
  <div class="proc-total"><span>{procs.length} procs</span>{#if motion?.effectivenessScore!=null}<strong title="Combined effectiveness against one expected proc. Each activation adds its own score.">{Math.round(motion.effectivenessScore*100)}% effective</strong>{/if}</div>
{/if}
<SkillImpact impact={total} {motion} {expanded} hideEffects={repeated}/>
{#if repeated}
  <div class="proc-list">
    {#each procs as {activation,impact},i}
      <div class="proc" aria-label={`Proc ${i+1}`}>
        <button class="proc-seek" onclick={()=>onSeek(activation.start)} title="Jump to this activation">▶ Proc {i+1} · {activation.start.toFixed(2)} s <small>{activationDurationText(activation)}</small></button>
        {#if impact}<SkillImpact {impact} {expanded}/>{:else}<small class="unavailable">Effectiveness unavailable</small>{/if}
      </div>
    {/each}
  </div>
{/if}
<style>
  .proc-total{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:var(--font-12);color:var(--muted)}
  .proc-total strong{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
  .proc-list{display:grid;gap:10px;margin-top:10px}.proc{border-left:2px solid var(--skill,var(--accent));padding:2px 0 2px 8px;min-width:0}
  .proc-seek{display:flex;align-items:center;gap:8px;width:100%;padding:3px 0;border:0;background:none;color:var(--accent-text,var(--accent));text-align:left;font-size:var(--font-11);font-variant-numeric:tabular-nums}
  .proc-seek small{margin-left:auto;color:var(--muted);font-size:inherit}.unavailable{color:var(--muted);font-size:var(--font-11)}
</style>
