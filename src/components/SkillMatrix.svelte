<script lang="ts">
  import {skillCost,skillCostHelp} from '../data/skill-cost';
  import {conditionLabel} from '../data/condition-label';
  import type { Race } from '../data/types';
  import type { RaceAnalysis, SkillRow } from '../data/analytics';
  import { skillImpactSummary } from '../data/skill-impact';
  import SkillImpact from './SkillImpact.svelte';
  import { motionSkillImpact } from '../data/motion-skill-impact';
  import { skillTotals } from '../data/skill-totals';
  import { metricsForSkill } from '../data/skill-metrics';
  import SkillMetrics from './SkillMetrics.svelte';
  import MovementGainBreakdown from './MovementGainBreakdown.svelte';
  import { onDestroy } from 'svelte';
  import { compareDisplayedSkills, nonProcLabel, conditionSplit, skillTone, skillToneColor, levelBuffExplanation, uniqueLevelLabel, activationDurationText } from '../data/skill-details';
  import EffectLine from './EffectLine.svelte';
  import { skillName, runnerName, type ReferenceData } from '../data/reference';
  import { runnerColors } from '../library';
  import UmaPortrait from './UmaPortrait.svelte';
  import GameIcon from './GameIcon.svelte';
  import { skillIconKey } from '../data/game-icons';
  export let race:Race;
  export let reference:ReferenceData|null;
  export let analysis:RaceAnalysis;
  export let selected:string;
  export let onSkill:(skillId:number,runnerId:string)=>void;
  export let onSeek:(time:number)=>void;
  let search='',filter='all',enrich=false,token=0,enrichKey='';
  function verdictParts(row:SkillRow):{kind:'bad'|'good'|'plain';label:string;conditions:string}{
    const split=conditionSplit(row);
    if(row.simulation){const failed=[...new Set(row.conditionEvaluation?.branches.flatMap(b=>b.predicates.filter(p=>p.state==='unmet').map(p=>conditionLabel(p.expression,reference,race.runners.length)))??[])];return {kind:'bad',label:nonProcLabel(row,reference),conditions:failed.join(' ')};}
    if(row.activationStatus==='conditions-unmet')return {kind:'bad',label:'Conditions unmet',conditions:split.unmet.join(', ')};
    if(row.activationStatus==='wit-failure-inferred'||row.activationStatus==='wit-failure-supported')return {kind:'bad',label:'Wit check failed',conditions:split.met.join(', ')};
    if(row.activationStatus==='conditions-met'||row.activationStatus==='conditions-inferred')return {kind:'good',label:'Conditions met',conditions:split.met.join(', ')};
    return {kind:'plain',label:nonProcLabel(row,reference),conditions:''};
  }
  function queueEnrich(){const key=`${selected}:${race.id}`;if(key===enrichKey)return;enrichKey=key;enrich=false;const current=++token;const run=()=>{if(current===token)enrich=true;};const idle=window.requestIdleCallback;if(idle)idle(run,{timeout:500});else setTimeout(run,40);}
  $: if(`${selected}:${race.id}`!==enrichKey)queueEnrich();
  onDestroy(()=>{token++;});
  function tone(skillId:number,received=false){return received?'#8e1e24':skillToneColor[skillTone(reference,skillId)];}
  function combined(runnerId:string){
    if(!enrich)return null;
    const totals=skillTotals(race,reference,analysis,runnerId),benefit=totals.benefit;
    const skills=totals.skills.map(row=>{
      const owner=race.runners.find(r=>r.id===runnerId),level=uniqueLevelLabel(reference,owner,row.skillId),motion=row.motion;
      return {skillId:row.skillId,name:level?`${skillName(reference,row.skillId)} ${level}`:skillName(reference,row.skillId),color:tone(row.skillId),
        missed:!analysis.runners[runnerId]?.skillRows.find(s=>s.skillId===row.skillId)?.effectiveActive,distance:motion?.distance?.mid??null,time:motion?.time?-motion.time.mid:null,score:row.score,coverage:row.coverage,laneMovement:motion?.laneMovement,
        carry:motion?.carryoverEfficiency??null,carryMeters:motion?.carryoverDistance&&(motion.carryoverDistance.mid>0||motion.effects.some(e=>e.kind!=='acceleration'))?motion.carryoverDistance.mid:null,carryTime:motion?.carryoverTime?-motion.carryoverTime.mid:null};
    }).sort((a,b)=>Math.abs(b.distance??0)-Math.abs(a.distance??0)||(b.score??-1)-(a.score??-1)||a.name.localeCompare(b.name));
    return {distance:benefit?.distance?.mid??null,time:benefit?.time?-benefit.time.mid:null,score:totals.score,coverage:totals.coverage,laneMovement:benefit?.laneMovement,
      counted:skills.length,skills,scale:Math.max(.01,...skills.map(skill=>Math.abs(skill.distance??0))),
      carryDistance:benefit?.carryoverDistance?.mid??null,carryTime:benefit?.carryoverTime?-benefit.carryoverTime.mid:null,
      carry:benefit?.carryoverEfficiency??null,carryLabel:!benefit?'No movement effects':benefit.speedPotentialDistance?.mid===0?'No speed effects':!benefit.carryoverComplete||benefit.coverage<.999?'Partial':'Unavailable',complete:benefit?.carryoverComplete&&benefit.coverage>=.999};
  }
  $: needle=search.toLowerCase();
  $: groups=race.runners.filter(runner=>runner.id===selected).map(runner=>({runner,rows:(analysis.runners[runner.id]?.skillRows??[])
    .filter(row=>skillName(reference,row.skillId).toLowerCase().includes(needle)&&(filter==='all'||(filter==='procced'?row.effectiveActive:!row.effectiveActive)))
    .sort((a,b)=>Number(b.effectiveActive)-Number(a.effectiveActive)||compareDisplayedSkills(reference,a.skillId,b.skillId))}))
    .filter(group=>group.rows.length);
  $: totals=enrich&&groups[0]?combined(groups[0].runner.id):null;
  $: hits=(analysis.debuffs??[]).filter(hit=>hit.targetRunnerIds.includes(selected));
