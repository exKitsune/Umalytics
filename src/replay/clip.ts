import type { ReplayOptions } from './model';
import { drawReplay, type ReplayPalette } from './draw';
import { preloadPortraits } from '../data/portraits';
import { preloadReplayIcons } from './cards';
export function supportedClipType():string|null {
  if(typeof MediaRecorder==='undefined'||typeof HTMLCanvasElement==='undefined'||!HTMLCanvasElement.prototype.captureStream)return null;
  return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type))??null;
}
/** Encode the canvas directly. No microphone, audio or screen-capture permission. */
export async function recordReplayClip(canvas:HTMLCanvasElement,options:ReplayOptions,palette:ReplayPalette,start:number,end:number,speed:number,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<Blob> {
  // The DOM minimap is absent from the encoded canvas.
  options={...options,cardObstacles:[]};
  const mimeType=supportedClipType();if(!mimeType)throw new Error('This browser does not support canvas WebM recording. Try a current Chrome or Edge browser.');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>options.race.duration||end<=start)throw new Error('Choose a clip end after its start, within the recorded race.');
  if(!Number.isFinite(speed)||speed<=0)throw new Error('Choose a valid clip playback rate.');
  if(signal.aborted)throw new DOMException('Clip export cancelled.','AbortError');
  await Promise.all([preloadPortraits(options.race.runners),preloadReplayIcons(options)]);
  if(signal.aborted)throw new DOMException('Clip export cancelled.','AbortError');
  const context=canvas.getContext('2d');if(!context)throw new Error('Canvas recording is unavailable.');
  drawReplay(context,options,start,canvas.width,canvas.height,palette);
  const stream=canvas.captureStream(30);let recorder:MediaRecorder;
  try{recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:5000000});}catch(e){for(const track of stream.getTracks())track.stop();throw e;}
  const chunks:BlobPart[]=[];let frame=0,failure:Error|null=null;
  return new Promise<Blob>((resolve,reject)=>{
    const finish=()=>{cancelAnimationFrame(frame);for(const track of stream.getTracks())track.stop();signal.removeEventListener('abort',abort);};
    const abort=()=>{cancelAnimationFrame(frame);if(recorder.state!=='inactive')recorder.stop();};
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=()=>{finish();reject(new Error('The browser video encoder failed.'));};
    recorder.onstop=()=>{finish();if(failure){reject(failure);return;}if(signal.aborted){reject(new DOMException('Clip export cancelled.','AbortError'));return;}const blob=new Blob(chunks,{type:mimeType});if(!blob.size){reject(new Error('The video encoder returned an empty clip.'));return;}onProgress(1);resolve(blob);};
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){finish();reject(new DOMException('Clip export cancelled.','AbortError'));return;}
    try{recorder.start(250);}catch(e){finish();reject(e);return;}
    const began=performance.now(),rate=Math.max(.25,Math.min(4,speed));
    const tick=(now:number)=>{
      if(signal.aborted||recorder.state!=='recording')return;
      const time=Math.min(end,start+(now-began)/1000*rate);
      try{drawReplay(context,options,time,canvas.width,canvas.height,palette);onProgress((time-start)/(end-start));}catch(e){failure=e instanceof Error?e:new Error(String(e));recorder.stop();return;}
      if(time>=end){recorder.stop();return;}frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
  });
}
