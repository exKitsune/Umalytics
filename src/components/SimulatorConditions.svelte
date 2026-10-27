<script lang="ts">
  import type {Setup} from '../sandbox/model';
  import type {ReferenceData} from '../data/reference';
  import GameIcon from './GameIcon.svelte';
  import SimSymbol from './SimSymbol.svelte';
  export let setup:Setup;
  export let reference:ReferenceData;
  $: courses=Object.values(reference.courses).sort((a,b)=>a.trackName.localeCompare(b.trackName)||a.distance-b.distance);
  $: course=reference.courses[setup.courseId];
  $: venues=[...new Map(courses.map(c=>[c.raceTrackId,c.trackName])).entries()];
  $: venueCourses=courses.filter(c=>c.raceTrackId===course?.raceTrackId);
  function changeVenue(id:number){const options=courses.filter(c=>c.raceTrackId===id);setup.courseId=(options.find(c=>c.distance===course?.distance&&c.surface===course?.surface)??options[0]).id;}
  const groups=[
    {key:'weather',label:'Weather',options:['Sunny','Cloudy','Rainy','Snowy'],colors:['#edc35d','#a9bacd','#73b4ee','#b8d9ef']},
    {key:'ground',label:'Ground',options:['Firm','Good','Soft','Heavy'],colors:['#94c979','#b4ba72','#ba9e76','#b58d80']},
    {key:'season',label:'Season',options:['Spring','Summer','Autumn','Winter','Sakura'],colors:['#e6a2c4','#8bce87','#eba567','#a3cbef','#ee8fbf']},
  ] as const;
</script>
<div class="course-row">
  <div class="course-emblem"><SimSymbol name="track" size={56}/><span>{course?.surface===2?'DIRT':'TURF'}</span></div>
  <label class="course-select">Racecourse<select aria-label="Racecourse" value={course?.raceTrackId} onchange={e=>changeVenue(Number(e.currentTarget.value))}>{#each venues as [id,name]}<option value={id}>{name}</option>{/each}</select><span class="course-tags">{course?.turn===1?'↻ Right':course?.turn===2?'↺ Left':'Straight course'}</span></label>
  <label>Distance<select aria-label="Course distance" bind:value={setup.courseId}>{#each [[1,'Turf'],[2,'Dirt']] as [surface,name]}{#if venueCourses.some(c=>c.surface===surface)}<optgroup label={String(name)}>{#each venueCourses.filter(c=>c.surface===surface) as c}<option value={c.id}>{c.distance.toLocaleString()} m{c.course===2?' · Inner':c.course===3?' · Outer':c.course===4?' · Outer to inner':''}</option>{/each}</optgroup>{/if}{/each}</select><span class="course-tags">{course?.surface===2?'Dirt':'Turf'}</span></label>
</div>
<div class="condition-grid">
  {#each groups as group}<fieldset><legend>{group.label}</legend><div class="options">{#each group.options as option,i}<button type="button" class:chosen={setup[group.key]===i+1} aria-pressed={setup[group.key]===i+1} aria-label={`${group.label}: ${option}`} style={`--choice:${group.colors[i]}`} onclick={()=>setup[group.key]=i+1}>{#if group.key==='ground'}<SimSymbol name="ground" size={20}/>{:else if group.key==='season'&&i===4}<SimSymbol name="blossom" size={22}/>{:else}<GameIcon name={`${group.key}-${i+1}`} size={22}/>{/if}<span>{option}</span></button>{/each}</div></fieldset>{/each}
  <fieldset><legend>Time of day</legend><div class="options time-options">{#each ['Any','Morning','Midday','Evening','Night'] as name,i}<button type="button" class:chosen={setup.time===i} aria-pressed={setup.time===i} aria-label={`Time: ${name}`} style={`--choice:${['#9ca7bb','#e7b77b','#edc35d','#d6a1c4','#a8a4e9'][i]}`} onclick={()=>setup.time=i}><SimSymbol name={['clock','dawn','sun','dusk','night'][i]} size={20}/><span>{name}</span></button>{/each}</div></fieldset>
</div>
<div class="grade-row"><SimSymbol name="trophy" size={20}/><span>Race grade</span><div role="group" aria-label="Race grade">{#each [[100,'G1'],[200,'G2'],[300,'G3'],[400,'Open'],[0,'Any']] as [value,label]}<button class:chosen={setup.grade===value} aria-pressed={setup.grade===value} onclick={()=>setup.grade=Number(value)}>{label}</button>{/each}</div></div>
<style>
  .course-row{display:grid;grid-template-columns:auto minmax(0,2fr) minmax(180px,1fr);gap:18px;align-items:center;padding:18px;border:1px solid var(--border);border-radius:10px;background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 7%,var(--bg)),var(--bg))}.course-emblem{display:grid;justify-items:center;gap:4px;color:#a1c979}.course-emblem span{font-size:9px;letter-spacing:.12em}.course-tags{display:flex;gap:14px;align-items:center;font-size:11px;color:var(--muted)}label{display:grid;gap:8px;font-size:12px;color:var(--muted)}select{min-width:0;width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}.condition-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px}fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;color:var(--muted);margin-bottom:6px}.options{display:flex;gap:4px}.options button{flex:1;min-width:0;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:5px;min-height:36px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--choice);padding:5px}.options button span{font-size:10px;color:var(--muted);white-space:normal}.options button.chosen{background:color-mix(in srgb,var(--choice) 12%,var(--bg));border-color:var(--choice);box-shadow:inset 0 -2px var(--choice)}.options button.chosen span{color:var(--text)}.options button:hover{border-color:var(--choice)}.grade-row{display:flex;align-items:center;gap:12px;font-size:12px;color:#dec07a}.grade-row>span{color:var(--muted)}.grade-row>div{display:flex;gap:6px}.grade-row button{padding:6px 16px;background:var(--bg)}.grade-row button.chosen{color:#f0d387;border-color:#ba9855;background:#ba98551a}@media(max-width:800px){.course-row{grid-template-columns:auto minmax(0,1fr)}.course-row>label:last-child{grid-column:1/-1}.condition-grid{grid-template-columns:1fr}.grade-row{flex-wrap:wrap}}
</style>
