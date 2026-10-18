<script lang="ts">
  import { onMount } from 'svelte';
  import type { AnalysisGateReport, AnalysisGateReportSummary, JsonObject } from '../simulation/contracts';
  import { canUseSimulatedCapability } from '../simulation/contracts';
  import { decisionTrace, motionAt, motionIndex as i, paceModes, blockingSummary } from '../simulation/trace';
  import type { Race } from '../data/types';
  import { runnerBySlot } from '../data/types';
  import { runnerName, type ReferenceData } from '../data/reference';
  export let report:AnalysisGateReportSummary;
  export let load:()=>Promise<AnalysisGateReport|null>;
  export let race:Race;
  export let reference:ReferenceData|null=null;
  export let selected='';
  export let time=0;
  export let onSeek:(time:number)=>void;
  export let onSelect:(id:string)=>void;
  let detail:AnalysisGateReport|null=null;
  let busy=false,message='',skill='',eventFilter='decisions',page=0;
  const pageSize=60;
  const fmt=(value:unknown,digits=3)=>typeof value==='number'?value.toFixed(digits):'—';
  const name=(index:number)=>{const r=runnerBySlot(race.runners,index);return r?runnerName(reference,r):`Runner ${index+1}`;};
  const skillName=(id:string)=>reference?.metadata.skillNames[id]??id;
  $: allowed=canUseSimulatedCapability(report,'recordedResults',report.binding);
  $: compared=detail?.binding?.authorizationSha256===report.binding?.authorizationSha256?detail:null;
  $: trace=decisionTrace(compared);
  $: runner=race.runners.find(r=>r.id===selected)??race.runners[0];
  $: slot=runner?.index??0;
  $: {slot;skill='';}
  $: rows=(trace?.motion??[]).filter(row=>row[i.horse]===slot);
  $: now=motionAt(rows,time);
  $: results=compared?.simulation?.modeled?.results as JsonObject[]|undefined;
  $: finish=typeof results?.[slot]?.finishTimeRaw==='number'?results[slot].finishTimeRaw as number:Infinity;
  $: summary=blockingSummary(rows.filter(row=>row[i.time]<=finish));
  $: events=(trace?.events??[]).filter(e=>e.horseIndex===slot);
  $: wits=events.filter(e=>e.kind==='skill-wit');
  $: spurts=events.filter(e=>['spurt-input','spurt-roll','spurt-plan','spurt-accepted','spurt-fallback'].includes(e.kind));
  $: visible=events.filter(e=>(!skill||e.skillId===skill)&&(eventFilter==='all'||eventFilter==='rng'?eventFilter==='all'||e.kind==='rng-draw':e.kind!=='rng-draw'&&e.kind!=='spurt-search'));
  $: selectedEvents=visible.slice(page*pageSize,(page+1)*pageSize);
  $: {slot;skill;eventFilter;page=0;}
  $: maximumTime=Math.max(1,rows.at(-1)?.[i.time]??race.duration);
  $: speedPath=rows.map((row,index)=>`${index?'L':'M'}${(row[i.time]/maximumTime*960).toFixed(2)},${(150-row[i.speed]*4).toFixed(2)}`).join('');
  $: targetPath=rows.map((row,index)=>`${index?'L':'M'}${(row[i.time]/maximumTime*960).toFixed(2)},${(150-row[i.target]*4).toFixed(2)}`).join('');
  $: lossPath=rows.map((row,index)=>`${index?'L':'M'}${(row[i.time]/maximumTime*960).toFixed(2)},${(205-row[i.selfLoss]*8).toFixed(2)}`).join('');
  async function open(){busy=true;message='';try{detail=await load();if(!detail)message='Analysis selection changed. Reopen this race.';}catch{detail=null;message='Simulation details are no longer available. Reopen this race.';}finally{busy=false;}}
  onMount(()=>{void open();});
