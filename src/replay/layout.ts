import { replayTextMetrics } from '../typography';
import type { ReplayScene } from './model';
type Rect={x:number;y:number;width:number;height:number};
type Marker=ReplayScene['markers'][number];
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export interface LayoutSeed {offsets:Map<string,{x:number;y:number}>;iterations?:number}
interface Box extends Rect {marker:Marker;alpha:number;anchorX:number;anchorY:number}

/** Close views favor proximity; wide views use the canvas to separate stacks.
 * Horizontal order follows current owners, so boxes can exchange places. */
export function placeReplayCards(markers:ReplayScene['markers'],width:number,height:number,obstacles:Rect[]=[],seed?:LayoutSeed,fontScale=100,viewWindow=140):Pick<ReplayScene,'cardRects'|'cardGroups'> {
  const text=replayTextMetrics(fontScale),header=text.headerInset+2;
  const spread=clamp((viewWindow-140)/15,0,1);
  const bottom=height-104,capacity=Math.max(1,Math.floor((bottom-36-header)/text.rowStride));
  const boxes:Box[]=markers.filter(m=>m.cards.length).map(marker=>{
    const count=marker.cards.reduce((n,c)=>n+c.alpha,0),rows=Math.min(capacity,Math.max(.15,count));
    let boxWidth=text.groupWidth;for(let start=capacity;start<count;start+=capacity)boxWidth+=text.columnStride*Math.min(1,count-start);
    boxWidth=Math.min(width-16,boxWidth);
    const boxHeight=header+rows*text.rowStride,anchorY=marker.y+(marker.cardSide==='above'?-34-boxHeight:34);
    const overflow=marker.cardSide==='above'?36-anchorY:anchorY+boxHeight-bottom;
    const anchorX=marker.x+(marker.x>width/2?-1:1)*(boxWidth/2+34)*clamp(overflow/40,0,1);
    const prior=seed?.offsets.get(marker.runner.id);
    return {marker,width:boxWidth,height:boxHeight,x:prior?marker.x+prior.x:anchorX,y:prior?anchorY+prior.y:anchorY,anchorX,anchorY,alpha:Math.max(...marker.cards.map(c=>c.alpha))};
  });
  if(spread>0)for(const side of ['above','below']){
    const row=boxes.filter(b=>b.marker.cardSide===side).sort((a,b)=>a.marker.x-b.marker.x||a.marker.runner.index-b.marker.runner.index);
    if(row.length<2)continue;
    const left=8+row[0].width/2,right=width-8-row.at(-1)!.width/2;
    for(const [i,b]of row.entries()){
      b.anchorX+=(left+(right-left)*i/(row.length-1)-b.anchorX)*spread;
      if(!seed?.offsets.has(b.marker.runner.id))b.x=b.anchorX;
    }
  }
  const bound=(b:Box)=>{
    const reach=140+width*spread,vertical=height*spread;
    b.x=clamp(b.x,b.marker.x-reach,b.marker.x+reach);b.y=clamp(b.y,b.anchorY-(b.marker.cardSide==='above'&&!b.marker.focused?110:90)-vertical,b.anchorY+90+vertical);
    b.x=clamp(b.x,8+b.width/2,width-8-b.width/2);b.y=clamp(b.y,36,bottom-b.height);
  };
  const push=(a:Box,r:Rect,weight:number,tie:number)=>{
    const dx=a.x-(r.x+r.width/2),dy=a.y+a.height/2-(r.y+r.height/2);
    const px=(a.width+r.width)/2+6-Math.abs(dx),py=(a.height+r.height)/2+6-Math.abs(dy);
    if(px<=0||py<=0)return{x:0,y:0};
    const wx=1/(1+Math.exp(clamp((px-py)/12,-25,25))),wy=1-wx;
    return{x:px*wx*dx/Math.sqrt(dx*dx+16)*weight,y:py*wy*(Math.abs(dy)<.1?tie:dy/Math.sqrt(dy*dy+1))*weight};
  };
  for(let pass=0;pass<(seed?.iterations??24+Math.round(24*spread));pass++){
    const pull=.04*(1-.85*spread);
    const delta=boxes.map(b=>({x:(b.anchorX-b.x)*pull,y:(b.anchorY-b.y)*pull}));
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j],p=push(a,{x:b.x-b.width/2,y:b.y,width:b.width,height:b.height},Math.min(a.alpha,b.alpha)*.75,a.marker.runner.index<b.marker.runner.index?-1:1);
      // Keep a consistent vertical tier when same-side stacks nearly coincide.
      // Otherwise two equally good up/down solutions alternate and smoothing
      // averages them into a complete overlap. Horizontal order stays free.
      if(a.marker.cardSide===b.marker.cardSide){const anchorDy=a.anchorY+a.height/2-b.anchorY-b.height/2;
        const direction=Math.abs(anchorDy)>20?Math.sign(anchorDy):a.marker.runner.index<b.marker.runner.index?-1:1;p.y=Math.abs(p.y)*direction;}
      const aw=a.marker.focused ? .6 : 1,bw=b.marker.focused ? .6 : 1;
      delta[i].x+=p.x*aw;delta[i].y+=p.y*aw;delta[j].x-=p.x*bw;delta[j].y-=p.y*bw;
    }
    for(let i=0;i<boxes.length;i++){
      const b=boxes[i];
      for(const m of markers){const p=push(b,{x:m.x-28,y:m.y-28,width:56,height:56},.8,b.marker.cardSide==='above'?-1:1);delta[i].x+=p.x;delta[i].y+=p.y;}
      for(const r of obstacles){const p=push(b,r,1.2,1);delta[i].x+=p.x;delta[i].y+=p.y;}
      b.x+=clamp(delta[i].x,-14,14);b.y+=clamp(delta[i].y,-14,14);bound(b);
    }
  }
  const cardGroups:ReplayScene['cardGroups']=[],cardRects:ReplayScene['cardRects']=[];
  // This is also the paint/hit-test order: the selected stack is last.
  boxes.sort((a,b)=>Number(a.marker.focused)-Number(b.marker.focused));
  for(const b of boxes){
    bound(b);const x=b.x-b.width/2,y=b.y;
    cardGroups.push({runnerId:b.marker.runner.id,header:`#${b.marker.runner.gate??b.marker.runner.index+1} ${b.marker.name}`,x,y,width:b.width,height:b.height,alpha:b.alpha,side:b.marker.cardSide});
    const point=(n:number)=>{const column=Math.floor(n/capacity),row=n%capacity;return{x:column*text.columnStride,y:(column%2?capacity-1-row:row)*text.rowStride};};
    let slot=0;
    for(const card of b.marker.cards){
      const index=Math.floor(slot),f=slot-index,a=point(index),c=point(index+1);
      cardRects.push({runnerId:b.marker.runner.id,card,x:clamp(x+4+a.x+(c.x-a.x)*f,8,width-text.rowWidth-8),y:clamp(y+text.headerInset+a.y+(c.y-a.y)*f,36+text.headerInset,bottom-text.rowHeight),width:text.rowWidth,height:text.rowHeight,side:b.marker.cardSide});slot+=card.alpha;
    }
  }
  return {cardGroups,cardRects};
}
