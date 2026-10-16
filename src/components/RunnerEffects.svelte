<script lang="ts">
  import {uphillHelp,downhillHelp,debuffHelp} from '../data/analysis-copy';
  import type { RunnerAnalysis } from '../data/analytics';
  import type { ReferenceData } from '../data/reference';
  import { skillName,runnerName } from '../data/reference';
  import type { Race } from '../data/types';
  import type { RunnerMotion, MotionBand } from '../data/race-motion';
  import type { StatusModeImpact } from '../data/status-mode-impact';
  import { statusShortLabel } from '../data/status-presentation';
  import ModeImpactSummary from './ModeImpactSummary.svelte';
  export let detail:RunnerAnalysis|undefined;
  export let motion:RunnerMotion;
  export let modes:StatusModeImpact[]=[];
  const range=(v:MotionBand,d=2)=>Math.abs(v.max-v.min)<10**-d?v.mid.toFixed(d):`${v.min.toFixed(d)}–${v.max.toFixed(d)}`;
  export let reference:ReferenceData|null;
  export let race:Race;
  export let onSeek:(time:number)=>void;
  const f=(v:number|null|undefined,d=2)=>v==null?'—':v.toFixed(d);
  const signed=(v:number|null|undefined,d=2)=>v==null?'—':`${v>0?'+':''}${v.toFixed(d)}`;
  const sourceName=(id:string)=>{const runner=race.runners.find(r=>r.id===id);return runner?runnerName(reference,runner):'Unknown runner';};
  $: uphillCompare=(()=>{const values=(detail?.hillImpacts??[]).filter(hill=>hill.kind==='uphill'&&hill.powerTimeDelta!=null).map(hill=>hill.powerTimeDelta!);return values.length?values.reduce((sum,value)=>sum+value,0):null;})();
