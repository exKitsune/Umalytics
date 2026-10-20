<script lang="ts">
  import type { Race, Runner } from '../data/types';
  import { getSkillReference, skillName, runnerName, type ReferenceData } from '../data/reference';
  import { effectText, durationText, activationDurationText, nonProcLabel, velocityKind, levelBuffExplanation, uniqueLevelLabel, teamScaleNote } from '../data/skill-details';
  import SpeedTerm from './SpeedTerm.svelte';
  import GameIcon from './GameIcon.svelte';
  import { skillIconKey } from '../data/game-icons';
  import type { RaceAnalysis } from '../data/analytics';
  import { skillImpactSummary } from '../data/skill-impact';
  import SkillImpact from './SkillImpact.svelte';
  import RecoveryTiming from './RecoveryTiming.svelte';
  import { motionSkillImpact } from '../data/motion-skill-impact';
  import { metricsForSkill } from '../data/skill-metrics';
  import SkillMetrics from './SkillMetrics.svelte';
  import ConditionRules from './ConditionRules.svelte';
  import SkillBranchGraph from './SkillBranchGraph.svelte';
  import SimulationChecks from './SimulationChecks.svelte';
  export let skillId:number;
  export let reference:ReferenceData|null;
  export let race:Race;
  export let analysis:RaceAnalysis;
  export let runner:Runner|null;
  export let onClose:()=>void;
  export let onSeek:(time:number)=>void;
  export let onFaq:()=>void=()=>{};
  let showConditionCode=true;
  $: skill=getSkillReference(reference,skillId);
  $: levelLabel=runner?uniqueLevelLabel(reference,runner,skillId):null;
  $: componentMetrics=runner?metricsForSkill(race,reference,analysis,runner.id,skillId):[];
  $: pureRecovery=!!skill&&skill.branches.every(b=>b.effects.length>0&&b.effects.every(e=>e.type===9));
  $: impact=runner?skillImpactSummary(analysis.runners[runner.id],skillId):null;
  $: row=runner?analysis.runners[runner.id]?.skillRows.find(r=>r.skillId===skillId):null;
  $: usedBranches=new Set(row?.activations.map(a=>a.effectBranch).filter(b=>b!==null)??[]);
  $: branches=(skill?.branches??[]).map((branch,i)=>({branch,index:branch.branchIndex??i}))
    .filter(({index})=>!usedBranches.size||usedBranches.has(index));
  function open(node:HTMLDialogElement){node.showModal();return{destroy(){node.close()}}}
