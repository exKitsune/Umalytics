<script lang="ts">
  import {statusLegend,slopeEffectHelp} from '../data/analysis-copy';
  import TelemetryRunners from './TelemetryRunners.svelte';
  import type { Race, RunnerSample } from '../data/types';
  import { coursePhases, courseSegments, elevationProfile, skillName, runnerName, type CourseReference, type ReferenceData } from '../data/reference';
  import { timeAtDistance, distanceAtTime, telemetryIndex, telemetryEndTime, metricPaths, timedPlotPath, type Metric } from '../telemetry';
  import type { RaceAnalysis, StatusInterval, SkillActivation } from '../data/analytics';
  import { combinedStatusIntervals, statusShortLabel, statusLabel, substantialNearIntervals } from '../data/status-presentation';
  import { effectsText, skillTone, skillToneColor } from '../data/skill-details';
  import { hpTimeline, hpSampledBridges } from '../data/hp-timeline';
  import { runnerColors } from '../library';
  import { motionFor } from '../data/motion-analysis';
  import { speedGapNote } from '../data/speed-gap';
  import { preparedFor } from '../analysis/prepared';
  import { positionKeepGuideTimeline, positionKeepMarkerGuides, positionKeepGuideSpans, type PositionKeepGuide } from '../data/position-keep-guides';
  export let race:Race, course:CourseReference|null, reference:ReferenceData|null, analysis:RaceAnalysis, selected:string, time:number;
  export let sample:RunnerSample|undefined=undefined;
  export let gap:number|null=null;
  export let onSeek:(time:number)=>void;
  let metric:Metric='speed', axis:'distance'|'time'='distance',showEvents=true,dragging=false;
  let extraRunnerIds:string[]=[],filterRace:Race;
  $: if(race!==filterRace){filterRace=race;extraRunnerIds=[];}
  $: visibleIds=new Set(race.runners.filter(r=>r.id===selected||extraRunnerIds.includes(r.id)).map(r=>r.id));
  $: selectedName=runnerName(reference,race.runners.find(r=>r.id===selected)!);
  let showHp=true,showGap=true,showStatuses=true,showIdeal=true;
  let hovered:SkillActivation|null=null;
  let hoveredSlope:{start:number;end:number;up:boolean}|null=null;
  let hoveredStatus:StatusInterval|null=null;
  let hoveredGapGuide:PositionKeepGuide['id']|null=null;
  const canvasWidth=1200,left=58,right=1178,top=18,bottom=400,elevationTop=bottom-58,elevationBottom=bottom,trackTop=bottom+28,phaseTop=trackTop+25,skillsTop=phaseTop+27;
  const ticks=(low:number,high:number,count:number)=>Array.from({length:count},(_,i)=>low+(high-low)*i/(count-1));
  $: index=telemetryIndex(race);
  $: detail=analysis.runners[selected];
  $: motion=motionFor(race,reference,analysis,selected,course?.id);
  $: compatibleCourse=course&&(race.distance===null||race.distance===course.distance)?course:null;
  $: extent=race.distance??compatibleCourse?.distance??index.extent;
  $: xmax=axis==='time'?Math.max(telemetryEndTime(race,selected),...race.runners.filter(r=>visibleIds.has(r.id)).map(r=>telemetryEndTime(race,r.id))):extent;
  $: laneMax=index.laneMax;
  $: bounds=metric==='position'?[1,Math.max(2,race.runners.length)]:metric==='lane'?[0,laneMax]:[0,Math.max(20,index.speedBounds[1],showIdeal?Math.max(0,...motion.samples.map(s=>s.free?.max??0)):0)];
  $: xTicks=ticks(0,xmax,9); $: yTicks=ticks(bounds[0],bounds[1],6);
  $: x=(v:number)=>left+v/Math.max(1,xmax)*(right-left);
  $: y=(v:number)=>metric==='position'?top+(v-bounds[0])/Math.max(1,bounds[1]-bounds[0])*(bottom-top):bottom-(v-bounds[0])/Math.max(1,bounds[1]-bounds[0])*(bottom-top);
  $: paths=metricPaths(race,metric,axis,x,y,reference);
  $: phaseBands=coursePhases(race.distance??compatibleCourse?.distance??0);
  $: trackBands=compatibleCourse?courseSegments(compatibleCourse):[];
  $: elevation=compatibleCourse?elevationProfile(compatibleCourse):[];
  $: heightRange=elevation.length?[Math.min(...elevation.map(p=>p.elevation)),Math.max(...elevation.map(p=>p.elevation))]:[0,1];
  $: atDistance=(d:number)=>axis==='distance'?x(d):(()=>{const t=timeAtDistance(race,selected,d);return t===null?null:x(t)})();
  $: atTime=(t:number)=>axis==='time'?x(t):(()=>{const d=distanceAtTime(race,selected,t);return d===null?null:x(d)})();
  $: raceSections=race.distance!==null&&race.distance>0?Array.from({length:24},(_,i)=>({number:i+1,start:race.distance!*i/24,end:race.distance!*(i+1)/24})):[];
  $: elevationPath=elevation.map((p,i)=>{const px=atDistance(p.distance);return px===null?'':`${i?'L':'M'}${px},${elevationBottom-4-(p.elevation-heightRange[0])/Math.max(.1,heightRange[1]-heightRange[0])*(elevationBottom-elevationTop-12)}`}).join(' ');
  $: cursor=atTime(Math.min(time,telemetryEndTime(race,selected)));
  $: activations=(detail?.skillActivations??[]).filter(activation=>{
    const skill=reference?.metadata.skills[activation.referenceSkillId??activation.skillId];
    const tags=skill?.tagIds??(skill?.tagId!=null?[skill.tagId]:[]);
    return !tags.some(tag=>tag>=601&&tag<=615);
  });
  $: allIntervals=combinedStatusIntervals(detail?.intervals??[],{includeModels:true});
  $: nearMotion=allIntervals.some(i=>i.kind==='near-slowdown')?motionFor(race,reference,analysis,selected,course?.id,undefined,true):motion;
  $: intervals=substantialNearIntervals(allIntervals,nearMotion.samples);
  $: dueling=runnerDueling(intervals);
  $: statusBoxes=packStatuses(intervals,dueling,atTime);
  $: statusY=metric==='speed'?y(Math.min(15,bounds[1]))-8:top+40;
  $: packed=packSkills(activations,moment=>{const direct=atTime(moment);if(direct!==null)return direct;const last=detail?.samples.at(-1);if(!last||last.distance==null||moment<=last.time)return null;return axis==='time'?x(moment):x(last.distance+(last.speed??0)*(moment-last.time));});
  $: skillRowCount=Math.max(1,...packed.map(p=>p.row+1));
  $: chartHeight=skillsTop+(showEvents?skillRowCount*26:0)+70;
  $: hpMax=Math.max(1,detail?.summary.hpStart??index.hpMax);
  $: guideTimeline=positionKeepGuideTimeline(race,analysis,selected);
  $: gapGuides=positionKeepMarkerGuides(guideTimeline,time);
  // Keep the secondary scale fixed while scrubbing, including early-only guides.
  $: guideRange=guideTimeline.flatMap(s=>s.guides.map(g=>g.gap));
  $: gapMax=Math.max(1,...guideRange,...(detail?.samples??[]).map(s=>s.leadGap??0));
  $: gapMin=Math.min(0,...guideRange,...(detail?.samples??[]).map(s=>s.leadGap??0));
  $: gapY=(value:number)=>bottom-(value-gapMin)/(gapMax-gapMin)*(bottom-top);
  $: activeGapGuide=gapGuides.find(g=>g.id===hoveredGapGuide);
  $: gapGuideSpans=positionKeepGuideSpans(race,analysis,selected);
  $: activeGapSegments=gapGuideSpans.filter(span=>span.id===activeGapGuide?.id).flatMap(span=>{
    const start=atTime(span.start),end=atTime(span.end);return start!==null&&end!==null&&end>start?[{start,end}]:[];
  });
  $: gapMarkers=placeGapMarkers(gapGuides,gapY);
  $: gapZero=gapMax/(gapMax-gapMin);
  $: hpPath=secondaryPath(hpTimeline(race,selected,reference),'hp',hpMax);
  $: hpBridges=hpSampledBridges(race,selected,reference,undefined,{analysis,course:compatibleCourse}).map(bridge=>({path:secondaryPath([{time:bridge.start,hp:bridge.startHp},{time:bridge.end,hp:bridge.endHp}],'hp',hpMax),reason:bridge.reason}));
  $: metricHpBridges=metric==='hp'?paths.map(p=>({runner:p.runner,bridges:hpSampledBridges(race,p.runner.id,reference,undefined,{analysis,course:compatibleCourse}).map(bridge=>({path:secondaryPath([{time:bridge.start,hp:bridge.startHp},{time:bridge.end,hp:bridge.endHp}],'hp',bounds[1],0,p.runner.id),reason:bridge.reason}))})):[];
  $: gapPath=secondaryPath(detail?.samples??[],'leadGap',gapMax,gapMin);
  $: simulatedPath=timedPlotPath(race,selected,axis,motion.samples.map(s=>({time:s.time,value:s.free?.mid??null})),x,y);
  $: currentMotion=latestAt(motion.samples,time);
  $: speedNote=analysis.source!=='simulation'&&metric==='speed'&&showIdeal?speedGapNote(currentMotion,allIntervals,compatibleCourse,sample?.speed):null;
  $: speedChanges=preparedFor(analysis)?.runners[selected]?.speedChanges??[];
  $: speedChange=speedChanges.find(change=>time>=change.start&&time<change.end);
  $: changeReasons=speedChange?.reasons.filter(reason=>time>=reason.start&&time<reason.end)??[];
  $: place=latestAt(detail?.samples??[],time+1e-6)?.rank??null;
  function latestAt<T extends {time:number}>(samples:readonly T[],moment:number):T|undefined {
    let low=0,high=samples.length;
    while(low<high){const mid=(low+high)>>>1;if(samples[mid].time<=moment)low=mid+1;else high=mid;}
    return samples[low-1];
  }
  function placeGapMarkers(guides:PositionKeepGuide[],project:(gap:number)=>number){
    const markers=guides.map(guide=>({guide,targetY:project(guide.gap),markerY:Math.max(top+9,Math.min(bottom-9,project(guide.gap)))})).sort((a,b)=>a.targetY-b.targetY);
    if(markers.length===2&&markers[1].markerY-markers[0].markerY<23){
      const center=Math.max(top+20.5,Math.min(bottom-20.5,(markers[0].markerY+markers[1].markerY)/2));
      markers[0].markerY=center-11.5;markers[1].markerY=center+11.5;
    }
    return markers;
  }
  $: hpLeft=sample?.hp!=null&&detail?.summary.hpStart?Math.max(0,sample.hp/detail.summary.hpStart*100):null;
  function secondaryPath(samples:readonly {time:number;hp?:number|null;leadGap?:number|null}[],key:'hp'|'leadGap',max:number,min=0,runnerId=selected){
    return timedPlotPath(race,runnerId,axis,samples.map(s=>({time:s.time,value:s[key]})),x,value=>bottom-(value-min)/(max-min)*(bottom-top));
  }
  function runnerDueling(intervals:StatusInterval[]):StatusInterval[]{
    const all=intervals.filter(i=>i.kind==='dueling').sort((a,b)=>a.start-b.start);
    const merged:StatusInterval[]=[];
    for(const interval of all){const prior=merged.at(-1);if(prior&&prior.end!==null&&interval.end!==null&&interval.start<=prior.end){prior.end=Math.max(prior.end,interval.end);if(interval.evidence==='estimated')prior.evidence='estimated';}else merged.push({...interval});}
    return merged;
  }
  function provenance(i:StatusInterval){if(i.evidence==='simulated')return `${statusLabel(i.kind)} · ${i.start.toFixed(3)}–${i.end?.toFixed(3)??'?'} s`;const multiplier=(i.kind==='rushed'||i.kind==='rushed-boost')?(i.model?.speedMultiplier??1.04):null;const delta=i.model?.speedDelta;const bonus=multiplier!=null?` · ×${multiplier.toFixed(2)}`:delta!=null?` · ${delta>=0?'+':''}${delta.toFixed(2)} m/s`:'';return `${statusLabel(i.kind)} · ${i.start.toFixed(2)}–${i.end?.toFixed(2)??'?'} s${bonus}`;}
  function ordinal(rank:number){const teen=rank%100;const suffix=teen>=11&&teen<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[rank%10]??'th';return `${rank}${suffix}`;}
  function span(interval:StatusInterval,project:(t:number)=>number|null){const a=project(interval.start),b=project(interval.end??interval.observedUntil??interval.start);if(a===null)return null;const start=Math.max(left,Math.min(right,a)),end=b===null?start:Math.max(left,Math.min(right,b));return {x:Math.max(left,Math.min(right-3,a)),width:Math.max(3,end-start),start,end};}
  function effectSummary(id:number){const text=effectsText(reference,id);return text.length>46?`${text.slice(0,43)}…`:text;}
  function hoverWidth(activation:SkillActivation){
    const distance=distanceAtTime(race,selected,activation.start),place=distance==null?'Distance unavailable':`${Math.round(distance)} m`;
    const lines=[skillName(reference,activation.skillId),`${activation.start.toFixed(2)} s · ${place}`,effectSummary(activation.skillId)];
    return Math.max(...lines.map(line=>line.length))*6.15+18;
  }
  function skillBox(start:number,end:number|null,id:number,project:(t:number)=>number|null){
    const name=skillName(reference,id),a=project(start);
    if(a===null||a<left||a>right||start>telemetryEndTime(race,selected))return null;
    const timed=end!=null&&end>start,projectedEnd=timed?project(Math.min(end!,telemetryEndTime(race,selected))):null,rawEnd=projectedEnd==null?null:Math.min(right,projectedEnd),durationWidth=rawEnd==null?0:Math.max(0,rawEnd-a);
    const labelWidth=timed?Math.max(durationWidth,1):5*6.4;
    return {x:Math.min(a,right-labelWidth),width:durationWidth,labelWidth,label:name,activation:a,end:rawEnd};
  }
  function packSkills(values:SkillActivation[],project:(t:number)=>number|null){
    const boxes=values.flatMap((activation,index)=>{const box=skillBox(activation.start,activation.effectiveEnd??activation.end,activation.skillId,project);return box?[{activation,box,index,row:0}]:[];}).sort((a,b)=>a.box.x-b.box.x||a.activation.start-b.activation.start);
    const ends:number[]=[];
    for(const entry of boxes){const low=entry.box.x,high=entry.box.x+entry.box.labelWidth;let row=ends.findIndex(end=>end+6<=low);if(row<0)row=ends.length;entry.row=row;ends[row]=high;}
    return boxes;
  }
  function packStatuses(local:StatusInterval[],field:StatusInterval[],project:(t:number)=>number|null){
    const values=[...local.filter(s=>['PU','PD','SU','OT','SS','DH','RUSH','Blocked','Near','Lane','Exhausted'].includes(statusShortLabel(s.kind))),...field];
    const boxes=values.flatMap(interval=>{const box=span(interval,project);return box?[{interval,box,label:statusShortLabel(interval.kind),row:0}]:[];}).sort((a,b)=>a.box.x-b.box.x);
    const ends:number[]=[];
    for(const entry of boxes){const textWidth=entry.label.length*6+6,low=entry.box.x+entry.box.width/2-textWidth/2,high=Math.max(entry.box.x+entry.box.width,low+textWidth);let row=ends.findIndex(end=>end+4<=Math.min(entry.box.x,low));if(row<0)row=ends.length;entry.row=row;ends[row]=high;}
    return boxes;
  }
  const phaseColor=(kind:string)=>({early:'#56bdb0',middle:'#61a65e',late:'#dfaa4b',final:'#d78359'} as Record<string,string>)[kind]??'#c98751';
  function svgPoint(e:PointerEvent){const svg=e.currentTarget as SVGSVGElement,transform=svg.getScreenCTM();if(!transform)return null;const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(transform.inverse());}
  function seek(e:PointerEvent){const local=svgPoint(e);if(!local)return;const value=Math.max(0,Math.min(1,(local.x-left)/(right-left)))*xmax;const t=axis==='time'?value:timeAtDistance(race,selected,value);if(t!==null)onSeek(t);}
  function hoverSkill(e:PointerEvent){if(!showEvents){hovered=null;return;}const local=svgPoint(e);if(!local)return;const open=hovered?packed.find(entry=>entry.activation===hovered):undefined;if(open){const wide=hoverWidth(open.activation),drawX=Math.max(left,Math.min(open.box.x,canvasWidth-wide-8)),rowY=skillsTop+open.row*26;if(local.x>=drawX&&local.x<=drawX+wide&&local.y>=rowY&&local.y<=rowY+80)return;}const hit=packed.find(entry=>{const rowY=skillsTop+entry.row*26,width=Math.max(entry.box.labelWidth,entry.box.width,12);return local.x>=entry.box.x-2&&local.x<=entry.box.x+width+2&&local.y>=rowY&&local.y<=rowY+24;});hovered=hit?.activation??null;}
  function down(e:PointerEvent){if(e.button!==0)return;e.preventDefault();dragging=true;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);seek(e);}
  function up(e:PointerEvent){if(!dragging)return;seek(e);dragging=false;const svg=e.currentTarget as SVGSVGElement;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}
  function keySeek(e:KeyboardEvent){if(e.target!==e.currentTarget)return;const delta=e.shiftKey?5:1;const next=e.key==='ArrowRight'?time+delta:e.key==='ArrowLeft'?time-delta:e.key==='Home'?0:e.key==='End'?race.duration:null;if(next!==null){e.preventDefault();onSeek(Math.max(0,Math.min(race.duration,next)));}}
  const color=(short:string)=>({PU:'#78b341',PD:'#6ca3d6',SU:'#9abe54',OT:'#e7c85a',SS:'#e8a351',DH:'#44b9b6',RUSH:'#e48087',DUEL:'#bf83df',Blocked:'#e28f7f',Near:'#d2a15a',Lane:'#3cba9a',Exhausted:'#ed676b'} as Record<string,string>)[short]??'#97a1ba';
  function brighten(hex:string){const n=Number.parseInt(hex.slice(1),16);if(!Number.isFinite(n))return hex;const channel=(c:number)=>Math.min(255,Math.round(c+(255-c)*.45));const r=channel((n>>16)&255),g=channel((n>>8)&255),b=channel(n&255);return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;}
  function skillMarker(activation:SkillActivation){const entry=packed.find(p=>p.activation===activation);if(!entry)return null;const xs=[entry.box.activation];if(entry.box.end!=null&&entry.box.end>entry.box.activation+1)xs.push(entry.box.end);return {color:brighten(skillToneColor[skillTone(reference,activation.skillId)]),xs,y2:skillsTop+entry.row*26+1};}
  function statusMarker(interval:StatusInterval){const entry=statusBoxes.find(p=>p.interval===interval);if(!entry)return null;const xs=[entry.box.start];if(entry.box.end>entry.box.start+1)xs.push(entry.box.end);return {color:brighten(color(entry.label==='Dueling'?'DUEL':entry.label)),xs,y2:Math.max(bottom,statusY-entry.row*19+16)};}
  function hillLines(){if(!hoveredSlope)return null;const a=atDistance(hoveredSlope.start),b=atDistance(Math.min(extent,hoveredSlope.end));const xs=[a,b].filter((mark):mark is number=>mark!=null);return xs.length?{color:hoveredSlope.up?'#8dcf86':'#3cb48a',xs,y2:elevationBottom}:null;}
  $: spanMarker=hoveredSlope?hillLines():showEvents&&hovered?skillMarker(hovered):showStatuses&&hoveredStatus?statusMarker(hoveredStatus):null;
