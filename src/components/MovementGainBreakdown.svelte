<script lang="ts">
  import type {LaneMovementGain} from '../data/motion-benefit';
  export let value:LaneMovementGain;
  const metres=(v:number)=>`${v>=0?'+':''}${v.toFixed(2)} m`;
  const seconds=(v:number)=>`${Math.abs(v).toFixed(3)} s ${v<=0?'saved':'lost'}`;
  $: rows=[{label:'Lane movement',distance:value.distance,time:value.time},
    ...(value.otherLabel?[{label:value.otherLabel,distance:value.otherDistance,time:value.otherTime}]:[])];
</script>
<dl class="gain-breakdown" aria-label="Movement gain breakdown">
  {#each rows as row}
    <div><dt>{row.label}</dt><dd title={`${row.label} gain, including retained speed.`}>{row.distance?metres(row.distance.mid):'Unavailable'}{#if row.time}<span>{seconds(row.time.mid)}</span>{/if}</dd></div>
  {/each}
</dl>
<style>
  .gain-breakdown{display:grid;gap:5px;margin:9px 0 0;padding:8px 10px;border-left:2px solid var(--border);font-size:var(--font-11);line-height:1.5}
  .gain-breakdown>div{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 14px}
  dt{color:var(--muted)}dd{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0;font-variant-numeric:tabular-nums}dd span{color:var(--muted)}
</style>
