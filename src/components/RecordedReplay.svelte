<script lang="ts">
  import type { Race } from '../data/types';
  import type { ReferenceData } from '../data/reference';
  import { runnerName } from '../data/reference';
  import { sampleRecordedAt } from '../data/observational-sample';
  import { runnerColors } from '../library';
  import { courseCaption } from '../race-display';
  import RaceConditions from './RaceConditions.svelte';
  import type { PreparedRace } from '../analysis/prepared';
  export let race:Race;
  export let reference:ReferenceData|null=null;
  export let time=0;
  export let selected='';
  export let historical:PreparedRace|null=null;
  export let onSeek:(time:number)=>void;
  export let onSelect:(id:string)=>void;
  export let onExport:()=>void;
  $: samples=sampleRecordedAt(race,time);
  $: extent=race.frames.reduce((maximum,frame)=>frame.runners.reduce((value,sample)=>Math.max(value,sample.distance??0),maximum),1);
  $: events=race.events.filter(e=>!selected||e.runnerId===selected||e.runnerId===null);
  const fmt=(value:number|null|undefined,digits=2)=>value==null?'—':value.toFixed(digits);
</script>
<section class="panel recorded-replay" aria-label="Recorded replay">
  <div class="panel-heading"><div><span class="eyebrow">RECORDED</span><h1>{courseCaption(race,reference)}</h1><RaceConditions conditions={race.conditions}/></div><button onclick={onExport}>Export race JSON</button></div>
  {#if race.racedAt}<p>Logged time: {race.racedAt}{race.savedReplay?' · Saved Replay':''} · {race.racedAtSource??'source unspecified'}</p>{/if}
  <svg viewBox={`0 0 1000 ${Math.max(120,race.runners.length*34+30)}`} role="img" aria-label="Recorded runner positions, interpolated between samples">
    {#each race.runners as runner,i}
      {@const sample=samples.find(s=>s.runnerId===runner.id)}
      <path d={`M160,${i*34+22}H970`} stroke="var(--border)"/>
      <text x="4" y={i*34+27} fill="var(--text)" font-size="12">{runnerName(reference,runner).slice(0,23)}</text>
      {#if sample?.distance!=null}<circle cx={160+Math.max(0,sample.distance)/extent*810} cy={i*34+22} r={selected===runner.id?10:7} fill={runnerColors[i%runnerColors.length]}/>{/if}
    {/each}
  </svg>
  <slot/>
  <p class="muted">Recorded samples with numeric interpolation. HP, speed and lane show observations; their causes are not inferred.</p>
  <div class="table-scroll"><table><thead><tr><th>Runner</th><th>Finish</th><th>Raw seconds</th><th>Position m</th><th>Speed m/s</th><th>HP</th><th>Lane</th></tr></thead><tbody>
    {#each race.runners as runner}{@const sample=samples.find(s=>s.runnerId===runner.id)}
      <tr><td><button class:active={selected===runner.id} onclick={()=>onSelect(runner.id)}>{runnerName(reference,runner)}</button></td><td>{runner.finishOrder??'—'}</td><td>{fmt(runner.finishTimeRaw,6)}</td><td>{fmt(sample?.distance)}</td><td>{fmt(sample?.speed)}</td><td>{fmt(sample?.hp,0)}</td><td>{fmt(sample?.lane,4)}</td></tr>
    {/each}
  </tbody></table></div>
  <details><summary>Recorded events · {events.length}</summary><div class="recorded-events">{#each events as event}<p><button onclick={()=>onSeek(event.time)}>{event.time.toFixed(6)} s</button> {event.label} · parameters {event.params.join(', ')}</p>{/each}</div></details>
  <details><summary>Recorded runner data and provenance</summary><pre>{JSON.stringify({runners:race.runners,originalRace:race.originalRace,capture:race.capture,warnings:race.warnings},null,2)}</pre></details>
  {#if historical}<details open><summary>Inferred · {historical.authorization?.plan.engine.version}</summary><p>Results from the selected historical worker and its own reference snapshot.</p><pre>{JSON.stringify(historical.analysis.runners,null,2)}</pre></details>{/if}
</section>
<style>
  .recorded-replay{padding:24px}.panel-heading{align-items:start}h1{margin:6px 0 12px}svg{width:100%;max-height:560px}table{width:100%;text-align:left;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--border)}.table-scroll{overflow:auto}details{margin-top:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:500px;overflow:auto}.recorded-events{max-height:360px;overflow:auto}
</style>
