<script lang="ts">
  import type {StatusInterval} from '../data/analytics';
  export let interval:StatusInterval,bursts:StatusInterval[],left:number,y:number,paint:string;
  export let project:(time:number)=>number|null,unproject:(x:number)=>number|null;
  export let onSeek:(time:number)=>void,onHover:(active:boolean)=>void;
  let hover:number|null=null;
  $: start=project(interval.start)??left;
  $: end=project(interval.end!)??start;
  $: activeSeconds=bursts.reduce((n,b)=>n+b.end!-b.start,0);
  $: hasPauses=interval.end!-interval.start-activeSeconds>1e-6;
  $: tooltip=[`Lane bonus · ${interval.start.toFixed(2)}–${interval.end!.toFixed(2)} s`,
    `${interval.model?.speedDelta!=null?`+${interval.model.speedDelta.toFixed(3)} m/s · `:''}${activeSeconds.toFixed(2)} s active`,
    hasPauses?'Includes brief movement pauses.':''].filter(Boolean).join('\n');
  function enter(){hover=interval.start;onHover(true);}
  function leave(){hover=null;onHover(false);}
  function move(event:PointerEvent){
    const svg=(event.currentTarget as SVGElement).ownerSVGElement,ctm=svg?.getScreenCTM();if(!svg||!ctm)return;
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const time=unproject(p.matrixTransform(ctm.inverse()).x);
    if(time!==null)hover=Math.max(interval.start,Math.min(interval.end!,time));
  }
  function key(event:KeyboardEvent){
    if(event.key==='Escape'){leave();event.stopPropagation();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onSeek(hover??interval.start);return;}
    const at=hover??interval.start,next=event.key==='ArrowRight'?at+.0666:event.key==='ArrowLeft'?at-.0666:event.key==='Home'?interval.start:event.key==='End'?interval.end:null;
    if(next!==null){event.preventDefault();event.stopPropagation();hover=Math.max(interval.start,Math.min(interval.end!,next));}
  }
</script>
<g class="status-span lane-bonus-band" role="button" tabindex="0" aria-label={tooltip}
  onpointerenter={enter} onpointermove={move} onpointerleave={leave} onfocus={enter} onblur={leave} onkeydown={key}
  onpointerdown={e=>{e.preventDefault();e.stopPropagation();}} onclick={()=>onSeek(hover??interval.start)}>
  <title>{tooltip}</title>
  <rect class="lane-envelope" x={start} {y} width={Math.max(1,end-start)} height="16" rx="2" fill={paint} fill-opacity={hover===null?.24:.36} stroke={paint} stroke-opacity=".85"/>
  <rect x={start} {y} width={Math.max(1,end-start)} height="16" fill="transparent"/>
  <text x={(start+end)/2} y={y+12} text-anchor="middle" class="lane-label" fill={paint}>Lane</text>
</g>
<style>
  .lane-bonus-band{cursor:pointer}.lane-bonus-band:focus-visible{outline:none}.lane-bonus-band:focus-visible .lane-envelope{stroke-width:2;stroke-opacity:1}
  text{pointer-events:none;font-size:var(--font-10);font-variant-numeric:tabular-nums}.lane-label{font-weight:700;paint-order:stroke;stroke:var(--panel);stroke-width:2px}
</style>
