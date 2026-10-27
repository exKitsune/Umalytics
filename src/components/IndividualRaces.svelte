<script lang="ts">
  import type {RunSummary,Setup} from '../sandbox/model';
  import {portraitUrl} from '../data/portraits';
  import SimSymbol from './SimSymbol.svelte';
  export let runs:RunSummary[];
  export let setup:Setup;
  export let onOpen:(index:number)=>void;
  export let opening:number|null=null;
  let page=0;
  const size=48;
  $: pages=Math.max(1,Math.ceil(runs.length/size));
  $: if(page>=pages)page=pages-1;
  $: visible=runs.slice(page*size,(page+1)*size);
  const portrait=(id:string)=>{const uma=setup.participants.find(p=>p.id===id)?.uma;return uma?portraitUrl(uma):null;};
</script>
<section aria-label="Individual simulated races">
  <header><div><span class="eyebrow">INDIVIDUAL RACES</span><h3>Replay &amp; telemetry</h3></div><span>{runs.length} completed</span></header>
  <div class="run-grid">{#each visible as run (run.index)}{@const winner=run.runners.find(r=>r.place===1)}{@const photo=winner?portrait(winner.id):null}<button class:opening={opening===run.index} disabled={opening!==null} aria-label={`Open race ${run.index+1}`} onclick={()=>onOpen(run.index)}>
    <div class="run-label"><strong>Race {run.index+1}</strong><span>{opening===run.index?'Preparing…':'Open →'}</span></div>
    <div class="winner">{#if photo}<img src={photo} alt=""/>{/if}<div><small><SimSymbol name="trophy" size={13}/> Winner</small><b title={winner?.name}>{winner?`#${winner.slot??setup.participants.findIndex(p=>p.id===winner.id)+1} ${winner.name}`:'—'}</b></div><strong>{winner?.time.toFixed(3)??'—'}<small>s</small></strong></div>
    <footer><span>Seed {run.seed}</span><span>{run.runners.length} runners</span></footer>
  </button>{/each}</div>
  {#if pages>1}<nav aria-label="Individual races pages"><button disabled={page===0} onclick={()=>page--}>← Previous</button><span>{page+1} / {pages}</span><button disabled={page+1===pages} onclick={()=>page++}>Next →</button></nav>{/if}
</section>
<style>
  .run-grid>button{justify-content:stretch;align-items:stretch}
  section{display:grid;gap:20px}header{display:flex;align-items:center;justify-content:space-between;gap:12px}.eyebrow{font-size:10px;letter-spacing:.1em;color:#b7a5e4}h3{margin:6px 0 0;font-size:21px}header>span{font-size:12px;color:var(--muted)}.run-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}.run-grid>button{display:grid;gap:18px;text-align:left;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:17px;transition:border-color .15s,background .15s}.run-grid>button:hover,.run-grid>button.opening{border-color:#b7a5e4;background:color-mix(in srgb,#b7a5e4 5%,var(--bg))}.run-label{display:flex;align-items:center;justify-content:space-between}.run-label>strong{font-size:14px}.run-label>span{font-size:11px;color:#b7a5e4}.winner{display:flex;align-items:center;gap:9px;min-width:0}.winner img{width:38px;height:38px;object-fit:contain;flex-shrink:0}.winner>div{display:grid;gap:5px;min-width:0}.winner>div small{display:flex;gap:4px;align-items:center;color:#e5c35e;font-size:10px}.winner b{font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.winner>strong{margin-left:auto;font-size:14px;font-variant-numeric:tabular-nums}.winner>strong small{font-size:10px;color:var(--muted);margin-left:3px}footer{display:flex;gap:10px;justify-content:space-between;color:var(--muted);font-size:10px;border-top:1px solid var(--border);padding-top:11px;font-weight:400}nav{display:flex;align-items:center;justify-content:center;gap:16px;font-size:12px;color:var(--muted)}
</style>
