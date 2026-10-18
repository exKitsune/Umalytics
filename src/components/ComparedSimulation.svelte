<script lang="ts">
  import type { AnalysisGateReport, AnalysisGateReportSummary, JsonObject } from '../simulation/contracts';
  import { canUseSimulatedCapability } from '../simulation/contracts';
  export let report:AnalysisGateReportSummary;
  export let load:()=>Promise<AnalysisGateReport|null>;
  let detail:AnalysisGateReport|null=null;
  let busy=false,message='';
  $: allowed=canUseSimulatedCapability(report,'recordedResults',report.binding);
  $: rows=(allowed&&Array.isArray(report.simulation?.comparison?.runnerResults)?report.simulation.comparison.runnerResults:[]) as JsonObject[];
  $: compared=detail?.binding?.authorizationSha256===report.binding?.authorizationSha256?detail:null;
  // Expose only result fields explicitly covered by comparison. Stock output
  // also has unverified telemetry which must never become product detail.
  const fields=['finishTimeRaw','finishOrder','startDelayTime','lastSpurtStartDistance','runningStyle','gutsOrder','wizOrder'];
  $: values=compared&&Array.isArray(compared.simulation?.modeled?.results)?compared.simulation.modeled.results.map(row=>Object.fromEntries(fields.map(key=>[key,(row as JsonObject)[key]]))):[];
  async function open(){busy=true;message='';try{detail=await load();if(!detail)message='Analysis selection changed. Reopen this race.';}catch{detail=null;message='Comparison is no longer available. Reopen this race.';}finally{busy=false;}}
</script>
{#if allowed}
<section class="panel compared" aria-label="Compared simulation">
  <span class="eyebrow">SIMULATED · COMPARED WITH RECORDED VALUES</span>
  <h2>Matched race results</h2>
  <p>Agreement applies to the recorded times and precision. Hidden state is not provided.</p>
  <table><thead><tr><th>Gate</th><th>Recorded place</th><th>Simulated place</th><th>Recorded raw seconds</th><th>Simulated raw seconds</th></tr></thead><tbody>
    {#each rows as row}<tr><td>{row.frameOrder}</td><td>{row.officialFinishOrder}</td><td>{row.simulatedFinishOrder}</td><td>{row.officialFinishTimeRaw}</td><td>{row.simulatedFinishTimeRaw}</td></tr>{/each}
  </tbody></table>
  <button disabled={busy} onclick={open}>{busy?'Loading compared details…':'Load compared result details'}</button>
  {#if message}<p role="status">{message}</p>{/if}
  {#if compared}<details open><summary>Simulated · compared result fields, in input order</summary><pre>{JSON.stringify(values,null,2)}</pre></details>{/if}
</section>
{/if}
<style>.compared{padding:24px;overflow:auto}table{width:100%;text-align:left;margin:16px 0}td,th{padding:8px;border-bottom:1px solid var(--border)}pre{max-height:400px;overflow:auto}details{margin-top:16px}</style>
