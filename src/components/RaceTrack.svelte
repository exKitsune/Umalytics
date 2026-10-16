<script lang="ts">
  import type { Race, RunnerSample } from '../data/types';
  import { coursePath, coursePoint, runnerName, type CourseReference, type ReferenceData } from '../data/reference';
  import { runnerColors } from '../library';
  import { telemetryIndex } from '../telemetry';
  import { estimatedLaneOffset } from '../replay/model';
  export let race: Race;
  export let samples: RunnerSample[] = [];
  export let course: CourseReference | null = null;
  export let reference: ReferenceData | null = null;
  export let selected: string;
  export let compact = false;
  export let onSelect: (id: string) => void;
  $: extent = telemetryIndex(race).extent;
  $: mappedCourse = course && (race.distance===null || race.distance===course.distance) ? course : null;
  $: path = mappedCourse ? coursePath(mappedCourse) : 'M70,220 L930,220';
  $: roster = new Map(race.runners.map((runner,i)=>[runner.id,{runner,i}]));
  $: dots = samples.map(s => {
    const entry=roster.get(s.runnerId), knownDistance=s.distance!==null&&Number.isFinite(s.distance);
    return { sample:s, runner:entry?.runner, point:!knownDistance||!entry?null:mappedCourse ?
      coursePoint(mappedCourse,s.distance!,estimatedLaneOffset(race,s.lane,48)) :
      {x:70+Math.max(0,Math.min(1,s.distance!/extent))*860,y:220+estimatedLaneOffset(race,s.lane,48)} };
  });
</script>
<div class="track-canvas" class:minimap={compact}>
  <svg viewBox="0 0 1000 440" role="group" data-geometry={mappedCourse?.geometry ?? 'distance'} aria-label={mappedCourse ? `${mappedCourse.name}, ${mappedCourse.gameGeometry ? 'game course path' : 'schematic course replay'}. Focus a runner and press Enter or Space to select.` : 'Distance replay; course unavailable. Focus a runner and press Enter or Space to select.'}>
    <defs><pattern id="field" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="currentColor" opacity=".12" /></pattern></defs>
    {#if !compact}<rect width="1000" height="440" fill="url(#field)" />{/if}
    <path data-course-outline d={path} fill="none" stroke="var(--track-edge)" stroke-width={compact?38:66} stroke-linejoin="round" stroke-linecap="round" />
    <path d={path} fill="none" stroke={compact?'var(--muted)':'var(--track-fill)'} stroke-opacity={compact?0.65:1} stroke-width={compact?24:58} stroke-linejoin="round" stroke-linecap="round" />
    {#if !compact}<path d={path} fill="none" stroke="var(--muted)" stroke-opacity=".25" stroke-width="1" stroke-dasharray="8 12" />{/if}
    {#if mappedCourse}
      {@const start = coursePoint(mappedCourse,0)}{@const finish = coursePoint(mappedCourse,mappedCourse.distance)}
      <text x={Math.max(75,Math.min(925,start.x))} y={Math.max(45,Math.min(395,start.y-48))} text-anchor="middle" class="map-label">{compact?'S':'START'}</text>
      <path d={`M${finish.x-Math.sin(finish.angle)*34},${finish.y+Math.cos(finish.angle)*34} l${Math.sin(finish.angle)*68},${-Math.cos(finish.angle)*68}`} stroke="var(--text)" stroke-width="4" stroke-dasharray="5 4" />
      <text x={Math.max(75,Math.min(925,finish.x))} y={Math.max(45,Math.min(410,finish.y+62))} text-anchor="middle" class="map-label">{compact?'F':'FINISH'}</text>
    {:else}<text x="70" y="335" class="map-label">0 m</text><text x="855" y="335" class="map-label">{Math.round(extent)} m</text>{/if}
    {#each dots as dot}
      {#if dot.point && dot.runner}
        <g role="button" tabindex="0" aria-label={`Select ${runnerName(reference,dot.runner)}, ${dot.sample.distance?.toFixed(1)} metres${dot.sample.lane===null?', lane unknown':`, recorded lane ${dot.sample.lane.toFixed(3)}, spacing estimated`}`} onclick={() => onSelect(dot.sample.runnerId)} onkeydown={e => {if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(dot.sample.runnerId)}}} style="cursor:pointer">
          <title>{runnerName(reference,dot.runner)} · {dot.sample.distance?.toFixed(1)} m{dot.sample.lane===null?' · lane unknown':` · recorded lane ${dot.sample.lane.toFixed(3)} · spacing estimated`}</title>
          <circle cx={dot.point.x} cy={dot.point.y} r={selected===dot.sample.runnerId?17:13} fill={runnerColors[dot.runner.index%runnerColors.length]} stroke={selected===dot.sample.runnerId?'var(--text)':'var(--panel)'} stroke-width={selected===dot.sample.runnerId?3:2} />
          {#if !compact}<text x={dot.point.x} y={dot.point.y+5} text-anchor="middle" fill="#14231c" style="font-size:var(--font-15)" font-weight="800">{dot.runner.gate ?? dot.runner.index+1}</text>{/if}
        </g>
      {/if}
    {/each}
  </svg>
</div>
<style>
  .track-canvas.minimap{height:auto;min-height:0;padding:0;background:transparent}.minimap svg{display:block;width:100%;height:auto;max-height:none}.minimap .map-label{font-size:var(--font-38);fill:var(--text);font-weight:600}
  g[role="button"]:focus-visible { outline:none; }
  g[role="button"]:focus-visible circle { stroke:var(--text); stroke-width:4px; }
</style>
