<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ReplayOptions } from '../replay/model';
  import { supportedClipType, recordReplayClip } from '../replay/clip';
  import { replayPalette } from '../replay/draw';
  export let options:ReplayOptions;
  export let time:number;
  let start=0,end=0,rate=1,recording=false,progress=0,error='',resultUrl='',resultName='umalytics-replay.webm',controller:AbortController|null=null;
  let encoder:HTMLCanvasElement;
  let previousRace:ReplayOptions['race']|null=null;
  $: if(options.race!==previousRace){previousRace=options.race;start=0;end=Math.min(10,options.race.duration);if(controller)controller.abort();if(resultUrl){URL.revokeObjectURL(resultUrl);resultUrl='';}}
  $: supported=typeof window!=='undefined'&&supportedClipType()!==null;
  async function record(){
    error='';recording=true;progress=0;controller=new AbortController();
    const snapshot={...options},signal=controller.signal,clipStart=Number(start),clipEnd=Number(end),clipRate=Number(rate);
    try{
      const blob=await recordReplayClip(encoder,snapshot,replayPalette(),clipStart,clipEnd,clipRate,signal,fraction=>progress=fraction);
      if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=URL.createObjectURL(blob);resultName=`umalytics-${snapshot.race.courseId??'race'}-${clipStart.toFixed(1)}-${clipEnd.toFixed(1)}.webm`;
    }catch(e){error=e instanceof DOMException&&e.name==='AbortError'?'Clip export cancelled.':String(e);}finally{recording=false;controller=null;}
  }
  onDestroy(()=>{controller?.abort();if(resultUrl)URL.revokeObjectURL(resultUrl);});
</script>
<div class="clip-controls">
  <div><strong>Create a replay clip</strong><small title="The browser encodes the current course view and labels directly to WebM, without screen capture, microphone or audio permissions. Recording takes the selected interval divided by its playback rate.">WebM · no audio · records in real time</small></div>
  <div class="clip-fields">
    <label>Start <input aria-label="Clip start seconds" type="number" min="0" max={options.race.duration} step=".1" bind:value={start} disabled={recording}/><span>s</span></label>
    <button disabled={recording} onclick={()=>start=Math.min(time,Math.max(0,end-.1))}>Start here</button>
    <label>End <input aria-label="Clip end seconds" type="number" min="0" max={options.race.duration} step=".1" bind:value={end} disabled={recording}/><span>s</span></label>
    <button disabled={recording} onclick={()=>end=Math.max(time,Math.min(options.race.duration,start+.1))}>End here</button>
    <label>Rate <select aria-label="Clip playback rate" bind:value={rate} disabled={recording}><option value={.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
    {#if recording}<button onclick={()=>controller?.abort()}>Cancel recording</button><span class="progress" role="status">{Math.round(progress*100)}%</span>{:else}<button class="accent-button" disabled={!supported||end<=start||start<0||end>options.race.duration} onclick={record}>Record WebM</button>{/if}
  </div>
  {#if !supported}<p>This browser cannot encode canvas WebM. Open the viewer in current Chrome or Edge.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if resultUrl}<div class="clip-result"><video src={resultUrl} controls playsinline muted aria-label="Exported replay clip preview"></video><a class="button" href={resultUrl} download={resultName}>Download WebM</a></div>{/if}
  <canvas class="encoder" bind:this={encoder} width="1280" height="480" aria-hidden="true"></canvas>
</div>
<style>
  .clip-controls{padding:14px 18px;border-top:1px solid var(--border);font-size:var(--font-12)}.clip-controls strong{font-size:var(--font-12)}.clip-controls small{display:block;color:var(--muted);font-size:var(--font-11);line-height:1.6;margin-top:3px}.clip-fields{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.clip-fields label{display:flex;align-items:center;gap:5px;font-size:var(--font-11)}.clip-fields input{width:78px}.clip-fields button{font-size:var(--font-11);padding:7px 9px}.progress{color:var(--accent);min-width:45px;font-variant-numeric:tabular-nums}.clip-controls p{font-size:var(--font-11);color:var(--muted)}.clip-result{display:flex;align-items:flex-end;gap:12px;margin-top:15px}.clip-result video{width:min(640px,75%);border:1px solid var(--border);border-radius:5px}.encoder{position:absolute;width:1px;height:1px;pointer-events:none;opacity:0}
</style>
