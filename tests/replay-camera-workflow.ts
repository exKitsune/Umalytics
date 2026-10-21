/** Whole-file import/reference/render workflow. No browser or private race required. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleReferenceData } from '../src/data/reference';
import { readGeometry } from '../src/data/geometry';
import { DEFAULT_REPLAY_WINDOW, cameraAngle, replayCourseMarkers, replayScene, type ReplayOptions, type ReplayScene } from '../src/replay/model';
import { drawReplay, courseLabelRect, replayMetres, fallbackPalette } from '../src/replay/draw';
import { portraitUrl } from '../src/data/portraits';
import { iconSource } from '../src/data/game-icons';
import { replayCardHelp, replayCards, layoutReplayCards } from '../src/replay/cards';
import { runnerColors } from '../src/library';
import type { Race } from '../src/data/types';
import { analyzeRace } from '../src/data/analytics';
import { parseRaceJson } from '../src/data/import';
import { runnerGap } from '../src/view-model';
import { replayPhaseTimes, REPLAY_PHASE_COLOR } from '../src/replay/phases';

const folder=process.argv[2],root=join(import.meta.dirname,'..');
assert.equal(replayMetres(1000,1200,true),'-200 m');
assert.equal(replayMetres(1200,1200,true),'0 m');
assert.equal(replayMetres(1000,null,true),'1000 m','Unknown finish stays distance travelled');
assert.equal(replayMetres(1000,1200,false),'1000 m');
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
const texts:string[]=[],textColors=new Map<string,string>(),arcs:number[][]=[],fills:{x:number;y:number;width:number;height:number;color:string}[]=[];
let strokes:number[][][]=[],path:number[][]=[];
let strokeCaps:string[]=[];
// The shared live/clip renderer emits real paths and portrait positions into a
// recording Canvas2D surface, so its transform is checked beyond scene metadata.
const context=new Proxy({
  measureText:(text:string)=>({width:text.length*6}),
  createLinearGradient:()=>({addColorStop:()=>{}}),
  fillText:(text:string)=>{texts.push(text);textColors.set(text,context.fillStyle as string);},
  fillRect:(x:number,y:number,width:number,height:number)=>fills.push({x,y,width,height,color:context.fillStyle as string}),
  beginPath:()=>{path=[];},moveTo:(x:number,y:number)=>path.push([x,y]),lineTo:(x:number,y:number)=>path.push([x,y]),
  stroke:()=>{strokes.push(path.map(p=>[...p]));strokeCaps.push(context.lineCap);},arc:(x:number,y:number,r:number)=>arcs.push([x,y,r]),
}, {get:(target,key)=>Reflect.get(target,key)??(()=>{})}) as unknown as CanvasRenderingContext2D;
const enabled={phases:true,sections:true,slopes:true,remaining777:true};
// Independently measure the shortest distance from each road segment to a
// card rectangle. This catches edge/corner intersections between route samples.
function assertOffTrack(scene:ReplayScene){
  for(const card of scene.cardGroups){
    const corners=[[card.x,card.y],[card.x+card.width,card.y],[card.x,card.y+card.height],[card.x+card.width,card.y+card.height]];
    for(let i=1;i<scene.route.length;i++){
      const a=scene.route[i-1],b=scene.route[i],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
      let near=Math.min(...[a,b].map(p=>Math.hypot(Math.max(card.x-p.x,0,p.x-card.x-card.width),Math.max(card.y-p.y,0,p.y-card.y-card.height))));
      for(const [x,y] of corners){const t=length2?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length2)):0;near=Math.min(near,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));}
      let enter=0,leave=1;
      for(const [p,q] of [[-dx,a.x-card.x],[dx,card.x+card.width-a.x],[-dy,a.y-card.y],[dy,card.y+card.height-a.y]]){
        if(p===0){if(q<0){enter=1;leave=0;break;}}else if(p<0)enter=Math.max(enter,q/p);else leave=Math.min(leave,q/p);
      }
      if(enter<=leave)near=0;
      assert.ok(near>=scene.trackWidth/2+4-1e-5,`Card ${card.runnerId} overlaps the track at ${scene.time}s (${near}px)`);
    }
  }
}
let renderedFrames=0,boundaries=0,gameCourses=0,courseLabels=0,left=false,right=false;
for(const course of Object.values(reference.courses).filter(c=>c.gameGeometry)){
  gameCourses++;left||=course.turn===2;right||=course.turn===1;
  const value:Race={...race,distance:course.distance,courseId:course.id,duration:120,
    frames:[0,120].map(time=>({time,runners:race.runners.map((runner,i)=>({runnerId:runner.id,distance:Math.max(0,course.distance*time/120-i*10),speed:20,hp:1000,lane:i*.2}))}))};
  // Course geometry is swept for every course; representative courses also run
  // card layout here. The full crowded playback scenarios below exercise cards
  // at every animation frame rather than repeating120s of label history119times.
  const options:ReplayOptions={race:value,course,reference,selected:value.runners[0].id,follow:'selected',window:140,labels:[10101,10506,10606].includes(course.id),elevation:true,courseMarkers:enabled,intervals:()=>[{kind:'skill',label:'Synthetic corner effect',start:0,end:120,evidence:'recorded',skillId:200362}]};
  const render=(distance:number)=>{texts.length=0;arcs.length=0;fills.length=0;strokes=[];strokeCaps=[];const scene=drawReplay(context,options,distance/course.distance*120,1280,500);renderedFrames++;
    assertOffTrack(scene);
    for(const marker of scene.courseMarkers){
      const rect=courseLabelRect(marker,180,44,scene,1280);courseLabels++;
      assert.ok(rect.y+rect.height<marker.y-scene.trackWidth/2,'Course signs stay above the road for both turn directions');
    }
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
    for(const rect of before.cardRects){const other=after.cardRects.find(r=>r.runnerId===rect.runnerId&&r.card.id===rect.card.id)!;
      if(rect.side!==other.side)assert.ok(Math.max(rect.card.alpha,other.card.alpha)<.03,'A bank swap at a corner must be faded out');
      else assert.ok(Math.hypot(rect.x-other.x,rect.y-other.y)<2);
    }
    assert.deepEqual(render(edge-.02),before); // no corner rotation/fitting leap
  }
  const signs=replayCourseMarkers(course,course.distance,enabled);
  assert.ok(signs.some(s=>s.label.includes('777m left')&&s.distance===course.distance-777));
  assert.ok(signs.some(s=>s.phase&&s.label.includes('Midleg')&&Math.abs(s.distance-course.distance/6)<.001));
  for(const d of signs.map(s=>s.distance)){const scene=render(d);assert.ok(scene.courseMarkers.some(s=>Math.abs(s.distance-d)<.001));
    for(const label of texts.filter(t=>/Midleg|Late race/.test(t)&&!t.endsWith(' s')))assert.equal(textColors.get(label),REPLAY_PHASE_COLOR,'Phase signs are orange');}
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
const phaseRace:Race={...race,distance:600,duration:60,runners:race.runners.slice(0,2),frames:[0,10,30,60].map((time,i)=>({time,runners:race.runners.slice(0,2).map((runner,j)=>({runnerId:runner.id,distance:(j?[0,50,250,600]:[0,100,400,600])[i],speed:20,hp:1000,lane:0}))}))};
const phaseMarks=replayPhaseTimes(phaseRace,phaseRace.runners[0].id);
assert.deepEqual(phaseMarks.map(m=>[m.label,m.time]),[['Midleg',10],['Late race',30]]);
const slowerMarks=replayPhaseTimes(phaseRace,phaseRace.runners[1].id);
assert.equal(slowerMarks[0].time,15);assert.ok(Math.abs(slowerMarks[1].time-(30+30*150/350))<1e-8,'Seek markers follow the selected runner’s crossings, not fractions of race time');
assert.deepEqual(replayPhaseTimes({...phaseRace,distance:null},phaseRace.runners[0].id),[]);
assert.deepEqual(replayPhaseTimes(phaseRace,'unrecorded-runner'),[]);
assert.deepEqual(replayPhaseTimes({...phaseRace,frames:phaseRace.frames.slice(2)},phaseRace.runners[0].id).map(m=>m.label),['Late race'],'Missing early crossings are not fabricated');
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
// Use the live viewer height: a 500px-high export cannot fit 200% text,
// multiple effect columns and a 234px road with separate off-track rails.
texts.length=0;const cardFrame=drawReplay(context,realOptions,61,1280,800);
assert.equal(texts.filter(t=>t.startsWith('#')).length,cardFrame.cardGroups.length);
assert.ok(cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards.length>1);
assert.equal(cardFrame.cardGroups.filter(g=>g.runnerId===sourceId).length,1);
assert.ok(cardFrame.cardRects.filter(r=>r.runnerId===sourceId).every(r=>r.height>24));
const fontSize=()=>Number(context.font.match(/([\d.]+)px/)?.[1]);
const baseFont=fontSize(),largeFrame=drawReplay(context,{...realOptions,fontScale:200},61,1280,800);
assert.ok(Math.abs(fontSize()-baseFont*2)<1e-6,'Replay text follows the percentage setting.');
assert.ok(context.font.startsWith('bold '),'The selected runner header is emphasized.');
assert.deepEqual(largeFrame.route,cardFrame.route,'Text size must not change the course or camera.');
assert.deepEqual(largeFrame.cardRects.map(r=>r.card.id),cardFrame.cardRects.map(r=>r.card.id));
assert.ok(largeFrame.cardRects.every(r=>r.height>cardFrame.cardRects[0].height&&r.width>cardFrame.cardRects[0].width));
assert.ok(largeFrame.cardRects.every(r=>r.x>=8&&r.x+r.width<=1272&&r.y>=36&&r.y+r.height<=696));
assert.deepEqual(drawReplay(context,realOptions,61,1280,800),cardFrame,'Reset restores the original label layout.');

assert.ok(cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards.some(c=>c.label==='Downhill mode'&&c.detail.includes('Modeled')));
assert.ok(!cardFrame.markers.some(m=>m.labels.some(label=>/GRADE|Proc|Start/.test(label))));
assert.ok(cardFrame.markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'&&c.iconKey.startsWith('skill-')));
const sourceCards=cardFrame.markers.find(m=>m.runner.id===sourceId)!.cards;
assert.ok(!sourceCards.some(c=>/^status:(force-in|conserve-power):/.test(c.id)));
assert.ok(sourceCards.some(c=>c.id.startsWith('status:release-conserve-power:')));
assert.ok(sourceCards.some(c=>c.id.startsWith('status:last-spurt:')));
const spurtCard=sourceCards.find(c=>c.id==='status:last-spurt:59')!;
assert.equal(spurtCard.end,70,'Replay notification preserves the real status end');
assert.equal(spurtCard.displayEnd,61.5);assert.equal(spurtCard.progress,null);assert.equal(spurtCard.visualOnly,true);
assert.equal(replayCardHelp(realOptions,spurtCard),'Started the final spurt.');
assert.ok(!replayCards(realOptions,sourceId,61.5,cardFrame.markers[0].sample).some(c=>c.id==='status:last-spurt:59'),'Spurt notification disappears after 2.5 seconds');
assert.equal(cardAnalysis.runners[sourceId].intervals.find(i=>i.kind==='last-spurt'&&i.start===59)!.end,70,'Notification dwell never truncates analysis');
assert.ok(cardAnalysis.runners[sourceId].intervals.some(s=>s.kind==='force-in'),'Replay filters leave analysis intact');
const fallbackCards=replayCards({...realOptions,analysis:null,intervals:()=>[
  {kind:'force-in-model',label:'Inward',start:59,end:70,evidence:'estimated'},
  {kind:'conserve-power',label:'Conserve',start:59,end:70,evidence:'recorded'},
  {kind:'skill',skillId:201431,label:'Vision',start:59,end:70,evidence:'recorded'},
  {kind:'skill',skillId:99999999,label:'Unknown skill',start:59,end:70,evidence:'recorded'},
  {kind:'last-spurt',label:'Spurt',start:59,end:70,evidence:'recorded'},
]},sourceId,61,cardFrame.markers[0].sample);
assert.deepEqual(fallbackCards.filter(c=>c.kind!=='received').map(c=>c.label),['Unknown skill','Last spurt']);
for(const end of [null,100]){
  const passiveOptions={...realOptions,analysis:null,intervals:()=>[
    {kind:'skill',skillId:200012,label:'Right-Handed ○',start:60,end,evidence:'recorded'},
  ]};
  const proc=replayCards(passiveOptions,sourceId,61,cardFrame.markers[0].sample).find(c=>c.kind==='skill')!;
  assert.ok(proc,'Reference passives still show their activation in fallback replay');
  assert.equal(proc.displayEnd,62.5);assert.equal(proc.progress,null);assert.equal(proc.end,end);
  assert.equal(replayCardHelp(passiveOptions,proc),'Passive bonus applied.');
  assert.ok(!replayCards(passiveOptions,sourceId,62.5,cardFrame.markers[0].sample).some(c=>c.kind==='skill'),'Reference passives expire as notifications, with or without a known effect end');
}
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
for(let t=61.01;t<62;t+=.01){const current=drawReplay(context,realOptions,t,1280,800);
  for(const rect of current.cardRects){const prior=previous.cardRects.find(r=>r.runnerId===rect.runnerId&&r.card.id===rect.card.id);if(prior){
    if(rect.side!==prior.side)assert.ok(Math.max(rect.card.alpha,prior.card.alpha)<.03,'A bank swap must not jump while visible');
    else assert.ok(Math.hypot(rect.x-prior.x,rect.y-prior.y)<15);
  }}
  previous=current;
}
const awayRace={...visionRace,frames:visionRace.frames.map(frame=>({...frame,runners:frame.runners.map(sample=>sample.runnerId===targetId?{...sample,distance:Math.max(0,frame.runners[0].distance!-30)}:sample)}))};
const away=drawReplay(context,{...realOptions,race:awayRace,selected:targetId,window:40,analysis:analyzeRace(awayRace,reference)},61,1280,500);
assert.ok(!away.markers.some(m=>m.runner.id===sourceId));assert.ok(away.markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'));
const immuneRace={...visionRace,runners:visionRace.runners.map(r=>({...r,teamGroup:7}))};
const immuneOptions={...realOptions,race:immuneRace,analysis:analyzeRace(immuneRace,reference)};
const immune=drawReplay(context,immuneOptions,61,1280,500).markers.find(m=>m.runner.id===targetId)!.cards.find(c=>c.kind==='received')!;
assert.equal(immune.color,'#97a1ba');assert.ok(replayCardHelp(immuneOptions,immune).includes('immune'));assert.ok(!replayCardHelp(immuneOptions,immune).includes('mask'));
const delivered={...instantOptions.debuffActivations[0],end:90,effectiveEnd:90,effectiveDuration:30,timingKind:'reported' as const,
  simulatedRecipients:{[targetId]:[{type:8,rawValue:-100000,evaluatedValue:-10,valueUsage:1,levelUsage:0,targetType:2,appliedStart:61,appliedEnd:65}]}};
const deliveredOptions={...immuneOptions,debuffActivations:[delivered]};
const deliveredFrame=(time:number)=>drawReplay(context,deliveredOptions,time,1280,500);
assert.ok(!deliveredFrame(60.5).markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'),'Recipient popup starts at delivery, not the caster activation');
const hit=deliveredFrame(62).markers.find(m=>m.runner.id===targetId)!.cards.find(c=>c.kind==='received')!;
assert.equal(hit.start,61);assert.equal(hit.end,65);assert.equal(hit.progress,.75);
assert.equal(hit.color,'#e47474','Confirmed delivery overrides an inferred same-team exclusion');
assert.match(replayCardHelp(deliveredOptions,hit),/Effect applied/);assert.doesNotMatch(replayCardHelp(deliveredOptions,hit),/immune|depends/);
assert.match(deliveredFrame(62).debuffs[0].label,/1 confirmed recipients/);
assert.deepEqual(deliveredFrame(65).debuffs,[],'The recipient arrow expires with the delivered effect, not the caster duration');
assert.ok(!deliveredFrame(65).markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'));
delivered.simulatedRecipients={};
assert.deepEqual(deliveredFrame(62).debuffs,[],'A queued target without a delivered effect is not a confirmed recipient');
assert.ok(!deliveredFrame(62).markers.find(m=>m.runner.id===targetId)!.cards.some(c=>c.kind==='received'));
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
  const height=36+Math.round(1.3*Math.max(560,Math.min(680,width*.5)));
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
      texts.length=0;const wide=drawReplay(context,wideOptions,frame/30,width,height);wideLayoutFrames++;assertOffTrack(wide);
      assert.equal(wide.cardRects.length,wide.markers.reduce((n,m)=>n+m.cards.length,0));
      assert.equal(texts.at(-1),wide.cardGroups.find(g=>g.runnerId===wideOptions.selected)!.header,'The selected header and effects must paint above all other content.');
      let area=0;
      for(const [i,g]of wide.cardGroups.entries()){
        const owner=wide.markers.find(m=>m.runner.id===g.runnerId)!;
        const gap=Math.hypot(Math.max(g.x-owner.x,0,owner.x-g.x-g.width),Math.max(g.y-owner.y,0,owner.y-g.y-g.height));
        assert.ok(gap<Math.max(500,width*.5),`Wide card left its owner: ${width}/${zoom}: ${gap}`);
        assert.ok(g.x>=7.999&&g.y>=35.999&&g.x+g.width<=width-7.999&&g.y+g.height<=height-103.999);
        for(const other of wide.cardGroups.slice(i+1))area+=overlaps(g,other);
        const prev=last?.cardGroups.find(p=>p.runnerId===g.runnerId);if(prev){
          if(g.side!==prev.side)assert.ok(Math.max(g.alpha,prev.alpha)<.08,'A cross-track relocation must happen while the box is faded out');
          if(g.alpha>.99&&prev.alpha>.99)maxStep=Math.max(maxStep,Math.hypot(g.x-prev.x,g.y-prev.y));
        }
      }
      maxOverlap=Math.max(maxOverlap,area);maxOverlapRatio=Math.max(maxOverlapRatio,area/wide.cardGroups.reduce((sum,g)=>sum+g.width*g.height,0));last=wide;
    }
    // The road is now forbidden even in a dense nine-runner view. Keep all
    // effect rows and measure crowding in the smaller off-track area.
    if(width>=1280){assert.ok(maxOverlapRatio<.35,`Wide stacks remain crowded: ${width}/${zoom}: ${maxOverlapRatio}`);wideLayoutOverlap=Math.max(wideLayoutOverlap,maxOverlap);}
    assert.ok(maxStep<28,`Wide layout jumped: ${width}/${zoom}: ${maxStep}`);wideLayoutStep=Math.max(wideLayoutStep,maxStep);
    const seek=drawReplay(context,wideOptions,3,width,height);drawReplay(context,wideOptions,1,width,height);assert.deepEqual(drawReplay(context,wideOptions,3,width,height),seek);
  }
  let previousLayout:ReturnType<typeof drawReplay>|null=null,initialOrder:number|null=null;
  for(let frame=1;frame<360;frame++){
    texts.length=0;arcs.length=0;fills.length=0;strokes=[];strokeCaps=[];
    const scene=drawReplay(context,layoutOptions,frame/30,width,height);layoutFrames++;assertOffTrack(scene);
    assert.equal(scene.cardRects.length,scene.markers.reduce((n,m)=>n+m.cards.length,0),'Every skill/status must have a visible row.');
    assert.ok(!texts.some(t=>/^\+\d+ more$/.test(t)),'No hidden-effect count chips.');
    for(const group of scene.cardGroups){
      const owner=scene.markers.find(m=>m.runner.id===group.runnerId)!;
      const gap=Math.hypot(Math.max(group.x-owner.x,0,owner.x-group.x-group.width),Math.max(group.y-owner.y,0,owner.y-group.y-group.height));if(gap>farthestCard){farthestCard=gap;worstDistance={scenario,width,frame,group,owner:{x:owner.x,y:owner.y}};}
      // Allow a broader tether to use free space rather than cover another
      // stack; track clearance and readable boxes take priority over centering.
      assert.ok(gap<Math.max(500,width*.5),`Card too far from owner: ${scenario}/${width}/${frame}: ${gap}`);
      assert.ok(group.x>=7.999&&group.y>=35.999&&group.x+group.width<=width-7.999&&group.y+group.height<=height-103.999,JSON.stringify({scenario,width,frame,group}));
      minimapOverlap=Math.max(minimapOverlap,overlaps(group,reserve));
      for(const m of scene.markers){const area=overlaps(group,{x:m.x-26,y:m.y-26,width:52,height:52});if(area>portraitOverlap){portraitOverlap=area;worstPortrait={scenario,width,frame,group,marker:{id:m.runner.id,x:m.x,y:m.y}};}}
      for(const other of scene.cardGroups)if(other.runnerId!==group.runnerId&&group.alpha>.99&&other.alpha>.99)layoutOverlap=Math.max(layoutOverlap,overlaps(group,other));
      const old=previousLayout?.cardGroups.find(g=>g.runnerId===group.runnerId);if(old&&old.alpha>.99&&group.alpha>.99&&frame>15){
        const step=Math.hypot(group.x-old.x,group.y-old.y);largestLayoutStep=Math.max(largestLayoutStep,step);assert.equal(group.side,old.side);
        assert.ok(step<28,`Layout relocation: ${scenario}/${width}/${frame}: ${step}`);
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
const trafficTicks=[{start:5,end:5.04,blocked:true,near:false,selfLoss:.2,finalLoss:0},{start:5.15,end:5.19,blocked:true,near:false,selfLoss:.1,finalLoss:0},{start:6.5,end:6.54,blocked:true,near:false,selfLoss:.3,finalLoss:0}];
const flickerIntervals=[{kind:'traffic',label:'Traffic',start:5,end:6.54,evidence:'simulated' as const,traffic:trafficTicks,detail:'Short traffic checks.'}];
const flickerOptions={...realOptions,overlays:{vision:false,debuffs:false},analysis:{...cardAnalysis,runners:{...cardAnalysis.runners,[sourceId]:{...cardAnalysis.runners[sourceId],intervals:flickerIntervals,skillActivations:[]}}}};
const originalTraffic=JSON.stringify(flickerIntervals);
const trafficCards=(time:number)=>replayCards(flickerOptions,sourceId,time,cardFrame.markers[0].sample).filter(c=>c.label==='Traffic');
assert.equal(trafficCards(4.99).length,0,'Look-ahead never shows a status before it occurs');
const firstTraffic=trafficCards(5.02)[0],heldTraffic=trafficCards(5.1)[0],againTraffic=trafficCards(5.17)[0];
assert.equal(firstTraffic.id,heldTraffic.id);assert.equal(heldTraffic.id,againTraffic.id);
assert.equal(heldTraffic.end,5.04);assert.equal(heldTraffic.visualOnly,true);assert.equal(heldTraffic.progress,0);
assert.match(replayCardHelp(flickerOptions,heldTraffic),/Recently active/);
assert.equal(againTraffic.end,5.19);assert.equal(againTraffic.visualOnly,false);
assert.equal(trafficCards(5.5).length,1,'A very brief notification stays readable');
assert.equal(trafficCards(5.8).length,0,'A settled clear gap removes the notification');
assert.notEqual(trafficCards(6.52)[0].id,firstTraffic.id,'Separate episodes stay separate');
assert.deepEqual(trafficCards(5.1),[heldTraffic],'Rewinding reproduces the same display hold');
assert.equal(JSON.stringify(flickerIntervals),originalTraffic,'Display holds never alter traffic evidence or totals');

const forecastRunners=race.runners.slice(0,2);
const forecastRace=(moving:boolean):Race=>({...race,courseId:null,distance:2500,duration:4,runners:forecastRunners,events:[],frames:[0,.1,1,4].map(time=>({time,runners:forecastRunners.map((r,i)=>({runnerId:r.id,distance:300-i*6+(moving&&time>.1&&i?18:0),lane:0,speed:20,hp:1000}))}))});
const forecastOptions:ReplayOptions={race:forecastRace(false),course:null,reference,selected:forecastRunners[0].id,window:140,follow:'selected',labels:true,elevation:false,intervals:()=>[{kind:'skill',skillId:200362,label:'Current skill',start:0,end:4,evidence:'recorded'}]};
const still=replayScene(forecastOptions,.05,1280,800),moving=replayScene({...forecastOptions,race:forecastRace(true)},.05,1280,800);
assert.deepEqual(still.markers.map(m=>[m.x,m.y]),moving.markers.map(m=>[m.x,m.y]));
assert.notDeepEqual(still.cardGroups,moving.cardGroups,'Future positions influence the initial card placement');
assertOffTrack(still);assertOffTrack(moving);
const cameraReport={gameCourses,renderedFrames,cornerBoundaries:boundaries,smoothCamera:'passed',worldTicks:'passed',sharedCanvas:'passed',markerToggles:'passed',
  outfitMappings:224,closerCamera:'passed',flatCuts:'passed',visionCandidates:'separate',automaticDebuffCone:'passed',visionModifiers:'passed',cardSideStability:'passed',cardClocks:'passed',seekClipDeterminism:'passed',receivedCards:'passed',cardViewport:'passed',teamImmunity:'passed',doubledTrack:'passed',singleRunnerHeader:'passed',runnerHeaderColor:'passed',
  layoutFrames,largestLayoutStep,farthestCard,layoutOverlap,portraitOverlap,minimapOverlap,horizontalSwaps:swaps,ownerAnchoredLayout:'passed',allEffectRowsVisible:'passed',fontScaling:'passed',wideLayoutFrames,wideLayoutOverlap,wideLayoutStep,wideViewSpacing:'passed',selectedStackOnTop:'passed',offTrack:'passed',initialLookAhead:'passed',statusFlickerHold:'passed'};

assert.ok(courseLabels>100,'Exercise actual course signs across course geometry');

// Two leaders on the same notification shelf stay almost level after late
// race. They must use free horizontal space instead of remaining superimposed.
const pairRunners=Array.from({length:9},(_,i)=>({...race.runners[i%race.runners.length],id:`pair-${i}`,index:i,gate:i+1,name:`Pair runner ${i+1}`}));
const pairRace:Race={...race,runners:pairRunners,courseId:10701,distance:1200,duration:12,events:[],frames:Array.from({length:49},(_,frame)=>{
  const time=frame/4;return {time,runners:pairRunners.map((runner,i)=>({runnerId:runner.id,speed:20,hp:1000,lane:(i%3)*.08,
    distance:820+20*time+(i===0?0:i===8?Math.sin(time/2)*.5:-4-i*1.5)}))};})};
const pairOptions:ReplayOptions={race:pairRace,course:reference.courses[10701],reference,selected:pairRunners[0].id,follow:'selected',window:50,labels:true,elevation:true,
  intervals:()=>Array.from({length:5},(_,i)=>({kind:'skill',label:`Pair effect ${i+1}`,skillId:200362,start:0,end:12,evidence:'recorded'}))};
const pairChecks=[];
for(const width of [1206,1846,2726,3126]){
  const height=36+Math.round(1.3*Math.max(560,Math.min(680,width*.5))),options={...pairOptions,cardObstacles:[{x:width-222,y:38,width:210,height:100}]};
  let run=0,longest=0,maxStep=0,leaderMoved=false,previous:ReplayScene|null=null;
  for(let frame=15;frame<345;frame++){
    const scene=replayScene(options,frame/30,width,height);assertOffTrack(scene);
    const a=scene.cardGroups.find(g=>g.runnerId==='pair-0')!,b=scene.cardGroups.find(g=>g.runnerId==='pair-8')!;
    if(overlaps(a,b)>1){run+=1/30;longest=Math.max(longest,run);}else run=0;
    const owner=scene.markers.find(m=>m.runner.id==='pair-0')!;leaderMoved||=Math.abs(a.x+a.width/2-owner.x)>40;
    if(previous)for(const group of scene.cardGroups){const old=previous.cardGroups.find(g=>g.runnerId===group.runnerId);if(old){
      if(group.side!==old.side)assert.ok(Math.max(group.alpha,old.alpha)<.08,'A side swap fades between off-track positions');
      if(group.alpha>.99&&old.alpha>.99)maxStep=Math.max(maxStep,Math.hypot(group.x-old.x,group.y-old.y));
    }}
    previous=scene;
  }
  assert.ok(longest<1,`A clear wide viewport must not leave the leaders overlapped: ${width}/${longest}s`);
  assert.ok(maxStep<28,`The over-center transition must stay smooth: ${width}/${maxStep}px`);
  const direct=replayScene({...options,race:{...pairRace}},7.35,width,height);
  assert.deepEqual(direct,replayScene(options,7.35,width,height),'A cold direct seek reconstructs the same slot history');
  pairChecks.push({width,longestOverlap:longest,maxStep,leaderMoved});
}

// Opposite gate parity must not put a lower runner's box above the field. As
// the runners exchange lanes, both boxes should exchange banks without ever
// painting through the road or oscillating back to their old gate-based side.
const bankRunners=pairRunners.slice(0,2);
const bankRace:Race={...pairRace,runners:bankRunners,courseId:null,distance:2500,frames:Array.from({length:49},(_,frame)=>{
  const time=frame/4,lane=Math.max(0,Math.min(1,(6-time)/3));
  return {time,runners:bankRunners.map((runner,i)=>({runnerId:runner.id,speed:20,hp:1000,lane:i?1-lane:lane,distance:200+time*20+(i?2:-2)}))};
})};
const bankChecks=[];
for(const width of [1280,3092]){
  const height=920,options={...pairOptions,race:bankRace,course:null};
  const first=replayScene(options,.05,width,height);
  assert.deepEqual(bankRunners.map(r=>first.cardGroups.find(g=>g.runnerId===r.id)!.side),['below','above'],'Initial banks follow on-screen lanes rather than runner index');
  const counts=new Map<string,number>();let previous=first;
  for(let frame=2;frame<330;frame++){
    const scene=replayScene(options,frame/30,width,height);assertOffTrack(scene);
    for(const group of scene.cardGroups){const old=previous.cardGroups.find(g=>g.runnerId===group.runnerId)!;
      if(group.side!==old.side){assert.ok(Math.max(group.alpha,old.alpha)<.08);counts.set(group.runnerId,(counts.get(group.runnerId)??0)+1);}
      else if(group.alpha>.99&&old.alpha>.99)assert.ok(Math.hypot(group.x-old.x,group.y-old.y)<28,'Same-bank motion stays smooth');
    }
    previous=scene;
  }
  assert.deepEqual(bankRunners.map(r=>previous.cardGroups.find(g=>g.runnerId===r.id)!.side),['above','below']);
  assert.deepEqual(bankRunners.map(r=>counts.get(r.id)),[1,1],'Each runner makes one sustained bank exchange');
  assert.deepEqual(replayScene({...options,race:{...bankRace}},6.35,width,height),replayScene(options,6.35,width,height),'Side planning is identical after a direct seek');
  bankChecks.push({width,sideChanges:[...counts.values()]});
}
// A close upper pack has spare room below it. Short notification gaps should
// reserve the same slots without displaying phantom rows or shifting a runner
// whose own effects remain active throughout the gap.
const quietRace:Race={...pairRace,courseId:null,distance:2500,duration:20,frames:[0,19,20].map(time=>({time,runners:pairRunners.map((runner,i)=>({runnerId:runner.id,speed:0,hp:1000,
  lane:time===20?i/8:i===3?.3:i===7?.4:i*.01,distance:400+i*.35}))}))};
const quietOptions:ReplayOptions={...pairOptions,race:quietRace,course:null,window:40,intervals:id=>{
  const periods=id==='pair-0'?[[0,20]]:[[0,5.1],[5.7,11.1],[11.7,20]];
  return periods.flatMap(([start,end])=>Array.from({length:3},(_,i)=>({kind:'skill',label:`Steady slot ${i}`,skillId:200362,start,end,evidence:'recorded'})));
}};
const quietBefore=replayScene(quietOptions,4.9,3092,920),quietGap=replayScene(quietOptions,5.4,3092,920),quietAfter=replayScene(quietOptions,6.3,3092,920);
assert.equal(quietGap.cardGroups.length,1,'Reserved slots do not display expired or future notifications');
assert.equal(quietGap.cardRects.length,3);
const quietAnchor=quietBefore.cardGroups.find(g=>g.runnerId==='pair-0')!;
for(const scene of [quietBefore,quietGap,quietAfter]){
  assertOffTrack(scene);const anchor=scene.cardGroups.find(g=>g.runnerId==='pair-0')!;
  assert.equal(anchor.side,quietAnchor.side);
  assert.ok(Math.hypot(anchor.x-quietAnchor.x,anchor.y-quietAnchor.y)<4,'Short notification gaps must not reshuffle the steady box');
}
for(const id of ['pair-3','pair-7']){
  assert.equal(quietBefore.cardGroups.find(g=>g.runnerId===id)!.side,'below','The lower members of a crowded upper pack use the free lower bank');
  assert.equal(quietAfter.cardGroups.find(g=>g.runnerId===id)!.side,'below','A notification gap retains its bank');
}
assert.deepEqual(replayScene({...quietOptions,race:{...quietRace}},6.3,3092,920),quietAfter,'Direct seeking reproduces the reserved slots');

// A squeezed middle box should not have to jump to another tier while both
// neighbours have room to yield sideways. Exercise the actual reserved sizes.
const sharedMarkers=[0,1,2].map((i)=>({...quietBefore.markers[i],x:[690,500,880][i],y:400,cardSide:'above' as const,
  focused:i===0,cards:quietBefore.markers[0].cards}));
const sharedTrack={route:[{x:0,y:400},{x:1400,y:400}],trackWidth:234};
const shared=layoutReplayCards(sharedMarkers,1400,920,[],{offsets:new Map(sharedMarkers.map(m=>[m.runner.id,{x:0,y:-95,side:'above' as const}])),lockSides:true,iterations:0},100,50,sharedTrack);
const sharedGroups=sharedMarkers.map(m=>shared.cardGroups.find(g=>g.runnerId===m.runner.id)!);
assert.ok(Math.abs(sharedGroups[0].x+sharedGroups[0].width/2-690)<1,'The middle stack stays centered when neighbours can yield');
assert.ok(sharedGroups[1].x+sharedGroups[1].width/2<480&&sharedGroups[2].x+sharedGroups[2].width/2>900,'Both neighbours share the required horizontal adjustment');
for(const group of sharedGroups)assert.ok(Math.abs(group.y+group.height-271)<1,'All three stacks keep the same track-facing tier');
assert.ok(overlaps(sharedGroups[0],sharedGroups[1])===0&&overlaps(sharedGroups[0],sharedGroups[2])===0);

// Course signs are world-anchored decorations. Show an actual skill stack on
// top of Midleg and verify the sign is painted first without dodging it.
const signRace:Race={...quietRace,distance:1200,runners:[pairRunners[0]],frames:[0,20].map(time=>({time,runners:[{runnerId:pairRunners[0].id,distance:200,speed:0,hp:1000,lane:0}]}))};
const signOptions:ReplayOptions={...quietOptions,race:signRace,window:50,elevation:false,courseMarkers:enabled};
fills.length=0;drawReplay(context,{...signOptions,labels:false},10,1400,920);
const signFill={...fills.find(f=>f.color===fallbackPalette.panel)!};assert.ok(signFill.width>0);
fills.length=0;const withSign=drawReplay(context,signOptions,10,1400,920);
const signIndex=fills.findIndex(f=>f.color===fallbackPalette.panel);
assert.deepEqual(fills[signIndex],signFill,'Skill stacks cannot shift course signs');
const stack=withSign.cardGroups[0];assert.ok(overlaps(signFill,stack)>0,'Exercise an actual sign/skill overlap');
assert.ok(fills.findIndex(f=>f.x===stack.x&&f.y===stack.y&&f.width===stack.width&&f.height===stack.height)>signIndex,'Skill stacks paint over course signs');
assert.deepEqual(replayScene({...signOptions,courseMarkers:{phases:false,sections:false,slopes:false,remaining777:false}},10,1400,920).cardGroups,withSign.cardGroups,'Course signs cannot shift skill stacks');
console.log(JSON.stringify({...cameraReport,leaderPairSeparation:'passed',pairChecks,positionBasedBanks:'passed',bankChecks,notificationGapSlots:'passed',packBalance:'passed',sharedRowSpacing:'passed',fixedCourseSigns:'passed'}));
