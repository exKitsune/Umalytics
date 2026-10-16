import type { Race, Runner, RunnerSample } from '../data/types';
import type { CourseReference, ReferenceData } from '../data/reference';
import { courseMap, coursePhases, courseSegments, elevationProfile, runnerName, skillName } from '../data/reference';
import { telemetryIndex } from '../telemetry';
import { sampleAt } from '../data/sample';
import type { RaceAnalysis } from '../data/analytics';
import type { DebuffActivation } from '../data/effect-types';
import { visionDistanceAt } from '../data/skill-impact';
import { replayCards, layoutReplayCards, CARD_DWELL } from './cards';

export interface ReplayInterval { kind:string; label:string; start:number; end:number|null; evidence:string; skillId?:number|null; detail?:string }
export const DEFAULT_REPLAY_WINDOW=50;
export interface ReplayOptions {
  race:Race; course:CourseReference|null; reference:ReferenceData|null; selected:string;
  fontScale?:number;
  window:number; follow:'selected'|'leader'; labels:boolean; elevation:boolean;
  courseMarkers?:{phases:boolean;sections:boolean;slopes:boolean;remaining777:boolean};
  overlays?:{vision:boolean;debuffs:boolean};
  debuffActivations?:readonly DebuffActivation[];
  visionDistance?:(runnerId:string,time:number)=>{metres:number|null;detail:string};
  intervals?: (runnerId:string) => readonly ReplayInterval[];
  analysis?:RaceAnalysis|null;
  /** Live-only screen overlays. Clip renderers omit the DOM minimap. */
  cardObstacles?:{x:number;y:number;width:number;height:number}[];
}
export interface ReplayPoint { x:number; y:number; height:number; angle:number }
export interface ReplayCard {
  id:string;label:string;kind:'skill'|'status'|'received';iconKey:string;color:string;
  start:number;end:number|null;displayEnd:number;progress:number|null;visualOnly:boolean;detail:string;alpha:number;
  sourceRunnerId?:string;
}
export interface ReplayScene {
  time:number; distance:number; phase:string; from:number; to:number;
  route:{distance:number;x:number;y:number;height:number}[];
  markers:{runner:Runner; sample:RunnerSample; x:number;y:number;name:string;labels:string[];cards:ReplayCard[];cardSide:'above'|'below';focused?:boolean}[];
  cardRects:{runnerId:string;card:ReplayCard;x:number;y:number;width:number;height:number;side:'above'|'below'}[];
  cardGroups:{runnerId:string;header:string;x:number;y:number;width:number;height:number;alpha:number;side:'above'|'below'}[];
  elevation:{distance:number;height:number}[]; geometry:string; laneNote:string;
  trackWidth:number;
  routeEnds:{start:boolean;finish:boolean};
  camera:{angle:number;scale:number;x:number;y:number};
  distanceTicks:{distance:number;x:number;y:number;angle:number;major:boolean}[];
  courseMarkers:{distance:number;x:number;y:number;angle:number;label:string}[];
  vision:{sourceRunnerId:string;polygon:{x:number;y:number}[];route:{x:number;y:number}[];label:string;detail:string;candidateRunnerIds:string[]}[];
  debuffs:{source:{x:number;y:number};sourceRunnerId:string;label:string;recipientsKnown:boolean;activationOnly:boolean;targets:{runnerId:string;x:number;y:number}[]}[];
}
const laneCache=new WeakMap<Race,{min:number;max:number}>();
const elevationCache=new WeakMap<CourseReference,ReturnType<typeof elevationProfile>>();
/** Metres relative to the starting datum: metre distance × percent grade /100.
 * The raw CourseLaneAnim Y scale is unresolved and is deliberately not renamed. */
