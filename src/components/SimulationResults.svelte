<script lang="ts">
  import {skillColumns,sortSkills,activatedWinDelta,skillCheckChance,type SkillSort,type SortDirection} from '../sandbox/skill-table';
  import {activationConfidence} from '../sandbox/activation-confidence';
  import {DEFAULT_IMPACT_PAIRS,type AutomaticSkills} from '../sandbox/automatic-skills';
  import SkillDefinitionPopover from './SkillDefinitionPopover.svelte';
  import EffectivenessMeter from './EffectivenessMeter.svelte';
  import RawStatComparison from './RawStatComparison.svelte';
  import {rawProfile} from '../data/raw-stat-comparison';
  import {initialRace,lobbyMetrics} from '../sandbox/results';
  import {statColors} from '../sandbox/stat-colors';
  import {STAT_PAIRS,STAT_STEP,STAT_RANGE} from '../sandbox/stat-trend';
  import {aggregate,headToHead} from '../sandbox/results';
  import {winImpacts,impactJobsByTarget,targetKey,statKeys,type ImpactRequest,type ImpactTarget,type ImpactExperiment,type StatKey} from '../sandbox/insights';
  import WinImpactValue from './WinImpactValue.svelte';
  import WinImpactDetails from './WinImpactDetails.svelte';
  import StatImpactCurve from './StatImpactCurve.svelte';
  import ConditionInsights from './ConditionInsights.svelte';
  import AverageRaceStats from './AverageRaceStats.svelte';
  import IndividualRaces from './IndividualRaces.svelte';
  import type {Job} from '../sandbox/model';
  import {skillName,type ReferenceData} from '../data/reference';
  import GameIcon from './GameIcon.svelte';
  import RaceTeams from './RaceTeams.svelte';
  import {finishPlace} from '../data/race-teams';
  import SimSymbol from './SimSymbol.svelte';
  import {portraitUrl} from '../data/portraits';
  import {skillIconKey} from '../data/game-icons';
  export let job:Job;
  export let reference:ReferenceData;
  export let onOpen:(index:number)=>void;
  export let opening:number|null=null;
  export let impactJobs:Job[]=[];
  export let onMeasure:(request:ImpactRequest)=>void|Promise<void>;
  export let measuring=false;
  export let canMeasure=true;
  export let automatic:AutomaticSkills|null=null;
  export let onAutomatic:(enabled:boolean)=>void=()=>{};
  let selected='',variant=0,impactCount=DEFAULT_IMPACT_PAIRS;
  let definitionId:number|null=null;
  let comparingStats=false;
  $: displayedSetup={...job.setup,participants:job.setup.participants.map(p=>({...p,uma:variant>0&&job.setup.variations?.participantId===p.id?job.setup.variations.builds[variant-1]:p.uma}))};
  $: comparisonCourse=reference.courses[job.setup.courseId];
  $: teamRace=variantRuns[0]&&comparisonCourse?initialRace(displayedSetup,variantRuns[0],job.id,job.engine.version,reference):null;
  $: definitionRace=(definitionId!==null||comparingStats)?teamRace:null;
  $: participantsById=new Map(job.setup.participants.map(p=>[p.id,p]));
  $: teamLabels=Object.fromEntries(rows.map(row=>[row.id,job.total===1?finishPlace(row.place.mean)??'—':`${pct(row.win)} wins`]));
  $: comparisonProfiles=definitionRace?.runners.map(r=>({...rawProfile(r,comparisonCourse),name:`#${r.index+1} ${r.name}`,mood:r.mood??null,moods:variantRuns.some(run=>run.moods[r.index]!==r.mood)?[1,2,3,4,5].map(mood=>({mood,weight:variantRuns.filter(run=>run.moods[r.index]===mood).length})).filter(m=>m.weight>0):undefined}))??[];
  $: definitionRunner=definitionRace?.runners.find(r=>r.id===current?.id)??null;
  $: lobby=lobbyMetrics(variantRuns);
  let skillSort:SkillSort='gain',skillDirection:SortDirection='desc';
  function sortBy(key:SkillSort){skillDirection=skillSort===key?(skillDirection==='desc'?'asc':'desc'):key==='name'?'asc':'desc';skillSort=key;}
  $: sortedSkills=current?sortSkills(current.skills,skillSort,skillDirection,current.win,id=>skillName(reference,id),impacts):[];
  $: efficiencyScale=Math.max(.01,...(current?.skills??[]).map(s=>Math.abs(s.per100Sp??0)));
  $: participantIndex=job.setup.participants.findIndex(p=>p.id===current?.id);
  $: witChances=currentBuild?.stats.wisdom!=null?variantRuns.filter(r=>r.runners.some(p=>p.id===current?.id)).map(r=>skillCheckChance(currentBuild!.stats.wisdom!,r.moods[participantIndex])):[];
  $: witReliability=witChances.length?witChances.reduce((sum,p)=>sum+p,0)/witChances.length:null;
  const points=(v:number|null)=>v===null?'—':`${v>0?'+':''}${(v*100).toFixed(1)} pp`;
  let resultView:'overview'|'statistics'|'races'='overview';
  let curveStat:StatKey|null=null;
  let inspection:{participantId:string;runnerName:string;target:ImpactTarget}|null=null,starting=false;
  $: measurements=impactJobsByTarget([job,...impactJobs],current?.id??'');
  $: impacts=winImpacts([job,...impactJobs],current?.id??'');
  $: inspectedJob=inspection?(inspection.participantId===current?.id?measurements:impactJobsByTarget([job,...impactJobs],inspection.participantId)).get(targetKey(inspection.target)):undefined;
  $: inspectedResult=inspection?(inspection.participantId===current?.id?impacts:winImpacts([job,...impactJobs],inspection.participantId)).get(targetKey(inspection.target)):undefined;
  function inspect(target:ImpactTarget){if(current)inspection={participantId:current.id,runnerName:current.name,target};}
  const targetTitle=(target:ImpactTarget)=>target.kind==='skill'?skillName(reference,target.skillId):`${target.delta>0?'+':'−'}${Math.abs(target.delta)} ${statLabel(target.stat)}`;
  $: currentBuild=current?identity(current.id):null;
  $: statDisabled=measuring||!canMeasure||variant!==0;
  $: impactDisabled=statDisabled||!Number.isInteger(impactCount)||impactCount<5||impactCount>500;
  async function measure(target:ImpactExperiment){
    if(!current||(target.kind==='skill'?impactDisabled:statDisabled)||starting)return;
    if(target.kind==='skill')inspect(target);starting=true;
    try{await onMeasure({participantId:current.id,target,count:target.kind==='skill'?impactCount:STAT_PAIRS});}finally{starting=false;}
  }
  const statLabel=(key:string)=>key==='wisdom'?'Wit':key.charAt(0).toUpperCase()+key.slice(1);

  $: variantRuns=job.runs.filter(r=>(r.variantIndex??0)===variant);
  $: rows=aggregate(variantRuns);
  $: current=rows.find(r=>r.id===selected)??rows[0];
  $: matchups=current?headToHead(variantRuns,current.id):[];
  $: fieldGain=Math.max(.01,...rows.map(r=>Math.abs(r.gain.mean??0)));
  $: timeLow=Math.min(...rows.map(r=>r.time.p10??Infinity));
  $: timeHigh=Math.max(timeLow+.05,...rows.map(r=>r.time.p90??-Infinity));
  const placeColors=['#e5c35e','#a9c4db','#d5a079','#8ebcac','#8aabd0','#a79bc9','#b08dbb','#9b9baa','#818992'];
  const placeColor=(i:number)=>placeColors[Math.min(i,placeColors.length-1)];
  const identity=(id:string)=>job.setup.variations?.participantId===id&&variant>0?job.setup.variations.builds[variant-1]:job.setup.participants.find(p=>p.id===id)?.uma;
  const timePosition=(t:number|null)=>Math.max(0,Math.min(100,100*((t??timeLow)-timeLow)/(timeHigh-timeLow)));
  const combinedCarry=(row:ReturnType<typeof aggregate>[number])=>Math.min(Math.max(0,row.gain.mean??0),Math.max(0,row.carryover.mean??0));
  $: gainScale=Math.max(.01,...(current?.skills??[]).map(s=>Math.abs(s.gain.mean??0)));
  $: missingCarryover=current?.skills.some(s=>!s.carryoverRecorded)??false;
  const fmt=(v:number|null,d=2)=>v==null?'—':v.toFixed(d);
  const pct=(v:number|null)=>v==null?'—':`${(v*100).toFixed(1)}%`;
  const amount=(v:number|null,unit:string,d=2)=>v==null?'—':`${fmt(v,d)} ${unit}`;
  const percentWidth=(v:number|null)=>100*Math.max(0,Math.min(1,v??0));
  const effectivenessColor=(v:number|null)=>`hsl(${12+percentWidth(v)*1.1} 64% 62%)`;
  const carryPart=(s:NonNullable<typeof current>['skills'][number])=>s.carryoverPaired?Math.min(Math.max(0,s.gain.mean??0),Math.max(0,s.carryover.mean??0)):0;
