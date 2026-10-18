<script lang="ts">
  import type {AnalysisGateReportSummary} from '../simulation/contracts';
  export let report:AnalysisGateReportSummary,frames:number,events:number,courseSource:string;
  export let onExport:()=>void;
  let open=false;
</script>
<details class="panel race-data-notes" bind:open>
  <summary>Analysis version and comparison details</summary>
  {#if open}<p>{frames} frames · {events} events · Course source: {courseSource}.</p><button onclick={onExport}>Export analysis and provenance</button><pre>{JSON.stringify(report,null,2)}</pre>{/if}
</details>
<style>
  button{margin-top:10px;font-size:var(--font-11)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto;font-size:var(--font-10);line-height:1.5}
</style>