export function relativeElevation(course:CourseReference,distance:number):number {
  let points=elevationCache.get(course);
  if(!points){points=elevationProfile(course);elevationCache.set(course,points);}
  if(!points.length)return 0;
  const d=Math.max(0,Math.min(course.distance,distance));
  let lo=0,hi=points.length-1;while(hi-lo>1){const mid=(lo+hi)>>>1;if(points[mid].distance<=d)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi];
  return a.elevation+(b.elevation-a.elevation)*(b.distance===a.distance?0:(d-a.distance)/(b.distance-a.distance));
}
/** Only recorded lateral ordering is known. Gate/index never contributes here. */
export function laneRange(race:Race):{min:number;max:number} {
  const cached=laneCache.get(race);if(cached)return cached;
  let min=Infinity,max=-Infinity;
  for(const frame of race.frames)for(const sample of frame.runners)if(sample.lane!==null&&Number.isFinite(sample.lane)){min=Math.min(min,sample.lane);max=Math.max(max,sample.lane);}
  const result=Number.isFinite(min)?{min,max}:{min:0,max:0};laneCache.set(race,result);return result;
}
/** Estimated position across a drawn track, lowest recorded lane nearest the
 * inner edge. The range is visual, not a lane-to-metres calibration. */
export function estimatedLaneOffset(race:Race,lane:number|null,width:number):number {
  if(lane===null||!Number.isFinite(lane))return 0;
  const range=laneRange(race);
  const fraction=range.max>range.min?Math.max(0,Math.min(1,(lane-range.min)/(range.max-range.min))):0;
  return -width*.42+fraction*width*.84;
}
/** The same linear visual lane scale as runner placement, without edge clamp.
 * Fractions are course-width units; one horse lane is1/18 of that unit. */
function visualLaneSlope(race:Race,width:number):number {
  const range=laneRange(race);return width*.84/(range.max>range.min?range.max-range.min:1);
}
export function rawCoursePoint(course:CourseReference|null,distance:number):ReplayPoint {
  const path=course?.gameGeometry?.path;
  if(path){
    const progress=Math.max(0,Math.min(path.distance,distance))/path.distance*(path.points.length-1);
    const i=Math.min(path.points.length-2,Math.floor(progress)),t=progress-i;
    const a=path.points[i],b=path.points[i+1];
    const tangent=(index:number)=>{const before=path.points[Math.max(0,index-1)],after=path.points[Math.min(path.points.length-1,index+1)];return Math.atan2(after[2]-before[2],-(after[0]-before[0]));};
    const aa=tangent(i),ba=tangent(i+1);
    return {x:-(a[0]+(b[0]-a[0])*t),y:a[2]+(b[2]-a[2])*t,
      height:a[1]+(b[1]-a[1])*t,angle:aa+Math.atan2(Math.sin(ba-aa),Math.cos(ba-aa))*t};
  }
  if(course){
    const points=courseMap(course),d=Math.max(0,Math.min(course.distance,distance));
    let lo=0,hi=points.length-1;while(hi-lo>1){const mid=(lo+hi)>>>1;if(points[mid].distance<=d)lo=mid;else hi=mid;}
    const a=points[lo],b=points[hi],t=b.distance===a.distance?0:(d-a.distance)/(b.distance-a.distance);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,height:0,angle:a.angle+Math.atan2(Math.sin(b.angle-a.angle),Math.cos(b.angle-a.angle))*t};
  }
  return {x:distance,y:0,height:0,angle:0};
}
const cameraCache=new WeakMap<CourseReference,number[]>();
/** A course-distance camera, never playback history: the centred18m chord
 * eases entry/exit from bends; unwrapped2m samples make seeks/clips identical. */
