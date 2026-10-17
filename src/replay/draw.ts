import { fontPixels, replayTextMetrics } from '../typography';
import type { ReplayOptions, ReplayScene } from './model';
import { estimatedLaneOffset, replayScene } from './model';
import { coursePath, coursePoint } from '../data/reference';
import { runnerColors } from '../library';
import { portraitImage } from '../data/portraits';
import { replayIcon } from './cards';
export interface ReplayPalette {bg:string;panel:string;track:string;edge:string;text:string;muted:string;accent:string;accentText?:string;border?:string}
export const fallbackPalette:ReplayPalette={bg:'#101610',panel:'#1a2418',track:'#34482a',edge:'#6c795f',text:'#e7eedb',muted:'#9ba793',accent:'#79ca0b',border:'#32383a'};
export function replayPalette():ReplayPalette {
  const styles=getComputedStyle(document.documentElement),get=(name:string,fallback:string)=>styles.getPropertyValue(name).trim()||fallback;
  return {bg:get('--bg',fallbackPalette.bg),panel:get('--panel',fallbackPalette.panel),track:get('--track-fill',fallbackPalette.track),edge:get('--track-edge',fallbackPalette.edge),text:get('--text',fallbackPalette.text),muted:get('--muted',fallbackPalette.muted),accent:get('--accent',fallbackPalette.accent),accentText:get('--accent-text',fallbackPalette.accent),border:get('--border',fallbackPalette.border??'#32383a')};
}
function route(ctx:CanvasRenderingContext2D,scene:ReplayScene){ctx.beginPath();for(const [i,p]of scene.route.entries()){if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}}
function clipRoute(route:ReplayScene['route'],start:number,end:number):{x:number;y:number}[]{
  const points:{x:number;y:number}[]=[];
  const at=(a:ReplayScene['route'][number],b:ReplayScene['route'][number],distance:number)=>{
    const span=b.distance-a.distance||1,t=(distance-a.distance)/span;
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  };
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i];
    if(b.distance<start||a.distance>end)continue;
    const from=Math.max(a.distance,start),to=Math.min(b.distance,end);
    if(to-from<=.001)continue;
    if(!points.length)points.push(at(a,b,from));
    points.push(at(a,b,to));
  }
  return points;
}
function slopeTriangle(ctx:CanvasRenderingContext2D,x:number,y:number,up:boolean){
  const s=7;
  ctx.beginPath();
  if(up){ctx.moveTo(x,y-s);ctx.lineTo(x+s*.86,y+s*.62);ctx.lineTo(x-s*.86,y+s*.62);}
  else{ctx.moveTo(x,y+s);ctx.lineTo(x+s*.86,y-s*.62);ctx.lineTo(x-s*.86,y-s*.62);}
  ctx.closePath();ctx.fill();
}
function shadeGrade(ctx:CanvasRenderingContext2D,scene:ReplayScene,course:ReplayOptions['course']){
  const slopes=course?.slopes??[],route=scene.route;
  if(route.length<2)return;
  ctx.save();ctx.lineCap='butt';ctx.lineJoin='bevel';ctx.miterLimit=2;ctx.lineWidth=scene.trackWidth;
  const atDistance=(distance:number)=>{
    for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];if(b.distance<distance||a.distance>distance)continue;const span=b.distance-a.distance||1,t=(distance-a.distance)/span;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
    return null;
  };
  for(const slope of slopes){
    if(Math.abs(slope.slopePercent)<.05)continue;
    const points=clipRoute(route,slope.start,slope.start+slope.length).filter((point,index,all)=>index===0||Math.hypot(point.x-all[index-1].x,point.y-all[index-1].y)>2);
    if(points.length<2)continue;
    const up=slope.slopePercent>0;
    ctx.strokeStyle=up?'#6d5bd4':'#2f8fbf';ctx.globalAlpha=.5;
    ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.stroke();
    ctx.globalAlpha=1;ctx.fillStyle=up?'#efe8ff':'#e5f6ff';
    const end=slope.start+slope.length;
    for(let distance=slope.start+18;distance<end-18;distance+=28){const point=atDistance(distance);if(point)slopeTriangle(ctx,point.x,point.y,up);}
  }
  ctx.restore();
}
function courseEnds(ctx:CanvasRenderingContext2D,scene:ReplayScene,radius:number,color:string){
  const ends=[...(scene.routeEnds.start?[scene.route[0]]:[]),...(scene.routeEnds.finish?[scene.route.at(-1)!]:[])];
  ctx.fillStyle=color;for(const point of ends){ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fill();}
}
function fittedText(ctx:CanvasRenderingContext2D,text:string,max:number):string {
  if(ctx.measureText(text).width<=max)return text;
  let end=text.length;while(end>0&&ctx.measureText(text.slice(0,end)+'…').width>max)end--;return text.slice(0,end)+'…';
}
function wrappedText(ctx:CanvasRenderingContext2D,text:string,max:number):string[] {
  const lines:string[]=[];let current='';
  for(const word of text.split(' ')){
    const next=current?`${current} ${word}`:word;
    if(current&&ctx.measureText(next).width>max){lines.push(current);current=word;}else current=next;
  }
  if(current)lines.push(current);return lines;
}
interface LabelRect {x:number;y:number;width:number;height:number}
/** Place a course callout on the outer side of the track. Horses stay toward the inner rail, so boxes may cover each other there instead. */
function courseLabelRect(marker:{x:number;y:number;angle:number},labelWidth:number,labelHeight:number,trackHalf:number,outerSign:number):LabelRect {
  const nx=-Math.sin(marker.angle),ny=Math.cos(marker.angle);
  const extent=labelWidth/2*Math.abs(nx)+labelHeight/2*Math.abs(ny),dist=trackHalf+22+extent;
  return {x:marker.x+nx*outerSign*dist-labelWidth/2,y:marker.y+ny*outerSign*dist-labelHeight/2,width:labelWidth,height:labelHeight};
}
function roundRectPath(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  const radius=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();
}
/** Compact course map matching the live DOM overlay. Only painted for clip encoding. */
function drawMinimap(ctx:CanvasRenderingContext2D,options:ReplayOptions,scene:ReplayScene,palette:ReplayPalette){
  const rect=options.cardObstacles?.[0];if(!options.paintMinimap||!rect)return;
  const {x,y,width,height}=rect,viewW=1000,viewH=440,mapped=options.course&&(options.race.distance===null||options.race.distance===options.course.distance)?options.course:null;
  const d=mapped?coursePath(mapped):'M70,220 L930,220',path=typeof Path2D==='function'?new Path2D(d):null;
  const scale=Math.min(width/viewW,height/viewH);
  ctx.save();
  roundRectPath(ctx,x,y,width,height,8);ctx.fillStyle=palette.panel;ctx.globalAlpha=.82;ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=palette.border??palette.muted;ctx.lineWidth=1;ctx.stroke();ctx.clip();
  ctx.translate(x+(width-viewW*scale)/2,y+(height-viewH*scale)/2);ctx.scale(scale,scale);
  ctx.lineJoin='round';ctx.lineCap='round';
  if(path){ctx.strokeStyle=palette.edge;ctx.lineWidth=38;ctx.stroke(path);ctx.strokeStyle=palette.muted;ctx.globalAlpha=.65;ctx.lineWidth=24;ctx.stroke(path);ctx.globalAlpha=1;}
  ctx.font='600 38px system-ui,sans-serif';ctx.fillStyle=palette.text;ctx.textAlign='center';
  if(mapped){
    const start=coursePoint(mapped,0),finish=coursePoint(mapped,mapped.distance);
    ctx.fillText('S',Math.max(75,Math.min(925,start.x)),Math.max(45,Math.min(395,start.y-48)));
    ctx.strokeStyle=palette.text;ctx.lineWidth=4;ctx.setLineDash([5,4]);ctx.beginPath();
    ctx.moveTo(finish.x-Math.sin(finish.angle)*34,finish.y+Math.cos(finish.angle)*34);
    ctx.lineTo(finish.x+Math.sin(finish.angle)*34,finish.y-Math.cos(finish.angle)*34);ctx.stroke();ctx.setLineDash([]);
    ctx.fillText('F',Math.max(75,Math.min(925,finish.x)),Math.max(45,Math.min(410,finish.y+62)));
  }else{
    const extent=options.race.distance||1;ctx.fillText('0 m',70,335);ctx.fillText(`${Math.round(extent)} m`,855,335);
  }
  for(const marker of scene.markers){
    const distance=marker.sample.distance;if(distance===null||!Number.isFinite(distance))continue;
    const point=mapped?coursePoint(mapped,distance,estimatedLaneOffset(options.race,marker.sample.lane,48)):{x:70+Math.max(0,Math.min(1,distance/(options.race.distance||1)))*860,y:220+estimatedLaneOffset(options.race,marker.sample.lane,48)};
    const focus=marker.runner.id===options.selected,radius=focus?17:13;
    ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fillStyle=runnerColors[marker.runner.index%runnerColors.length];ctx.fill();
    ctx.lineWidth=focus?3:2;ctx.strokeStyle=focus?palette.text:palette.panel;ctx.stroke();
  }
  ctx.restore();
}
/** Viewer and exported video share this exact draw function. */
export function drawReplay(ctx:CanvasRenderingContext2D,options:ReplayOptions,time:number,width:number,height:number,palette:ReplayPalette=fallbackPalette):ReplayScene {
  const scene=replayScene(options,time,width,height),text=replayTextMetrics(options.fontScale);
  const font=(size:number,bold=false)=>`${bold?'bold ':''}${fontPixels(size,options.fontScale)}px system-ui,sans-serif`;
  ctx.clearRect(0,0,width,height);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,width,height);
  const headingY=Math.max(26,fontPixels(13,options.fontScale)+8);
  ctx.font=font(13);
  const heading=[options.race.synthetic?'SYNTHETIC':null,scene.geometry==='Game-extracted course curve'?null:scene.geometry].filter(Boolean).join(' · ');
  if(heading){ctx.fillStyle=palette.text;ctx.fillText(fittedText(ctx,heading,width*.42),20,headingY);}
  ctx.textAlign='right';ctx.fillStyle=palette.accentText??palette.accent;ctx.fillText(fittedText(ctx,`${scene.phase} · ${scene.distance.toFixed(1)} m · ${time.toFixed(2)} s`,width*.5),width-20,headingY);ctx.textAlign='left';
  route(ctx,scene);ctx.strokeStyle=palette.edge;ctx.lineWidth=scene.trackWidth+8;ctx.lineCap='butt';ctx.lineJoin='round';ctx.stroke();courseEnds(ctx,scene,(scene.trackWidth+8)/2,palette.edge);
  route(ctx,scene);ctx.strokeStyle=palette.track;ctx.lineWidth=scene.trackWidth;ctx.stroke();courseEnds(ctx,scene,scene.trackWidth/2,palette.track);
  shadeGrade(ctx,scene,options.course);
  for(const tick of scene.distanceTicks){
    const nx=-Math.sin(tick.angle),ny=Math.cos(tick.angle),half=scene.trackWidth/2;
    ctx.beginPath();ctx.moveTo(tick.x-nx*half,tick.y-ny*half);ctx.lineTo(tick.x+nx*(half+(tick.major?8:4)),tick.y+ny*(half+(tick.major?8:4)));
    ctx.strokeStyle=palette.muted;ctx.lineWidth=tick.major?1:0.6;ctx.globalAlpha=tick.major?0.75:0.4;ctx.stroke();ctx.globalAlpha=1;
    if(tick.major||options.window<=100){ctx.fillStyle=palette.muted;ctx.font=font(11);ctx.textAlign='center';ctx.fillText(`${tick.distance} m`,tick.x+nx*(half+23),tick.y+ny*(half+23)+4);ctx.textAlign='left';}
  }
  const ordered=[...scene.markers].sort((a,b)=>Number(b.runner.id===options.selected)-Number(a.runner.id===options.selected));
  for(const vision of scene.vision){
    ctx.fillStyle=palette.accent;ctx.globalAlpha=.13;ctx.beginPath();
    for(const [i,p]of vision.polygon.entries()){if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}ctx.closePath();ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle=palette.muted;ctx.lineWidth=2;ctx.setLineDash([4,5]);ctx.beginPath();
    for(const [i,p]of vision.polygon.entries()){if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}ctx.closePath();ctx.stroke();ctx.setLineDash([]);
    for(const candidate of scene.markers.filter(m=>vision.candidateRunnerIds.includes(m.runner.id))){ctx.beginPath();ctx.arc(candidate.x,candidate.y,27,0,Math.PI*2);ctx.setLineDash([2,4]);ctx.lineWidth=1;ctx.stroke();ctx.setLineDash([]);}
    const end=vision.route.at(-1)!;
    ctx.font=font(11);ctx.fillStyle=palette.muted;ctx.fillText(vision.label,end.x+10,end.y-10);
  }
  for(const debuff of scene.debuffs){
    ctx.lineWidth=2.4;
    for(const target of debuff.targets){
      const gradient=ctx.createLinearGradient(debuff.source.x,debuff.source.y,target.x,target.y);
      gradient.addColorStop(0,'#7a1420');gradient.addColorStop(1,'#e23d45');
      ctx.strokeStyle=gradient;ctx.beginPath();ctx.moveTo(debuff.source.x,debuff.source.y);ctx.lineTo(target.x,target.y);ctx.stroke();
      ctx.strokeStyle='#e23d45';ctx.beginPath();ctx.arc(target.x,target.y,29,0,Math.PI*2);ctx.stroke();
    }
    ctx.strokeStyle='#7a1420';ctx.setLineDash(debuff.recipientsKnown?[]:[3,4]);ctx.beginPath();ctx.arc(debuff.source.x,debuff.source.y,31,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  }
  for(const marker of scene.courseMarkers){
    const nx=-Math.sin(marker.angle),ny=Math.cos(marker.angle),half=scene.trackWidth/2+12;
    ctx.beginPath();ctx.moveTo(marker.x-nx*half,marker.y-ny*half);ctx.lineTo(marker.x+nx*half,marker.y+ny*half);
    ctx.strokeStyle=palette.accent;ctx.lineWidth=1.4;ctx.stroke();
    ctx.font=font(15);const texts=wrappedText(ctx,`${marker.label} · ${Number(marker.distance.toFixed(1))} m`,240);
    const labelWidth=Math.max(...texts.map(s=>ctx.measureText(s).width))+18,labelHeight=texts.length*(fontPixels(15,options.fontScale)+7)+16;
    const rect=courseLabelRect(marker,labelWidth,labelHeight,scene.trackWidth/2,options.course?.turn===1?-1:1);
    ctx.fillStyle=palette.panel;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
    ctx.strokeStyle=palette.accent;ctx.lineWidth=1.2;ctx.strokeRect(rect.x,rect.y,rect.width,rect.height);
    const trackX=marker.x-nx*half,trackY=marker.y-ny*half,cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
    const edgeX=Math.abs(trackX-cx)>Math.abs(trackY-cy)?(trackX>cx?rect.x+rect.width:rect.x):cx;
    const edgeY=Math.abs(trackX-cx)>Math.abs(trackY-cy)?cy:(trackY>cy?rect.y+rect.height:rect.y);
    ctx.beginPath();ctx.moveTo(trackX,trackY);ctx.lineTo(edgeX,edgeY);ctx.stroke();
    ctx.fillStyle=palette.accentText??palette.accent;for(const [i,text]of texts.entries())ctx.fillText(text,rect.x+9,rect.y+8+fontPixels(15,options.fontScale)+i*(fontPixels(15,options.fontScale)+7));
  }
  if(options.labels)for(const group of scene.cardGroups){
    const marker=scene.markers.find(m=>m.runner.id===group.runnerId)!;
    const endX=Math.max(group.x,Math.min(group.x+group.width,marker.x)),endY=Math.max(group.y,Math.min(group.y+group.height,marker.y));
    ctx.globalAlpha=group.alpha*.65;ctx.strokeStyle=runnerColors[marker.runner.index%runnerColors.length];ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(marker.x,marker.y);ctx.lineTo(endX,endY);ctx.stroke();
    ctx.globalAlpha=1;
  }
  const drawGroup=(group:ReplayScene['cardGroups'][number])=>{
    ctx.globalAlpha=group.alpha;ctx.fillStyle=palette.panel;ctx.fillRect(group.x,group.y,group.width,group.height);
    ctx.strokeStyle=palette.edge;ctx.lineWidth=.7;ctx.strokeRect(group.x,group.y,group.width,group.height);
    ctx.globalAlpha=1;
    for(const rect of scene.cardRects.filter(r=>r.runnerId===group.runnerId)){
      const {card,x,y,width:cardWidth,height:cardHeight}=rect;
      ctx.globalAlpha=card.alpha;ctx.fillStyle=palette.panel;ctx.fillRect(x,y,cardWidth,cardHeight);
      ctx.fillStyle=card.color;ctx.fillRect(x,y,3,cardHeight);
      const icon=replayIcon(card.iconKey);
      if(icon)ctx.drawImage(icon,x+5,y+(cardHeight-18)/2,18,18);
      else{ctx.fillStyle=card.color;ctx.fillRect(x+6,y+(cardHeight-14)/2,14,14);}
      ctx.fillStyle=palette.text;ctx.font=font(11);
      ctx.fillText(fittedText(ctx,card.label,cardWidth-30),x+27,y+(cardHeight+text.font)/2-3);
      // Solid bar = resolved duration; dotted edge = visual dwell/unknown duration.
      if(card.progress!==null&&!card.visualOnly){ctx.fillStyle=card.color;ctx.fillRect(x+3,y+cardHeight-2,(cardWidth-3)*card.progress,2);}
      else{ctx.strokeStyle=card.color;ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x+3,y+cardHeight-1);ctx.lineTo(x+cardWidth,y+cardHeight-1);ctx.stroke();ctx.setLineDash([]);}
      ctx.globalAlpha=1;
    }
    const marker=scene.markers.find(m=>m.runner.id===group.runnerId)!;
    ctx.globalAlpha=group.alpha;ctx.fillStyle=runnerColors[marker.runner.index%runnerColors.length];ctx.fillRect(group.x,group.y,group.width,text.headerHeight);
    ctx.font=font(11);ctx.fillStyle='#101610';
    ctx.fillText(fittedText(ctx,group.header,group.width-12),group.x+6,group.y+text.font+2);
    ctx.globalAlpha=1;
  };
  if(options.labels)for(const group of scene.cardGroups)if(group.runnerId!==options.selected)drawGroup(group);
  // Draw selected last so a tightly grouped field cannot hide its focus ring.
  for(const marker of [...ordered].reverse()){
    const focus=marker.runner.id===options.selected,color=runnerColors[marker.runner.index%runnerColors.length];
    const radius=focus?24:20,image=portraitImage(marker.runner);
    ctx.save();ctx.beginPath();ctx.arc(marker.x,marker.y,radius,0,Math.PI*2);ctx.clip();
    ctx.fillStyle=palette.panel;ctx.fillRect(marker.x-radius,marker.y-radius,radius*2,radius*2);
    if(image)ctx.drawImage(image,marker.x-radius,marker.y-radius,radius*2,radius*2);
    else{ctx.fillStyle=palette.text;ctx.font=font(15,true);ctx.textAlign='center';ctx.fillText(marker.name.charAt(0)||'?',marker.x,marker.y+5);}
    ctx.restore();ctx.beginPath();ctx.arc(marker.x,marker.y,radius,0,Math.PI*2);ctx.lineWidth=focus?3:2;ctx.strokeStyle=color;ctx.stroke();
    if(focus){ctx.beginPath();ctx.arc(marker.x,marker.y,radius+4,0,Math.PI*2);ctx.lineWidth=1.5;ctx.strokeStyle=palette.accent;ctx.stroke();}
    if(options.labels&&focus&&!marker.cards.length){ctx.font=font(11);ctx.fillStyle=palette.text;ctx.textAlign='center';ctx.fillText(fittedText(ctx,marker.name,150),marker.x,marker.y+34);ctx.textAlign='left';}
  }
  if(options.elevation&&scene.elevation.length){
    let min=0,max=0,current=scene.elevation[0].height;for(const p of scene.elevation){min=Math.min(min,p.height);max=Math.max(max,p.height);if(p.distance<=scene.distance)current=p.height;}
    const span=Math.max(.1,max-min);
    const plotX=(distance:number)=>24+(distance-scene.from)/Math.max(1,scene.to-scene.from)*(width-48);
    const plotY=(heightValue:number)=>height-43-(heightValue-min)/span*27;
    ctx.fillStyle=palette.panel;ctx.globalAlpha=.6;ctx.fillRect(16,height-86,width-32,54);ctx.globalAlpha=1;
    ctx.beginPath();ctx.moveTo(24,plotY(0));ctx.lineTo(width-24,plotY(0));ctx.strokeStyle=palette.muted;ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();for(const [i,p]of scene.elevation.entries()){const x=plotX(p.distance),y=plotY(p.height);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}
    ctx.strokeStyle=palette.accent;ctx.lineWidth=1.5;ctx.stroke();ctx.font=font(11);ctx.fillStyle=palette.muted;ctx.fillText(`Current elevation · ${current.toFixed(2)} m`,24,height-72);
  }
  // The complete selected stack stays above other labels and portraits.
  if(options.labels){const selectedGroup=scene.cardGroups.find(g=>g.runnerId===options.selected);if(selectedGroup)drawGroup(selectedGroup);}
  drawMinimap(ctx,options,scene,palette);
  return scene;
}
