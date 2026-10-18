<script lang="ts">
  import type { DecisionEvent } from '../simulation/trace';
  export let checks:DecisionEvent[]=[];
  export let onSeek:(time:number)=>void;
  let predicates=false;
  const kinds=new Set(['skill-wit','precondition-latched','precondition-ready','condition','activation-ready','skill-activated','effect-ended','cooldown-start','cooldown-ready','target-available','sampled-trigger','effect-queued','effect-immune','effect-deferred']);
  $: rows=checks.filter(e=>predicates?e.kind!=='skill-definition':kinds.has(e.kind));
  const label=(e:DecisionEvent)=>e.kind.replaceAll('-',' ');
  function result(e:DecisionEvent){
    const d=e.data;
    if(e.kind==='skill-wit')return d.checked?`${d.passed?'Passed':'Failed'} · ${Number(d.roll).toFixed(2)} / ${Number(d.threshold).toFixed(2)}`:'Exempt · no draw';
    if(typeof d.passed==='boolean')return d.passed?'Passed':'Failed';
    if(e.kind==='sampled-trigger')return `${d.predicate}: ${Array.isArray(d.windows)?d.windows.map(w=>Array.isArray(w)?`${Number(w[0]).toFixed(1)}–${Number(w[1]).toFixed(1)} m`:String(w)).join(', '):String(d.windows)}`;
    if(e.kind==='cooldown-start')return `${Number(d.baseDuration)*Number(d.distance)/1000} s`;
    if(e.kind==='effect-queued')return 'Recipients selected';
    if(d.modifier!==undefined)return `${d.modifier} · ${Number(d.duration).toFixed(3)} s`;
    return 'Executed';
  }
</script>
<details class="simulation-checks">
  <summary>Simulation checks <small>{checks.length} entries</small></summary>
  <label><input type="checkbox" bind:checked={predicates}/> Include individual predicates and effects</label>
  <div class="checks-scroll"><table aria-label="Simulation skill checks"><thead><tr><th>Time</th><th>Check</th><th>Result</th></tr></thead><tbody>
    {#each rows as check}<tr><td><button onclick={()=>onSeek(check.time)}>{check.time.toFixed(3)}{#if check.count>1}–{check.lastTime.toFixed(3)}{/if} s</button></td><td>{label(check)}<small>Variant {check.detail+1}{check.count>1?` · ${check.count} checks`:''}</small></td><td>{result(check)}</td></tr>{/each}
  </tbody></table></div>
  <p>Repeated identical checks are grouped by consecutive ticks. Unevaluated predicates are not assumed to pass.</p>
</details>
<style>
  .simulation-checks{margin:16px 0;border:1px solid var(--border);border-radius:6px;padding:10px}summary{cursor:pointer;font-weight:600}summary small{float:right}label{display:flex;gap:7px;align-items:center;margin:12px 0;font-size:var(--font-11)}.checks-scroll{max-height:300px;overflow:auto}td{white-space:normal;font-size:var(--font-11);vertical-align:top}td:first-child{white-space:nowrap}td button{padding:0;border:0;background:none;color:var(--accent-text,var(--accent));font-size:inherit}p{font-size:var(--font-10);color:var(--muted);margin-bottom:0}
</style>