</script>
<section class="panel runner-skills-panel">
  <div class="panel-heading"><div><strong>Runner skills</strong><span class="muted">Open a skill for conditions and effects</span></div><div class="toolbar"><input type="search" aria-label="Find a skill" placeholder="Find a skill…" bind:value={search}/><select aria-label="Skill activation filter" bind:value={filter}><option value="all">All skills</option><option value="procced">Active</option><option value="missed">Not confirmed active</option></select></div></div>
  <div class="runner-skill-groups">
    {#each groups as group (group.runner.id)}{@const runner=group.runner}
      <section class="runner-skill-card" class:chosen={runner.id===selected} style={`--runner:${runnerColors[runner.index%runnerColors.length]}`} aria-label={`${runnerName(reference,runner)} skills`}>
        <div class="runner-skill-head"><UmaPortrait {runner} size={32}/><div><h3><span class="runner-gate">{runner.gate??runner.index+1}</span>{runnerName(reference,runner)}</h3><small title="Activated skills.">{group.rows.filter(r=>r.effectiveActive).length} / {group.rows.length} active</small></div></div>
        <div class="skill-totals">{#if !enrich}<span>Adding skill totals…</span>{:else if totals&&totals.counted}
          <div class="totals-summary">
            <div title="Combined skill movement gain."><span>Movement gain</span><strong>{totals.distance===null?'—':`${totals.distance>=0?'+':''}${totals.distance.toFixed(2)} m`}</strong></div>
            <div title="Equivalent travel time saved."><span>Time saved</span><strong>{totals.time===null?'—':`${totals.time.toFixed(3)} s`}</strong></div>
            {#if totals.score!=null}<div title="Overall skill effectiveness."><span>Effectiveness</span><strong>{Math.round(totals.score*100)}% effective</strong><b><i class="score" style:width={`${Math.round(Math.max(0,Math.min(1,totals.score))*100)}%`}></i></b>{#if totals.coverage<.999}<small>{Math.round(totals.coverage*100)}% assessed</small>{/if}</div>{/if}
            <div title="Extra benefit after speed effects end."><span>Carryover gain</span><strong class="carry-total">{totals.carry===null?totals.carryLabel:`+${Math.round(totals.carry*100)}%`}</strong><small>{totals.carryDistance===null?'':`+${totals.carryDistance.toFixed(2)} m`}{#if totals.carryDistance!==null&&!totals.complete} · partial{/if}</small></div>
            <div title="Equivalent travel time saved by the retained speed."><span>Carryover time saved</span><strong class="carry-total">{totals.carryTime===null?'—':`${totals.carryTime.toFixed(3)} s`}</strong></div>
          </div>
          {#if totals.laneMovement}<div class="combined-gain-breakdown"><MovementGainBreakdown value={totals.laneMovement}/></div>{/if}
          <div class="totals-chart" aria-label="Skill movement gains">
            <div class="totals-row totals-header"><span>Skill</span><span>Movement gain</span><span>Effectiveness</span><span class="totals-figures"><span>Distance</span><span>Time</span><span title="Extra distance retained after speed effects end.">Carryover gain</span></span></div>
            {#each totals.skills as skill}
              {@const carryDistance=Math.min(Math.max(0,skill.distance??0),Math.max(0,skill.carryMeters??0))}
              {@const directDistance=(skill.distance??0)-carryDistance}
              <div class="totals-row" class:missed={skill.missed}>
                <span class="totals-name" title={skill.missed?`${skill.name} · did not activate`:skill.name}>{#if skill.missed}<span class="totals-x" aria-hidden="true">×</span>{/if}{skill.name}</span>
                <span class="totals-bars" role="img" aria-label={skill.distance===null?'Movement gain unavailable':`Movement gain: ${skill.distance.toFixed(2)} m; direct: ${directDistance.toFixed(2)} m; carryover: ${carryDistance.toFixed(2)} m`}><i title={`Direct movement gain: ${directDistance.toFixed(2)} m`} style:width={`${Math.abs(directDistance)/totals.scale*100}%`} style:background={skill.color}></i>{#if carryDistance>0}<i class="carry-bar" title={`Carryover gain: ${carryDistance.toFixed(2)} m`} style:width={`${carryDistance/totals.scale*100}%`}></i>{/if}</span>
                <span class="totals-score" title={skill.coverage<.999?`${Math.round(skill.coverage*100)}% assessed`:undefined}><span class="totals-meter"><i style:width={skill.missed||skill.score===null?'0':`${Math.round(Math.max(0,Math.min(1,skill.score))*100)}%`} style:background={skill.color}></i></span><strong>{skill.score===null?'—':`${Math.round(skill.score*100)}%`}</strong></span>
                <span class="totals-figures"><span title={skill.laneMovement?`Lane movement: ${skill.laneMovement.distance?`${skill.laneMovement.distance.mid.toFixed(2)} m`:'unavailable'}${skill.laneMovement.otherLabel?`; ${skill.laneMovement.otherLabel}: ${skill.laneMovement.otherDistance?`${skill.laneMovement.otherDistance.mid.toFixed(2)} m`:'unavailable'}`:''}`:undefined}>{skill.distance===null?'—':`${skill.distance>=0?'+':''}${skill.distance.toFixed(2)} m`}</span><span>{skill.time===null?'—':`${skill.time.toFixed(3)} s`}</span><span class="carry-num">{skill.carryMeters===null?'—':`+${skill.carryMeters.toFixed(2)} m`}{skill.carry===null?'':` · +${Math.round(skill.carry*100)}%`}</span></span>
              </div>
            {/each}
          </div>
        {:else}<span>No skill totals yet.</span>{/if}</div>
        <div class="runner-skill-list">{#each [true,false] as active}{@const rows=group.rows.filter(row=>row.effectiveActive===active)}{#if rows.length}<div class="skill-outcome-group" class:missed={!active}>
        {#each rows as row (row.skillId)}
          {@const levelLabel=uniqueLevelLabel(reference,runner,row.skillId)}
          <article class="skill-row" class:activated={row.effectiveActive} data-activation-status={row.activationStatus} style={`--skill:${tone(row.skillId)}`}>
            <button class="skill-detail-button" title={nonProcLabel(row,reference)} onclick={()=>onSkill(row.skillId,runner.id)}><span class="skill-icon"><GameIcon name={skillIconKey(reference,row.skillId)} size={24}/><span class="outcome-icon" class:failed={!row.effectiveActive} aria-label={row.effectiveActive?'Active':'No activation'}>{row.effectiveActive?'✓':'×'}</span></span><span><strong>{skillName(reference,row.skillId)}{#if levelLabel}<span class="skill-level">{levelLabel}</span>{/if}</strong><small><EffectLine {reference} {runner} skillId={row.skillId} {row}/></small>{#if runner}{@const levelNote=analysis.source!=='simulation'?levelBuffExplanation(reference,runner,row.skillId):null}{#if levelNote}<small class="level-note">{levelNote.summary}</small>{/if}{/if}{#if !row.effectiveActive}{@const verdict=verdictParts(row)}<small class="verdict"><span class="verdict-label" class:bad={verdict.kind==='bad'} class:good={verdict.kind==='good'}>{verdict.label}</span>{#if verdict.conditions}<span class="verdict-condition">{verdict.conditions}</span>{/if}</small>{/if}</span><span class="skill-sp" title={skillCostHelp}>{skillCost(row.skillId).cost===null?'—':`${skillCost(row.skillId).cost} SP`}</span><span class="detail-arrow" aria-hidden="true">›</span></button>
            {#if row.activations.length}<div class="proc-times">{#each row.activations as activation}<button title="Jump to this activation" onclick={()=>{onSeek(activation.start);}}>▶ {activation.start.toFixed(2)} s{#if activationDurationText(activation)}<small> · {activationDurationText(activation)}</small>{/if}</button>{/each}</div>
            {/if}
            {#if enrich&&row.effectiveActive}<SkillImpact impact={skillImpactSummary(analysis.runners[runner.id],row.skillId)} motion={motionSkillImpact(race,reference,analysis,runner.id,row.skillId)}/><SkillMetrics activated metrics={metricsForSkill(race,reference,analysis,runner.id,row.skillId)}/>{#if !row.activations.length}<p class="skill-passive">On for the whole race. Its stat bonus is included in the totals.</p>{/if}{/if}
          </article>
        {/each}</div>{/if}{/each}
        {#if hits.length}<div class="skill-outcome-group received"><h4>{analysis.source==='simulation'?'Skills targeting this runner':'Debuffs received'}</h4>{#each hits as hit}{@const sourceRunner=race.runners.find(r=>r.id===hit.sourceRunnerId)}<article class="skill-row received-hit" style="--skill:#8e1e24"><button class="skill-detail-button" onclick={()=>onSkill(hit.skillId,hit.sourceRunnerId)}><span><strong>{skillName(reference,hit.skillId)}</strong><small>From {sourceRunner?runnerName(reference,sourceRunner):'Unknown runner'}</small></span></button></article>{/each}</div>{/if}
        </div>
      </section>
    {:else}<p class="empty-skills">No matching skills.</p>{/each}
  </div>
  <div class="skills-note">{analysis.source==='simulation'?'Open a skill for activation checks and effects.':'Open a skill for utilization and carryover.'}</div>
</section>
<style>
.totals-bars i{flex-shrink:0}.totals-bars i.carry-bar{background:#8ec8f0}
.combined-gain-breakdown{max-width:440px;margin-bottom:12px}
.skill-sp{margin-left:auto;flex:0 0 auto;text-align:right;color:var(--muted);font-size:var(--font-11);white-space:nowrap}
.skill-detail-button>span:nth-child(2){flex:1;min-width:0;overflow-wrap:anywhere}
.skill-detail-button .detail-arrow{margin-left:0;flex:0 0 auto}
.panel-heading{height:auto;min-height:48px;flex-wrap:wrap;gap:10px}.panel-heading>div:first-child{display:flex;flex-wrap:wrap;gap:8px 14px}.panel-heading .muted{font-size:var(--font-10)}.toolbar input{min-width:140px}.runner-skill-groups{padding:10px}.runner-skill-card{min-width:0;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--panel)}.runner-skill-card.chosen{border-color:var(--runner);box-shadow:0 0 0 1px color-mix(in srgb,var(--runner) 25%,transparent)}.runner-skill-head{display:flex;align-items:center;gap:9px;padding:9px;background:color-mix(in srgb,var(--runner) 5%,var(--panel));border-bottom:1px solid var(--border)}h3{font-size:var(--font-14);font-weight:550;line-height:1.5;margin:0}.runner-gate{display:inline-block;margin-right:6px;color:var(--runner);font-variant-numeric:tabular-nums}.runner-skill-head small{font-size:var(--font-11);color:var(--muted);line-height:1.5}.skill-totals{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);font-size:var(--font-12);font-variant-numeric:tabular-nums}.skill-totals>span{color:var(--text)}.totals-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.totals-summary div{display:grid;gap:3px;min-width:0}.totals-summary span{color:var(--muted);font-size:var(--font-10)}.totals-summary strong{color:var(--text);font-weight:600}.totals-summary .carry-total{color:#8ec8f0}.totals-summary b,.totals-meter{display:block;height:8px;border-radius:0;background:var(--border);overflow:hidden}.totals-summary i,.totals-meter i,.totals-bars i{display:block;height:100%;border-radius:0}.totals-summary i.score{width:0;background:#e2c04a}.totals-figures .carry-num{color:#8ec8f0;font-weight:750}.totals-chart{overflow-x:auto;display:flex;flex-direction:column;gap:2px}.totals-row{min-width:720px;display:grid;grid-template-columns:minmax(88px,1.1fr) minmax(60px,1.6fr) minmax(100px,.8fr) 24em;gap:8px;align-items:center;padding:4px 6px;border-radius:4px}.totals-header{color:var(--muted);border-bottom:1px solid var(--border)}.totals-header>span{font-size:var(--font-10)}.totals-score{display:flex;align-items:center;gap:7px;min-width:0}.totals-score .totals-meter{flex:1;min-width:30px}.totals-score strong{font-size:var(--font-11);font-weight:550;min-width:3em;text-align:right}.totals-row:hover{background:color-mix(in srgb,#000 14%,var(--panel))}.totals-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}.totals-x{margin-right:5px;font-weight:800}.totals-row.missed .totals-name,.totals-row.missed .totals-score strong,.totals-row.missed .totals-figures,.totals-row.missed .totals-figures .carry-num{color:#ef7474}.totals-bars{display:flex;gap:0;min-width:0}.totals-bars i{height:7px;border-radius:0;background:var(--border)}.totals-figures{display:grid;grid-template-columns:5.4em 5.4em 11.2em;column-gap:6px;justify-items:end;color:var(--muted);font-size:var(--font-11);white-space:nowrap}@media(max-width:850px){.totals-summary{grid-template-columns:1fr}.totals-row{grid-template-columns:minmax(0,1fr) 90px}.totals-score,.totals-figures{grid-column:2}.totals-header{display:none}}.runner-skill-list{padding:0 10px}.chosen .skill-outcome-group{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:14px}.skill-row{min-width:0;padding:8px 0;border-bottom:1px solid var(--border)}.skill-row:last-child{border-bottom:0}.skill-detail-button{display:flex;gap:8px;align-items:flex-start;justify-content:flex-start;width:100%;border:1px solid transparent;border-radius:6px;background:color-mix(in srgb,var(--skill) 12%,transparent);padding:8px;text-align:left;white-space:normal;cursor:pointer}.skill-detail-button>span:nth-child(2){text-align:left}.totals-name{text-align:left}.skill-detail-button:hover{border-color:var(--skill);background:color-mix(in srgb,var(--skill) 22%,var(--panel))}.verdict,.verdict{color:var(--skill);font-weight:600}.received h4{margin:8px 0 4px;font-size:var(--font-11);color:#c45a5a;font-weight:650}.skill-detail-button strong{font-size:var(--font-13);font-weight:550;line-height:1.4}.skill-detail-button .skill-level,.activated .skill-detail-button strong .skill-level{margin-left:6px;color:var(--muted);font-size:var(--font-11);font-weight:650;font-variant-numeric:tabular-nums}.skill-detail-button small{display:block;color:var(--muted);font-size:var(--font-11);line-height:1.4;margin-top:2px}.skill-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:27px;min-height:27px;border-radius:4px}.activated .skill-icon{background:var(--accent-soft)}.activated .skill-detail-button strong{color:var(--skill)}.detail-arrow{margin-left:auto;font-size:var(--font-15);color:var(--muted)}.proc-times{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 0 0 33px}.proc-times button{font-size:var(--font-11);padding:3px 5px;background:var(--accent-soft);color:var(--accent-text,var(--accent));border:0}.proc-times small{font-size:var(--font-10)}.skills-note{padding:8px 10px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--font-10);line-height:1.5}.empty-skills{grid-column:1/-1;padding:10px;color:var(--muted);font-size:var(--font-12)}@media(max-width:1100px){.chosen .skill-outcome-group{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:850px){.chosen .skill-outcome-group{grid-template-columns:1fr}}
.skill-outcome-group+.skill-outcome-group{border-top:1px solid var(--border);margin-top:7px;padding-top:7px}.skill-icon{position:relative}.outcome-icon{position:absolute;right:-4px;bottom:-3px;width:13px;height:13px;border-radius:50%;background:var(--panel);color:var(--accent-text,var(--accent));font-size:var(--font-11);font-weight:800;text-align:center;line-height:13px}.outcome-icon.failed{color:#ef7474}.missed .skill-row{opacity:1}.missed .skill-detail-button small.verdict{display:block;color:var(--text);font-size:var(--font-12);font-weight:450;line-height:1.4}.missed .verdict-label.bad{color:#ef7474}.missed .verdict-label.good{color:#6dce86}.missed .verdict-condition{color:var(--text);font-weight:450;margin-left:6px}.skill-passive{margin:4px 0 0 33px;color:var(--muted);font-size:var(--font-11)}
</style>
