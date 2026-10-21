<script lang="ts">
  import { onDestroy,onMount } from 'svelte';
  import type { Race } from '../data/types';
  import type { CourseReference, ReferenceData } from '../data/reference';
  import { drawReplay,replayPalette } from '../replay/draw';
  import type { ReplayOptions,ReplayScene,ReplayInterval } from '../replay/model';
  import { DEFAULT_REPLAY_WINDOW, replayMinimapObstacle } from '../replay/model';
  import ReplayClip from './ReplayClip.svelte';
  import type { RaceAnalysis } from '../data/analytics';
  import { preloadPortraits } from '../data/portraits';
  import { preloadReplayIcons, replayCardHelp } from '../replay/cards';
  export let race:Race;
  export let course:CourseReference|null=null;
  export let reference:ReferenceData|null=null;
  export let selected:string;
  export let time:number;
  export let fontScale=100;
  export let onSelect:(id:string)=>void;
  export let onSeek:(time:number)=>void=()=>{};
  export let intervals:((runnerId:string)=>readonly ReplayInterval[])|undefined=undefined;
  export let analysis:RaceAnalysis|null=null;
  let viewWindow=DEFAULT_REPLAY_WINDOW,follow:'selected'|'leader'='selected',labels=true,elevation=true,showClips=false;
  let phaseMarkers=true,sectionMarkers=true,slopeMarkers=true,remainingMarker=true;
  let remainingDistance=true;
  let visionGuide=false,debuffTargets=true;
  let canvas:HTMLCanvasElement,scene:ReplayScene|null=null,frame:number|null=null;
  let markerMenu:HTMLDetailsElement;
  let canvasWidth=1280,canvasHeight=816;
  let mounted=false,portraitRace:Race|null=null,iconReference:ReferenceData|null|undefined=undefined,iconAnalysis:RaceAnalysis|null|undefined=undefined,cardTitle='';
  $: options={race,course,reference,selected,fontScale,window:Number(viewWindow),follow,labels,elevation,remainingDistance,intervals,analysis,courseMarkers:{phases:phaseMarkers&&analysis?.source!=='recorded',sections:sectionMarkers&&analysis?.source!=='recorded',slopes:slopeMarkers,remaining777:remainingMarker},overlays:{vision:visionGuide,debuffs:debuffTargets},cardObstacles:$$slots.minimap?[replayMinimapObstacle(canvasWidth)]:[]} satisfies ReplayOptions;
  // Include every visual dependency explicitly; playback time does not rebuild data.
  $: if(canvas){options;time;schedule();}
  $: if(mounted&&race!==portraitRace){portraitRace=race;Promise.all([preloadPortraits(race.runners)]).then(()=>{if(mounted)schedule();});}
  $: if(mounted&&(reference!==iconReference||analysis!==iconAnalysis)){iconReference=reference;iconAnalysis=analysis;preloadReplayIcons(options).then(()=>{if(mounted)schedule();});}
  function schedule(){
    // Parent playback also runs on RAF. Cancelling and replacing this callback
    // on every parent tick starves it indefinitely while Play is running.
    if(frame!==null)return;
    frame=requestAnimationFrame(()=>{frame=null;const context=canvas?.getContext('2d');if(context)scene=drawReplay(context,options,time,canvas.width,canvas.height,replayPalette());});
  }
  function select(event:MouseEvent){
    if(!scene)return;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*canvas.width,y=(event.clientY-rect.top)/rect.height*canvas.height;
    const marker=scene.markers.filter(m=>Math.hypot(m.x-x,m.y-y)<24).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];if(marker)onSelect(marker.runner.id);
  }
  function describeCard(event:MouseEvent){
    if(!scene)return;const bounds=canvas.getBoundingClientRect(),x=(event.clientX-bounds.left)/bounds.width*canvas.width,y=(event.clientY-bounds.top)/bounds.height*canvas.height;
    const group=[...scene.cardGroups].reverse().find(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height);
    const card=group?scene.cardRects.find(r=>r.runnerId===group.runnerId&&x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height)?.card:undefined;
    const marker=group?scene.markers.find(m=>m.runner.id===group.runnerId):undefined;
    cardTitle=card?`${card.label}. ${replayCardHelp(options,card)}`:marker?`${group!.header}: ${marker.cards.map(c=>`${c.label}. ${replayCardHelp(options,c)}`).join(' ')}`:'';
  }
  function keyboard(event:KeyboardEvent){
    const next=event.key==='ArrowRight'?time+(event.shiftKey?5:1):event.key==='ArrowLeft'?time-(event.shiftKey?5:1):event.key==='Home'?0:event.key==='End'?race.duration:null;
    if(next!==null){event.preventDefault();onSeek(Math.max(0,Math.min(race.duration,next)));}
  }
  onDestroy(()=>{mounted=false;if(frame!==null)cancelAnimationFrame(frame);});
  onMount(()=>{
    mounted=true;
    const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
    // Match the draw coordinate space to the visible size: a 1280px bitmap
    // squeezed into a narrow panel made 11px callout text unreadably small.
    const resize=new ResizeObserver(entries=>{
      const width=Math.max(1,Math.round(entries[0].contentRect.width)),height=36+Math.round(1.3*Math.max(560,Math.min(680,width*.5)));
      if(width!==canvasWidth||height!==canvasHeight){canvasWidth=width;canvasHeight=height;schedule();}
    });
    resize.observe(canvas);return()=>{observer.disconnect();resize.disconnect();};
  });