</script>
<section class="batch-results">
  <div class="result-heading"><div><span class="eyebrow">{job.total===1?'SIMULATED RACE':'MULTI RACE ANALYSIS'}</span><h2>{job.completed} / {job.total} races</h2></div></div>
  {#if job.setup.variations}<label class="version-choice">Displayed version<select bind:value={variant}><option value={0}>Original</option>{#each job.setup.variations.builds as build,i}<option value={i+1}>{build.name}</option>{/each}</select></label>{/if}
  {#if rows.length}
    {#if teamRace}<RaceTeams race={teamRace} {reference} selected={current?.id??''} onSelect={id=>selected=id} runnerLabels={teamLabels}/>{/if}
    <nav class="result-views" aria-label="Simulation result sections">
      <button class:active={resultView==='overview'} aria-pressed={resultView==='overview'} onclick={()=>resultView='overview'}><SimSymbol name="trophy" size={21}/><span>Overview</span></button>
      <button class:active={resultView==='statistics'} aria-pressed={resultView==='statistics'} onclick={()=>resultView='statistics'}><SimSymbol name="batch" size={21}/><span>Averaged race statistics</span></button>
      <button class:active={resultView==='races'} aria-pressed={resultView==='races'} onclick={()=>resultView='races'}><SimSymbol name="race" size={21}/><span>Individual races</span><b>{variantRuns.length}</b></button>
    </nav>
    {#if resultView==='statistics'&&current}
      <div class="statistics-runners" role="group" aria-label="Select runner for average statistics">{#each rows as row}{@const uma=identity(row.id)}<button class:chosen={row.id===current.id} aria-pressed={row.id===current.id} onclick={()=>selected=row.id}>{#if uma&&portraitUrl(uma)}<img src={portraitUrl(uma)!} alt=""/>{/if}<span><small>#{row.slot}</small> {row.name}</span></button>{/each}</div>
      <AverageRaceStats runner={current} {lobby} onCompare={()=>comparingStats=true}/>
    {:else if resultView==='races'}
      <IndividualRaces runs={variantRuns} setup={job.setup} {opening} {onOpen}/>
    {:else}
    <div class="results-caption"><span><SimSymbol name="trophy" size={18}/> Finishing results</span><button onclick={()=>comparingStats=true}>Compare raw stats</button></div>
    <div class="table-scroll race-result-table"><table aria-label="Averaged race results"><thead><tr><th>Uma</th><th class="gold">1st</th><th class="silver">2nd</th><th class="bronze">3rd</th><th><div class="podium-pair"><span>Top 2</span><span>Top 3</span></div></th><th>Mean place</th><th>Finish time <small>10–90% · median</small></th><th>HP left</th><th>Skill gain</th><th>Full spurt</th></tr></thead><tbody>{#each rows as row}
      {@const uma=identity(row.id)}{@const carry=combinedCarry(row)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <tr class:chosen={row.id===current?.id} onclick={()=>selected=row.id} onkeydown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selected=row.id;}}}>
        <td><button class="runner-choice" aria-pressed={row.id===current?.id} onclick={()=>selected=row.id}>{#if uma&&portraitUrl(uma)}<img src={portraitUrl(uma)!} alt=""/>{/if}<span><small>#{row.slot??'—'}</small><span class="runner-heading"><strong>{row.name}</strong>{#if participantsById.get(row.id)?.trainer}<span class="trainer-name" title={participantsById.get(row.id)!.trainer!}>{participantsById.get(row.id)!.trainer}</span>{/if}</span></span></button><div class="placement-bar" title={row.placements.map((p,i)=>`${i+1}: ${pct(p)}`).join(' · ')}>{#each row.placements as p,i}<span style={`width:${p*100}%;background:${placeColor(i)}`}></span>{/each}</div></td>
        {#each [row.win,row.placements[1]??0,row.placements[2]??0] as p,i}<td style={`--place:${placeColor(i)}`}><strong class="podium-value">{pct(p)}</strong><div class="result-meter"><span style:width={`${percentWidth(p)}%`}></span></div></td>{/each}
        <td><div class="podium-pair"><div class="podium-ring" style={`--ring:${percentWidth(row.top2)}%;`}><span>{pct(row.top2)}</span></div><div class="podium-ring" style={`--ring:${percentWidth(row.podium)}%;`}><span>{pct(row.podium)}</span></div></div></td><td>{fmt(row.place.mean)}</td>
        <td class="time-cell" title={`10–90%: ${amount(row.time.p10,'s')} to ${amount(row.time.p90,'s')}; median ${amount(row.time.median,'s')}`}><b>{amount(row.time.mean,'s')}</b><div class="time-spread" aria-hidden="true"><span style:left={`${timePosition(row.time.p10)}%`} style:width={`${Math.max(.7,timePosition(row.time.p90)-timePosition(row.time.p10))}%`}></span><i style:left={`${timePosition(row.time.median)}%`}></i></div></td>
        <td>{fmt(row.hp.mean,0)}<div class="result-meter hp-meter" aria-hidden="true"><span style:width={`${percentWidth((row.hp.mean??0)/Math.max(1,row.metrics.find(m=>m.key==='Starting HP')?.mean??row.hp.mean??1))}%`}></span></div></td>
        <td class="result-gain">{amount(row.gain.mean,'m')}<div class="gain-track" title={`Carryover: ${amount(row.carryover.mean,'m')}`}><span class="direct-fill" style:width={`${Math.max(0,(row.gain.mean??0)-carry)/fieldGain*100}%`}></span><span class="carry-fill" style:width={`${carry/fieldGain*100}%`}></span></div></td>
        <td>{pct(row.fullSpurt)}<div class="result-meter" aria-hidden="true"><span style:width={`${percentWidth(row.fullSpurt)}%`}></span></div></td>
      </tr>{/each}</tbody></table></div>
    {#if current}<div class="batch-cards"><div><small>Finish time · median</small><strong>{fmt(current.time.median)} s</strong><span>10–90%: {fmt(current.time.p10)}–{fmt(current.time.p90)} s</span></div><div><small>Combined effectiveness</small><strong>{pct(current.effectiveness.mean)}</strong><span>{current.effectiveness.n} assessed races</span></div><div><small>Full spurt</small><strong>{pct(current.fullSpurt)}</strong><span>Exhausted: {pct(current.exhaustion)}</span></div><div><small>Combined movement gain</small><strong>{fmt(current.gain.mean)} m</strong><span class="carry-total">Average carryover: {fmt(current.carryover.mean)} m</span></div></div>
    <div class="impact-controls"><div><strong>Win impact</strong>{#if automatic}<label class="automatic-skills"><input type="checkbox" checked={automatic.enabled} onchange={e=>onAutomatic(e.currentTarget.checked)}/>Automatic skills <b>{automatic.completeSkills} / {automatic.totalSkills}</b><span>{automatic.pairs} pairs each · {automatic.phase==='waiting'?'Waiting for your run':automatic.phase}</span></label>{#if automatic.activeJob&&['queued','running'].includes(automatic.activeJob.phase)}<progress aria-label="Automatic skill batch progress" max={automatic.activeJob.total} value={automatic.activeJob.completed}></progress>{/if}{#if automatic.error}<small role="alert">{automatic.error}</small>{/if}{/if}</div><label>Additional pairs<input type="number" min="5" max="500" step="5" bind:value={impactCount}/></label><small>{impactCount*2||'—'} races per skill measurement</small></div>
    {#if currentBuild}<div class="stat-impact-heading"><h3>{current.name} · stat sensitivity</h3><span>−{STAT_RANGE} to +{STAT_RANGE} · steps of {STAT_STEP}</span></div><div class="stat-impacts">{#each statKeys as stat}{@const measured=[...impacts.values()].filter(r=>r.target.kind==='stat'&&r.target.stat===stat)}<button style={`--stat:${statColors[stat]}`} onclick={()=>curveStat=stat}><span><GameIcon name={`stat-${stat}`} size={22}/>{statLabel(stat)}</span><strong>{currentBuild.stats[stat]}</strong><small>{measured.length?`${measured.length} measured ${measured.length===1?'value':'values'}`:'Explore win-rate curve'} <b>→</b></small></button>{/each}</div>{/if}
    {#if impactJobs.length}<details class="measurements"><summary>Saved win-impact measurements · {impactJobs.length}</summary>{#each impactJobs as measured}<p>{measured.setup.participants.find(p=>p.id===measured.setup.variations?.participantId)?.uma.name} · {measured.setup.variations?.builds[0]?.name} · {measured.completed}/{measured.total} · {measured.phase}</p>{/each}</details>{/if}
    <details class="distribution-panel" open><summary>{current.name} · placements &amp; matchups</summary><div class="insight-grid">
      <div><h4>Finishing placement</h4><div class="placement-chart" role="img" aria-label={current.placements.map((p,i)=>`Place ${i+1}: ${pct(p)}`).join(', ')}>{#each current.placements as p,i}<div class="placement-column"><small>{pct(p)}</small><div><span style={`height:${Math.max(1,percentWidth(p))}%;background:${placeColor(i)}`}></span></div><b>{i+1}</b></div>{/each}</div><p>{current.n} races · each bar is the share finishing in that place.</p></div>
      <div><h4>Finishes ahead of</h4><div class="matchup-list">{#each matchups as m}<div title={`${m.ahead} ahead in ${m.n} shared races${m.ties?`; ${m.ties} tied`:''}`}><span>{#if m.slot}<small>#{m.slot} </small>{/if}{m.name}</span><div class="matchup-track"><b style:width={`${percentWidth(m.rate)}%`}></b></div><strong>{pct(m.rate)}</strong><small>{m.n} races</small></div>{/each}{#if !matchups.length}<p>Add opponents to compare finishing order.</p>{/if}</div><p>Observed in this field; a matchup rate is not a one-on-one win prediction.</p></div>
    </div></details>
    <ConditionInsights setup={job.setup} runs={variantRuns} participantId={current.id}/>
    <div class="skill-heading">
      <div class="result-heading"><h3>{current.name} · skills</h3><div class="skill-summary"><span class="wit-number" title="Chance to pass a required Wit check: max(20%, 100% − 9000 / initial Wit). Includes the batch’s moods and the stat soft cap; excludes green skills and strategy aptitude. Guaranteed skills do not roll."><GameIcon name="stat-wisdom" size={19}/>Wit reliability <b>{pct(witReliability)}</b></span><span class="race-count">{current.n} races</span></div></div>
      <div class="gain-legend"><span><b class="direct-key"></b>Direct gain</span><span><b class="carry-key"></b>Carryover · included in total</span><small>Averages per race, including nonactivations</small></div>
    </div>
    {#if missingCarryover}<p class="summary-note">This saved batch predates per-skill carryover. Run its setup again to include the breakdown.</p>{/if}
    <div class="table-scroll skill-table"><table aria-label={`${current.name} average skill gains`}>
      <thead><tr>{#each skillColumns as column}<th aria-sort={skillSort===column.key?(skillDirection==='asc'?'ascending':'descending'):'none'}><button class="column-sort" title={'title' in column?column.title:undefined} onclick={()=>sortBy(column.key)}>{column.label}<span aria-hidden="true">{skillSort===column.key?(skillDirection==='asc'?'↑':'↓'):'↕'}</span></button></th>{/each}</tr></thead>
      <tbody>{#each sortedSkills as s (s.id)}
        {@const carry=carryPart(s)}
        {@const direct=(s.gain.mean??0)-carry}
        {@const winDelta=activatedWinDelta(s,current.win)}
        {@const confidence=activationConfidence(s.winsWhenActivated,s.activatedRaces,Math.round(current.win*current.n),current.n,s.n)}
        <tr>
          <td><button class="skill-identity" aria-label={`${skillName(reference,s.id)} details`} onclick={()=>definitionId=s.id}><GameIcon name={skillIconKey(reference,s.id)} size={23}/><span>{skillName(reference,s.id)}</span></button></td>
          <td class="gain-cell">
            <div class="gain-value" title={`Average total movement gain, including carryover. ${s.gain.n} assessed races.`}>{amount(s.gain.mean,'m')}</div>
            {#if s.gain.mean!==null}<div class="gain-track" role="img" aria-label={`Average total gain ${fmt(s.gain.mean)} m${s.carryoverPaired?`; direct ${fmt(direct)} m; carryover ${fmt(carry)} m`:''}`}>
              <span class="direct-fill" class:loss={direct<0} class:undivided={!s.carryoverPaired} style:width={`${Math.abs(direct)/gainScale*100}%`}></span>
              {#if carry>0}<span class="carry-fill" style:width={`${carry/gainScale*100}%`}></span>{/if}
            </div>{/if}
            {#if s.gain.n>1}<small class="gain-range">10–90%: {fmt(s.gain.p10)}–{fmt(s.gain.p90)} m · median {fmt(s.gain.median)} m</small>{/if}
          </td>
          <td><WinImpactValue measurement={measurements.get(`skill:${s.id}`)} onInspect={()=>inspect({kind:'skill',skillId:s.id})} result={impacts.get(`skill:${s.id}`)} label={`Measure ${skillName(reference,s.id)}`} disabled={impactDisabled} onMeasure={()=>measure({kind:'skill',skillId:s.id})}/></td>
          <td title={`WR when activated: ${pct(s.winRateWhenActivated)} · overall WR: ${pct(current.win)}. ${confidence?`95% range: ${points(confidence.low)} to ${points(confidence.high)}. Color fades in beyond 95% confidence, reaching full color at 99%.`:'Insufficient activation data for uncertainty.'} Association, not causal impact.`}><div class="win-difference" style:color={confidence?.strength?`color-mix(in srgb,${(winDelta??0)>0?'#83d3ac':'#ed97a2'} ${confidence.strength*100}%,var(--text))`:undefined}>{points(winDelta)}</div><small class="win-baseline">{pct(s.winRateWhenActivated)} vs {pct(current.win)}</small><span class="race-count" title="Wins / races where the skill activated">{s.winsWhenActivated} / {s.activatedRaces} races</span></td>
          <td class="carry-value" title={s.carryoverTime.mean===null?'Retained speed benefit.':`${fmt(-s.carryoverTime.mean,3)} s saved by retained speed.`}>{amount(s.carryover.mean,'m')}{#if s.carryover.mean!==null&&s.carryover.n<s.n}<small>{s.carryover.n} / {s.n} assessed</small>{/if}</td>
          <td>{amount(s.time.mean===null?null:-s.time.mean,'s',3)}</td>
          <td><div class="rate-value">{pct(s.effectiveness.mean)}<small>{s.effectiveness.n} assessed</small></div><EffectivenessMeter score={s.effectiveness.mean} color={effectivenessColor(s.effectiveness.mean)}/></td>
          <td><div class="rate-value">{pct(s.activation)}</div><div class="rate-track activation" aria-hidden="true"><span style:width={`${percentWidth(s.activation)}%`}></span></div><span class="race-count">{s.activatedRaces} / {s.n} races</span></td>
          <td class="efficiency-cell">{amount(s.per100Sp,'m')}{#if s.per100Sp!==null}<div class="rate-track efficiency" class:loss={s.per100Sp<0} title="Average distance gain per 100 skill points"><span style:width={`${Math.abs(s.per100Sp)/efficiencyScale*100}%`}></span></div>{/if}</td>
        </tr>
      {/each}</tbody>
    </table></div>{/if}
    <details class="run-details"><summary>Run details</summary><p>Starting seed <b>{job.setup.seed}</b> · {job.setup.shuffleGates?'Gates shuffled':'Fixed gates'}</p></details>
    <details><summary>How to read these results</summary><p>WR when activated shows the percentage-point difference from the runner’s overall win rate, with both rates underneath; it does not measure causation. Effectiveness excludes wit failures; assessable condition failures count as zero. Wit reliability is the calculated chance per required check, averaged over the batch’s moods; guaranteed skills bypass it. Gain per race includes nonactivations. Combined gains are calculated together within each race before averaging.</p><p>Movement and time gains use the same fixed-context velocity comparisons as the race dashboard. They are estimates of an effect’s contribution, not a prediction of a different finishing order. Win impact uses separate races with identical starting seed, gate and mood schedules. Skill impact is the original win rate minus the rate without that skill; stat impact is the changed rate minus the original. Measurements accumulate distinct matched seeds, excluding repeat runs and isolating each engine and race setup. Seed pinning applies to the race setup; these analysis runs always draw fresh seeds. Values are percentage points (pp), not relative percentages. They include activation reliability. Later random decisions can diverge after a change. Open a measurement for its win rates, paired sample count and approximate 95% uncertainty range; a range crossing zero is not conclusive. Gain ranges include nonactivations and exclude unavailable estimates.</p></details>
    {/if}
  {:else}<p class="muted">Results will appear as each race finishes.</p>{/if}
</section>
{#if comparingStats&&comparisonCourse&&comparisonProfiles.length}<RawStatComparison profiles={comparisonProfiles} course={comparisonCourse} ground={job.setup.ground} initialId={current?.id} onClose={()=>comparingStats=false}/>{/if}
{#if definitionId!==null}<SkillDefinitionPopover skillId={definitionId} {reference} runner={definitionRunner} distance={reference.courses[job.setup.courseId]?.distance??0} fieldSize={job.setup.participants.length} onClose={()=>definitionId=null}/>{/if}
{#if curveStat&&current&&currentBuild}<StatImpactCurve jobs={[job,...impactJobs]} participantId={current.id} runnerName={current.name} stat={curveStat} base={currentBuild.stats[curveStat]!} disabled={statDisabled||starting} {starting} onRun={measure} onClose={()=>curveStat=null}/>{/if}
{#if inspection}<WinImpactDetails target={inspection.target} title={targetTitle(inspection.target)} runnerName={inspection.runnerName} result={inspectedResult} measurement={starting?undefined:inspectedJob} bind:count={impactCount} {starting} disabled={impactDisabled} onMeasure={()=>inspection&&measure(inspection.target)} onClose={()=>inspection=null}/>{/if}
<style>
  .runner-heading{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.trainer-name{font-size:10px;font-weight:400;color:var(--muted);max-width:125px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.run-details b{font-variant-numeric:tabular-nums;color:var(--text)}
  .table-scroll.race-result-table{max-height:none}
  .race-result-table th:nth-child(4),.race-result-table td:nth-child(4){padding-right:8px}
  .race-result-table th:nth-child(5),.race-result-table td:nth-child(5){width:106px;padding-left:8px;padding-right:8px}
  .race-result-table th:nth-child(6),.race-result-table td:nth-child(6){width:90px;text-align:center;padding-left:8px;padding-right:8px}
  .race-result-table .podium-pair{justify-content:flex-start}
  .automatic-skills{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.automatic-skills input{width:auto!important}.automatic-skills b{color:var(--text)}.impact-controls progress{height:4px;width:100%;max-width:320px;margin-top:6px}.impact-controls [role=alert]{color:#efa1a8}
  button.skill-identity{justify-content:flex-start;width:100%;border:0;background:transparent;padding:0;text-align:left;color:var(--text);font:inherit}button.skill-identity :global(img){width:23px;height:23px;object-fit:contain;flex:0 0 23px}button.skill-identity:hover{color:var(--accent-text);text-decoration:underline}

  .column-sort{display:flex;align-items:center;justify-content:space-between;gap:9px;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.column-sort span{color:var(--muted)}th[aria-sort="ascending"] .column-sort,th[aria-sort="descending"] .column-sort{color:var(--text)}.skill-summary{display:flex;align-items:center;gap:15px;flex-wrap:wrap}.wit-number{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px}.wit-number b{color:#8bd3a3;font-size:15px}.race-count{display:inline-block;margin-top:5px;padding:4px 7px;border-radius:5px;background:var(--panel-raised);color:var(--text);font-size:12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}.win-difference{font-size:16px;font-weight:600;white-space:nowrap}.win-baseline{display:block;font-size:11px;color:var(--muted);margin:4px 0}.efficiency-cell{min-width:115px}.efficiency span{background:linear-gradient(90deg,#649cc8,#80d7d4)}.efficiency.loss span{background:#ed8896}

  .result-views{display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:16px}.result-views button{display:flex;align-items:center;gap:10px;padding:12px 17px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--muted);font-size:13px}.result-views button:nth-child(1){--view:#e5c35e}.result-views button:nth-child(2){--view:#8dbde7}.result-views button:nth-child(3){--view:#b7a5e4}.result-views button.active{border-color:var(--view);color:var(--view);background:color-mix(in srgb,var(--view) 9%,var(--bg))}.result-views b{font-size:11px;font-weight:500;padding:2px 6px;border-radius:4px;background:var(--panel-raised)}.statistics-runners{display:flex;flex-wrap:wrap;gap:8px}.statistics-runners button{display:flex;align-items:center;gap:7px;font-size:12px;background:var(--bg);border:1px solid var(--border);padding:7px 10px;border-radius:8px}.statistics-runners button.chosen{border-color:#8dbde7;background:color-mix(in srgb,#8dbde7 8%,var(--bg))}.statistics-runners img{width:28px;height:28px;object-fit:contain}.statistics-runners small{color:var(--muted)}
  .batch-results{display:grid;gap:18px}.result-heading{display:flex;justify-content:space-between;align-items:center;gap:15px}.result-heading h2{margin:4px 0 0}.table-scroll{height:auto;max-height:700px;overflow:auto;border:1px solid var(--border);border-radius:9px}table{width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap}th,td{text-align:right;padding:12px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums}th{font-size:11px;color:var(--muted);font-weight:500;background:var(--panel-raised)}th:first-child,td:first-child{text-align:left}td button{border:0;padding:0;background:transparent;font-weight:600}tr.chosen{background:var(--accent-soft)}.placement-bar{display:flex;height:3px;border-radius:3px;overflow:hidden;margin-top:7px;min-width:100px}.batch-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.batch-cards>div{background:var(--panel-raised);padding:16px;border-radius:9px;display:grid;gap:8px}.batch-cards strong{font-size:24px;font-variant-numeric:tabular-nums}.batch-cards small,.batch-cards span{color:var(--muted);font-size:12px}summary{cursor:pointer;font-size:12px;color:var(--muted)}details p{font-size:12px;color:var(--muted);line-height:1.6;max-width:900px}@media(max-width:1000px){.batch-cards{grid-template-columns:1fr 1fr}}

  .skill-heading{display:grid;gap:9px}.skill-heading h3{margin:0}.gain-legend{display:flex;flex-wrap:wrap;align-items:center;gap:16px;color:var(--muted);font-size:11px}.gain-legend>span{display:inline-flex;align-items:center;gap:6px}.gain-legend b{width:16px;height:5px;border-radius:3px}.gain-legend small{margin-left:auto}.direct-key,.direct-fill{background:linear-gradient(90deg,#dca13e,#f3d373)}.carry-key,.carry-fill{background:#70aaff}.summary-note{font-size:12px;color:var(--muted);margin:0}.skill-table{max-height:780px}.skill-table td{vertical-align:middle;padding-top:11px;padding-bottom:11px}.skill-identity{display:flex;align-items:center;gap:9px;min-width:180px;max-width:320px;white-space:normal;line-height:1.4}.gain-cell{min-width:195px}.gain-value{font-weight:600}.gain-track{display:flex;height:8px;margin-top:7px;border-radius:3px;overflow:hidden;background:color-mix(in srgb,var(--text) 6%,transparent)}.gain-track>span{height:100%;flex-shrink:0;transition:width .2s ease}.direct-fill.loss{background:#ed8896}.direct-fill.undivided{background:#8895a6}.carry-value,.batch-cards .carry-total{color:#70aaff}.carry-value small,.rate-value small{display:block;font-size:10px;color:var(--muted);margin-top:3px}.rate-value{font-variant-numeric:tabular-nums}.rate-track{height:4px;min-width:76px;margin-top:7px;border-radius:3px;background:color-mix(in srgb,var(--text) 7%,transparent);overflow:hidden}.rate-track>span{display:block;height:100%;border-radius:3px;transition:width .2s ease}.activation span{background:#62c9ad}.skill-table tbody tr:hover{background:color-mix(in srgb,var(--text) 3%,transparent)}

  .podium-pair{display:flex;justify-content:flex-end;gap:8px}.podium-pair>span{width:49px;text-align:center}.podium-pair .podium-ring{margin:0;flex-shrink:0}.race-result-table tbody tr{cursor:pointer}.race-result-table tbody tr:hover{background:color-mix(in srgb,var(--accent) 8%,var(--panel))}.race-result-table tbody tr.chosen:hover{background:var(--accent-soft)}
  .results-caption{display:flex;justify-content:space-between;align-items:center;gap:12px}.results-caption>span{display:flex;align-items:center;gap:9px;font-weight:600;color:#e5c35e}.race-result-table th small{display:block;font-size:9px;white-space:nowrap;margin-top:4px}.runner-choice{display:flex;align-items:center;gap:9px;text-align:left;max-width:230px}.runner-choice img{width:34px;height:34px;object-fit:contain;border-radius:50%}.runner-choice>span{display:grid;gap:4px;white-space:normal;min-width:125px}.runner-choice small{color:var(--muted);font-size:9px}.runner-choice strong{font-size:12px}.race-result-table .placement-bar{height:5px;margin-top:10px}.podium-value{color:var(--place);font-size:13px}.result-meter{height:5px;min-width:55px;margin-top:8px;border-radius:3px;background:color-mix(in srgb,var(--text) 6%,transparent);overflow:hidden}.result-meter>span{display:block;height:100%;background:var(--place,#8db9ca);border-radius:3px}.hp-meter>span{background:#73c9a0}.podium-ring{display:grid;place-items:center;width:49px;height:49px;margin-left:auto;border-radius:50%;background:conic-gradient(#79b9bd var(--ring),var(--border) 0);position:relative}.podium-ring:before{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--panel)}.podium-ring span{position:relative;font-size:10px}.time-cell{min-width:120px}.time-spread{height:12px;margin-top:6px;position:relative;background:linear-gradient(var(--border),var(--border)) center/100% 1px no-repeat}.time-spread span{position:absolute;top:4px;height:4px;background:#91adce;border-radius:3px}.time-spread i{position:absolute;top:2px;height:8px;width:2px;background:#e0eafa}.result-gain{min-width:105px}.race-result-table .gain-track{height:5px;margin-top:8px}.race-result-table .gold{color:#e5c35e}.race-result-table .silver{color:#a9c4db}.race-result-table .bronze{color:#d5a079}.distribution-panel{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px}.distribution-panel>summary{font-size:13px;font-weight:550;color:var(--text)}.insight-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:28px;margin-top:18px}.insight-grid h4{margin:0 0 15px;font-size:12px;color:var(--muted);font-weight:500}.insight-grid p{font-size:10px;margin-bottom:0}.placement-chart{display:flex;gap:7px;height:160px;align-items:stretch}.placement-column{display:flex;flex:1;min-width:0;flex-direction:column;gap:7px;align-items:center}.placement-column small{font-size:9px;font-variant-numeric:tabular-nums}.placement-column>div{height:110px;width:100%;max-width:40px;display:flex;align-items:flex-end;background:color-mix(in srgb,var(--text) 3%,transparent);border-radius:4px;overflow:hidden}.placement-column span{width:100%;border-radius:4px}.placement-column b{font-size:11px;font-weight:500;color:var(--muted)}.matchup-list{display:grid;gap:9px;max-height:180px;overflow:auto}.matchup-list>div{display:grid;grid-template-columns:minmax(110px,1.5fr) minmax(60px,1fr) 44px 46px;gap:9px;align-items:center;font-size:11px}.matchup-list>div>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.matchup-list>div>span small{margin-right:4px}.matchup-list strong{text-align:right;font-weight:500;color:#91c5ce}.matchup-list small{font-size:9px;color:var(--muted);text-align:right}.matchup-track{height:7px;border-radius:3px;background:var(--border);overflow:hidden}.matchup-track b{display:block;height:100%;background:linear-gradient(90deg,#7d9cb8,#8dd0c4)}@media(max-width:1050px){.insight-grid{grid-template-columns:1fr}.results-caption{align-items:flex-start;flex-direction:column}}

  .version-choice{display:flex;gap:12px;align-items:center;font-size:12px;color:var(--muted)}.version-choice select{padding:7px;background:var(--bg);color:var(--text);border:1px solid var(--border)}.impact-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:18px}.impact-controls>div{display:grid;gap:5px;flex:1;min-width:220px}.impact-controls strong{font-size:14px}.impact-controls span,.impact-controls>small{font-size:11px;color:var(--muted)}.impact-controls label{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--muted)}.impact-controls input{width:70px;padding:6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:5px}.stat-impact-heading{display:flex;justify-content:space-between;align-items:center}.stat-impact-heading h3{font-size:13px;margin:0}.stat-impact-heading>span{font-size:12px;color:var(--muted)}.stat-impacts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.stat-impacts>button{padding:12px;border:1px solid color-mix(in srgb,var(--stat) 35%,var(--border));border-radius:8px;background:color-mix(in srgb,var(--stat) 4%,var(--bg))}.stat-impacts>button>span{display:flex;align-items:center;gap:6px;color:var(--stat);font-size:12px}.stat-impacts>button>strong{display:block;font-size:22px;margin:8px 0;font-weight:500}.stat-impacts>button{display:grid;gap:6px;text-align:left}.stat-impacts>button>small{font-size:11px;color:var(--muted)}.stat-impacts>button b{color:var(--stat);margin-left:5px}.stat-impacts>button:hover{border-color:var(--stat)}.gain-range{display:block;font-size:9px;color:var(--muted);margin-top:6px}.measurements p{margin:5px 0;font-size:11px}@media(max-width:1100px){.stat-impacts{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:650px){.stat-impacts{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