export function cameraAngle(course:CourseReference|null,distance:number):number {
  if(!course)return 0;
  let angles=cameraCache.get(course);
  if(!angles){angles=[];for(let d=0;d<=course.distance+2;d+=2){
    const a=rawCoursePoint(course,Math.max(0,d-18)),b=rawCoursePoint(course,Math.min(course.distance,d+18));
    let angle=Math.atan2(b.y-a.y,b.x-a.x);
    if(angles.length){const previous=angles.at(-1)!;angle=previous+Math.atan2(Math.sin(angle-previous),Math.cos(angle-previous));}
    angles.push(angle);
  }cameraCache.set(course,angles);}
  const p=Math.max(0,Math.min(course.distance,distance))/2,i=Math.floor(p);
  return angles[i]+((angles[i+1]??angles[i])-angles[i])*(p-i);
}
function phaseAt(distance:number,total:number):string {
  if(!total)return 'Phase unknown';
  return distance<total/6?'Early race':distance<total*2/3?'Middle race':distance<total*5/6?'Late race':'Last spurt';
}
/** Marker distances are fixed in course space, independently of the camera. */
export function replayCourseMarkers(course:CourseReference|null,total:number,enabled:ReplayOptions['courseMarkers']):{distance:number;label:string}[] {
  if(!enabled||!Number.isFinite(total)||total<=0)return [];
  const markers:{distance:number;label:string}[]=[];
  if(enabled.phases)for(const phase of coursePhases(total).slice(1))markers.push({distance:phase.start,label:phase.label});
  if(course&&enabled.sections){
    const bands=courseSegments(course);
    const edges=[...new Set(bands.flatMap(b=>[b.start,b.end]))].sort((a,b)=>a-b);
    for(const distance of edges){
      if(distance<=0||distance>=total)continue;
      const starting=bands.filter(b=>Math.abs(b.start-distance)<.001);
      const ending=bands.filter(b=>Math.abs(b.end-distance)<.001);
      markers.push({distance,label:starting.length?starting.map(b=>b.label).join(' / '):ending.map(b=>`${b.label} ends`).join(' / ')});
    }
  }
  if(course&&enabled.slopes){
    const edges=[...new Set(course.slopes.flatMap(s=>[s.start,s.start+s.length]))].sort((a,b)=>a-b);
    const grade=(d:number)=>course.slopes.filter(s=>d>=s.start&&d<s.start+s.length).reduce((sum,s)=>sum+s.slopePercent,0);
    for(const distance of edges){
      if(distance<=0||distance>=total)continue;
      const before=grade(distance-.001),after=grade(distance+.001);
      if(Math.abs(before-after)<.00001)continue;
      markers.push({distance,label:after>0?`Uphill ${after.toFixed(1)}%`:after<0?`Downhill ${Math.abs(after).toFixed(1)}%`:'Level'});
    }
  }
  if(enabled.remaining777&&total>=777)markers.push({distance:total-777,label:'777m left'});
  // One sign at coincident boundaries, preserving every enabled category.
  const merged=new Map<number,string[]>();
  for(const marker of markers){const distance=Math.round(marker.distance*1000)/1000;merged.set(distance,[...(merged.get(distance)??[]),marker.label]);}
  return [...merged].sort((a,b)=>a[0]-b[0]).map(([distance,labels])=>({distance,label:[...new Set(labels)].join(' · ')}));
}
export function replayLabels(options:ReplayOptions,runnerId:string,time:number,sample:RunnerSample):string[] {
  return replayCards(options,runnerId,time,sample).map(card=>card.label);
}
function buildReplayScene(options:ReplayOptions,time:number,width:number,height:number,layout:boolean,markersOnly:true):ReplayScene['markers'];
function buildReplayScene(options:ReplayOptions,time:number,width:number,height:number,layout?:boolean,markersOnly?:false):ReplayScene;
function buildReplayScene(options:ReplayOptions,time:number,width:number,height:number,layout=true,markersOnly=false):ReplayScene|ReplayScene['markers'] {
  const samples=sampleAt(options.race,time,options.reference),known=samples.filter(s=>s.distance!==null&&Number.isFinite(s.distance));
  const chosen=options.follow==='leader'?known.reduce<RunnerSample|undefined>((a,b)=>!a||b.distance!>a.distance!?b:a,undefined):known.find(s=>s.runnerId===options.selected);
  const total=options.race.distance??options.course?.distance??telemetryIndex(options.race).extent;
  const distance=Math.max(0,Math.min(total,chosen?.distance??0));
  const course=options.course&&(options.race.distance===null||options.course.distance===options.race.distance)?options.course:null;
  const window=Math.max(40,Math.min(600,options.window)),from=Math.max(0,distance-window*.4),to=Math.min(total,distance+window*.6);
  const camera=rawCoursePoint(course,distance),angle=cameraAngle(course,distance),cos=Math.cos(angle),sin=Math.sin(angle);
  const local=(point:ReplayPoint)=>({x:(point.x-camera.x)*cos+(point.y-camera.y)*sin,y:-(point.x-camera.x)*sin+(point.y-camera.y)*cos});
  // Fixed horizontal scale; smoothly rotating course-distance orientation.
  const scale=Math.max(30,width-100)/window;
  const transform=(point:ReplayPoint)=>{const p=local(point);return {x:width*.43+p.x*scale,y:height*.46+p.y*scale};};
  const trackWidth=Math.max(91,Math.min(234,36*scale*1.3));
  const roster=new Map(options.race.runners.map(r=>[r.id,r]));
  const markers:ReplayScene['markers']=[];
  for(const sample of known){
    const visibleDistance=Math.max(0,Math.min(total,sample.distance!));
    if(visibleDistance<from||visibleDistance>to)continue;
    const runner=roster.get(sample.runnerId);if(!runner)continue;
    const point=rawCoursePoint(course,visibleDistance),normalSign=course?.turn===1?-1:1;
    // Apply the outward normal in world space, then rotate into the camera view.
    const offset=estimatedLaneOffset(options.race,sample.lane,trackWidth)/scale*normalSign;
    const projected=transform({...point,x:point.x-Math.sin(point.angle)*offset,y:point.y+Math.cos(point.angle)*offset});
    const cards=replayCards(options,runner.id,time,sample);
    markers.push({runner,sample,...projected,name:runnerName(options.reference,runner),labels:cards.map(c=>c.label),cards,cardSide:runner.index%2===0?'above':'below',focused:runner.id===options.selected});
  }
  // Layout history needs owner positions and cards only. Avoid constructing
  // routes, elevation, signs and vision polygons for each smoothing knot.
  if(markersOnly)return markers;
  const world:{distance:number;point:ReplayPoint}[]=[];
  const steps=Math.max(2,Math.ceil((to-from)/2));
  for(let i=0;i<=steps;i++){
    const d=from+(to-from)*i/steps;world.push({distance:d,point:rawCoursePoint(course,d)});
  }
  const distanceTicks:ReplayScene['distanceTicks']=[],step=window>300?100:50;
  for(let d=Math.ceil(from/step)*step;d<=to;d+=step){const point=rawCoursePoint(course,d);distanceTicks.push({distance:d,...transform(point),angle:point.angle-angle,major:d%100===0});}
  const courseMarkers=replayCourseMarkers(course,options.race.distance??course?.distance??0,options.courseMarkers).filter(m=>m.distance>=from&&m.distance<=to).map(m=>{const point=rawCoursePoint(course,m.distance);return {...m,...transform(point),angle:point.angle-angle};});
  const vision:ReplayScene['vision']=[],visionSources=new Map<string,string>();
  if(options.overlays?.vision)visionSources.set(options.selected,'');
  if(options.overlays?.debuffs&&options.analysis)for(const [runnerId,runner]of Object.entries(options.analysis.runners))for(const skill of runner.skillActivations){
    if(!skill.effects.some(effect=>effect.type===8&&(effect.targetType??1)===1))continue;
    const definition=options.reference?.metadata.skills[skill.referenceSkillId??skill.skillId];
    const tags=definition?.tagIds??(definition?.tagId!=null?[definition.tagId]:[]);
    // A green is on for the race. It changes vision distance; it does not draw a cone.
    if(skill.timingKind==='passive'||tags.some(tag=>tag>=601&&tag<=615))continue;
    const end=skill.effectiveEnd??skill.end;
    if(time>=skill.start&&time<Math.max(skill.start+CARD_DWELL,end??skill.start))visionSources.set(runnerId,skillName(options.reference,skill.referenceSkillId??skill.skillId));
  }
  const debuffs:ReplayScene['debuffs']=[];
  const activations=options.debuffActivations??options.analysis?.debuffs??[];
  if(options.overlays?.debuffs)for(const activation of activations){
    const end=activation.effectiveEnd??activation.end;
    const activationOnly=end===null||end<=activation.start;
    if(time<activation.start||time>=Math.max(activation.start+CARD_DWELL,end??activation.start))continue;
    const source=markers.find(m=>m.runner.id===activation.sourceRunnerId);if(!source)continue;
    // Explicit gaze-skill families; targetType4 is not generalized to every skill.
    if([201441,201442,201511,201512].includes(activation.skillId))visionSources.set(source.runner.id,skillName(options.reference,activation.skillId));
    // Only the recorded mask supplies recipients. Geometry does not add any.
    const targets=activation.recipientsKnown?markers.filter(m=>m.runner.id!==source.runner.id&&activation.targetRunnerIds.includes(m.runner.id)).map(m=>({runnerId:m.runner.id,x:m.x,y:m.y})):[];
    debuffs.push({source:{x:source.x,y:source.y},sourceRunnerId:source.runner.id,activationOnly,recipientsKnown:activation.recipientsKnown,
      label:`${skillName(options.reference,activation.skillId)} · ${activation.recipientsKnown?`${activation.targetRunnerIds.length} recorded targets`:'recipients unknown'}`,targets});
  }
  for(const [runnerId,skill]of visionSources){
    const source=markers.find(m=>m.runner.id===runnerId);if(!source||source.sample.distance===null||source.sample.lane===null)continue;
    const modified=options.visionDistance?.(runnerId,time)??(options.analysis?visionDistanceAt(options.race,runnerId,time,options.reference,options.analysis):undefined),resolved=modified?.metres;
    const visibleDistance=resolved!==null&&resolved!==undefined&&Number.isFinite(resolved)?Math.max(0,resolved):20;
    if(visibleDistance<=0)continue;
    const start=Math.max(0,Math.min(total,source.sample.distance)),end=Math.min(total,start+visibleDistance),normalSign=course?.turn===1?-1:1;
    const offset=estimatedLaneOffset(options.race,source.sample.lane,trackWidth)/scale*normalSign;
    const route:{x:number;y:number}[]=[],left:{x:number;y:number}[]=[],right:{x:number;y:number}[]=[];
    const distances=Array.from({length:Math.max(2,Math.ceil((end-start)/2))+1},(_,i)=>start+(end-start)*i/Math.max(2,Math.ceil((end-start)/2)));
    for(const d of distances){
      const point=rawCoursePoint(course,d),gap=d-start;
      const halfWidth=((gap/visibleDistance)*11.5+2)/36*visualLaneSlope(options.race,trackWidth)/scale;
      const at=(lateral:number)=>transform({...point,x:point.x-Math.sin(point.angle)*lateral,y:point.y+Math.cos(point.angle)*lateral});
      route.push(at(offset));left.push(at(offset-halfWidth));right.push(at(offset+halfWidth));
    }
    const candidateRunnerIds=known.filter(s=>{
      if(s.runnerId===runnerId||s.distance===null||s.lane===null)return false;
      const gap=s.distance-source.sample.distance!;
      return gap>=0&&gap<=visibleDistance&&Math.abs(s.lane-source.sample.lane!)<=((gap/visibleDistance)*11.5+2)/36;
    }).map(s=>s.runnerId);
    if(end>start)vision.push({sourceRunnerId:runnerId,route,polygon:[...left,...right.reverse()],candidateRunnerIds,
      label:`Reference vision ${visibleDistance.toFixed(0)}m${skill?` · ${skill}`:''}${resolved===null||resolved===undefined?' · modifiers unknown':''}`,
      detail:`Reference lane envelope: horse lane=1/18 course width; half-width=(gap/visibleDistance×11.5+2)/36. ${modified?.detail??'Base20m; skill modifiers unresolved.'} Visual spacing follows the portrait lane projection. Cone candidates are not recorded targets or proof of debuff effect; teammates may consume target limits but are immune to debuffs.`});
  }
  const cardLayout=layout?layoutReplayCards(markers,width,height,options.cardObstacles,undefined,options.fontScale,options.window):{cardRects:[],cardGroups:[]};
  return {time,distance,phase:phaseAt(distance,options.race.distance??course?.distance??0),from,to,
    route:world.map(p=>({...transform(p.point),distance:p.distance,height:p.point.height})),markers,...cardLayout,
    elevation:course?world.map(p=>({distance:p.distance,height:relativeElevation(course,p.distance)})):[],
    geometry:course?.gameGeometry?'Game-extracted course curve':course?'Course schematic':'Distance view · course unknown',
    trackWidth,routeEnds:{start:from===0,finish:(options.race.distance??course?.distance??0)>0&&to===(options.race.distance??course?.distance)},camera:{angle,scale,x:camera.x,y:camera.y},distanceTicks,courseMarkers,vision,debuffs,
    laneNote:'Portraits identify runners. Recorded lane order is preserved; fence alignment and spacing are estimated.'};
}
type LayoutOffsets=Map<string,{x:number;y:number}>;
// Retain only the owner-relative offsets used by smoothing. Marker/card/sample
// objects are transient; a configuration holds at most400 small offset maps.
const layoutCache=new WeakMap<Race,Map<string,Map<number,LayoutOffsets>>>();
const objectIds=new WeakMap<object,number>();let nextObjectId=0;
function objectId(value:object|null|undefined){if(!value)return 0;let id=objectIds.get(value);if(!id){id=++nextObjectId;objectIds.set(value,id);}return id;}
const layoutOffsets=(markers:ReplayScene['markers'],groups:ReplayScene['cardGroups']):LayoutOffsets=>new Map(groups.flatMap(g=>{
  const m=markers.find(m=>m.runner.id===g.runnerId);
  return m?[[g.runnerId,{x:g.x+g.width/2-m.x,y:g.y-m.y-(m.cardSide==='above'?-34-g.height:34)}] as const]:[];
}));
/** A fixed race-time smoothing window filters placement targets, not playback
 * history. Only nine nearby knots are needed on a cold seek. Residual offsets
 * follow owners immediately and never lag the camera or hide effect rows. */
