<script lang="ts">
  import type {TrafficSample} from '../simulation/traffic-lane';
  import {trafficCells,trafficSampleAt} from '../simulation/traffic-lane';
  import {trafficSlowdown,TRAFFIC_MIN_SLOWDOWN} from '../simulation/traffic';
  export let ticks:TrafficSample[],left:number,right:number,y:number,finish:number,time:number;
  export let project:(time:number)=>number|null,unproject:(x:number)=>number|null,runnerName:(id:string)=>string,onSeek:(time:number)=>void;
  let hover:number|null=null;
  $: cells=trafficCells(ticks,project);
  $: tick=hover===null?null:trafficSampleAt(ticks,hover);
  $: cut=trafficSlowdown(tick);
  $: hasCut=cut>=TRAFFIC_MIN_SLOWDOWN;
  $: status=tick?(tick.blocked?(hasCut?'Blocked':'Contact only'):'Not blocked'):'Data unavailable';
  $: slowdown=tick?(hasCut?`Speed cut ${cut.toFixed(3)} m/s`:(cut>0?'Speed cut below 0.001 m/s':'No speed cut')):'No sample at this point';
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
  {#each cells as cell}<rect class="traffic-tick" x={cell.start} y={y} width={cell.end-cell.start} height="16" fill={cell.color} pointer-events="none"/>{/each}
  <rect class="traffic-hit-area" x={left} y={y} width={right-left} height="18" fill="transparent" role="slider" tabindex="0" aria-label="Traffic lane" aria-valuemin="0" aria-valuemax={finish} aria-valuenow={hover??time} aria-valuetext={`${status} · ${slowdown}`} onpointermove={move} onpointerleave={()=>hover=null} onpointerdown={event=>{event.stopPropagation();move(event);if(hover!==null)onSeek(hover);}} onfocus={()=>hover=time} onblur={()=>hover=null} onkeydown={key}/>
  {#if hover!==null&&cursor!==null}
    <g class="traffic-tooltip" aria-live="polite" pointer-events="none">
      <line x1={cursor} x2={cursor} y1={y-2} y2={y+18} stroke="var(--text)"/>
      <rect x={cardX} y={y+22} width={cardWidth} height="48" rx="4" fill="var(--panel)" stroke="var(--border)"/>
      <text x={cardX+9} y={y+40} class="traffic-status">{status}<tspan dx="8" class="traffic-time">{hover.toFixed(2)} s</tspan></text>
      <text x={cardX+9} y={y+58}>{slowdown}{#if tick?.blocker}<tspan dx="8">· {runnerName(tick.blocker)}</tspan>{/if}</text>
    </g>
  {/if}
</g>
<style>
  .traffic-hit-area{cursor:crosshair}.traffic-hit-area:focus-visible{outline:1px solid var(--accent)}.traffic-tooltip text{fill:var(--text);font-size:var(--font-11);font-variant-numeric:tabular-nums}.traffic-status{font-weight:600}.traffic-tooltip .traffic-time{fill:var(--muted);font-weight:400}
</style>
