import {createWorker,PSM,type Worker,type Page} from 'tesseract.js';
import {findSkillCards,findDetailRegions,textPixels,gradeColor,iconSignature,matchIcon,type Box} from './layout';
import {iconSource} from '../data/game-icons';
import type {ReferenceData} from '../data/reference';
import {normalizeText,statKeys,type OcrLine,type ScreenshotReading} from './recognition';
export interface Screenshot {id:string;name:string;url:string;width:number;height:number}
export const screenshotLimit=24;
export async function screenshotFile(file:File):Promise<Screenshot>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose PNG, JPEG or WebP screenshots.');
  if(file.size>12*1024*1024)throw new Error('Each screenshot must be under 12 MB.');
  const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read screenshot.'));reader.readAsDataURL(file);});
  const image=await loadImage(url);if(image.naturalWidth*image.naturalHeight>24_000_000||Math.max(image.naturalWidth,image.naturalHeight)>12000)throw new Error('Screenshot is too large (maximum 24 megapixels).');
  const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return {id:Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join(''),name:file.name||'Pasted screenshot',url,width:image.naturalWidth,height:image.naturalHeight};
}
function loadImage(url:string):Promise<HTMLImageElement>{return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not decode screenshot.'));image.src=url;});}
function canvas(width:number,height:number){const value=document.createElement('canvas');value.width=width;value.height=height;const ctx=value.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas is unavailable.');return {canvas:value,ctx};}
function detailMask(source:HTMLCanvasElement,regions:(Box|undefined)[]){
  const result=canvas(source.width,source.height);result.ctx.fillStyle='#fff';result.ctx.fillRect(0,0,source.width,source.height);
  for(const [i,b] of regions.entries())if(b&&b.height>0){result.ctx.drawImage(source,b.x,b.y,b.width,b.height,b.x,b.y,b.width,b.height);
    if(i===0){const pixels=result.ctx.getImageData(b.x,b.y,b.width,b.height);pixels.data.set(textPixels(pixels));result.ctx.putImageData(pixels,b.x,b.y);}}
  return result.canvas;
}
function sheet(source:HTMLCanvasElement,boxes:Box[]){const result=canvas(900,Math.max(1,boxes.length)*190);result.ctx.fillStyle='#fff';result.ctx.fillRect(0,0,900,result.canvas.height);
  for(const [i,b] of boxes.entries()){const crop=canvas(Math.max(1,Math.round(b.width)),Math.max(1,Math.round(b.height)));crop.ctx.drawImage(source,b.x,b.y,b.width,b.height,0,0,crop.canvas.width,crop.canvas.height);
    const pixels=crop.ctx.getImageData(0,0,crop.canvas.width,crop.canvas.height);pixels.data.set(textPixels(pixels));crop.ctx.putImageData(pixels,0,0);
    const scale=Math.min(2,860/crop.canvas.width,150/crop.canvas.height);result.ctx.drawImage(crop.canvas,20,i*190+20,Math.round(crop.canvas.width*scale),Math.round(crop.canvas.height*scale));}
  return result.canvas;
}
function lines(data:Page):OcrLine[]{return (data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines)).map(l=>({text:l.text.trim(),confidence:l.confidence,bbox:l.bbox,words:l.words.map(w=>({text:w.text,confidence:w.confidence,bbox:w.bbox}))}));}
function abortable<T>(job:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});job.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
function readAptitudes(source:HTMLCanvasElement,header:OcrLine[],cells:Box[]):Record<string,string>{
  if(!cells.length)return {};const words=header.flatMap(l=>l.words),cw=cells[0].width/.57,left=cells[0].x-cw*.39,ctx=source.getContext('2d',{willReadFrequently:true})!,result:Record<string,string>={};
  for(const group of [['Turf','Dirt'],['Sprint','Mile','Medium','Long'],['Front','Pace','Late','End']]){
    const labels=words.filter(w=>group.map(normalizeText).includes(normalizeText(w.text)));if(!labels.length)continue;
    const ys=labels.map(w=>(w.bbox.y0+w.bbox.y1)/2).sort((a,b)=>a-b),y=ys[Math.floor(ys.length/2)];
    for(const [i,key] of group.entries()){const x=Math.round(left+cw*(1.825+.95*i)-cw*.105),top=Math.round(y-cw*.12),w=Math.round(cw*.21),h=Math.round(cw*.24);
      if(x<0||top<0||x+w>source.width||top+h>source.height)continue;
      const value=gradeColor(ctx.getImageData(x,top,w,h));if(value)result[key]=value;}
  }
  return result;
}
export async function recognizeScreenshots(images:Screenshot[],reference:ReferenceData,signal:AbortSignal,progress:(fraction:number,message:string)=>void):Promise<ScreenshotReading[]>{
  if(!images.length||images.length>screenshotLimit)throw new Error(`Choose 1–${screenshotLimit} screenshots.`);
  let worker:Worker|undefined;const stop=()=>{void worker?.terminate();};signal.addEventListener('abort',stop,{once:true});
  try{
    progress(0,'Starting local OCR');const root=new URL('ocr/',document.baseURI).href;
    worker=await createWorker('eng',1,{workerPath:root+'worker.min.js',corePath:root,langPath:root,workerBlobURL:false,cacheMethod:'none'});
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    const templates:{id:number;signature:number[]}[]=[];
    for(const id of new Set(Object.values(reference.metadata.skills).map(s=>s.iconId).filter((id):id is number=>id!==undefined))){const url=iconSource(`skill-${id}`);if(!url)continue;const image=await loadImage(url),buffer=canvas(image.naturalWidth,image.naturalHeight);buffer.ctx.drawImage(image,0,0);templates.push({id,signature:iconSignature(buffer.ctx.getImageData(0,0,buffer.canvas.width,buffer.canvas.height))});}
    const results:ScreenshotReading[]=[];
    for(const [i,image] of images.entries()){
      const source=await loadImage(image.url),scale=Math.min(1,1400/source.naturalWidth,Math.sqrt(6_000_000/(source.naturalWidth*source.naturalHeight))),picture=canvas(Math.round(source.naturalWidth*scale),Math.round(source.naturalHeight*scale));
      picture.ctx.drawImage(source,0,0,picture.canvas.width,picture.canvas.height);const pixels=picture.ctx.getImageData(0,0,picture.canvas.width,picture.canvas.height),cards=findSkillCards(pixels),regions=findDetailRegions(pixels),cells=regions.stats;
      const result:ScreenshotReading={image:i,lines:[],skills:[],stats:{},aptitudes:{}};
      await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:'',user_defined_dpi:'150'});
      if(cells.length){progress((i+.1)/images.length,`Reading Uma details · ${i+1} / ${images.length}`);
        result.lines=lines((await abortable(worker.recognize(detailMask(picture.canvas,[regions.identity,regions.aptitudes]),{},{blocks:true}),signal)).data);result.aptitudes=readAptitudes(picture.canvas,result.lines,cells);
        await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:'0123456789'});
        const values=lines((await abortable(worker.recognize(sheet(picture.canvas,cells),{},{blocks:true}),signal)).data);
        for(const line of values){const n=Math.floor((line.bbox.y0+line.bbox.y1)/2/190),value=Number(line.text.replace(/\s/g,''));if(n>=0&&n<5&&line.confidence>=50&&Number.isInteger(value)&&value>=1&&value<=2000)result.stats[statKeys[n]]=value;}
      }
      progress((i+.55)/images.length,`Reading ${cards.length} skill cards · ${i+1} / ${images.length}`);
      if(cards.length){await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''});
        const words=lines((await abortable(worker.recognize(sheet(picture.canvas,cards.map(c=>c.text)),{},{blocks:true}),signal)).data);
        for(let j=0;j<cards.length;j++){const row=words.filter(l=>Math.floor((l.bbox.y0+l.bbox.y1)/2/190)===j).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);const text=row.map(l=>l.text).join(' ').trim(),b=cards[j].icon;
          const iconId=matchIcon(iconSignature(picture.ctx.getImageData(b.x,b.y,b.width,b.height)),templates);
          if(text)result.skills.push({text,confidence:row.reduce((n,l)=>n+l.confidence,0)/row.length,image:i,iconId,nativeUnique:cards[j].rainbow&&/\bLv[l.]?\s*[1-6]\b/i.test(text)});}
      }
      results.push(result);progress((i+1)/images.length,`Read ${i+1} / ${images.length} screenshots`);
    }
    return results;
  }finally{signal.removeEventListener('abort',stop);await worker?.terminate();}
}
