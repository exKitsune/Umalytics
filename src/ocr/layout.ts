/** Screenshot landmarks, independent of the browser and OCR engine. */
export interface Box {x:number;y:number;width:number;height:number}
export interface Pixels {width:number;height:number;data:ArrayLike<number>}
export interface SkillCard extends Box {text:Box;icon:Box;rainbow:boolean}
function greenHeaders(image:Pixels):Box[]{
  const bands:Box[]=[];
  for(let y=0;y<image.height;y++){let count=0,left=image.width,right=0;for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4;if(image.data[i+1]>150&&image.data[i+1]>image.data[i]*1.25&&image.data[i+2]<150){count++;left=Math.min(left,x);right=x;}}
    if(count>image.width*.5){const last=bands.at(-1);if(last&&y-(last.y+last.height)<=40&&Math.abs(left-last.x)<image.width*.1){const edge=Math.max(last.x+last.width,right+1);last.x=Math.min(left,last.x);last.width=edge-last.x;last.height=y-last.y+1;}else bands.push({x:left,y,width:right-left+1,height:1});}}
  return bands.filter(b=>b.height>=8);
}
function statHeader(image:Pixels):Box|undefined {
  // Locate the five-column row itself; the title may be cropped off entirely.
  return greenHeaders(image).find(b=>{
    if(b.width/b.height<14)return false;
    const cell=b.width/5,h=Math.round(b.height*1.8),top=b.y+b.height+4;
    if(top+h>image.height)return false;
    return Array.from({length:5},(_,n)=>{
      const left=Math.round(b.x+cell*(n+.39)),w=Math.round(cell*.57);let brown=0;
      for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++){
        const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],blue=image.data[i+2];
        if(r>55&&r<215&&r>g*1.12&&g>blue*1.15)brown++;
      }
      return brown/(w*h)>.008;
    }).every(Boolean);
  });
}
export function findStatCells(image:Pixels):Box[]{
  const b=statHeader(image);if(!b)return [];const cell=b.width/5;
  return Array.from({length:5},(_,i)=>({x:Math.round(b.x+cell*(i+.39)),y:b.y+b.height+4,width:Math.round(cell*.57),height:Math.round(b.height*1.8)}));
}
export function findDetailRegions(image:Pixels):{identity?:Box;aptitudes?:Box;stats:Box[]} {
  const header=statHeader(image),stats=findStatCells(image);if(!header)return {stats};
  const cell=header.width/5,top=Math.max(0,Math.floor(header.y-cell*1.65)),aptTop=Math.round(header.y+header.height+cell*.3);
  return {stats,identity:{x:Math.round(header.x+cell*2),y:top,width:Math.floor(cell*3),height:header.y-top},aptitudes:{x:header.x,y:aptTop,width:header.width,height:Math.min(Math.round(cell*1.2),image.height-aptTop)}};
}
export function rainbowCard(image:Pixels,box:Box):boolean {
  let cyan=0,pink=0,total=0;
  for(let y=Math.ceil(box.y+box.height*.2);y<box.y+box.height*.9;y+=2)for(let x=Math.ceil(box.x+box.height);x<box.x+box.width-box.height*.08;x+=2){
    const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];total++;
    if(g>190&&b>180&&g>r*1.1&&b>r*1.1)cyan++;
    if(r>210&&b>190&&r>g*1.08&&b>g*1.08)pink++;
  }
  return total>0&&cyan/total>.06&&pink/total>.06;
}
function components(image:Pixels,test:(r:number,g:number,b:number)=>boolean):Box[]{
  const {width:w,height:h,data}=image,mask=new Uint8Array(w*h),queue=new Int32Array(w*h),result:Box[]=[];
  for(let p=0;p<mask.length;p++){const i=p*4;mask[p]=test(data[i],data[i+1],data[i+2])?1:0;}
  for(let p=0;p<mask.length;p++)if(mask[p]){
    let head=0,tail=1,x0=p%w,x1=x0,y0=Math.floor(p/w),y1=y0;queue[0]=p;mask[p]=0;
    while(head<tail){const n=queue[head++],x=n%w,y=Math.floor(n/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const q of [x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h-1?n+w:-1])if(q>=0&&mask[q]){mask[q]=0;queue[tail++]=q;}}
    if(tail>=40)result.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1});
  }
  return result;
}
export function findSkillCards(image:Pixels):SkillCard[]{
  // Rank/portrait decorations must never become skill cards, even without a title.
  const header=statHeader(image),belowStats=header?header.y+header.height:0;
  const icons=components(image,(r,g,b)=>Math.max(r,g,b)>155&&Math.max(r,g,b)-Math.min(r,g,b)>95)
    .filter(b=>b.width>=14&&b.height>=14&&b.height<image.height*.6&&b.width/b.height>.65&&b.width/b.height<1.45);
  const panels=components(image,(r,g,b)=>r>120&&g>100&&b>g+6&&(b>r+4&&Math.abs(r-g)<28||r>g+30)||r>225&&g>145&&g<247&&b<145)
    .filter(b=>b.width/b.height>2.2&&b.width/b.height<18&&b.height>=18);
  const cards:SkillCard[]=[];
  for(const icon of icons){
    if(icon.y<belowStats)continue;
    const cy=icon.y+icon.height/2;
    const panel=panels.filter(b=>cy>b.y&&cy<b.y+b.height&&b.height>=icon.height*.75&&b.height<icon.height*2.3&&b.x<icon.x+icon.width*4&&b.x+b.width>icon.x+icon.width*3)
      .sort((a,b)=>Math.abs(a.y+a.height/2-cy)-Math.abs(b.y+b.height/2-cy)||a.x-b.x)[0];
    if(!panel)continue;
    const x=Math.max(0,Math.min(panel.x,icon.x-icon.height*.2)),y=panel.y,width=panel.x+panel.width-x,height=panel.height;
    if(width/height<3||cards.some(b=>Math.abs(b.y-y)<height*.35&&Math.abs(b.x-x)<height))continue;
    const left=Math.round(icon.x+icon.width+icon.height*.22),top=Math.max(0,y+Math.round(height*.1));
    cards.push({x,y,width,height,icon,rainbow:rainbowCard(image,{x,y,width,height}),text:{x:left,y:top,width:Math.max(1,Math.round(x+width-left-height*.08)),height:Math.round(height*.8)}});
  }
  return cards.sort((a,b)=>a.y-b.y||a.x-b.x);
}
/** Brown game lettering only; colored icons, borders and scenery stay white. */
export function textPixels(image:Pixels):Uint8ClampedArray {
  const out=new Uint8ClampedArray(image.width*image.height*4);
  for(let i=0;i<out.length;i+=4){const r=image.data[i],g=image.data[i+1],b=image.data[i+2];
    const black=r>55&&r<215&&r>g*1.12&&g>b*1.15;
    out[i]=out[i+1]=out[i+2]=black?0:255;out[i+3]=255;}
  return out;
}
export function gradeColor(image:Pixels):string|null {
  const counts:Record<string,number>={S:0,A:0,B:0,C:0,D:0,E:0,F:0,G:0};
  for(let i=0;i<image.data.length;i+=4){const r=image.data[i],g=image.data[i+1],b=image.data[i+2];let k='';
    if(r>200&&g>120&&g<220&&b<130)k=g/r>.7?'S':'A';
    else if(r>190&&b>150&&r>b*1.03&&r>g*1.2&&b>g*1.1)k='B';
    else if(g>160&&g>r*1.15&&g>b*1.15)k='C';
    else if(b>180&&b>r*1.25&&g>r*1.25)k='D';
    else if(b>180&&b>g*1.25&&r>g*1.15)k=r/b>.75?'E':'F';
    else if(r>105&&r<205&&Math.abs(r-g)<7&&Math.abs(g-b)<7)k='G';
    if(k)counts[k]++;}
  const order=Object.entries(counts).sort((a,b)=>b[1]-a[1]);return order[0][1]>=8&&order[0][1]>order[1][1]*1.4?order[0][0]:null;
}
export function iconSignature(image:Pixels):number[]{
  let left=image.width,right=0,top=image.height,bottom=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];if(image.data[i+3]>128&&Math.max(r,g,b)>155&&Math.max(r,g,b)-Math.min(r,g,b)>95){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  if(right<=left||bottom<=top)return [];
  const result:number[]=[];for(let y=0;y<20;y++)for(let x=0;x<20;x++){const px=Math.min(right,left+Math.floor((x+.5)*(right-left+1)/20)),py=Math.min(bottom,top+Math.floor((y+.5)*(bottom-top+1)/20)),i=(py*image.width+px)*4;result.push(image.data[i],image.data[i+1],image.data[i+2]);}return result;
}
export function matchIcon(signature:number[],templates:{id:number;signature:number[]}[]):number|undefined {
  if(!signature.length)return undefined;
  const scores=templates.filter(t=>t.signature.length===signature.length).map(t=>({id:t.id,distance:t.signature.reduce((sum,v,i)=>sum+Math.abs(v-signature[i]),0)/(signature.length*255)})).sort((a,b)=>a.distance-b.distance);
  return scores[0]&&scores[0].distance<.17&&(!scores[1]||scores[1].distance-scores[0].distance>.012)?scores[0].id:undefined;
}