</script>
<dialog class="skill-dialog" use:open onclose={onClose} onclick={(event)=>{if(event.target===event.currentTarget)onClose();}} aria-label={`${skillName(reference,skillId)} details`}>
  <div class="skill-dialog-title"><GameIcon name={skillIconKey(reference,skillId)} size={32}/><div><h2>{skillName(reference,skillId)}{#if levelLabel}<span class="skill-level">{levelLabel}</span>{/if}</h2>{#if runner}<small>{runnerName(reference,runner)}</small>{/if}</div><button aria-label="Close skill details" onclick={onClose}>×</button></div>
  <div class="skill-dialog-body">
    {#if skill?.dataRegion==='JP'}<p class="muted">JP fallback · Global data unavailable.</p>{/if}
    {#if skill?.description}<p class="description">{skill.description}</p>{/if}
    {#if row?.activations.length}<div class="activation-links">{#each row.activations as a}<button onclick={()=>onSeek(a.start)}>▶ {a.start.toFixed(2)} s{#if activationDurationText(a)}<small>{activationDurationText(a)}</small>{/if}</button>{/each}</div>
    {:else if row}<p class="outcome" class:active={row.effectiveActive}>{row.effectiveActive?'✓':'×'} {nonProcLabel(row,reference)}</p>{/if}
    {#if impact&&row?.effectiveActive&&(!componentMetrics.length||skill?.branches.some(b=>b.effects.some(e=>[9,21,22,27,28,31].includes(e.type))))}<section><h3>{pureRecovery?'Recovery timing':skill?.branches.some(b=>b.effects.some(e=>e.type===28))?'Movement gain':'Effectiveness'}{#if !pureRecovery}<small class="calculated">Calculated</small>{/if}</h3>{#if pureRecovery}{#each row.activations as activation}<RecoveryTiming recovery={analysis.runners[runner!.id]?.skillImpacts.find(i=>i.skillId===skillId&&i.start===activation.start)?.recovery??impact.recovery} starts={[activation.start]}/>{/each}{:else}<SkillImpact {impact} expanded motion={runner?motionSkillImpact(race,reference,analysis,runner.id,skillId):null}/>{/if}</section>{/if}
    {#if runner&&!pureRecovery}<SkillMetrics expanded activated={row?.effectiveActive??false} metrics={componentMetrics}/>{/if}
    {#if row?.simulation&&!row.effectiveActive}<p class="muted">{row.nonProcReason}</p>{/if}
    {#if row?.simulation}<SimulationChecks checks={row.simulation.checks} {onSeek}/>{/if}
    {#if skill}
      <div class="activation-rule"><span>Activation</span><strong>{skill.activateLot===0?'Guaranteed if conditions are met':skill.activateLot===1?'Wit check':'Unknown'}</strong></div>
      {#each branches as {branch,index},i}
        {@const evaluated=row?.conditionEvaluation?.branches.find(b=>b.branchIndex===index)}
        {@const activation=row?.activations.find(a=>a.effectBranch===index||skill.branches.length===1)}
        {@const levelNote=analysis.source!=='simulation'&&runner?levelBuffExplanation(reference,runner,skillId,branch.effects):null}
        {@const branched=skill.branches.length>1}
        {@const effects=branch.effects.filter(e=>!([1,2,3,4,5,8].includes(e.type)&&componentMetrics.some(m=>m.value!==null&&(m.label==='Vision modifier'?'Vision distance':m.label.split(' · ')[0])===({1:'Speed stat',2:'Stamina stat',3:'Power stat',4:'Guts stat',5:'Wit stat',8:'Vision distance'} as Record<number,string>)[e.type])))}
        <section class="skill-effects">{#if effects.length}<h3>{branches.length>1?`Variant ${i+1}`:analysis.source==='simulation'?'Effect definitions':'Effects'}</h3>
          <ul>{#each effects as effect}{@const kind=velocityKind(effect.type)}<li>{#if kind}<SpeedTerm {kind} up={effect.rawValue>=0} text={effectText(effect,runner,skillId)}/>{:else}{effectText(effect,runner,skillId)}{/if}{#if teamScaleNote(runner,effect)}<small class="scale-note">{teamScaleNote(runner,effect)}</small>{/if}</li>{/each}</ul>{/if}
          {#if levelNote}<p class="level-note">{levelNote.detail}</p>{/if}
          <div class="duration"><span>Duration</span><strong>{activationDurationText(activation)??durationText(branch,race.distance)}</strong></div>
          {#if !branched||i===branches.length-1}
            {@const summary=branched?row?.conditionEvaluation?.branches.find(b=>usedBranches.has(b.branchIndex))??evaluated:evaluated}
            <details class="conditions" open><summary>Conditions <span class:met={!!activation||!!usedBranches.size||summary?.state==='met'}>{activation||usedBranches.size||summary?.state==='met'?'Met':summary?.state==='unmet'?'Not met':summary?.inferredState==='met'?'Met in replay model':summary?.eligibilityState==='eligible'?'Eligible window':'Uncertain'}</span></summary>
              <label class="condition-code"><input type="checkbox" bind:checked={showConditionCode}/>Show condition code</label>
              {#if branched}
                <SkillBranchGraph {skill} {skillId} {row} {runner} {race} {reference} showCode={showConditionCode} {onSeek}/>
              {:else}
                {#if branch.precondition}<h4>First</h4><ConditionRules expression={branch.precondition} {reference} showCode={showConditionCode} fieldSize={race.runners.length} predicates={evaluated?.predicates??[]} role="precondition" {onSeek}/><h4>Then</h4>{/if}
                <ConditionRules expression={branch.condition} {reference} showCode={showConditionCode} fieldSize={race.runners.length} predicates={evaluated?.predicates??[]} {onSeek}/>
                {#if evaluated?.firstOpportunity!=null&&!evaluated.staticOnly}<button class="seek-condition" onclick={()=>onSeek(evaluated.firstOpportunity!)}>▶ {evaluated.firstOpportunity.toFixed(2)} s</button>{/if}
              {/if}
              {#if row?.simulation&&row.effectiveActive}{#each row.conditionEvaluation?.branches.filter(b=>b.state==='met')??[] as completed}<p class="muted">{completed.detail}</p>{/each}{/if}
              {#if !activation&&!usedBranches.size&&summary?.state==='unknown'}<p class="muted">{analysis.source==='simulation'?'This branch was not fully evaluated. See the activation checks above.':summary.randomTrigger?'The random trigger is not in the replay.':summary.missingInputs.length?'Some required race details are missing.':'The replay cannot confirm every check.'}</p>{/if}
            </details>
          {/if}
        </section>
      {/each}
    {:else}<p>Skill data unavailable.</p>{/if}
    <footer><a href={`https://gametora.com/\x75mamusume/skill-condition-viewer?skill=${skillId}`} target="_blank" rel="noreferrer">GameTora ↗</a><button onclick={onFaq}>How this is calculated</button></footer>
  </div>
</dialog>
<style>
.condition-code{display:flex;align-items:center;gap:6px;margin-top:12px;font-size:var(--font-11);color:var(--muted);font-weight:400}.condition-code input{margin:0}
dialog{padding:0;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:10px;width:min(640px,calc(100vw - 32px));max-height:85vh;box-shadow:var(--shadow)}dialog::backdrop{background:#0009}.skill-dialog-title{display:flex;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border);gap:12px}.skill-dialog-title>div{flex:1}.skill-dialog-title small{font-size:var(--font-11);color:var(--muted)}h2{margin:0 0 3px;font-size:var(--font-18)}.skill-level{margin-left:8px;color:var(--muted);font-size:var(--font-13);font-weight:650;font-variant-numeric:tabular-nums}.skill-dialog-title button{font-size:var(--font-24);background:transparent;border:0;padding:0 6px}.skill-dialog-body{padding:0 20px 18px;font-size:var(--font-12);line-height:1.6}.description{margin:16px 0;color:var(--muted)}section{padding:15px 0;border-bottom:1px solid var(--border)}h3{margin:0 0 10px;font-size:var(--font-13)}.activation-links{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}.activation-links button{display:flex;align-items:center;gap:12px;padding:6px 10px;font-size:var(--font-12);background:var(--accent-soft);color:var(--accent-text,var(--accent));border:0}.activation-links small{font-size:var(--font-10)}.activation-rule,.duration{display:flex;justify-content:space-between;gap:16px;padding:9px 0}.activation-rule{border-bottom:1px solid var(--border)}.activation-rule span,.duration span{color:var(--muted)}strong{font-weight:550}.skill-effects ul{list-style:none;padding:0;margin:0;display:grid;gap:5px}.scale-note{display:block;margin-top:3px;color:var(--muted);font-size:var(--font-10)}.level-note{margin:8px 0 0;color:var(--muted);font-size:var(--font-11);line-height:1.45}.outcome{color:#e48087}.outcome.active{color:var(--accent-text,var(--accent))}.conditions{margin-top:9px}.conditions summary{cursor:pointer;font-weight:550}.conditions summary span{float:right;color:var(--muted);font-weight:400}.conditions summary span.met{color:var(--accent-text,var(--accent))}.conditions :global(.condition-rules){margin-top:10px}.conditions h4{margin:12px 0 0;font-size:var(--font-11);color:var(--muted)}.seek-condition{font-size:var(--font-11);margin-top:8px}.muted{font-size:var(--font-11);color:var(--muted)}footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px}footer button{padding:0;border:0;background:transparent;color:var(--muted);font-size:var(--font-11)}footer a{font-size:var(--font-11)}.calculated{float:right;font-size:var(--font-10);color:var(--muted);font-weight:400}
</style>
