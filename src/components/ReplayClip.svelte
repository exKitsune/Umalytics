<script lang="ts">
  import { onDestroy,tick } from 'svelte';
  import type { ReplayOptions } from '../replay/model';
  import { CLIP_SIZE_MAX, CLIP_SIZE_MIN } from '../replay/model';
  import { supportedClipType, recordReplayClip, clipExtension } from '../replay/clip';
  import { replayPalette } from '../replay/draw';
  export let options:ReplayOptions;
  export let time:number;
  export let liveWidth=1280;
  export let liveHeight=720;
  export let open=false;
  let start=0,end=0,rate=1,outWidth=1920,outHeight=1080,recording=false,progress=0,error='',resultUrl='',resultName='umalytics-replay.mp4',controller:AbortController|null=null;
  let root:HTMLDivElement,attention=false,wasOpen=false;
  let previousRace:ReplayOptions['race']|null=null;
  $: encoderWidth=Math.max(2,Number(outWidth) & ~1);
  $: encoderHeight=Math.max(2,Number(outHeight) & ~1);
  $: sizeOk=encoderWidth>=CLIP_SIZE_MIN&&encoderHeight>=CLIP_SIZE_MIN&&encoderWidth<=CLIP_SIZE_MAX&&encoderHeight<=CLIP_SIZE_MAX;
  $: if(options.race!==previousRace){previousRace=options.race;start=0;end=Math.min(10,options.race.duration);error='';if(controller)controller.abort();if(resultUrl){URL.revokeObjectURL(resultUrl);resultUrl='';}}
  $: supported=typeof window!=='undefined'&&supportedClipType()!==null;
  $: if(open&&!wasOpen){wasOpen=true;reveal();}else if(!open&&wasOpen){wasOpen=false;attention=false;}
  function applySize(width:number,height:number){outWidth=width;outHeight=height;}
  function close(){if(recording)controller?.abort();open=false;}
  async function reveal(){
    await tick();
    root?.scrollIntoView({behavior:'smooth',block:'center'});
    attention=false;
    await tick();
    attention=true;
  }
  async function record(){
    error='';recording=true;progress=0;controller=new AbortController();
    const snapshot={...options},signal=controller.signal,clipStart=Number(start),clipEnd=Number(end),clipRate=Number(rate);
    try{
      const blob=await recordReplayClip({width:encoderWidth,height:encoderHeight},snapshot,replayPalette(),clipStart,clipEnd,clipRate,signal,fraction=>progress=fraction);
      if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=URL.createObjectURL(blob);
      const ext=clipExtension(blob.type||supportedClipType()||'video/mp4');
      resultName=`umalytics-${snapshot.race.courseId??'race'}-${clipStart.toFixed(1)}-${clipEnd.toFixed(1)}.${ext}`;
    }catch(e){error=e instanceof DOMException&&e.name==='AbortError'?'Clip export cancelled.':String(e);}finally{recording=false;controller=null;}
  }
  onDestroy(()=>{controller?.abort();if(resultUrl)URL.revokeObjectURL(resultUrl);});
</script>
{#if open||resultUrl}
<div class="clip-controls" class:attention={open&&attention} bind:this={root}>
  {#if open}
    <div class="clip-heading">
      <div><strong>Create a replay clip</strong><small title="The browser draws the current course view, labels and minimap onto a hidden canvas at the chosen size, then encodes MP4. No screen capture, microphone or audio permissions. Recording takes the selected interval divided by its playback rate.">MP4 · hidden canvas · no audio · records in real time</small></div>
      <button class="icon-button" aria-label="Close clip tools" onclick={close}>×</button>
    </div>
    <div class="clip-fields">
      <label>Start <input aria-label="Clip start seconds" type="number" min="0" max={options.race.duration} step=".1" bind:value={start} disabled={recording}/><span>s</span></label>
      <button disabled={recording} onclick={()=>start=Math.min(time,Math.max(0,end-.1))}>Start here</button>
      <label>End <input aria-label="Clip end seconds" type="number" min="0" max={options.race.duration} step=".1" bind:value={end} disabled={recording}/><span>s</span></label>
      <button disabled={recording} onclick={()=>end=Math.max(time,Math.min(options.race.duration,start+.1))}>End here</button>
      <label>Rate <select aria-label="Clip playback rate" bind:value={rate} disabled={recording}><option value={.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
      <label>Size <input aria-label="Clip width pixels" type="number" min={CLIP_SIZE_MIN} max={CLIP_SIZE_MAX} step="2" bind:value={outWidth} disabled={recording}/><span>×</span><input aria-label="Clip height pixels" type="number" min={CLIP_SIZE_MIN} max={CLIP_SIZE_MAX} step="2" bind:value={outHeight} disabled={recording}/></label>
      <button disabled={recording} onclick={()=>applySize(1920,1080)}>1080p</button>
      <button disabled={recording} onclick={()=>applySize(1280,720)}>720p</button>
      <button disabled={recording} onclick={()=>applySize(Math.max(2,liveWidth & ~1),Math.max(2,liveHeight & ~1))}>Match viewer</button>
      {#if recording}<button onclick={()=>controller?.abort()}>Cancel recording</button><span class="progress" role="status">{Math.round(progress*100)}%</span>{:else}<button class="accent-button" disabled={!supported||!sizeOk||end<=start||start<0||end>options.race.duration} onclick={record}>Record MP4</button>{/if}
    </div>
    {#if !supported}<p>This browser cannot encode canvas MP4. Open the viewer in current Chrome or Edge.</p>{/if}
    {#if !sizeOk}<p>Choose an even width and height between {CLIP_SIZE_MIN} and {CLIP_SIZE_MAX}.</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  {:else}
    <div class="clip-heading"><strong>Last clip</strong></div>
  {/if}
  {#if resultUrl}<div class="clip-result"><video src={resultUrl} controls playsinline muted aria-label="Exported replay clip preview"></video><a class="button" href={resultUrl} download={resultName}>Download MP4</a></div>{/if}
</div>
{/if}
<style>
  .clip-controls{padding:14px 18px;border-top:1px solid var(--border);font-size:var(--font-12)}.clip-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.clip-controls strong{font-size:var(--font-12)}.clip-controls small{display:block;color:var(--muted);font-size:var(--font-11);line-height:1.6;margin-top:3px}.clip-heading .icon-button{flex:none;width:28px;height:28px;padding:0;font-size:var(--font-16);line-height:1}.clip-fields{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.clip-fields label{display:flex;align-items:center;gap:5px;font-size:var(--font-11)}.clip-fields input{width:78px}.clip-fields button{font-size:var(--font-11);padding:7px 9px}.progress{color:var(--accent);min-width:45px;font-variant-numeric:tabular-nums}.clip-controls p{font-size:var(--font-11);color:var(--muted)}.clip-result{display:flex;align-items:flex-end;gap:12px;margin-top:15px}.clip-result video{width:min(640px,75%);border:1px solid var(--border);border-radius:5px}
  .clip-controls.attention{animation:clip-attention .55s ease-in-out 3}
  @keyframes clip-attention{0%,100%{background:transparent;box-shadow:inset 0 0 0 0 transparent}45%{background:color-mix(in srgb,var(--accent) 22%,var(--panel));box-shadow:inset 0 0 0 2px var(--accent)}}
</style>
