<script lang="ts">
  import type { Race } from '../data/types';
  import { replayPhaseTimes, REPLAY_PHASE_COLOR } from '../replay/phases';
  export let race:Race,selected:string,time:number;
  export let distance:number|null=race.distance;
  $: marks=replayPhaseTimes(race,selected,distance);
</script>
<div class="replay-seek" style={`--phase-color:${REPLAY_PHASE_COLOR}`}>
  <input aria-label="Replay time" type="range" min="0" max={race.duration} step=".05" bind:value={time}/>
  <div class="phase-marks">
    {#each marks as mark}
      <button class="phase-mark" style:left={`${mark.position*100}%`} title={`${mark.label} · ${mark.time.toFixed(2)} s · ${mark.distance.toFixed(1)} m`} aria-label={`Seek to ${mark.label.toLowerCase()} at ${mark.time.toFixed(2)} seconds`} onclick={()=>time=mark.time}><span aria-hidden="true"></span></button>
    {/each}
  </div>
</div>
<style>
  .replay-seek{flex:1;min-width:60px;position:relative;margin:0 6px;height:34px;display:flex;align-items:center}
  .replay-seek input{width:100%;min-width:0;margin:0}
  /* Native range thumbs travel between their centres, inset by half a thumb. */
  .phase-marks{position:absolute;inset:0 8px;pointer-events:none}
  .phase-mark{position:absolute;top:-1px;transform:translateX(-50%);width:20px;height:15px;padding:0;border:0;background:transparent;pointer-events:auto;border-radius:3px}
  .phase-mark span{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:6px solid var(--phase-color)}
  .phase-mark:hover{background:color-mix(in srgb,var(--phase-color) 18%,transparent)}
  .phase-mark:focus-visible{outline:2px solid var(--phase-color);outline-offset:0}
</style>
