<script lang="ts">
  import type {Race,Runner} from '../data/types';
  import type {RunnerAnalysis} from '../data/analytics';
  import type {CourseReference} from '../data/reference';
  import type {PreparedRunner} from '../analysis/prepared';
  import {runnerMechanics} from '../data/runner-mechanics';
  export let race:Race,runner:Runner,course:CourseReference|null,detail:RunnerAnalysis,prepared:PreparedRunner|undefined;
  $: facts=runnerMechanics(race,runner,course,detail.statBreakdown);
  $: groups=[['Speed targets',facts.speed],['Acceleration',facts.accel],['HP & wit',facts.other]] as const;
  const f=(v:number|null|undefined)=>v==null?'—':v.toFixed(3);
</script>
<section class="mechanics" aria-label="Runner mechanics">
  <h3>Speed & acceleration</h3><p class="intro">Starting effective stats · hover a value for its formula.</p>
  {#each groups as [heading,rows]}
    <div class="fact-group"><h4>{heading}</h4>{#each rows as row}<div class="fact" title={`${row.formula}\n${row.detail}`}><span>{row.label}</span><strong>{f(row.value)}{#if row.value!==null}<small>{row.unit}</small>{/if}</strong></div>{/each}</div>
  {/each}
  {#if prepared?.spurt.source==='simulation'}<div class="selected-spurt"><span>Selected spurt target</span><strong>{f(prepared.spurt.target?.mid)} <small>m/s</small></strong><p>The actual retained plan; temporary effects are separate.</p></div>{/if}
  <details><summary>Formulas & inputs</summary><p>SPD {f(detail.statBreakdown.stats.speed.final)} · POW {f(detail.statBreakdown.stats.power.final)} · GUT {f(detail.statBreakdown.stats.guts.final)} · WIT {f(detail.statBreakdown.stats.wisdom.final)}</p><p>These readable baseline formulas use starting stats. Live stat effects and the engine’s floating-point rounding can change tick values.</p>{#each [...facts.speed,...facts.accel,...facts.other] as row}<div class="formula"><strong>{row.label}</strong><code>{row.formula}</code><p>{row.detail}</p></div>{/each}</details>
  {#if prepared?.sections?.length}<details><summary>Actual section targets · {prepared.sections.length} sections</summary><p>Base + actual wit modifier before skills, slopes and pace. No section randomness is applied during the last spurt.</p><table><thead><tr><th>Section / m</th><th>Base</th><th>Wit</th><th>Total</th></tr></thead><tbody>{#each prepared.sections as section}<tr><td title={`${section.start.toFixed(1)}–${section.end.toFixed(1)} m`}>{section.section}<small>{Math.round(section.start)}–{Math.round(section.end)}</small></td><td>{f(section.base)}</td><td>{section.modifier>=0?'+':''}{f(section.modifier)}</td><td>{f(section.base+section.modifier)}</td></tr>{/each}</tbody></table></details>{/if}
</section>
<style>
  .mechanics{padding:15px 16px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums}h3{font-size:var(--font-12);margin:0 0 7px}h4{font-size:var(--font-10);color:var(--muted);font-weight:600;margin:12px 0 6px}.intro,p{font-size:var(--font-10);color:var(--muted);line-height:1.5;margin:5px 0}.fact,.selected-spurt{display:flex;justify-content:space-between;gap:8px;font-size:var(--font-11);padding:5px 0}.fact{cursor:help}.fact span{color:var(--muted)}strong{font-weight:550;white-space:nowrap}small{font-size:var(--font-9);color:var(--muted);margin-left:4px}.selected-spurt{flex-wrap:wrap;margin-top:10px;border-top:1px solid var(--border);padding-top:10px}.selected-spurt p{flex-basis:100%;margin:0}details{margin-top:12px;border:1px solid var(--border);border-radius:5px;padding:9px}summary{cursor:pointer;font-size:var(--font-11);font-weight:550}.formula{padding:9px 0;border-bottom:1px solid var(--border);font-size:var(--font-10)}.formula strong{white-space:normal}.formula code{display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.6;color:var(--text);font-size:var(--font-10);margin-top:5px}table{width:100%;margin-top:8px;font-size:var(--font-10)}td,th{padding:5px 2px;text-align:right}td:first-child,th:first-child{text-align:left}td small{display:block;margin:2px 0 0}
</style>