</script>
{#if allowed}
<section class="panel compared" aria-label="Simulator analysis">
  <span class="eyebrow">SIMULATED · REPLAY MATCHED</span>
  <h2>Race decisions</h2>
  <p>The simulator reproduced all supported recorded fields at their recorded precision. These panels explain its execution. {report.compatibility?.mode==='simulation_trial'?'The original game version is still unknown.':''}</p>
  {#if busy}<p role="status">Loading simulator decisions…</p>{/if}
  {#if message}<p role="status">{message}</p><button onclick={open}>Retry details</button>{/if}
  {#if trace}
    <div class="runner-tabs">{#each race.runners as r}<button class:active={runner.id===r.id} onclick={()=>onSelect(r.id)}>#{r.gate??r.index+1} {runnerName(reference,r)}</button>{/each}</div>
    <div class="trace-transport"><strong>{fmt(time)} s</strong><input aria-label="Simulator time" type="range" min="0" max={maximumTime} step="0.0666" value={time} oninput={e=>onSeek(Number(e.currentTarget.value))}/></div>
    <svg viewBox="0 0 960 220" role="img" aria-label="Simulated speed, target speed, and self-speed blocking reduction">
      <path d="M0,150H960M0,205H960" stroke="var(--border)"/>
      <path d={targetPath} stroke="#cda4fa" fill="none" stroke-width="1.4"/><path d={speedPath} stroke="#65d6b0" fill="none" stroke-width="1.8"/>
      <path d={lossPath} stroke="#ffb56b" fill="none" stroke-width="1.8"/>
      <path d={`M${time/maximumTime*960},0V220`} stroke="var(--text)" stroke-dasharray="4 4"/>
    </svg>
    <p class="legend"><span>● Speed</span><span>● Target speed</span><span>● Self-speed clamp reduction</span></p>
    {#if now}
      <div class="metrics">
        <div><small>Tick · {now[i.tick]}</small><strong>{fmt(now[i.time])} s</strong><span>{fmt(now[i.position],1)} m · phase {now[i.phase]}</span></div>
        <div><small>Speed / target</small><strong>{fmt(now[i.speed])} / {fmt(now[i.target])}</strong><span>m/s · acceleration {fmt(now[i.acceleration])} m/s²</span></div>
        <div><small>HP</small><strong>{fmt(now[i.hp],1)}</strong><span>Lane {fmt(now[i.lane],4)} → {fmt(now[i.laneTarget],4)}</span></div>
        <div><small>Position keeping</small><strong>{paceModes[now[i.paceMode]]??'Unknown'}</strong><span>Coefficient {fmt(now[i.pace])} · force in {now[i.forceIn]?'active':'off'}</span></div>
        <div><small>Race states</small><strong>{now[i.spurt]?'Last spurt':'No last spurt'}</strong><span>Rushing {now[i.rushing]} · downhill {now[i.downhill]?'on':'off'}</span><span>Spot struggle {now[i.spotStruggle]?'on':'off'} · duel {now[i.duel]?'on':'off'}</span></div>
        <div><small>Front blocker</small><strong>{now[i.blocker]>=0?name(now[i.blocker]):'None'}</strong><span>{now[i.blocker]>=0?`${fmt(now[i.gap])} m gap · `:''}cap {fmt(now[i.cap])} m/s</span></div>
      </div>
      <details open><summary>Speed calculation and blocking</summary>
        <p>Base target {fmt(now[i.base])} m/s · section {fmt(now[i.section])} · position coefficient {fmt(now[i.pace])} · final target {fmt(now[i.target])} m/s.</p>
        <p>Self speed before the clamp: <b>{fmt(now[i.unclamped])}</b> → after: <b>{fmt(now[i.selfSpeed])}</b> m/s. Direct reduction: <b>{fmt(now[i.selfLoss])} m/s</b>.</p>
        <p>Skill-adjusted speed: <b>{fmt(now[i.skillSpeed])}</b> → final speed: <b>{fmt(now[i.speed])}</b> m/s. Final clamp reduction: <b>{fmt(now[i.finalLoss])} m/s</b>.</p>
        <p>Before the finish: {fmt(summary.blockedSeconds,2)} s with a front blocker; {fmt(summary.constrainedSeconds,2)} s with a speed clamp reducing speed. Maximum reductions: {fmt(summary.maximumSelfClamp)} / {fmt(summary.maximumFinalClamp)} m/s at the two stages.</p>
        <p>Continuous blocking timers: front {fmt(now[i.blockedFrontSeconds])} s · side {fmt(now[i.blockedSideSeconds])} s · all directions {fmt(now[i.blockedAllSeconds])} s. Near-lane timers: ahead {fmt(now[i.nearFrontSeconds])} s · behind {fmt(now[i.nearBehindSeconds])} s. Overtake-target timer: {fmt(now[i.overtakeTargetSeconds])} s.</p>
        <p class="muted">The two clamps are separate stages. They do not measure the finish-time cost of traffic; that requires a separate counterfactual run. Nearby runners can also change positioning and lane decisions.</p>
      </details>
    {:else}<p>No movement tick yet. Move the timeline past the start delay.</p>{/if}
    <details open><summary>Last-spurt decisions · {spurts.filter(e=>e.kind==='spurt-roll').length} lottery rolls</summary>
      <p>Each calculation can accept full speed immediately, search for affordable candidates, or fail. A calculation can therefore use zero lottery rolls.</p>
      <div class="event-list">{#each spurts as event}<div><button onclick={()=>onSeek(event.time)}>{fmt(event.time)} s</button><b>{event.kind.replace('spurt-','')}</b><code>{JSON.stringify(event.data)}</code></div>{/each}</div>
    </details>
    <details open><summary>Skills · initialization wit checks and activation decisions</summary>
      <p>Wit lotteries occur during initialization. Runtime conditions, latched preconditions, sampled windows and cooldowns are checked separately. Forced activation can override a failed ordinary wit lottery.</p>
      <div class="table-scroll"><table><thead><tr><th>Skill</th><th>Wit roll</th><th>Required</th><th>Ordinary lottery</th><th>Activated at</th></tr></thead><tbody>
        {#each wits as event}{@const activations=events.filter(e=>e.kind==='skill-activated'&&e.skillId===event.skillId)}
          <tr><td><button onclick={()=>{skill=event.skillId;eventFilter='decisions';}}>{skillName(event.skillId)}</button></td><td>{event.data.checked?fmt(event.data.roll,5):'Not required'}</td><td>{event.data.checked?`< ${fmt(event.data.threshold,5)}`:'—'}</td><td>{event.data.passed?'Passed / exempt':'Failed'}</td><td>{#each activations as a}<button onclick={()=>onSeek(a.time)}>{fmt(a.time)} s</button>{/each}{#if !activations.length}No activation{/if}</td></tr>
        {/each}
      </tbody></table></div>
    </details>
    <details open><summary>Decision log · {visible.length} rows</summary>
      <div class="filters"><label>Skill <select bind:value={skill}><option value="">All skills and states</option>{#each wits as e}<option value={e.skillId}>{skillName(e.skillId)}</option>{/each}</select></label><label>Show <select bind:value={eventFilter}><option value="decisions">Decisions and conditions</option><option value="rng">Raw shared RNG draws</option><option value="all">Everything, including spurt searches</option></select></label></div>
      <p class="muted">Rows record checks actually executed. Short-circuited predicates are not evaluated for logging. Repeated identical checks on consecutive ticks appear as one series; first/last sequences bound that series.</p>
      <div class="event-list">{#each selectedEvents as event}<div><button onclick={()=>onSeek(event.time)}>{fmt(event.time)}{event.count>1?`–${fmt(event.lastTime)}`:''} s</button><b>{event.kind}</b><span>{event.skillId?`${skillName(event.skillId)} · branch ${event.detail+1}`:event.stage}{event.count>1?` · ${event.count} checks`:''}</span><code>{JSON.stringify(event.data)}</code></div>{/each}</div>
      <button disabled={page===0} onclick={()=>page--}>Previous</button><span> Page {page+1} / {Math.max(1,Math.ceil(visible.length/pageSize))} </span><button disabled={(page+1)*pageSize>=visible.length} onclick={()=>page++}>Next</button>
    </details>
    <p class="muted">Source: {report.binding?.simulation?.engineId} · {trace.observations.toLocaleString()} trace observations. Private decisions are modeled, not independently recorded by the game.</p>
  {:else if compared}<p>Recorded fields matched, but this build did not provide a complete supported decision trace.</p>{/if}
</section>
{/if}
<style>
  .compared{padding:24px;overflow:hidden}.runner-tabs,.filters{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.trace-transport{display:flex;align-items:center;gap:16px}.trace-transport input{flex:1}svg{width:100%;max-height:260px}.legend{display:flex;gap:20px;font-size:12px}.legend span:nth-child(1){color:#65d6b0}.legend span:nth-child(2){color:#cda4fa}.legend span:nth-child(3){color:#ffb56b}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.metrics>div{padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:6px}.metrics small,.metrics span{color:var(--muted);font-size:12px}.metrics strong{font-size:17px}table{width:100%;text-align:left;margin:16px 0;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--border)}.table-scroll{overflow:auto}.event-list{max-height:420px;overflow:auto;margin:12px 0}.event-list>div{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--border)}code{font-size:11px;overflow-wrap:anywhere;max-width:100%}details{margin-top:22px}summary{cursor:pointer;font-weight:600}p{line-height:1.6}
</style>