</script>
<section class="panel telemetry">
  <div class="panel-heading telemetry-heading"><div><strong>Race telemetry</strong><span class="muted">{metric==='speed'?'Velocity · m/s':metric==='lane'?'Lane':'Race position'}</span></div><div class="toolbar"><div class="segmented">{#each ['speed','lane','position'] as m}<button class:active={metric===m} onclick={()=>metric=m as Metric}>{m==='speed'?'Velocity':m==='lane'?'Lane':'Position'}</button>{/each}</div><select aria-label="Graph horizontal axis" bind:value={axis}><option value="distance">Distance</option><option value="time">Time</option></select><TelemetryRunners runners={race.runners} {selected} {reference} bind:extraRunnerIds/></div></div>
  <div class="plot-legend"><label style="--line:var(--simulated)" title={analysis.source==='simulation'?'Actual engine target, including active modes, skills and slope.':'Ordinary section speed after skills and slope.'}><input type="checkbox" bind:checked={showIdeal}/> {analysis.source==='simulation'?'Target speed':'Simulated speed'}</label><label style="--line:#ed676b"><input type="checkbox" bind:checked={showHp}/> Selected HP</label><label style="--line:#78acd8"><input type="checkbox" bind:checked={showGap}/> Gap<span class="ahead-key" title="Yellow marks the part of the gap line where this horse is ahead of second.">· Ahead</span></label><label><input type="checkbox" bind:checked={showStatuses}/> Statuses</label><label><input type="checkbox" bind:checked={showEvents}/> Skills</label><div class="live-readout" aria-label="Current telemetry"><span>Time <strong>{time.toFixed(2)} <small>s</small></strong></span><span>Distance <strong>{sample?.distance==null?'—':Math.round(sample.distance)} <small>m</small></strong></span><span>Place <strong>{place==null?'—':ordinal(place)}</strong></span>{#if showIdeal&&currentMotion?.free}<span title={analysis.source==='simulation'?'Actual engine target at this tick.':'Free-running reference speed at this time.'}>{analysis.source==='simulation'?'Target':'Simulated'} <strong>{currentMotion.free.mid.toFixed(2)} <small>m/s</small></strong></span>{/if}<span>Speed <strong>{sample?.speed==null?'—':sample.speed.toFixed(2)} <small>m/s</small></strong></span>{#if speedNote}<span class="speed-note" class:unexplained={speedNote.unexplained} title={speedNote.detail}><strong>{speedNote.label}</strong></span>{/if}{#if currentMotion?.blockingClamps&&(currentMotion.blockingClamps.self>0||currentMotion.blockingClamps.final>0)}<span title="Actual speed reductions at two separate clamp stages; not finish-time loss.">Clamps <strong>{currentMotion.blockingClamps.self.toFixed(2)} / {currentMotion.blockingClamps.final.toFixed(2)} <small>m/s</small></strong></span>{/if}<span class="hp-reading">HP <strong>{sample?.hp==null?'—':Math.round(sample.hp)}</strong>{#if hpLeft!=null}<span class="hp-pct">/ {hpLeft.toFixed(0)}%</span>{/if}</span><span class="gap-reading" class:ahead={gap!==null&&gap<0} title="Positive behind first; negative ahead of second.">Gap <strong>{gap==null?'—':gap.toFixed(1)} <small>m</small></strong></span></div></div>
  <div class="speed-explanation" class:empty={metric!=='speed'||!speedChange} aria-label="Speed change explanation">{#if metric==='speed'&&speedChange}<strong>{speedChange.to>speedChange.from?'Speed rises':'Speed falls'} · {speedChange.start.toFixed(2)}–{speedChange.end.toFixed(2)} s</strong><span title={changeReasons.map(r=>r.detail??r.label).join('\n')}>{changeReasons.length?changeReasons.map(r=>r.label).join(' · '):'Cause unresolved'}</span><small title="These are supported factors in this sampled interval. Position alone does not establish a slowdown, and overlapping causes are not assigned separate amounts.">Replay context</small>{/if}</div>
  <div class="chart-wrap">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
    <svg class="telemetry-svg" viewBox={`0 0 ${canvasWidth} ${chartHeight}`} style:width={`${canvasWidth/1200*100}%`} style:min-width={`${Math.round(canvasWidth*0.7)}px`} role="group" tabindex="0" aria-label={`${metric} graph with selected HP, leader gap and status overlays. Drag or use arrow keys to seek.`} onpointerdown={down} onpointermove={e=>{hoverSkill(e);if(dragging)seek(e)}} onpointerleave={()=>hovered=null} onpointerup={up} onpointercancel={()=>dragging=false} onlostpointercapture={()=>dragging=false} onkeydown={keySeek}>
      {#each yTicks as tick}<line x1={left} x2={right} y1={y(tick)} y2={y(tick)} class="gridline"/><text x={left-12} y={y(tick)+4} text-anchor="end" class="axis-label">{metric==='position'?Math.round(tick):tick.toFixed(metric==='lane'?2:1)}</text>{/each}
      {#each xTicks as tick}<line x1={x(tick)} x2={x(tick)} y1={top} y2={chartHeight-8} class="gridline faint"/><text x={x(tick)} y={bottom+19} text-anchor="middle" class="axis-label">{Math.round(tick)}{axis==='distance'?'m':'s'}</text>{/each}
      {#if elevationPath.trim()}<path d={`${elevationPath} L${right},${elevationBottom} L${left},${elevationBottom} Z`} fill="var(--accent)" fill-opacity=".18"/>
        {#each compatibleCourse?.slopes??[] as slope}
          {@const a=atDistance(slope.start)}{@const end=slope.start+slope.length}{@const b=atDistance(Math.min(extent,end))}
          {@const help=slopeEffectHelp(slope.slopePercent,detail?.statBreakdown.stats.power.final,selectedName)}
          {#if a!==null&&b!==null&&b>a}<g class="hill-span" role="group" aria-label={help} onpointerenter={()=>hoveredSlope={start:slope.start,end,up:slope.slopePercent>0}} onpointerleave={()=>hoveredSlope=null} onpointerdown={e=>e.stopPropagation()}>
            <title>{help} · {slope.start}–{end} m</title><rect x={a} y={elevationTop} width={b-a} height={elevationBottom-elevationTop} fill={slope.slopePercent>0?'#69b779':'#2f9c69'} opacity=".16"/>
            <text x={(a+b)/2} y={elevationTop+13} text-anchor="middle" class="slope-label">{b-a>85?`${slope.slopePercent>0?'Up':'Down'} ${Math.abs(slope.slopePercent)}%`:`${slope.slopePercent>0?'↗':'↘'}${Math.abs(slope.slopePercent)}%`}</text>
          </g>{/if}
        {/each}
        <path d={elevationPath} fill="none" stroke="var(--accent)" stroke-opacity=".85" stroke-width="1.8"><title>Relative course elevation.</title></path>
      {/if}
      {#if metric==='speed'&&showIdeal}<g class="simulated-speed"><title>Ordinary section speed, including skills and slope. Inferred pace and downhill modes stay on the status row and are not folded back into this line.</title><path d={simulatedPath} fill="none" stroke="var(--simulated)" stroke-width="2" stroke-dasharray="7 3"/></g>{/if}
      {#each paths.filter(p=>visibleIds.has(p.runner.id)).sort((a,b)=>Number(a.runner.id===selected)-Number(b.runner.id===selected)) as p}<path data-runner-id={p.runner.id} d={p.path} fill="none" stroke={runnerColors[p.runner.index%runnerColors.length]} stroke-width={p.runner.id===selected?3:1.3} opacity={p.runner.id===selected?1:.3}/>{/each}
      {#each metricHpBridges.filter(p=>visibleIds.has(p.runner.id)) as p}{#each p.bridges as bridge}<path class="hp-sampled-bridge" d={bridge.path} fill="none" stroke={runnerColors[p.runner.index%runnerColors.length]} stroke-width={p.runner.id===selected?3:1.3} opacity={p.runner.id===selected?0.7:0.2}><title>{bridge.reason}</title></path>{/each}{/each}
      {#if metric==='speed'}{#if showHp}{#each hpBridges as bridge}<path class="hp-sampled-bridge" d={bridge.path} fill="none" stroke="#ed676b" stroke-width="2.4" stroke-opacity=".7"><title>{bridge.reason}</title></path>{/each}<path d={hpPath} fill="none" stroke="#ed676b" stroke-width="2.4"/>{/if}{#if showGap}<defs><linearGradient id="telemetry-gap-color" x1="0" y1={top} x2="0" y2={bottom} gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#78acd8"/><stop offset={gapZero} stop-color="#78acd8"/><stop offset={gapZero} stop-color="var(--gap-ahead)"/><stop offset="1" stop-color="var(--gap-ahead)"/></linearGradient></defs><path d={gapPath} fill="none" stroke="url(#telemetry-gap-color)" stroke-width="2" stroke-dasharray="3 3"/>{/if}{/if}
      {#if showStatuses}<defs>{#each statusBoxes as entry,index}<clipPath id={`status-label-${index}`}><rect x={entry.box.start} y={statusY-entry.row*19} width={Math.max(entry.box.end-entry.box.start,3)} height="16"/></clipPath>{/each}</defs>{#each statusBoxes as entry,index}{@const interval=entry.interval}{@const box=entry.box}{@const rowY=statusY-entry.row*19}{@const short=entry.label}{@const spanWidth=Math.max(box.end-box.start,3)}{@const hot=hoveredStatus===interval}<g class="status-span" class:hot role="button" tabindex="0" onfocus={()=>hoveredStatus=interval} onblur={()=>hoveredStatus=null} onkeydown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSeek(interval.start);}}} aria-label={`${statusLabel(interval.kind)} from ${interval.start.toFixed(2)} to ${(interval.end??interval.start).toFixed(2)} seconds`} onpointerenter={()=>hoveredStatus=interval} onpointerleave={()=>hoveredStatus=null} onpointerdown={e=>e.stopPropagation()} onclick={()=>onSeek(interval.start)}><title>{provenance(interval)}</title><rect x={box.start} y={rowY} width={spanWidth} height="16" rx="2" fill={color(short==='Dueling'?'DUEL':short)} fill-opacity={hot?0.42:0.22} stroke={color(short==='Dueling'?'DUEL':short)} stroke-width={hot?1.75:1} stroke-dasharray={interval.evidence==='estimated'?'4 3':undefined}/><text x={box.start+4} y={rowY+12} class="overlay-label" clip-path={`url(#status-label-${index})`} fill={color(short==='Dueling'?'DUEL':short)}>{short}</text><line x1={box.start} x2={box.start+spanWidth} y1={rowY+16} y2={rowY+16} stroke={color(short==='Dueling'?'DUEL':short)} stroke-width="2"/></g>{/each}{/if}
      <g class="race-section-markers" aria-label="24 race sections">{#each raceSections as section}{@const a=atDistance(section.start)}{@const b=atDistance(section.end)}{#if a!==null&&b!==null&&b>a}<g data-race-section={section.number}><title>Section {section.number} · {section.start.toFixed(0)}–{section.end.toFixed(0)} m</title><line x1={a} x2={a} y1={bottom-5} y2={bottom}/><text x={(a+b)/2} y={bottom-7} text-anchor="middle">{section.number}</text></g>{/if}{/each}</g>
      {#each trackBands as band}{@const a=atDistance(band.start)}{@const b=atDistance(band.end)}{#if a!==null&&b!==null}<rect x={a} y={trackTop} width={Math.max(0,b-a-1)} height="23" fill={band.kind==='corner'?'#bc915c':'#57998a'} opacity=".55"/>{#if b-a>48}<text x={(a+b)/2} y={trackTop+15} text-anchor="middle" class="band-label">{band.label.replace(/\s+segment/i,'')}</text>{/if}{/if}{/each}
      {#each phaseBands as band}{@const a=atDistance(band.start)}{@const b=atDistance(band.end)}{#if a!==null&&b!==null}<rect x={a} y={phaseTop} width={Math.max(0,b-a-1)} height="23" fill={phaseColor(band.kind)} opacity=".5"/><text x={(a+b)/2} y={phaseTop+15} text-anchor="middle" class="band-label">{band.label}</text>{/if}{/each}
      {#if showEvents}
        <defs>{#each packed as entry}<clipPath id={`proc-label-${entry.index}`}><rect x={entry.box.x+1} y={skillsTop+entry.row*26+2} width={Math.max(0,entry.box.labelWidth-2)} height="21"/></clipPath>{/each}</defs>
        {#each packed as entry}
          {@const a=entry.activation}{@const box=entry.box}{@const rowY=skillsTop+entry.row*26}{@const tone=skillToneColor[skillTone(reference,a.skillId)]}
          <g class="skill-box" class:hot={hovered===a} role="button" tabindex="0" aria-label={`${skillName(reference,a.skillId)} at ${a.start.toFixed(2)} seconds${a.effectiveDuration?`; duration ${a.effectiveDuration.toFixed(2)} seconds`:''}`}
            onfocus={()=>hovered=a} onblur={()=>hovered=null} onkeydown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSeek(a.start);}else if(e.key==='Escape'){hovered=null;e.stopPropagation();}}}
            onpointerdown={e=>e.stopPropagation()} onclick={()=>onSeek(a.start)}>
            <rect x={box.x} y={rowY+1} width={box.labelWidth} height="23" rx="2" fill={tone} fill-opacity="0.35" stroke={tone} stroke-width="1.25"/>
            <text x={box.x+6} y={rowY+16} class="skill-label" clip-path={`url(#proc-label-${entry.index})`}>{skillName(reference,a.skillId)}</text>
            {#if box.width>1}<line x1={box.activation} x2={box.activation+box.width} y1={rowY+24} y2={rowY+24} stroke={tone} stroke-width="2"/>{:else}<path d={`M${box.x},${rowY+21} l3,3 -3,3 -3,-3 Z`} fill={tone}/>{/if}
            <line x1={box.activation} x2={box.activation} y1={rowY+1} y2={rowY+24} stroke={tone} stroke-width="1.5"/>
          </g>
        {:else}<text x={left+8} y={skillsTop+18} class="axis-label">No skill activations recorded</text>{/each}
      {/if}
      {#if spanMarker}<g class="span-markers" aria-hidden="true">{#each spanMarker.xs as mark}<line class="span-marker" x1={mark} x2={mark} y1="8" y2={spanMarker.y2} stroke={spanMarker.color} stroke-width="1.5" vector-effect="non-scaling-stroke"/>{/each}</g>{/if}
      {#if metric==='speed'&&showGap}
        {#if activeGapGuide&&activeGapSegments.length}<g class="gap-threshold-line" aria-hidden="true">{#each activeGapSegments as segment}<line x1={segment.start} x2={segment.end} y1={gapY(activeGapGuide.gap)} y2={gapY(activeGapGuide.gap)} stroke={color(activeGapGuide.id)} stroke-dasharray="5 4"/>{/each}<text x={activeGapSegments.at(-1)!.end-5} y={gapY(activeGapGuide.gap)-6} text-anchor="end" fill={color(activeGapGuide.id)}>{activeGapGuide.id} · {activeGapGuide.gap.toFixed(1)} m gap</text></g>{/if}
        {#each gapMarkers as marker}{@const guide=marker.guide}<g class="gap-threshold-marker" role="button" tabindex="0" aria-label={guide.detail} data-gap-guide={guide.id} data-gap-value={guide.gap} onpointerenter={()=>hoveredGapGuide=guide.id} onpointerleave={()=>hoveredGapGuide=null} onfocus={()=>hoveredGapGuide=guide.id} onblur={()=>hoveredGapGuide=null} onkeydown={e=>{if(e.key==='Escape'){hoveredGapGuide=null;e.stopPropagation();}}} onpointerdown={e=>e.stopPropagation()}><title>{guide.detail}</title><path class="gap-marker-leader" d={`M${left-16},${marker.markerY} H${left-12} L${left-4},${marker.targetY} H${left}`} fill="none" stroke={color(guide.id)}/><rect x={left-43} y={marker.markerY-9} width="27" height="18" rx="3" fill="var(--panel)" stroke={color(guide.id)}/><text x={left-29.5} y={marker.markerY+3.5} text-anchor="middle" fill={color(guide.id)}>{guide.id}</text><path d={`M${left-4},${marker.targetY-3} L${left},${marker.targetY} L${left-4},${marker.targetY+3} Z`} fill={color(guide.id)}/></g>{/each}
      {/if}
      {#if cursor!==null}<line pointer-events="none" x1={cursor} x2={cursor} y1="8" y2={chartHeight-8} stroke="var(--text)" opacity=".7" stroke-width="1.3"/><circle pointer-events="none" cx={cursor} cy="7" r="4" fill="var(--text)"/>{/if}
      <!-- SVG paints in DOM order. Keep the expanded card above every plot layer. -->
      {#if showEvents&&hovered}
        {@const entry=packed.find(p=>p.activation===hovered)}
        {#if entry}
          {@const a=entry.activation}{@const wide=hoverWidth(a)}{@const drawX=Math.max(left,Math.min(entry.box.x,canvasWidth-wide-8))}{@const rowY=skillsTop+entry.row*26}
          {@const tone=skillToneColor[skillTone(reference,a.skillId)]}{@const distance=distanceAtTime(race,selected,a.start)}
          <g class="skill-hover-card" role="button" tabindex="-1" aria-label={`Seek to ${skillName(reference,a.skillId)}`} onpointerdown={e=>{e.preventDefault();e.stopPropagation();}} onclick={()=>onSeek(a.start)} onkeydown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSeek(a.start);}}}>
            <rect x={drawX} y={rowY+1} width={wide} height="78" rx="5" fill="var(--panel)"/>
            <rect x={drawX} y={rowY+1} width={wide} height="78" rx="5" fill={tone} fill-opacity="0.35" stroke={tone} stroke-width="1.25"/>
            <rect x={drawX+5} y={rowY+32} width={Math.max(0,wide-10)} height="42" rx="4" fill="var(--panel)"/>
            <text x={drawX+6} y={rowY+19} class="skill-label">{skillName(reference,a.skillId)}</text>
            <text x={drawX+12} y={rowY+49} class="skill-hover-detail">{a.start.toFixed(2)} s · {distance==null?'—':`${Math.round(distance)} m`}</text>
            <text x={drawX+12} y={rowY+64} class="skill-hover-detail">{effectSummary(a.skillId)}</text>
          </g>
        {/if}
      {/if}
    </svg>
  </div>
  <details class="status-legend"><summary>Status legend</summary><ul>{#each statusLegend as item}<li><span class="legend-swatch" style:background={item.kind==='uphill'?'#69b779':color(item.short)}></span><strong>{item.short}</strong><span>{item.name}</span><span class="legend-detail">{#if item.formula&&analysis.source!=='simulation'}<code>{item.formula}</code>{/if}{#if analysis.source!=='simulation'}<small>{item.source}</small>{/if}</span></li>{/each}</ul></details>
</section>
<style>
  .telemetry-svg [tabindex]:focus{outline:none}
  .speed-explanation{display:flex;gap:12px;align-items:baseline;height:36px;box-sizing:border-box;padding:8px 18px;color:var(--text);font-size:var(--font-11);border-bottom:1px solid var(--border);overflow:hidden}.speed-explanation strong{flex-shrink:0;font-size:var(--font-11);font-weight:550}.speed-explanation>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.speed-explanation small{margin-left:auto;flex-shrink:0;color:var(--muted);font-size:var(--font-10);text-decoration:underline dotted}.speed-explanation.empty{color:transparent}
  .gap-threshold-marker{cursor:help}.gap-threshold-marker text{font-size:var(--font-10);font-weight:700;pointer-events:none}.gap-threshold-marker:focus-visible{outline:none}.gap-threshold-marker:focus-visible rect{stroke-width:2}.gap-threshold-line{pointer-events:none}.gap-threshold-line text{font-size:var(--font-10);paint-order:stroke;stroke:var(--panel);stroke-width:3px}
.telemetry{--gap-ahead:#e7b65b}:global(:root[data-theme=light]) .telemetry{--gap-ahead:#996000}.ahead-key,.live-readout .gap-reading.ahead strong{color:var(--gap-ahead)}
.race-section-markers{pointer-events:none}.race-section-markers line{stroke:var(--muted);stroke-opacity:.5}.race-section-markers text{fill:var(--muted);font-size:var(--font-8);paint-order:stroke;stroke:var(--panel);stroke-width:2px}
.telemetry-heading{min-height:48px;height:auto;flex-wrap:wrap;gap:12px}.telemetry-heading>div:first-child{gap:12px}.plot-legend{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:9px 18px 2px;font-size:var(--font-11)}.plot-legend label{display:flex;align-items:center;gap:6px;color:var(--line,var(--text))}.live-readout{display:flex;gap:14px;margin-left:auto;flex-wrap:wrap;font-variant-numeric:tabular-nums}.live-readout span{display:flex;gap:5px;align-items:baseline;color:var(--muted);font-size:var(--font-10)}.live-readout strong{color:var(--text);font-size:var(--font-12);font-weight:550}.live-readout small{font-size:var(--font-9);font-weight:400}.live-readout .hp-reading{gap:8px}.live-readout .hp-reading strong{color:#ed676b}.live-readout .hp-reading .hp-pct{color:color-mix(in srgb,#ed676b 55%,var(--muted));font-size:var(--font-11);font-weight:550}.live-readout .gap-reading strong{color:#78acd8}.live-readout .speed-note strong{color:var(--text);font-weight:550}.live-readout .speed-note.unexplained strong{color:#e7b65b}.chart-wrap{overflow-x:auto}.telemetry-svg{display:block;width:100%;height:auto;min-width:840px;max-height:none;touch-action:none;user-select:none;cursor:crosshair}svg:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.skill-label{fill:var(--text);font-size:var(--font-12);font-weight:550}.skill-box{color:var(--text)}.skill-hover-detail{font-size:var(--font-11);font-weight:450;fill:currentColor}.status-legend{margin:0 12px 12px;border:1px solid var(--border);border-radius:6px;background:color-mix(in srgb,#000 12%,var(--panel))}.status-legend summary{cursor:pointer;padding:8px 12px;font-size:var(--font-12);font-weight:550}.status-legend ul{list-style:none;margin:0;padding:0 12px 12px;display:grid;gap:10px}.status-legend li{display:grid;grid-template-columns:10px 4.8em 9em minmax(0,1fr);column-gap:14px;align-items:baseline;font-size:var(--font-12)}.status-legend strong{font-weight:550}.legend-detail{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 2.25em;min-width:0}.legend-detail small{flex:1 1 18em;color:var(--muted);font-size:var(--font-11);line-height:1.45}.status-legend code{flex:0 0 auto;color:var(--text);font-size:var(--font-11)}.legend-swatch{width:8px;height:8px;border-radius:2px}.hill-span{cursor:pointer}.hill-span text{pointer-events:none}.overlay-label{font-size:var(--font-10);font-weight:700;paint-order:stroke;stroke:var(--panel);stroke-width:2px}.span-markers,.span-marker{pointer-events:none}.span-marker{stroke-opacity:1}.status-span{cursor:pointer}.status-span:focus-visible{outline:none}.status-span:focus-visible rect{stroke-width:1.75}.skill-box,.skill-hover-card{cursor:pointer}.skill-hover-card{color:var(--text)}.skill-hover-card text{pointer-events:none}.skill-box text,.skill-box.hot rect{pointer-events:none}.skill-box:focus-visible{outline:none}.skill-box:focus-visible rect{stroke-width:2.25}.status-span text{pointer-events:none}.slope-label{fill:var(--text);font-size:var(--font-10);font-weight:600;paint-order:stroke;stroke:var(--panel);stroke-opacity:.45;stroke-width:2px}
</style>