</script>
{#if motion.trafficLoss?.duration||motion.exhaustionLoss?.duration}
  <section class="effect-section" aria-label="Blocking and exhaustion">
    <h3>Speed lost <small>Calculated</small></h3>
    {#each [{label:'Traffic',value:motion.trafficLoss},{label:'Exhausted',value:motion.exhaustionLoss}] as item}{@const value=item.value}
      {#if value?.duration}<div class="effect-total"><strong>{item.label} · {f(value.duration,1)} s</strong>
        {#if value.distanceLoss}<dl><dt>Distance lost</dt><dd>{range(value.distanceLoss)} m</dd>{#if value.timeLoss}<dt>Time added</dt><dd>{range(value.timeLoss,3)} s</dd>{/if}</dl>{#if (value.coverage??0)<.999}<small class="muted">Partial · {Math.round((value.coverage??0)*100)}% assessed</small>{/if}{:else}<p class="muted">Distance loss unavailable</p>{/if}
        <details><summary>Intervals</summary>{#each value.episodes as interval}<button class="effect-event" onclick={()=>onSeek(interval.start)}><strong>▶ {f(interval.start)}–{f(interval.end)} s</strong>{#if interval.distanceLoss}<small>{range(interval.distanceLoss)} m lost</small>{/if}</button>{/each}</details>
      </div>{/if}
    {/each}
  </section>
{/if}
{#if modes.some(m=>m.kind!=='downhill-mode')}
  <section class="effect-section" aria-label="Position keep gains"><h3>Position keep <small>Calculated</small></h3>
    {#each modes.filter(m=>m.kind!=='downhill-mode') as mode}<div class="effect-total"><strong>{statusShortLabel(mode.kind)} · {f(mode.duration,1)} s</strong><ModeImpactSummary value={mode}/></div>{/each}
  </section>
{/if}
{#if detail?.hillTotals}
  <section class="effect-section" aria-label="Hill effects">
    <h3>Hills <small>Model</small></h3>
    {#each ['uphill','downhill'] as kind}{@const total=detail.hillTotals[kind as 'uphill'|'downhill']}
      {#if total.intervals}<div class="effect-total"><strong>{kind==='uphill'?'Uphill':'Downhill'}</strong>
        {#if kind==='uphill'}<p class="explain">Target speed drops by grade × 200 / power. A steeper hill or lower power costs more time. The comparison below is the same hills at 1000 power.</p>{#if uphillCompare!==null}<p class="explain">Versus 1000 power: {Math.abs(uphillCompare).toFixed(3)} s {uphillCompare<0?'faster':'slower'}.</p>{/if}{/if}
        {#if kind==='downhill'&&modes.some(m=>m.kind==='downhill-mode')}<ModeImpactSummary value={modes.find(m=>m.kind==='downhill-mode')}/>{:else if total.modeledDistanceDelta===null&&total.modeledTimeDelta===null&&total.modeledHpDelta===null}<p class="explain">{total.assessedDuration>0?`${f(total.assessedDuration,1)} s on slope. The per-slope lines below have the measured pieces.`:kind==='downhill'?'Downhill mode could not be confirmed from HP.':'Power or the course is missing, so the slowdown is not calculated.'}</p>{:else}<dl>{#if total.modeledTimeDelta!==null}<dt>Time {total.modeledTimeDelta<0?'saved':'lost'}</dt><dd>{f(Math.abs(total.modeledTimeDelta),3)} s</dd>{/if}{#if total.modeledDistanceDelta!==null}<dt>Distance</dt><dd>{signed(total.modeledDistanceDelta)} m</dd>{/if}{#if total.modeledHpDelta!==null}<dt>HP {total.modeledHpDelta<0?'saved':'spent'}</dt><dd>{f(Math.abs(total.modeledHpDelta),1)}</dd>{/if}</dl>{/if}</div>{/if}
    {/each}
    <details><summary>By slope</summary>{#each detail.hillImpacts??[] as hill}<button class="effect-event" disabled={hill.start===null} onclick={()=>hill.start!==null&&onSeek(hill.start)} title={hill.kind==='uphill'?uphillHelp:downhillHelp}><strong>{hill.kind==='uphill'?'Up':'Down'} {Math.abs(hill.slopePercent).toFixed(1)}% <span>{hill.distanceStart.toFixed(0)}–{hill.distanceEnd.toFixed(0)} m</span></strong><small>{signed(hill.modeledSpeedDelta,3)} m/s · {signed(hill.modeledDistanceDelta)} m</small>{#if hill.powerTimeDelta!==null}<small>Power: {Math.abs(hill.powerTimeDelta).toFixed(3)} s {hill.powerTimeDelta<0?'saved':'lost'} vs 1000</small>{/if}{#if hill.modeledHpSaved!==null}<small>{hill.modeledHpSaved.toFixed(1)} HP saved</small>{/if}</button>{/each}</details>
  </section>
{/if}
{#if detail?.receivedDebuffImpacts?.length}
  {@const total=detail.receivedDebuffTotals}
  <section class="effect-section" aria-label="Received debuffs">
    <h3>Debuffs received</h3>
    {#if total}<div class="effect-total" title={debuffHelp}><dl><dt>HP lost</dt><dd>{f(total.modeledHpDelta,1)}</dd><dt>Distance lost</dt><dd>{f(total.modeledDistanceDelta===null?null:-total.modeledDistanceDelta)} m</dd><dt>Time lost</dt><dd>{f(total.modeledTimeDelta,3)} s</dd></dl></div>{/if}
    {#each detail.receivedDebuffImpacts as impact}<button class="effect-event" title={debuffHelp} onclick={()=>onSeek(impact.start)}><strong>{skillName(reference,impact.skillId)}</strong><small>{sourceName(impact.sourceRunnerId)} · {impact.start.toFixed(2)} s</small><small>{signed(impact.modeledDistanceDelta)} m · {f(impact.modeledHpDelta,1)} HP lost</small></button>{/each}
  </section>
{/if}
<style>
  .effect-section{padding:14px 16px;border-bottom:1px solid var(--border)}h3{display:flex;justify-content:space-between;font-size:var(--font-13);margin:0 0 8px}h3 small{color:var(--muted);font-size:var(--font-11);font-weight:400}.effect-total{padding:8px 0 12px;font-size:var(--font-12)}.effect-total>strong{font-weight:600}.explain{margin:6px 0 0;color:var(--muted);font-size:var(--font-12);line-height:1.45}dl{display:grid;grid-template-columns:1fr auto;gap:7px 12px;margin:8px 0 0}dt{color:var(--muted)}dd{margin:0;font-variant-numeric:tabular-nums}details{margin-top:8px}summary{font-size:var(--font-12);color:var(--muted);cursor:pointer}.effect-event{display:block;width:100%;text-align:left;white-space:normal;border:0;border-bottom:1px solid var(--border);border-radius:0;background:none;padding:10px 0;font-size:var(--font-12)}.effect-event:hover{background:color-mix(in srgb,#000 10%,var(--panel))}.effect-event strong{display:block;font-weight:550}.effect-event strong span{font-weight:400;color:var(--muted);margin-left:5px}.effect-event small{display:block;color:var(--text);font-size:var(--font-12);line-height:1.45;margin-top:3px}
</style>
