<script lang="ts">
  import {aptitudeGroups,type UmaAptitudes,type AptitudeKey} from '../sandbox/aptitudes';
  import type {Aptitude} from '../sandbox/model';
  import RaceIconPicker from './RaceIconPicker.svelte';
  export let value:UmaAptitudes;
  export let onChange:(key:AptitudeKey,grade:Aptitude)=>void;
</script>
<section class="build-aptitudes" aria-label="Build aptitudes">
  <h3>Aptitudes</h3>
  {#each aptitudeGroups as group}<div class="aptitude-group"><span>{group.label}</span><div>{#each group.keys as [key,label]}<RaceIconPicker kind="aptitude" {label} value={value[key]} onChange={grade=>onChange(key,grade as Aptitude)}/>{/each}</div></div>{/each}
</section>
<style>
  .build-aptitudes{padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}h3{font-size:13px;margin:0 0 12px}.aptitude-group{display:grid;grid-template-columns:50px 1fr;gap:8px;align-items:center;margin-top:10px}.aptitude-group>span{font-size:11px;color:var(--muted)}.aptitude-group>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
</style>