</script>
<svelte:window onkeydown={event=>{if(event.key==='Escape'&&markerMenu)markerMenu.open=false;}}/>
<section class="panel curve-replay" class:clips-open={showClips}>
  <div class="panel-heading"><div><strong>Race replay</strong><span class="subtitle">Follow the field</span></div><button class:active={showClips} onclick={()=>showClips=!showClips}>Create clip</button></div>
  <div class="replay-tools">
    <label>Follow <select aria-label="Zoomed replay camera" bind:value={follow}><option value="selected">Selected runner</option><option value="leader">Leader</option></select></label>
    <label>Window <input aria-label="Zoomed replay view window" type="range" min="40" max="600" step="10" bind:value={viewWindow}/><output>{viewWindow} m</output></label>
    <label><input type="checkbox" bind:checked={labels}/> Names & statuses</label>
    <label><input type="checkbox" bind:checked={elevation}/> Elevation</label>
    <label title="Show distance to the finish, such as −200 m."><input type="checkbox" bind:checked={remainingDistance}/> Distance remaining</label>
    <details class="marker-menu" bind:this={markerMenu}>
    <summary>Markers <span aria-hidden="true">▸</span></summary>
    <div class="course-marker-tools" aria-label="Race replay course markers">
    <label><input type="checkbox" bind:checked={phaseMarkers}/> Phases</label>
    <label><input type="checkbox" bind:checked={sectionMarkers} disabled={!course}/> Corners & straights</label>
    <label><input type="checkbox" bind:checked={slopeMarkers} disabled={!course}/> Slope changes</label>
    <label><input type="checkbox" bind:checked={remainingMarker} disabled={(race.distance??course?.distance??0)<777}/> 777m left</label>
    <label title="Shows the skill’s view. Dashed rings mark possible targets."><input type="checkbox" bind:checked={visionGuide}/> Vision guide</label>
    <label title="Shows targets listed in the replay. Immunity can prevent the effect."><input type="checkbox" bind:checked={debuffTargets}/> Debuff targets</label>
    </div>
    </details>
  </div>
  <div class="replay-stage">
    <canvas bind:this={canvas} width={canvasWidth} height={canvasHeight} style:height={`${canvasHeight}px`} data-replay-time={scene?.time} data-replay-distance={scene?.distance} data-replay-angle={scene?.camera.angle} data-replay-scale={scene?.camera.scale} title={cardTitle} onmousemove={describeCard} tabindex="0" aria-describedby="curve-replay-statuses" aria-label="Race replay. Click a Uma portrait to select. Arrow keys seek; Shift arrows seek five seconds; Home and End seek race endpoints." onclick={select} onkeydown={keyboard}></canvas>
    {#if $$slots.minimap}<div class="replay-minimap"><slot name="minimap"/></div>{/if}
  </div>
  <slot/>
  <div class="runner-status-description" id="curve-replay-statuses">{#each scene?.markers??[] as marker}{marker.name}: {marker.cards.map(card=>`${card.label}: ${replayCardHelp(options,card)}`).join(', ')||'No active status recorded'}. {/each}{#each scene?.debuffs??[] as debuff}{debuff.label}. {/each}{#each scene?.vision??[] as vision}{vision.label}. {/each}</div>
  <ReplayClip {options} {time} liveWidth={canvasWidth} liveHeight={canvasHeight} bind:open={showClips}/>
</section>
<style>
  .curve-replay{overflow:hidden}.curve-replay.clips-open{overflow:visible}.subtitle{display:block;color:var(--muted);font-size:var(--font-10);margin-top:4px}.replay-tools{position:relative;z-index:3;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--border);font-size:var(--font-11)}.replay-tools label{display:flex;align-items:center;gap:7px}.replay-tools select{font-size:var(--font-11)}.replay-tools input[type=range]{width:80px;padding:0}.replay-tools output{min-width:34px;color:var(--text);font-variant-numeric:tabular-nums}.curve-replay canvas{display:block;width:100%;cursor:pointer}.curve-replay canvas:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}.marker-menu{position:relative;border-left:1px solid var(--border);padding-left:14px}.marker-menu summary{display:flex;align-items:center;gap:8px;list-style:none;cursor:pointer;padding:4px 0;font-weight:550}.marker-menu summary::-webkit-details-marker{display:none}.marker-menu summary span{font-size:10px;transition:transform .15s}.marker-menu[open] summary span{transform:rotate(90deg)}.course-marker-tools{position:absolute;top:calc(100% + 10px);right:0;display:grid;grid-template-columns:repeat(2,max-content);gap:12px 16px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--panel);box-shadow:0 5px 18px #0003;font-size:var(--font-11)}.course-marker-tools label{display:flex;align-items:center;gap:5px;color:var(--text)}@media(max-width:700px){.course-marker-tools{grid-template-columns:1fr;right:auto;left:0}}
  .replay-stage{position:relative}.replay-minimap{position:absolute;right:12px;top:38px;width:210px;height:100px;border:1px solid var(--border);border-radius:8px;background:color-mix(in srgb,var(--panel) 82%,transparent);overflow:hidden;box-shadow:0 2px 12px #0002}@media(max-width:650px){.replay-minimap{width:190px;right:8px;top:38px;height:95px}}
.runner-status-description{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style>
