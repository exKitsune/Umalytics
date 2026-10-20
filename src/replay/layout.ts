import { replayTextMetrics } from '../typography';
import type { ReplayScene } from './model';
type Rect={x:number;y:number;width:number;height:number};
type Marker=ReplayScene['markers'][number];
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export interface LayoutSeed {offsets:Map<string,{x:number;y:number}>;iterations?:number}
export interface ReplayTrack {route:readonly {x:number;y:number}[];trackWidth:number;futureRows?:Map<string,number>}
interface Box extends Rect {marker:Marker;alpha:number;anchorX:number;anchorY:number;capacity:number;reserveHeight:number;reserveWidth:number}

/** Envelope of the stroked route beneath the entire card width. Segment
 * quads and circular joins preserve the curved edge at a starting gate or
 * corner; inflating an axis-aligned bounding box creates abrupt dead zones. */
function trackBand(x:number,width:number,track:ReplayTrack){
  const radius=track.trackWidth/2+12,left=x-width/2,right=x+width/2;
  let top=Infinity,bottom=-Infinity;
  const include=(y:number)=>{top=Math.min(top,y);bottom=Math.max(bottom,y);};
  for(const p of track.route){
    const dx=Math.max(left-p.x,0,p.x-right);
    if(dx<=radius){const reach=Math.sqrt(Math.max(0,radius*radius-dx*dx));include(p.y-reach);include(p.y+reach);}
  }
  for(let i=1;i<track.route.length;i++){
    const a=track.route[i-1],b=track.route[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(!length||Math.max(a.x,b.x)+radius<left||Math.min(a.x,b.x)-radius>right)continue;
    const nx=-dy/length*radius,ny=dx/length*radius;
    const points=[{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}];
    for(let j=0;j<4;j++){
      const p=points[j],q=points[(j+1)%4];
      if(p.x>=left&&p.x<=right)include(p.y);
      if(p.x!==q.x)for(const edge of [left,right]){const t=(edge-p.x)/(q.x-p.x);if(t>=0&&t<=1)include(p.y+t*(q.y-p.y));}
    }
  }
  return {top,bottom};
}

/** Hard clearance runs after interpolation as well as initial placement. A
 * smoothed path between two safe layouts must never cut through the track. */
function clearTrack(boxes:Box[],width:number,bottom:number,track:ReplayTrack,obstacles:Rect[],settle=true,viewWindow=140){
  const placed:Box[]=[];
  const bands=new Map<string,ReturnType<typeof trackBand>>();
  const bandAt=(x:number,w:number)=>{const key=x+':'+w;let value=bands.get(key);if(!value){value=trackBand(x,w,track);bands.set(key,value);}return value;};
  const fieldX=boxes.length?(Math.min(...boxes.map(b=>b.marker.x))+Math.max(...boxes.map(b=>b.marker.x)))/2:width/2;
  for(const original of [...boxes].sort((a,b)=>Number(b.marker.focused)-Number(a.marker.focused)||byGate(a,b))){
    const b={...original,height:original.reserveHeight,width:original.reserveWidth};
    // Use nearly the full width, retaining a broad field tether only at the
    // widest zoom where remote bends create disappearing off-track pockets.
    const left=clamp(viewWindow>300?fieldX-width*.3:8+b.width/2,8+b.width/2,width-8-b.width/2);
    const right=clamp(viewWindow>300?fieldX+width*.3:width-8-b.width/2,left,width-8-b.width/2);
    const xs=new Set([clamp(b.x,left,right),clamp(b.anchorX,left,right),left,right]);
    for(const r of obstacles){xs.add(clamp(r.x-6-b.width/2,left,right));xs.add(clamp(r.x+r.width+6+b.width/2,left,right));}
    for(let x=left;x<right;x+=32)xs.add(x);
    const ranges=(x:number,side:'above'|'below')=>{
      const band=bandAt(x,b.width);
      let spans=side==='above'?[[36,Math.min(bottom-b.height,band.top-b.height)]]:[[Math.max(36,band.bottom),bottom-b.height]];
      for(const r of obstacles){
        if(x+b.width/2+6<=r.x||x-b.width/2-6>=r.x+r.width)continue;
        // Tall stacks cannot travel through the narrow gap below the minimap
        // on bends. Short notifications can use that space normally.
        if(side==='above'&&r.y<bottom*.25&&b.height>r.height)return [];
        const lo=r.y-b.height-6,hi=r.y+r.height+6;
        spans=spans.flatMap(([a,z])=>hi<=a||lo>=z?[[a,z]]:[[a,Math.min(z,lo)],[Math.max(a,hi),z]]);
      }
      return spans.filter(([lo,hi])=>hi>=lo);
    };
    let best:{x:number;y:number;score:number;side:'above'|'below'}|null=null;
    for(const x of xs){
      for(const side of ['above','below'] as const){
        for(const [lo,hi] of ranges(x,side)){
          for(const y of new Set([clamp(b.y,lo,hi),lo,hi])){
            let overlap=0;
            if(settle)for(const other of placed)overlap+=Math.max(0,Math.min(x+b.width/2,other.x+other.width/2)-Math.max(x-b.width/2,other.x-other.width/2))*Math.max(0,Math.min(y+b.height,other.y+other.height)-Math.max(y,other.y));
            const score=(x-b.x)**2*(settle?1:100)+(y-b.y)**2+(side===b.marker.cardSide?0:16000000)+overlap*4;
            if(!best||score<best.score)best={x,y,score,side};
          }
        }
      }
    }
    if(!settle&&best&&best.side===b.marker.cardSide&&!ranges(b.x,best.side).length){
      let invalid=b.x,valid=best.x;
      for(let i=0;i<14;i++){const mid=(invalid+valid)/2;if(ranges(mid,best.side).length)valid=mid;else invalid=mid;}
      best.x=valid;
      best.y=ranges(valid,best.side).map(([lo,hi])=>clamp(b.y,lo,hi)).sort((a,z)=>Math.abs(a-b.y)-Math.abs(z-b.y))[0];
    }
    // Very small export sizes can have no room for a full stack. Keep the
    // track clear even then; the live viewer reserves enough vertical space.
    if(best){b.x=best.x;b.y=best.y;}
    else{const band=trackBand(b.x,b.width,track);b.y=b.marker.cardSide==='above'?band.top-b.height:band.bottom;}
    original.x=b.x;original.y=b.y;
    placed.push(b);
  }
}

const byGate=(a:Box,b:Box)=>(a.marker.runner.gate??a.marker.runner.index)-(b.marker.runner.gate??b.marker.runner.index);
const gapToOwner=(b:Box)=>{
  const dx=Math.max(b.x-b.width/2-b.marker.x,0,b.marker.x-(b.x+b.width/2));
  const dy=Math.max(b.y-b.marker.y,0,b.marker.y-(b.y+b.height));
  return Math.hypot(dx,dy);
};
/** Pull a box toward its Uma until the nearest-edge gap is inside the tether. */
function tether(b:Box,maxGap:number){
  const gap=gapToOwner(b);if(gap<=maxGap||gap<.001)return;
  const s=(gap-maxGap+6)/gap,cx=b.x,cy=b.y+b.height/2;
  b.x=cx+(b.marker.x-cx)*s;b.y=cy+(b.marker.y-cy)*s-b.height/2;
}

function shelfBand(row:Box[],side:'above'|'below',cluster:{minY:number;maxY:number},bottom:number){
  const n=row.length,maxH=Math.max(...row.map(b=>b.height)),lift=n>1?Math.min(14,40/Math.max(1,n-1)):0;
  const chevron=Math.abs(0-(n-1)/2)*lift,inner=44;
  if(side==='above'){
    let innerEdge=cluster.minY-inner;const top=innerEdge-maxH-chevron;
    if(top<36)innerEdge+=36-top;
    return {innerEdge,lift,top:innerEdge-maxH-chevron,bottom:innerEdge};
  }
  let innerEdge=cluster.maxY+inner;const shelfBottom=innerEdge+maxH+chevron;
  if(shelfBottom>bottom)innerEdge-=shelfBottom-bottom;
  if(innerEdge<36)innerEdge=36;
  return {innerEdge,lift,top:innerEdge,bottom:innerEdge+maxH+chevron};
}

function shelfLimits(band:{top:number;bottom:number},width:number,obstacles:Rect[]){
  let left=8,right=width-8;
  for(const r of obstacles){
    if(Math.min(band.bottom,r.y+r.height)-Math.max(band.top,r.y)<=0)continue;
    if(r.x-8>=width-8-(r.x+r.width))right=Math.min(right,r.x-6);
    else left=Math.max(left,r.x+r.width+6);
  }
  return {left,right};
}

function packLine(row:Box[],side:'above'|'below',innerEdge:number,lift:number,clusterX:number,left:number,right:number,bottom:number){
  const n=row.length;if(!n)return;
  const avail=Math.max(40,right-left),sumW=row.reduce((s,b)=>s+b.width,0);
  let gap=n>1?8:0,total=sumW+gap*(n-1);
  if(total>avail){gap=(avail-sumW)/Math.max(1,n-1);total=avail;}
  let rowLeft=clusterX-total/2;
  if(rowLeft<left)rowLeft=left;if(rowLeft+total>right)rowLeft=right-total;
  let cursor=rowLeft;
  row.forEach((b,i)=>{
    const chevron=Math.abs(i-(n-1)/2)*lift;
    b.x=cursor+b.width/2;cursor+=b.width+gap;
    b.y=side==='above'?innerEdge-b.height-chevron:innerEdge+chevron;
    b.y=clamp(b.y,36,bottom-b.height);b.anchorX=b.x;b.anchorY=b.y;
  });
}

/**
 * Starting-gate pack: horses sit in a tight stack, so owner-centered boxes
 * land on the portraits. Odd gates form a shelf above the cluster, even gates
 * a shelf below — gate order left to right, inner edges aligned, a light
 * chevron opening a window onto the faces. The above shelf yields to the
 * minimap; if a shelf still cannot fit, it wraps to two staggered rows.
 */
function startSlots(boxes:Box[],markers:Marker[],width:number,bottom:number,obstacles:Rect[]){
  const xs=markers.map(m=>m.x),ys=markers.map(m=>m.y);
  const cluster={x:(Math.min(...xs)+Math.max(...xs))/2,minY:Math.min(...ys),maxY:Math.max(...ys)};
  const place=(row:Box[],side:'above'|'below')=>{
    const n=row.length;if(!n)return;
    row.sort(byGate);
    const band=shelfBand(row,side,cluster,bottom),{left,right}=shelfLimits(band,width,obstacles);
    const natural=row.reduce((s,b)=>s+b.width,0)+8*Math.max(0,n-1);
    if(n>=5||n>=4&&natural>Math.max(40,right-left)){
      const far=row.filter((_,i)=>i%2===0),near=row.filter((_,i)=>i%2===1);
      const nearBand=shelfBand(near,side,cluster,bottom),rowGap=20;
      packLine(far,side,side==='above'?nearBand.innerEdge-Math.max(...near.map(b=>b.height))-rowGap:nearBand.innerEdge+Math.max(...near.map(b=>b.height))+rowGap,0,cluster.x,left,right,bottom);
      const nearY=side==='above'?Math.max(...far.map(b=>b.y+b.height))+rowGap:Math.min(...far.map(b=>b.y))-rowGap;
      if(near.length&&far.length>=2)near.forEach((b,i)=>{
        const a=far[Math.min(i,far.length-2)],c=far[Math.min(i+1,far.length-1)];
        b.x=(a.x+c.x)/2;
        b.y=side==='above'?nearY:nearY-b.height;
        b.y=clamp(b.y,36,bottom-b.height);b.anchorX=b.x;b.anchorY=b.y;
      });
      else packLine(near,side,nearBand.innerEdge,0,cluster.x,left,right,bottom);
      return;
    }
    packLine(row,side,band.innerEdge,band.lift,cluster.x,left,right,bottom);
  };
  place(boxes.filter(b=>b.marker.cardSide==='above'),'above');
  place(boxes.filter(b=>b.marker.cardSide==='below'),'below');
}

function separateSide(row:Box[]){
  if(row.length<2)return;
  row.sort((a,b)=>a.x-b.x||byGate(a,b));
  for(let pass=0;pass<10;pass++){
    for(let i=0;i<row.length-1;i++){
      const a=row[i],b=row[i+1],need=(a.width+b.width)/2+6,dx=b.x-a.x;
      if(dx>=need)continue;
      const push=(need-dx)/2;a.x-=push;b.x+=push;
    }
  }
}

function clearPortraits(boxes:Box[],markers:Marker[]){
  for(const b of boxes)for(const m of markers){
    const nearestX=clamp(m.x,b.x-b.width/2,b.x+b.width/2),nearestY=clamp(m.y,b.y,b.y+b.height);
    const dx=nearestX-m.x,dy=nearestY-m.y,dist=Math.hypot(dx,dy),need=b.marker.runner.id===m.runner.id?26:32;
    if(dist>=need)continue;
    const extra=need-(dist<.001?0:dist)+2;
    if(dist<.001){if(b.marker.cardSide==='above')b.y-=extra;else b.y+=extra;}
    else{b.x+=dx/dist*extra;b.y+=dy/dist*extra;}
  }
}

/** Owner proximity takes precedence over filling empty space at the edges.
 * Horizontal order follows current owners, so boxes can exchange places.
 * A bunched starting field uses fixed gate shelves instead of stacking. */
export function placeReplayCards(markers:ReplayScene['markers'],width:number,height:number,obstacles:Rect[]=[],seed?:LayoutSeed,fontScale=100,viewWindow=140,track?:ReplayTrack):Pick<ReplayScene,'cardRects'|'cardGroups'> {
  const text=replayTextMetrics(fontScale),header=text.headerInset+2;
  const spread=clamp((viewWindow-140)/460,0,1);
  const bottom=height-104;
  const ds=markers.map(m=>m.sample.distance).filter((d):d is number=>d!=null&&Number.isFinite(d));
  const raceSpread=ds.length>1?Math.max(...ds)-Math.min(...ds):0;
  const ahead=ds.length?Math.max(...ds):0;
  const bunch=markers.length>1?clamp((120-ahead)/40,0,1)*clamp((12-raceSpread)/8,0,1):0;
  const boxes:Box[]=markers.filter(m=>m.cards.length).map(marker=>{
    // Keep a row of headroom for bends; overflowing stacks grow sideways
    // before their height would force them across the road.
    const railHeight=track?Math.max(height*.46-track.trackWidth/2-84,bottom-height*.46-track.trackWidth/2-48):bottom-36;
    const capacity=Math.max(1,Math.min(viewWindow>100&&width<1000?3:Infinity,Math.floor((railHeight-header)/text.rowStride)));
    const count=marker.cards.reduce((n,c)=>n+c.alpha,0),rows=Math.min(capacity,Math.max(.15,count));
    let boxWidth=text.groupWidth;for(let start=capacity;start<count;start+=capacity)boxWidth+=text.columnStride*Math.min(1,count-start);
    boxWidth=Math.min(width-16,boxWidth);
    const boxHeight=header+rows*text.rowStride,anchorY=marker.y+(marker.cardSide==='above'?-34-boxHeight:34);
    const overflow=marker.cardSide==='above'?36-anchorY:anchorY+boxHeight-bottom;
    const ownerX=marker.x+(marker.x>width/2?-1:1)*(boxWidth/2+34)*clamp(overflow/40,0,1);
    const prior=seed?.offsets.get(marker.runner.id);
    const futureCount=Math.max(count,track?.futureRows?.get(marker.runner.id)??0);
    const reserveHeight=Math.max(boxHeight,header+Math.min(capacity,futureCount)*text.rowStride);
    let reserveWidth=text.groupWidth;for(let start=capacity;start<futureCount;start+=capacity)reserveWidth+=text.columnStride*Math.min(1,futureCount-start);
    reserveWidth=Math.min(width-16,reserveWidth);
    return {marker,width:boxWidth,height:boxHeight,capacity,reserveHeight,reserveWidth,x:prior?marker.x+prior.x:ownerX,y:prior?anchorY+prior.y:anchorY,anchorX:ownerX,anchorY,alpha:Math.max(...marker.cards.map(c=>c.alpha))};
  });
  if(bunch>0&&boxes.length&&!seed){
    const owner=boxes.map(b=>({x:b.anchorX,y:b.anchorY}));
    startSlots(boxes,markers,width,bottom,obstacles);
    if(bunch<1)boxes.forEach((b,i)=>{b.anchorX=owner[i].x+(b.anchorX-owner[i].x)*bunch;b.anchorY=owner[i].y+(b.anchorY-owner[i].y)*bunch;
      b.x=owner[i].x+(b.x-owner[i].x)*bunch;b.y=owner[i].y+(b.y-owner[i].y)*bunch;});
  }
  const bound=(b:Box)=>{
    const reach=(viewWindow>140?240:140)+Math.round(280*bunch),vertical=50*spread+200*bunch;
    if(!track)b.x=clamp(b.x,b.marker.x-reach,b.marker.x+reach);
    b.y=clamp(b.y,b.marker.y-b.height-170-vertical,b.marker.y+170+vertical);
    b.x=clamp(b.x,8+b.width/2,width-8-b.width/2);b.y=clamp(b.y,36,bottom-b.height);
  };
  const push=(a:Box,r:Rect,weight:number,tie:number)=>{
    const dx=a.x-(r.x+r.width/2),dy=a.y+a.height/2-(r.y+r.height/2);
    const px=(a.width+r.width)/2+6-Math.abs(dx),py=(a.height+r.height)/2+6-Math.abs(dy);
    if(px<=0||py<=0)return{x:0,y:0};
    const wx=1/(1+Math.exp(clamp((px-py)/12,-25,25))),wy=1-wx;
    const deep=px>14&&py>14?1.35:1;
    return{x:px*wx*(Math.abs(dx)<.1?tie:dx/Math.sqrt(dx*dx+16))*weight*deep,y:py*wy*(Math.abs(dy)<.1?tie:dy/Math.sqrt(dy*dy+1))*weight};
  };
  const fixed=bunch>=.6&&!seed;
  const passes=seed?.iterations??(fixed?0:24+Math.round(24*spread)+Math.round(18*bunch));
  for(let pass=0;pass<passes;pass++){
    const pull=bunch>.55?.04:.018;
    const delta=boxes.map(b=>({x:(b.anchorX-b.x)*pull,y:(b.anchorY-b.y)*pull}));
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j],p=push(a,{x:b.x-b.width/2,y:b.y,width:b.width,height:b.height},Math.min(a.alpha,b.alpha)*1.2,a.marker.runner.index<b.marker.runner.index?-1:1);
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
      for(const m of markers){const p=push(b,{x:m.x-32,y:m.y-32,width:64,height:64},1.15,b.marker.cardSide==='above'?-1:1);delta[i].x+=p.x;delta[i].y+=p.y;}
      for(const r of obstacles){const p=push(b,r,1.2,1);delta[i].x+=p.x;delta[i].y+=p.y;}
      b.x+=clamp(delta[i].x,-14,14);b.y+=clamp(delta[i].y,-14,14);bound(b);
    }
  }
  if(!seed&&!fixed){
    separateSide(boxes.filter(b=>b.marker.cardSide==='above'));
    separateSide(boxes.filter(b=>b.marker.cardSide==='below'));
    for(const b of boxes)bound(b);
    clearPortraits(boxes,markers);
    for(const b of boxes){bound(b);if(!track)tether(b,(viewWindow>140?220:170)+Math.round(160*bunch));}
  }
  if(!seed&&fixed)for(const b of boxes){b.x=clamp(b.x,8+b.width/2,width-8-b.width/2);b.y=clamp(b.y,36,bottom-b.height);}
  if(track)clearTrack(boxes,width,bottom,track,obstacles,!seed,viewWindow);
  const cardGroups:ReplayScene['cardGroups']=[],cardRects:ReplayScene['cardRects']=[];
  // This is also the paint/hit-test order: the selected stack is last.
  boxes.sort((a,b)=>Number(a.marker.focused)-Number(b.marker.focused));
  for(const b of boxes){
    if(!track){if(bunch>=.6){b.x=clamp(b.x,8+b.width/2,width-8-b.width/2);b.y=clamp(b.y,36,bottom-b.height);}else bound(b);}
    const x=b.x-b.width/2,y=b.y;
    cardGroups.push({runnerId:b.marker.runner.id,header:`#${b.marker.runner.gate??b.marker.runner.index+1} ${b.marker.name}`,x,y,width:b.width,height:b.height,alpha:b.alpha,side:b.marker.cardSide});
    const capacity=b.capacity;
    const point=(n:number)=>{const column=Math.floor(n/capacity),row=n%capacity;return{x:column*text.columnStride,y:(column%2?capacity-1-row:row)*text.rowStride};};
    let slot=0;
    for(const card of b.marker.cards){
      const index=Math.floor(slot),f=slot-index,a=point(index),c=point(index+1);
      const rowX=clamp(x+4+a.x+(c.x-a.x)*f,8,width-text.rowWidth-8),rowY=y+text.headerInset+a.y+(c.y-a.y)*f;
      cardRects.push({runnerId:b.marker.runner.id,card,x:rowX,y:rowY,width:Math.max(0,Math.min(text.rowWidth,x+b.width-rowX)),height:Math.max(0,Math.min(text.rowHeight,y+b.height-rowY)),side:b.marker.cardSide});slot+=card.alpha;
    }
  }
  return {cardGroups,cardRects};
}