export function replayScene(options:ReplayOptions,time:number,width:number,height:number):ReplayScene {
  const scene=buildReplayScene(options,time,width,height,false);
  if(!options.labels)return scene;
  let cache=layoutCache.get(options.race);if(!cache){cache=new Map();layoutCache.set(options.race,cache);}
  const revision=Object.values(options.analysis?.runners??{}).map(r=>r.intervals.length+'/'+r.skillActivations.length).join(',');
  const key=[objectId(options.course),objectId(options.reference),objectId(options.analysis),objectId(options.intervals),options.selected,options.follow,options.window,width,height,options.fontScale??100,revision,options.overlays?.debuffs,
    JSON.stringify(options.debuffActivations??options.analysis?.debuffs??[]),JSON.stringify(options.cardObstacles??[])].join('|');
  let frames=cache.get(key);if(!frames){frames=new Map();cache.set(key,frames);if(cache.size>8)cache.delete(cache.keys().next().value!);}
  const target=(index:number)=>{
    index=Math.max(0,index);let frame=frames!.get(index);
    if(!frame){const markers=buildReplayScene(options,index/5,width,height,false,true),placed=layoutReplayCards(markers,width,height,options.cardObstacles,undefined,options.fontScale,options.window);
      frame=layoutOffsets(markers,placed.cardGroups);frames!.set(index,frame);
      if(frames!.size>400)frames!.delete(frames!.keys().next().value!);
    }
    return frame;
  };
  const p=Math.max(0,time*5),k=Math.floor(p),f=p-k;
  const sums=new Map<string,{x:number;y:number;weight:number}>();
  for(let i=k-7;i<=k+1;i++){
    const weight=i===k-7?1-f:i===k+1?f:1;if(weight<=0)continue;
    for(const[id,point]of target(i)){const sum=sums.get(id)??{x:0,y:0,weight:0};sum.x+=point.x*weight;sum.y+=point.y*weight;sum.weight+=weight;sums.set(id,sum);}
  }
  const offsets=new Map([...sums].map(([id,p])=>[id,{x:p.x/p.weight,y:p.y/p.weight}]));
  return {...scene,...layoutReplayCards(scene.markers,width,height,options.cardObstacles,{offsets,iterations:0},options.fontScale,options.window)};
}
