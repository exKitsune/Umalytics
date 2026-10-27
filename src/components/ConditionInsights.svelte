<script lang="ts">
  import type {Setup,RunSummary} from '../sandbox/model';
  import {moodNames} from '../sandbox/model';
  import {conditionSplits} from '../sandbox/insights';
  import GameIcon from './GameIcon.svelte';
  export let setup:Setup;
  export let runs:RunSummary[];
  export let participantId:string;
  $: groups=[{label:'Gate',rows:conditionSplits(runs,setup,participantId,'gates')},{label:'Mood',rows:conditionSplits(runs,setup,participantId,'moods')}];
</script>
<details class="conditions"><summary>Gate &amp; mood breakdown</summary><div class="split-grid">{#each groups as group}<div><h4>{group.label}</h4><div class="split-head"><span>{group.label}</span><span>Win rate</span><span>Top 3</span><span>Races</span></div>{#each group.rows as row}<div class="split-row"><span>{#if group.label==='Mood'}<GameIcon name={`mood-${row.value}`} size={21}/>{moodNames[row.value]}{:else}Gate {row.value}{/if}</span><div class="rate"><b>{(row.win*100).toFixed(1)}%</b><i><em style:width={`${row.win*100}%`}></em></i></div><span>{(row.podium*100).toFixed(1)}%</span><small>{row.n}</small></div>{/each}{#if group.rows.length===1}<p>{group.label} was fixed for this batch.</p>{/if}</div>{/each}</div><p>Observed results by the actual gate and mood drawn. Sample counts vary; these splits do not isolate a causal effect.</p></details>
<style>.conditions{background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:14px}summary{cursor:pointer;font-size:12px;color:var(--text)}.split-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:15px}h4{font-size:12px;color:var(--muted);margin:0 0 10px;font-weight:500}.split-head,.split-row{display:grid;grid-template-columns:minmax(95px,1fr) 1.3fr 60px 40px;gap:12px;align-items:center;font-size:11px}.split-head{font-size:10px;color:var(--muted);margin-bottom:8px}.split-row{padding:7px 0;border-bottom:1px solid var(--border)}.split-row>span:first-child{display:flex;align-items:center;gap:6px}.split-row>small,.split-row>span:nth-child(3){text-align:right}.rate{display:grid;gap:4px}.rate b{font-weight:500;color:#92c9c0}.rate i{display:block;height:4px;width:100%;background:var(--border);border-radius:3px;overflow:hidden}.rate em{display:block;height:100%;background:#87bfb7}p{font-size:10px;color:var(--muted);margin-bottom:0;line-height:1.5}@media(max-width:850px){.split-grid{grid-template-columns:1fr}}</style>
