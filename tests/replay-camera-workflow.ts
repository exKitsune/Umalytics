/** Whole-file import/reference/render workflow. No browser or private race required. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleReferenceData } from '../src/data/reference';
import { readGeometry } from '../src/data/geometry';
import { DEFAULT_REPLAY_WINDOW, cameraAngle, replayCourseMarkers, type ReplayOptions } from '../src/replay/model';
import { drawReplay } from '../src/replay/draw';
import { portraitUrl } from '../src/data/portraits';
import { iconSource } from '../src/data/game-icons';
import { replayCardHelp, replayCards } from '../src/replay/cards';
import { runnerColors } from '../src/library';
import type { Race } from '../src/data/types';
import { analyzeRace } from '../src/data/analytics';
import { parseRaceJson } from '../src/data/import';
import { runnerGap } from '../src/view-model';

const folder=process.argv[2],root=join(import.meta.dirname,'..');
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const race:Race=parseRaceJson(await json(join(folder,(await readdir(folder))[0])))[0];
// Imported field: a leader gets a negative gap, a pursuer a positive one.
const gapFrame=race.frames[0].runners.map((s,i)=>({...s,distance:100-i*12}));
assert.equal(runnerGap(race,gapFrame,race.runners[0].id),-12);
assert.equal(runnerGap(race,gapFrame,race.runners[1].id),12);
assert.equal(runnerGap(race,gapFrame.map(s=>({...s,distance:100})),race.runners[0].id),0);
assert.equal(runnerGap(race,gapFrame.slice(0,1),race.runners[0].id),null);
assert.equal(runnerGap(race,gapFrame.map(s=>({...s,distance:race.distance!+10})),race.runners[0].id),0);
const reference=assembleReferenceData(await json(join(root,'public/data/metadata.json')),await json(join(root,'public/data/courses.json')),await json(join(root,'public/data/reference-source.json')),await json(join(root,'public/data/simulator-skill-ids.json')),readGeometry(await json(join(root,'public/data/course-geometry.json'))));
const texts:string[]=[],arcs:number[][]=[],fills:{x:number;y:number;width:number;height:number;color:string}[]=[];
let strokes:number[][][]=[],path:number[][]=[];
let strokeCaps:string[]=[];
// The shared live/clip renderer emits real paths and portrait positions into a
// recording Canvas2D surface, so its transform is checked beyond scene metadata.
const context=new Proxy({
  measureText:(text:string)=>({width:text.length*6}),
  createLinearGradient:()=>({addColorStop:()=>{}}),
  fillText:(text:string)=>texts.push(text),
  fillRect:(x:number,y:number,width:number,height:number)=>fills.push({x,y,width,height,color:context.fillStyle as string}),
  beginPath:()=>{path=[];},moveTo:(x:number,y:number)=>path.push([x,y]),lineTo:(x:number,y:number)=>path.push([x,y]),
  stroke:()=>{strokes.push(path.map(p=>[...p]));strokeCaps.push(context.lineCap);},arc:(x:number,y:number,r:number)=>arcs.push([x,y,r]),
}, {get:(target,key)=>Reflect.get(target,key)??(()=>{})}) as unknown as CanvasRenderingContext2D;
const enabled={phases:true,sections:true,slopes:true,remaining777:true};
let renderedFrames=0,boundaries=0,gameCourses=0,left=false,right=false;
for(const course of Object.values(reference.courses).filter(c=>c.gameGeometry)){
  gameCourses++;left||=course.turn===2;right||=course.turn===1;
  const value:Race={...race,distance:course.distance,courseId:course.id,duration:120,
    frames:[0,120].map(time=>({time,runners:race.runners.map((runner,i)=>({runnerId:runner.id,distance:Math.max(0,course.distance*time/120-i*10),speed:20,hp:1000,lane:i*.2}))}))};
  // Course geometry is swept for every course; representative courses also run
  // card layout here. The full crowded playback scenarios below exercise cards
  // at every animation frame rather than repeating120s of label history119times.
  const options:ReplayOptions={race:value,course,reference,selected:value.runners[0].id,follow:'selected',window:140,labels:[10101,10506,10606].includes(course.id),elevation:true,courseMarkers:enabled,intervals:()=>[{kind:'skill',label:'Synthetic corner effect',start:0,end:120,evidence:'recorded',skillId:200362}]};
  const render=(distance:number)=>{texts.length=0;arcs.length=0;fills.length=0;strokes=[];strokeCaps=[];const scene=drawReplay(context,options,distance/course.distance*120,1280,500);renderedFrames++;
    assert.equal(scene.camera.angle,cameraAngle(course,scene.distance));assert.equal(scene.camera.scale,1180/options.window);
    assert.ok(strokes.length>=3);assert.deepEqual(strokes[0],scene.route.map(p=>[p.x,p.y]));
    assert.equal(strokeCaps[0],'butt');assert.equal(strokeCaps[1],'butt');
    assert.ok(arcs.some(([x,y])=>scene.markers.some(m=>m.x===x&&m.y===y)));
    for(const stroke of strokes)for(const point of stroke)assert.ok(point.every(Number.isFinite));
    assert.ok(scene.distanceTicks.every(t=>t.distance%50===0));
    // The widened track keeps portrait lane spacing in the same scale.
    assert.equal(scene.trackWidth,Math.max(91,Math.min(234,36*scene.camera.scale*1.3)));
    for(const rect of scene.cardRects){assert.ok(rect.x>=8&&rect.x+rect.width<=1272);assert.ok(rect.y>=36&&rect.y+rect.height<=396);}
    assert.equal(new Set(scene.cardGroups.map(g=>g.runnerId)).size,scene.cardGroups.length);
    assert.equal(texts.filter(t=>t.startsWith('#')).length,scene.cardGroups.length);
    for(const group of scene.cardGroups){assert.ok(group.x>=8&&group.x+group.width<=1272);assert.ok(group.y>=36&&group.y+group.height<=396);
      const marker=scene.markers.find(m=>m.runner.id===group.runnerId)!;
      assert.ok(fills.some(f=>f.x===group.x&&f.y===group.y&&f.width===group.width&&f.height>0&&f.height<group.height&&f.color===runnerColors[marker.runner.index%runnerColors.length]));}
    return scene;
  };
  const first=render(0),early=render(1);
  assert.deepEqual(first.distanceTicks.map(t=>t.distance),early.distanceTicks.map(t=>t.distance));
  assert.equal(first.route[0].distance,0);assert.equal(early.route[0].distance,0);
  assert.notDeepEqual(strokes[0],first.route.map(p=>[p.x,p.y])); // actual canvas route moves while tracking
  for(const edge of course.corners.flatMap(c=>[c.start,c.start+c.length]).filter(d=>d>1&&d<course.distance-1)){
    boundaries++;const before=render(edge-.02),after=render(edge+.02);
    const common=before.distanceTicks.filter(t=>after.distanceTicks.some(b=>b.distance===t.distance));assert.ok(common.length>=2);
    const a=common[0],b=common[1],a2=after.distanceTicks.find(t=>t.distance===a.distance)!,b2=after.distanceTicks.find(t=>t.distance===b.distance)!;
    assert.ok(Math.abs(after.camera.angle-before.camera.angle)<.005);
    assert.ok(Math.hypot((b.x-a.x)-(b2.x-a2.x),(b.y-a.y)-(b2.y-a2.y))<2);
    assert.ok(Math.hypot(a2.x-a.x,a2.y-a.y)<2);
    for(const rect of before.cardRects){const other=after.cardRects.find(r=>r.runnerId===rect.runnerId&&r.card.id===rect.card.id)!;assert.equal(rect.side,other.side);assert.ok(Math.hypot(rect.x-other.x,rect.y-other.y)<2);}
    assert.deepEqual(render(edge-.02),before); // no corner rotation/fitting leap
  }
  const signs=replayCourseMarkers(course,course.distance,enabled);
  assert.ok(signs.some(s=>s.label.includes('777m left')&&s.distance===course.distance-777));
  assert.ok(signs.some(s=>s.label.includes('Middle')&&Math.abs(s.distance-course.distance/6)<.001));
  for(const d of signs.map(s=>s.distance)){const scene=render(d);assert.ok(scene.courseMarkers.some(s=>Math.abs(s.distance-d)<.001));}
  options.courseMarkers={phases:false,sections:false,slopes:false,remaining777:false};options.window=400;
  const clean=render(course.distance-777);assert.deepEqual(clean.courseMarkers,[]);assert.ok(clean.distanceTicks.every(t=>t.distance%100===0));assert.ok(!texts.some(t=>t.includes('777m left')));
  options.window=DEFAULT_REPLAY_WINDOW;const closer=render(course.distance/2);
  assert.ok(closer.camera.scale/(1180/140)>2.7&&closer.camera.scale/(1180/140)<3);assert.deepEqual(closer.routeEnds,{start:false,finish:false});
  assert.equal(render(0).routeEnds.start,true);assert.equal(render(course.distance).routeEnds.finish,true);
  // Debuff target evidence is independent of the reference vision guide. The
  // target mask can point behind the source, never replaced by a cone guess.
  options.overlays={vision:true,debuffs:true};options.debuffActivations=[{sourceRunnerId:race.runners[0].id,skillId:999001,start:59,end:61,
    recipientsKnown:true,targetRunnerIds:[race.runners[1].id],effects:[],detail:'Synthetic recorded recipient mask.',effectiveEnd:61,effectiveDuration:2,timingKind:'reported',timingReason:'Synthetic reported2s.'}];
  const targeted=render(course.distance/2);assert.equal(targeted.vision.length,1);assert.equal(targeted.debuffs.length,1);assert.equal(targeted.debuffs[0].targets[0].runnerId,race.runners[1].id);
  assert.ok(!targeted.vision[0].candidateRunnerIds.includes(race.runners[1].id)); // recorded target behind source remains a target outside current cone
  options.debuffActivations=[{...options.debuffActivations![0],skillId:201441,start:60,end:60,effectiveEnd:60,effectiveDuration:0,timingKind:'instant'}];options.overlays.vision=false;
  const automatic=render(course.distance/2);assert.equal(automatic.vision.length,1);assert.equal(automatic.debuffs[0].activationOnly,true);
  assert.ok(automatic.vision[0].polygon.length>=4);
  const polygon=automatic.vision[0].polygon,n=polygon.length/2;
  const startWidth=Math.hypot(polygon[0].x-polygon.at(-1)!.x,polygon[0].y-polygon.at(-1)!.y),endWidth=Math.hypot(polygon[n-1].x-polygon[n].x,polygon[n-1].y-polygon[n].y);
  assert.ok(Math.abs(endWidth/startWidth-6.75)<1e-7);
  options.debuffActivations=[{...options.debuffActivations![0],recipientsKnown:false}];
  assert.deepEqual(render(course.distance/2).debuffs[0].targets,[]);
  options.debuffActivations=[{...options.debuffActivations![0],end:null,start:57,effectiveEnd:null,effectiveDuration:null,timingKind:'unknown'}];
  assert.deepEqual(render(course.distance/2).debuffs,[]); // unknown end is only a2.5s activation flash
  options.overlays={vision:false,debuffs:false};const hidden=render(course.distance/2);assert.deepEqual(hidden.vision,[]);assert.deepEqual(hidden.debuffs,[]);
}
assert.ok(gameCourses>=14&&left&&right&&boundaries>20);
assert.deepEqual(replayCourseMarkers(null,0,enabled),[]);
assert.equal(portraitUrl({...race.runners[0],cardId:100103,charaId:1001}),'./portraits/trained_chr_icon_1001_100102_02.png');
assert.equal(portraitUrl({...race.runners[0],cardId:100102,charaId:1001}),'./portraits/trained_chr_icon_1001_100130_02.png');
assert.equal(portraitUrl({...race.runners[0],cardId:null,charaId:1001}),'./portraits/chr_icon_1001.png');
const outfitMap=await json(join(root,'src/data/outfit-portraits.json'));assert.equal(Object.keys(outfitMap).length,224);
for(const filename of Object.values(outfitMap) as string[]){const bytes=await readFile(join(root,'public/portraits',filename));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
const sourceId=race.runners[0].id,targetId=race.runners[1].id,candidateId='synthetic-cone-candidate';
const candidate={...race.runners[1],id:candidateId,index:2,gate:3,name:'Synthetic cone candidate',skills:[]};
const visionRace:Race={...race,runners:[{...race.runners[0],strategy:'Late Surger',strategyCode:3,skills:[{id:201541,level:1},{id:201431,level:1},{id:201441,level:1},{id:200362,level:1}]},race.runners[1],candidate],
  frames:race.frames.map(frame=>({...frame,runners:[...frame.runners,{...frame.runners[0],runnerId:candidateId,distance:frame.runners[0].distance===null?null:frame.runners[0].distance+10}]})),
  events:[{time:60,type:3,runnerId:sourceId,skillId:201431,label:'Synthetic vision proc',params:[0,201431,30000,0,0]},
    {time:60,type:3,runnerId:sourceId,skillId:201441,label:'Synthetic gaze proc',params:[0,201441,0,0,2]},
    {time:60,type:3,runnerId:sourceId,skillId:200362,label:'Synthetic speed proc',params:[0,200362,30000,0,0]}]};
const realOptions:ReplayOptions={race:visionRace,course:reference.courses[race.courseId!],reference,selected:sourceId,window:DEFAULT_REPLAY_WINDOW,follow:'selected',labels:true,elevation:true,overlays:{vision:false,debuffs:true},analysis:analyzeRace(visionRace,reference)};
assert.equal(realOptions.analysis!.debuffs[0].targetRunnerIds[0],targetId);
arcs.length=0;const modded=drawReplay(context,realOptions,61,1280,500);assert.equal(modded.vision.length,1);assert.ok(modded.vision[0].label.includes('45m'));
assert.ok(modded.vision[0].candidateRunnerIds.includes(candidateId));assert.ok(!modded.vision[0].candidateRunnerIds.includes(targetId));
assert.deepEqual(modded.debuffs[0].targets.map(t=>t.runnerId),[targetId]);
assert.ok(!modded.markers.find(m=>m.runner.id===sourceId)!.cards.some(c=>c.id.startsWith('skill:201431:')),'Self-only vision skill popup is hidden');
assert.equal(drawReplay(context,{...realOptions,debuffActivations:[]},61,1280,500).vision.length,0,'Self-only vision does not draw an automatic cone');
const markedCandidate=modded.markers.find(m=>m.runner.id===candidateId)!,markedTarget=modded.markers.find(m=>m.runner.id===targetId)!;
assert.ok(arcs.some(([x,y,r])=>x===markedCandidate.x&&y===markedCandidate.y&&r===27));assert.ok(arcs.some(([x,y,r])=>x===markedTarget.x&&y===markedTarget.y&&r===29));
realOptions.overlays!.vision=true;const expired=drawReplay(context,realOptions,80,1280,500);assert.ok(expired.vision[0].label.includes('30m'));assert.deepEqual(expired.debuffs,[]);
const unresolvedRace={...visionRace,events:visionRace.events.map(e=>e.skillId===201431?{...e,params:[0,201431,0,0,0]}:e)};
const derived=drawReplay(context,{...realOptions,race:unresolvedRace,analysis:analyzeRace(unresolvedRace,reference)},61,1280,500);assert.ok(derived.vision[0].label.includes('45m'));
const unknownRace={...unresolvedRace,distance:null};
const unresolved=drawReplay(context,{...realOptions,race:unknownRace,analysis:analyzeRace(unknownRace,reference)},61,1280,500);assert.ok(unresolved.vision[0].label.includes('modifiers unknown'));
// Real import → analytics → shared canvas: clocks, received-mask cards and stable
// placement are checked while sampling corners and seeking in arbitrary order.
const cardAnalysis=realOptions.analysis!;
cardAnalysis.runners[sourceId].intervals.push(
  {kind:'downhill-section',label:'Grade',start:59,end:90,evidence:'derived',detail:'Terrain only.'},
  {kind:'downhill-mode-model',label:'DH',start:59,end:70,evidence:'estimated',detail:'Synthetic modeled downhill activity.'},
  {kind:'force-in',label:'Inward',start:59,end:70,evidence:'recorded',detail:'Inward positioning.'},
  {kind:'conserve-power',label:'Conserve',start:59,end:70,evidence:'recorded',detail:'Accumulating power.'},
  {kind:'release-conserve-power',label:'Release',start:59,end:70,evidence:'recorded',detail:'Releasing power.'},
  {kind:'last-spurt',label:'Spurt',start:59,end:70,evidence:'recorded',detail:'Last spurt.'},
  {kind:'pace-up',label:'PU',start:60,end:60.1,evidence:'recorded',detail:'Short recorded status.'});
texts.length=0;const cardFrame=drawReplay(context,realOptions,61,1280,500);
assert.equal(texts.filter(t=>t.startsWith('#')).length,cardFrame.cardGroups.length);
assert.ok(cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards.length>1);
assert.equal(cardFrame.cardGroups.filter(g=>g.runnerId===sourceId).length,1);
assert.ok(cardFrame.cardRects.filter(r=>r.runnerId===sourceId).every(r=>r.height>24));
const baseFont=parseFloat(context.font),largeFrame=drawReplay(context,{...realOptions,fontScale:200},61,1280,500);
assert.ok(Math.abs(parseFloat(context.font)-baseFont*2)<1e-6,'Replay text follows the percentage setting.');
assert.deepEqual(largeFrame.route,cardFrame.route,'Text size must not change the course or camera.');
assert.deepEqual(largeFrame.cardRects.map(r=>r.card.id),cardFrame.cardRects.map(r=>r.card.id));
assert.ok(largeFrame.cardRects.every(r=>r.height>cardFrame.cardRects[0].height&&r.width>cardFrame.cardRects[0].width));
assert.ok(largeFrame.cardRects.every(r=>r.x>=8&&r.x+r.width<=1272&&r.y>=36&&r.y+r.height<=396));
assert.deepEqual(drawReplay(context,realOptions,61,1280,500),cardFrame,'Reset restores the original label layout.');

assert.ok(cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards.some(c=>c.label==='Downhill mode'&&c.detail.includes('Modeled')));
assert.ok(!cardFrame.markers.some(m=>m.labels.some(label=>/GRADE|Proc|Start/.test(label))));
assert.ok(cardFrame.markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'&&c.iconKey.startsWith('skill-')));
const sourceCards=cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards;
assert.ok(!sourceCards.some(c=>/^status:(force-in|conserve-power):/.test(c.id)));
assert.ok(sourceCards.some(c=>c.id.startsWith('status:release-conserve-power:')));
assert.ok(sourceCards.some(c=>c.id.startsWith('status:last-spurt:')));
assert.ok(cardAnalysis.runners[sourceId].intervals.some(s=>s.kind==='force-in'),'Replay filters leave analysis intact');
const fallbackCards=replayCards({...realOptions,analysis:null,intervals:()=>[
  {kind:'force-in-model',label:'Inward',start:59,end:70,evidence:'estimated'},
  {kind:'conserve-power',label:'Conserve',start:59,end:70,evidence:'recorded'},
  {kind:'skill',skillId:201431,label:'Vision',start:59,end:70,evidence:'recorded'},
  {kind:'skill',skillId:99999999,label:'Unknown skill',start:59,end:70,evidence:'recorded'},
  {kind:'last-spurt',label:'Spurt',start:59,end:70,evidence:'recorded'},
]},sourceId,61,cardFrame.markers[0].sample);
assert.deepEqual(fallbackCards.filter(c=>c.kind!=='received').map(c=>c.label),['Unknown skill','Last spurt']);
const durationCard=sourceCards.find(c=>c.id.startsWith('skill:200362:'))!;
const speedProc=cardAnalysis.runners[sourceId].skillActivations.find(s=>s.skillId===200362)!;
const visionProc=cardAnalysis.runners[sourceId].skillActivations.find(s=>s.skillId===201431)!;
const mixedAnalysis={...cardAnalysis,runners:{...cardAnalysis.runners,[sourceId]:{
  ...cardAnalysis.runners[sourceId],skillActivations:[{...speedProc,effects:[...speedProc.effects,...visionProc.effects]}],
}}};
assert.ok(replayCards({...realOptions,analysis:mixedAnalysis},sourceId,61,cardFrame.markers[0].sample).some(c=>c.id.startsWith('skill:200362:')),'Skills with speed and vision effects remain visible');
assert.ok(!replayCards({...realOptions,analysis:null,intervals:undefined},sourceId,61,cardFrame.markers[0].sample).some(c=>c.id.startsWith('event:201431:')),'Recorded-only replay also hides known self-only vision');
assert.ok(Math.abs(durationCard.progress!-2/3)<1e-7);assert.equal(durationCard.visualOnly,false);
assert.ok(!cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards.some(c=>c.label==='PU'));
assert.ok(iconSource(durationCard.iconKey)?.startsWith('data:image/png;base64,'));
const instantOptions={...realOptions,debuffActivations:[{sourceRunnerId:sourceId,skillId:201441,start:60,end:60,effectiveEnd:60,effectiveDuration:0,timingKind:'instant' as const,timingReason:'Instant synthetic effect.',recipientsKnown:true,targetRunnerIds:[targetId],effects:[],detail:'Mask evidence.'}]};
const instant=drawReplay(context,instantOptions,62.4,1280,500).markers.find(m=>m.runner.id===targetId)!.cards.find(c=>c.kind==='received')!;
assert.equal(instant.progress,null);assert.equal(instant.visualOnly,true);
assert.ok(!drawReplay(context,instantOptions,62.5,1280,500).markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'));
let previous=cardFrame;
for(let t=61.01;t<62;t+=.01){const current=drawReplay(context,realOptions,t,1280,500);
  for(const rect of current.cardRects){const prior=previous.cardRects.find(r=>r.runnerId===rect.runnerId&&r.card.id===rect.card.id);if(prior){assert.equal(rect.side,prior.side);assert.ok(Math.hypot(rect.x-prior.x,rect.y-prior.y)<15);}}
  previous=current;
}
const awayRace={...visionRace,frames:visionRace.frames.map(frame=>({...frame,runners:frame.runners.map(sample=>sample.runnerId===targetId?{...sample,distance:Math.max(0,frame.runners[0].distance!-30)}:sample)}))};
const away=drawReplay(context,{...realOptions,race:awayRace,selected:targetId,window:40,analysis:analyzeRace(awayRace,reference)},61,1280,500);
assert.ok(!away.markers.some(m=>m.runner.id===sourceId));assert.ok(away.markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'));
const immuneRace={...visionRace,runners:visionRace.runners.map(r=>({...r,teamGroup:7}))};
const immuneOptions={...realOptions,race:immuneRace,analysis:analyzeRace(immuneRace,reference)};
const immune=drawReplay(context,immuneOptions,61,1280,500).markers.find(m=>m.runner.id===targetId)!.cards.find(c=>c.kind==='received')!;
assert.equal(immune.color,'#97a1ba');assert.ok(replayCardHelp(immuneOptions,immune).includes('immune'));assert.ok(!replayCardHelp(immuneOptions,immune).includes('mask'));
const expected=drawReplay(context,realOptions,61.2,1280,500);
for(const t of [0,80,61.2,59,62,61.2])drawReplay(context,realOptions,t,1280,500);
assert.deepEqual(drawReplay(context,realOptions,61.2,1280,500),expected);
// Adversarial whole-playback races pass through import-backed sampling and the
// actual shared renderer: crossing owners, growing stacks and dense fields.
const overlaps=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
let layoutFrames=0,largestLayoutStep=0,farthestCard=0,layoutOverlap=0,portraitOverlap=0,minimapOverlap=0,swaps=0;
let worstPortrait:unknown=null,worstDistance:unknown=null;
let wideLayoutFrames=0,wideLayoutOverlap=0,wideLayoutStep=0;
for(const width of [760,1280,1920])for(const scenario of ['crossing','heights','crowded']){
  const height=Math.round(1.3*Math.max(560,Math.min(680,width*.5)));
  const runners=Array.from({length:scenario==='crowded'?9:4},(_,i)=>({...race.runners[i%race.runners.length],id:`layout-${i}`,index:i,gate:i+1,name:`Layout runner ${i+1}`}));
  const layoutRace:Race={...race,runners,duration:12,courseId:10506,distance:2500,events:[],frames:Array.from({length:49},(_,frame)=>{
    const time=frame/4;return {time,runners:runners.map((r,i)=>({runnerId:r.id,speed:20,hp:1000,lane:(i%3)*.1,
      distance:200+20*time+(i-(runners.length-1)/2)*2+(i%2?1:-1)*(time-6)*2}))};})};
  const reserve={x:width-222,y:38,width:210,height:100};
  const layoutOptions:ReplayOptions={race:layoutRace,course:reference.courses[10506],reference,selected:runners[0].id,follow:'selected',window:140,labels:true,elevation:true,cardObstacles:[reserve],
    intervals:id=>Array.from({length:scenario==='heights'?6:scenario==='crowded'?5:2},(_,i)=>({kind:'skill',label:`Layout effect ${i+1}`,skillId:200362,start:scenario==='heights'?i*.63:0,end:12,evidence:'recorded'}))};
  if(scenario==='crowded')for(const zoom of [150,200,300,600]){
    const wideOptions={...layoutOptions,window:zoom};let maxOverlap=0,maxOverlapRatio=0,maxStep=0,last:ReturnType<typeof drawReplay>|null=null;
    for(let frame=60;frame<150;frame++){
      texts.length=0;const wide=drawReplay(context,wideOptions,frame/30,width,height);wideLayoutFrames++;
      assert.equal(wide.cardRects.length,wide.markers.reduce((n,m)=>n+m.cards.length,0));
      assert.equal(texts.at(-1),wide.cardGroups.find(g=>g.runnerId===wideOptions.selected)!.header,'The selected header and effects must paint above all other content.');
      let area=0;
      for(const [i,g]of wide.cardGroups.entries()){
        const owner=wide.markers.find(m=>m.runner.id===g.runnerId)!;
        const gap=Math.hypot(Math.max(g.x-owner.x,0,owner.x-g.x-g.width),Math.max(g.y-owner.y,0,owner.y-g.y-g.height));
        assert.ok(gap<230,`Wide card left its owner: ${width}/${zoom}: ${gap}`);
        assert.ok(g.x>=7.999&&g.y>=35.999&&g.x+g.width<=width-7.999&&g.y+g.height<=height-103.999);
        for(const other of wide.cardGroups.slice(i+1))area+=overlaps(g,other);
        const prev=last?.cardGroups.find(p=>p.runnerId===g.runnerId);if(prev)maxStep=Math.max(maxStep,Math.hypot(g.x-prev.x,g.y-prev.y));
      }
      maxOverlap=Math.max(maxOverlap,area);maxOverlapRatio=Math.max(maxOverlapRatio,area/wide.cardGroups.reduce((sum,g)=>sum+g.width*g.height,0));last=wide;
    }
    // Dense nine-runner fields allow limited overlap to keep labels near their
    // owners. Check a fraction of visible stack area, independent of font size.
    if(width>=1280){assert.ok(maxOverlapRatio<.2,`Wide stacks remain crowded: ${width}/${zoom}: ${maxOverlapRatio}`);wideLayoutOverlap=Math.max(wideLayoutOverlap,maxOverlap);}
    assert.ok(maxStep<15,`Wide layout jumped: ${width}/${zoom}: ${maxStep}`);wideLayoutStep=Math.max(wideLayoutStep,maxStep);
    const seek=drawReplay(context,wideOptions,3,width,height);drawReplay(context,wideOptions,1,width,height);assert.deepEqual(drawReplay(context,wideOptions,3,width,height),seek);
  }
  let previousLayout:ReturnType<typeof drawReplay>|null=null,initialOrder:number|null=null;
  for(let frame=1;frame<360;frame++){
    texts.length=0;arcs.length=0;fills.length=0;strokes=[];strokeCaps=[];
    const scene=drawReplay(context,layoutOptions,frame/30,width,height);layoutFrames++;
    assert.equal(scene.cardRects.length,scene.markers.reduce((n,m)=>n+m.cards.length,0),'Every skill/status must have a visible row.');
    assert.ok(!texts.some(t=>/^\+\d+ more$/.test(t)),'No hidden-effect count chips.');
    for(const group of scene.cardGroups){
      const owner=scene.markers.find(m=>m.runner.id===group.runnerId)!;
      const gap=Math.hypot(Math.max(group.x-owner.x,0,owner.x-group.x-group.width),Math.max(group.y-owner.y,0,owner.y-group.y-group.height));if(gap>farthestCard){farthestCard=gap;worstDistance={scenario,width,frame,group,owner:{x:owner.x,y:owner.y}};}
      assert.ok(gap<180,`Card too far from owner: ${scenario}/${width}/${frame}: ${gap}`);
      assert.ok(group.x>=7.999&&group.y>=35.999&&group.x+group.width<=width-7.999&&group.y+group.height<=height-103.999,JSON.stringify({scenario,width,frame,group}));
      minimapOverlap=Math.max(minimapOverlap,overlaps(group,reserve));
      for(const m of scene.markers){const area=overlaps(group,{x:m.x-26,y:m.y-26,width:52,height:52});if(area>portraitOverlap){portraitOverlap=area;worstPortrait={scenario,width,frame,group,marker:{id:m.runner.id,x:m.x,y:m.y}};}}
      for(const other of scene.cardGroups)if(other.runnerId!==group.runnerId&&group.alpha>.99&&other.alpha>.99)layoutOverlap=Math.max(layoutOverlap,overlaps(group,other));
      const old=previousLayout?.cardGroups.find(g=>g.runnerId===group.runnerId);if(old&&old.alpha>.99&&group.alpha>.99&&frame>15){
        const step=Math.hypot(group.x-old.x,group.y-old.y);largestLayoutStep=Math.max(largestLayoutStep,step);assert.equal(group.side,old.side);
        assert.ok(step<15,`Layout relocation: ${scenario}/${width}/${frame}: ${step}`);
      }
    }
    if(scenario==='crossing'){
      const a=scene.cardGroups.find(g=>g.runnerId===runners[0].id)!,b=scene.cardGroups.find(g=>g.runnerId===runners[1].id)!;
      const order=Math.sign(a.x-b.x);if(initialOrder===null&&order)initialOrder=order;else if(order&&order!==initialOrder){swaps++;initialOrder=order;}
    }
    if(frame%79===0){const again=drawReplay(context,layoutOptions,frame/30,width,height);assert.deepEqual(again,scene);drawReplay(context,layoutOptions,1,width,height);assert.deepEqual(drawReplay(context,layoutOptions,frame/30,width,height),scene);}
    previousLayout=scene;
  }
}
assert.ok(swaps>0,`Crossing owner boxes must exchange horizontal order. ${JSON.stringify({farthestCard,largestLayoutStep,portraitOverlap,minimapOverlap,layoutOverlap,swaps,worstPortrait,worstDistance})}`);
// The user explicitly prefers every effect row over perfect packing. Measure
// intersections honestly; never hide rows to drive these counters to zero.
assert.ok([portraitOverlap,minimapOverlap,layoutOverlap].every(Number.isFinite));
console.log(JSON.stringify({gameCourses,renderedFrames,cornerBoundaries:boundaries,smoothCamera:'passed',worldTicks:'passed',sharedCanvas:'passed',markerToggles:'passed',
  outfitMappings:224,closerCamera:'passed',flatCuts:'passed',visionCandidates:'separate',automaticDebuffCone:'passed',visionModifiers:'passed',cardSideStability:'passed',cardClocks:'passed',seekClipDeterminism:'passed',receivedCards:'passed',cardViewport:'passed',teamImmunity:'passed',doubledTrack:'passed',singleRunnerHeader:'passed',runnerHeaderColor:'passed',
  layoutFrames,largestLayoutStep,farthestCard,layoutOverlap,portraitOverlap,minimapOverlap,horizontalSwaps:swaps,ownerAnchoredLayout:'passed',allEffectRowsVisible:'passed',fontScaling:'passed',wideLayoutFrames,wideLayoutOverlap,wideLayoutStep,wideViewSpacing:'passed',selectedStackOnTop:'passed'}));
