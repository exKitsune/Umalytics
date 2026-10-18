<script lang="ts">
  import type {TrafficSample} from '../simulation/traffic-lane';
  import type {StatusInterval} from '../data/analytics';
  import {trafficCells,trafficSampleAt} from '../simulation/traffic-lane';
  import {trafficSlowdown} from '../simulation/traffic';
  export let ticks:TrafficSample[],contacts:StatusInterval[],left:number,right:number,y:number,finish:number,time:number;
  export let project:(time:number)=>number|null,unproject:(x:number)=>number|null,runnerName:(id:string)=>string,onSeek:(time:number)=>void;
  let hover:number|null=null;
  $: cells=trafficCells(ticks,project);
  $: spans=contacts.flatMap(interval=>{const start=project(interval.start),end=project(interval.end??finish);return start!==null&&end!==null&&end>start?[{start,end}]:[];});
  $: tick=hover===null?null:trafficSampleAt(ticks,hover);
  $: cut=trafficSlowdown(tick);
  $: status=tick?(tick.blocked?'Blocked':'Not blocked'):'Data unavailable';
  $: cursor=hover===null?null:project(hover);
  const cardWidth=280;
  $: cardX=Math.max(left,Math.min(right-cardWidth,(cursor??left)-cardWidth/2));
  function move(event:PointerEvent){
    const svg=(event.currentTarget as SVGElement).ownerSVGElement,ctm=svg?.getScreenCTM();if(!svg||!ctm)return;
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const x=point.matrixTransform(ctm.inverse()).x;
    hover=unproject(Math.max(left,Math.min(right,x)));
  }
  function key(event:KeyboardEvent){
    const at=hover??time,next=event.key==='ArrowRight'?at+.1:event.key==='ArrowLeft'?at-.1:event.key==='Home'?0:event.key==='End'?finish:null;
    if(next!==null){event.preventDefault();event.stopPropagation();hover=Math.max(0,Math.min(finish,next));onSeek(hover);}
    if(event.key==='Escape')hover=null;
  }
</script>
<g class="traffic-lane">
  <line x1={left} x2={right} y1={y+16} y2={y+16} stroke="var(--muted)" stroke-opacity=".18"/>
  {#each spans as span}<rect x={span.start} y={y} width={span.end-span.start} height="16" rx="2" fill="none" stroke="var(--muted)" stroke-opacity=".35"/>{/each}
  {#each cells as cell}<rect class="traffic-tick" x={cell.start} y={y+1} width={cell.end-cell.start} height="14" fill={cell.color}/>{/each}
  <rect class="traffic-hit-area" x={left} y={y} width={right-left} height="18" fill="transparent" role="slider" tabindex="0" aria-label="Traffic lane" aria-valuemin="0" aria-valuemax={finish} aria-valuenow={hover??time} aria-valuetext={`${status}${tick?`, ${cut.toFixed(3)} m/s slowdown`:''}`} onpointermove={move} onpointerleave={()=>hover=null} onpointerdown={event=>{event.stopPropagation();move(event);if(hover!==null)onSeek(hover);}} onfocus={()=>hover=time} onblur={()=>hover=null} onkeydown={key}/>
  {#if hover!==null&&cursor!==null}
    <g class="traffic-tooltip" aria-live="polite" pointer-events="none">
      <line x1={cursor} x2={cursor} y1={y-2} y2={y+18} stroke="var(--text)"/>
      <rect x={cardX} y={y+22} width={cardWidth} height="48" rx="4" fill="var(--panel)" stroke="var(--border)"/>
      <text x={cardX+9} y={y+40} class="traffic-status">{status}<tspan dx="8" class="traffic-time">{hover.toFixed(2)} s</tspan></text>
      <text x={cardX+9} y={y+58}>{tick?`Slowdown ${cut.toFixed(3)} m/s`:'No sample at this point'}{#if tick?.blocker}<tspan dx="8">· {runnerName(tick.blocker)}</tspan>{/if}</text>
    </g>
  {/if}
</g>
<style>
  .traffic-hit-area{cursor:crosshair}.traffic-hit-area:focus-visible{outline:1px solid var(--accent)}.traffic-tooltip text{fill:var(--text);font-size:var(--font-11);font-variant-numeric:tabular-nums}.traffic-status{font-weight:600}.traffic-tooltip .traffic-time{fill:var(--muted);font-weight:400}
</style>
