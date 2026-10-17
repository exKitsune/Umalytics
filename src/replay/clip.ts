import { replayMinimapObstacle, type ReplayOptions } from './model';
import { drawReplay, type ReplayPalette } from './draw';
import { preloadPortraits } from '../data/portraits';
import { preloadReplayIcons } from './cards';
const CLIP_TYPES=['video/mp4;codecs=avc1.4D4028','video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.4D002A','video/mp4'];
export function supportedClipType():string|null {
  if(typeof MediaRecorder==='undefined'||typeof HTMLCanvasElement==='undefined'||!HTMLCanvasElement.prototype.captureStream)return null;
  return CLIP_TYPES.find(type=>MediaRecorder.isTypeSupported(type))??null;
}
export function clipExtension(mimeType:string):string {return mimeType.includes('mp4')?'mp4':'webm';}
function attachOffscreenCanvas(width:number,height:number){
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'fixed',left:'-10000px',top:'0',width:`${width}px`,height:`${height}px`,pointerEvents:'none',opacity:'0'});
  document.body.appendChild(canvas);
  return canvas;
}
/** Encode onto a hidden canvas. No microphone, audio or screen-capture permission. */
export async function recordReplayClip(size:{width:number;height:number},options:ReplayOptions,palette:ReplayPalette,start:number,end:number,speed:number,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<Blob> {
  const width=Math.max(2,size.width & ~1),height=Math.max(2,size.height & ~1);
  options={...options,paintMinimap:true,cardObstacles:options.cardObstacles?.length?[replayMinimapObstacle(width)]:[]};
  const mimeType=supportedClipType();if(!mimeType)throw new Error('This browser does not support canvas MP4 recording. Try a current Chrome or Edge browser.');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>options.race.duration||end<=start)throw new Error('Choose a clip end after its start, within the recorded race.');
  if(!Number.isFinite(speed)||speed<=0)throw new Error('Choose a valid clip playback rate.');
  if(signal.aborted)throw new DOMException('Clip export cancelled.','AbortError');
  await Promise.all([preloadPortraits(options.race.runners),preloadReplayIcons(options)]);
  if(signal.aborted)throw new DOMException('Clip export cancelled.','AbortError');
  const canvas=attachOffscreenCanvas(width,height);
  const context=canvas.getContext('2d',{alpha:false});if(!context){canvas.remove();throw new Error('Canvas recording is unavailable.');}
  const stream=canvas.captureStream(30);let recorder:MediaRecorder;
  const bitrate=Math.min(20000000,Math.max(5000000,Math.round(width*height*6)));
  try{recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:bitrate});}catch(e){for(const track of stream.getTracks())track.stop();canvas.remove();throw e;}
  const chunks:BlobPart[]=[];let frame=0,flush=0,failure:Error|null=null;
  return new Promise<Blob>((resolve,reject)=>{
    const finish=()=>{cancelAnimationFrame(frame);clearTimeout(flush);for(const track of stream.getTracks())track.stop();canvas.remove();signal.removeEventListener('abort',abort);};
    const abort=()=>{cancelAnimationFrame(frame);clearTimeout(flush);if(recorder.state!=='inactive')recorder.stop();};
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=()=>{finish();reject(new Error('The browser video encoder failed.'));};
    recorder.onstop=()=>{finish();if(failure){reject(failure);return;}if(signal.aborted){reject(new DOMException('Clip export cancelled.','AbortError'));return;}const blob=new Blob(chunks,{type:clipExtension(mimeType)==='mp4'?'video/mp4':mimeType});if(!blob.size){reject(new Error(`The video encoder returned an empty ${width}×${height} clip.`));return;}onProgress(1);resolve(blob);};
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){finish();reject(new DOMException('Clip export cancelled.','AbortError'));return;}
    try{recorder.start(250);}catch(e){finish();reject(e);return;}
    const began=performance.now(),rate=Math.max(.25,Math.min(4,speed));
    const tick=(now:number)=>{
      if(signal.aborted||recorder.state!=='recording')return;
      const time=Math.min(end,start+(now-began)/1000*rate);
      try{drawReplay(context,options,time,width,height,palette);onProgress((time-start)/(end-start));}catch(e){failure=e instanceof Error?e:new Error(String(e));recorder.stop();return;}
      if(time>=end){try{recorder.requestData();}catch{/* older recorders */}flush=window.setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},250);return;}
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
  });
}
