import type { Runner } from './types';
import { projectGeometry, readGeometry, type CourseGeometry, type GeometryData } from './geometry';

export interface ReferenceSource { name: string; revision: string; url: string; license?: string }
export interface CourseReference {
  id: number; name: string; trackName: string; raceTrackId: number;
  distance: number; surface: number; turn: number; course: number;
  laneMax: number | null; courseSetStatus: number[];
  corners: { start: number; length: number }[];
  straights: { start: number; end: number; frontType?: number }[];
  slopes: { start: number; length: number; slopePercent: number }[];
  source: ReferenceSource; geometry: 'segment-schematic' | 'game-path';
  gameGeometry?: CourseGeometry;
}
export interface SkillReference {
  name: string; rarity: number; groupId?: number; dataRegion?: 'Global' | 'JP';
  activateLot?: number; iconId?: number; tagId?:number; tagIds?:number[]; description?: string | null;
  branches: { condition: string; rawDuration: number; durationUsage: number;
    branchIndex?: number; precondition?: string; rawCooldown?: number;
    effects: { type: number; rawValue: number; valueUsage: number; levelUsage: number;
      targetType?: number; targetValue?: number; additionalActivateType?: number }[] }[];
}
export interface ReferenceMetadata {
  characters: Record<string, string>; outfits: Record<string, string>;
  trackNames: Record<string, string>; skillNames: Record<string, string>;
  skills: Record<string, SkillReference>; source: ReferenceSource;
  raceInstances?: Record<string, number>;
  raceInstanceConditions?: Record<string, { grade?: number; time?: number }>;
  fallback?: Pick<ReferenceMetadata, 'characters' | 'outfits' | 'skillNames' | 'skills' | 'source'>;
}
export interface ReferenceData {
  metadata: ReferenceMetadata; courses: Record<string, CourseReference>;
  simulatorSkillIds: Set<string>; source: ReferenceSource;
}
export interface CourseBand { start: number; end: number; label: string; kind: string }
interface RawCourse extends Omit<CourseReference, 'id' | 'name' | 'trackName' | 'source' | 'geometry' | 'gameGeometry' | 'slopes'> {
  slopes: { start: number; length: number; slope: number }[];
}
/** Fact data is separate from the application source and carries its own provenance. */
export function assembleReferenceData(metadata: ReferenceMetadata, raw: Record<string, RawCourse>,
  source: ReferenceSource, skillIds: string[], geometry?: GeometryData | null): ReferenceData {
  // Installed Global records always win, including complete branch arrays.
  // Fallback names and mechanics never fill individual holes inside a known skill.
  if (metadata.fallback) metadata = { ...metadata,
    characters: { ...metadata.fallback.characters, ...metadata.characters },
    outfits: { ...metadata.fallback.outfits, ...metadata.outfits },
    skillNames: { ...metadata.fallback.skillNames, ...metadata.skillNames },
    skills: { ...metadata.fallback.skills, ...metadata.skills } };
  const courses: Record<string, CourseReference> = {};
  for (const [id, c] of Object.entries(raw)) {
    const trackName = metadata.trackNames[c.raceTrackId] ?? `Track ${c.raceTrackId}`;
    const surface = c.surface === 1 ? 'Turf' : c.surface === 2 ? 'Dirt' : `Surface ${c.surface}`;
    const direction = c.turn === 1 ? 'Right' : c.turn === 2 ? 'Left' : [3, 4].includes(c.turn) ? 'Straight' : `Turn ${c.turn}`;
    const circuit = ({ 2: 'Inner', 3: 'Outer', 4: 'Outer to inner' } as Record<number, string>)[c.course];
    courses[id] = { ...c, id: Number(id), trackName,
      name: `${trackName} · ${c.distance} m · ${surface} · ${direction}${circuit ? ` · ${circuit}` : ''}`,
      slopes: c.slopes.map(s => ({ start: s.start, length: s.length, slopePercent: s.slope / 10000 })),
      source, geometry: 'segment-schematic' };
    const binding = geometry?.courses[id], path = binding && geometry?.paths[binding.path];
    if (binding && path && path.distance === c.distance) {
      courses[id].gameGeometry = { path, loop: binding.loop ? geometry?.paths[binding.loop] : undefined, asset: binding.path };
      courses[id].geometry = 'game-path';
    }
  }
  return { metadata, courses, source, simulatorSkillIds: new Set(skillIds) };
}
export async function loadReferenceData(): Promise<ReferenceData> {
  async function json<T>(name: string): Promise<T> {
    const url = new URL(`data/${name}`, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Reference data ${name}: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
  const [metadata, courses, source, ids, geometry] = await Promise.all([
    json<ReferenceMetadata>('metadata.json'), json<Record<string, RawCourse>>('courses.json'),
    json<ReferenceSource>('reference-source.json'), json<string[]>('simulator-skill-ids.json'),
    json<unknown>('course-geometry.json').then(readGeometry).catch(() => null),
  ]);
  return assembleReferenceData(metadata, courses, source, ids, geometry);
}
export function getCourse(data: ReferenceData | null, id: number | null): CourseReference | null {
  return data && id !== null ? data.courses[id] ?? null : null;
}
export function skillName(data: ReferenceData | null, id: number | null): string {
  if (id === null) return 'Unknown skill';
  // Inherited unique IDs share the base skill's name, with inheritance explicit.
  const s = String(id);
  if (s.startsWith('9')) {
    const base = data?.metadata.skillNames[`1${s.slice(1)}`];
    if (base) return `${base} (inherited)`;
  }
  const name = data?.metadata.skillNames[id];
  if (name) return name;
  return `Skill ${id}`;
}
export function runnerName(data: ReferenceData | null, runner: Runner): string {
  const known = runner.charaId === null ? null : data?.metadata.characters[runner.charaId];
  return known || runner.name || `Runner ${runner.index + 1}`;
}
export function runnerOutfit(data: ReferenceData | null, runner: Runner): string | null {
  return runner.cardId === null ? null : data?.metadata.outfits[runner.cardId] ?? null;
}
const effectNames: Record<number, string> = {
  1: 'Speed stat', 2: 'Stamina stat', 3: 'Power stat', 4: 'Guts stat', 5: 'Wit stat',
  9: 'Recovery', 10: 'Start-delay multiplier', 14: 'Start-delay override',
  21: 'Current speed', 22: 'Current speed · coast',
  27: 'Target speed', 28: 'Lane movement speed', 31: 'Acceleration',
  35: 'Lane change', 37: 'Random gold activation', 42: 'Evolved duration extension',
};
export function getSkillReference(data: ReferenceData | null, id: number): SkillReference | null {
  return data?.metadata.skills[id] ?? null;
}
/** Reference effects and base times, never an asserted observed effect/duration. */
export function skillSummary(data: ReferenceData | null, id: number): string {
  const skill = getSkillReference(data, id);
  if (!skill) return skillName(data, id);
  const effects = [...new Set(skill.branches.flatMap(b => b.effects.map(e => effectNames[e.type] ?? `Effect ${e.type}`)))];
  const times = [...new Set(skill.branches.filter(b => b.rawDuration > 0).map(b => b.rawDuration / 10000))];
  return [skillName(data, id), effects.join(', '), times.length ? `Base duration ${times.join('/')} s; actual duration is conditional` : 'Reference skill effect; observed duration unknown']
    .filter(Boolean).join(' · ');
}
export function coursePhases(distance: number): CourseBand[] {
  if (!Number.isFinite(distance) || distance <= 0) return [];
  return [
    { start: 0, end: distance / 6, label: 'Early', kind: 'early' },
    { start: distance / 6, end: distance * 2 / 3, label: 'Middle', kind: 'middle' },
    { start: distance * 2 / 3, end: distance * 5 / 6, label: 'Late', kind: 'late' },
    { start: distance * 5 / 6, end: distance, label: 'Final sixth', kind: 'final' },
  ];
}
export function courseSegments(course: CourseReference): CourseBand[] {
  return [
    ...course.corners.map((c, i) => ({ start: c.start, end: c.start + c.length,
      label: i === course.corners.length - 1 ? 'Final corner' : `Corner ${i + 1}`, kind: 'corner' })),
    ...course.straights.map((s, i) => ({ start: s.start, end: s.end,
      label: i === course.straights.length - 1 ? 'Final straight' : `Straight ${i + 1}`, kind: 'straight' })),
  ].sort((a, b) => a.start - b.start);
}
/** Relative metres above the starting datum, derived from published grade segments.
 * Neither the absolute altitude nor its alignment to physical terrain is known. */
export function elevationProfile(course: CourseReference): { distance: number; elevation: number }[] {
  const edges = [...new Set([0, course.distance, ...course.slopes.flatMap(s =>
    [Math.max(0, s.start), Math.min(course.distance, s.start + s.length)])])].sort((a, b) => a - b);
  let elevation = 0;
  return edges.map((distance, i) => {
    if (i) {
      const a = edges[i - 1], mid = (a + distance) / 2;
      const grade = course.slopes.filter(s => mid >= s.start && mid < s.start + s.length)
        .reduce((sum, s) => sum + s.slopePercent, 0);
      elevation += (distance - a) * grade / 100;
    }
    return { distance, elevation };
  });
}

interface MapPoint { distance: number; x: number; y: number; angle: number }
const mapCache = new WeakMap<CourseReference, MapPoint[]>();
const ovalLeft=270, ovalRight=730, ovalY=220, ovalRadius=115;
const ovalStraight=ovalRight-ovalLeft, ovalQuarter=Math.PI*ovalRadius/2;
const ovalLap=2*ovalStraight+4*ovalQuarter;
/** One consistent radius keeps the oval closed. Race traversal is separate from
 * this outline, so initial/final home stretches can overlap without a chord. */
function ovalPoint(progress:number, turn:number): {x:number;y:number;angle:number} {
  const lap=Math.floor(progress/ovalLap), s=progress-lap*ovalLap;
  let x:number,y:number,angle:number;
  if(s<ovalStraight){x=ovalLeft+s;y=ovalY+ovalRadius;angle=0;}
  else if(s<ovalStraight+2*ovalQuarter){
    const theta=Math.PI/2-(s-ovalStraight)/ovalRadius;
    x=ovalRight+Math.cos(theta)*ovalRadius;y=ovalY+Math.sin(theta)*ovalRadius;angle=theta-Math.PI/2;
  }else if(s<2*ovalStraight+2*ovalQuarter){
    x=ovalRight-(s-ovalStraight-2*ovalQuarter);y=ovalY-ovalRadius;angle=-Math.PI;
  }else{
    const theta=-Math.PI/2-(s-2*ovalStraight-2*ovalQuarter)/ovalRadius;
    x=ovalLeft+Math.cos(theta)*ovalRadius;y=ovalY+Math.sin(theta)*ovalRadius;angle=theta-Math.PI/2;
  }
  angle-=lap*2*Math.PI;
  return turn===1?{x:1000-x,y,angle:Math.PI-angle}:{x,y,angle};
}
function quarterStart(index:number):number {
  const lap=Math.floor(index/4), quarter=index-lap*4;
  return lap*ovalLap+(quarter<2?ovalStraight+quarter*ovalQuarter:2*ovalStraight+quarter*ovalQuarter);
}
/** Exact source metre boundaries map onto normalized quarter arcs/straights.
 * The final home-straight endpoint is inset rather than a surveyed finish line;
 * where a complete home stretch is absent, its metre scale is estimated from
 * the final stretch occupying 80% of the diagram's home straight. */
export function courseMap(course: CourseReference): MapPoint[] {
  if (course.gameGeometry) return projectGeometry(course.gameGeometry).route;
  const cached = mapCache.get(course); if (cached) return cached;
  const corners=course.corners.filter(c=>c.length>0&&c.start>=0&&c.start<course.distance).sort((a,b)=>a.start-b.start);
  if(!corners.length){
    const points=[{distance:0,x:120,y:220,angle:0},{distance:course.distance,x:880,y:220,angle:0}];
    mapCache.set(course,points);return points;
  }
  const finalStretch=Math.max(0,course.distance-corners[corners.length-1].start-corners[corners.length-1].length);
  let homeMetres=Math.max(1,finalStretch/.8),backMetres=homeMetres;
  for(let i=1;i<corners.length;i++){
    const quarter=i+4-corners.length;
    const gap=corners[i].start-corners[i-1].start-corners[i-1].length;
    if(((quarter%4)+4)%4===0&&gap>0)homeMetres=Math.max(homeMetres,gap);
    if(((quarter%4)+4)%4===2&&gap>0)backMetres=gap;
  }
  const anchors:{distance:number;progress:number}[]=[];
  const firstQuarter=4-corners.length,firstProgress=quarterStart(firstQuarter);
  const firstSlot=((firstQuarter%4)+4)%4;
  const firstScale=firstSlot===2?backMetres:homeMetres;
  if(corners[0].start>0)anchors.push({distance:0,progress:firstProgress-Math.min(.95,corners[0].start/firstScale)*ovalStraight});
  for(let i=0;i<corners.length;i++){
    const corner=corners[i],progress=quarterStart(i+4-corners.length);
    anchors.push({distance:corner.start,progress});
    anchors.push({distance:Math.min(course.distance,corner.start+corner.length),progress:progress+ovalQuarter});
  }
  if(finalStretch>0)anchors.push({distance:course.distance,progress:ovalLap+Math.min(.95,finalStretch/homeMetres)*ovalStraight});
  const points:MapPoint[]=[];
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i];
    if(!i){points.push({distance:a.distance,...ovalPoint(a.progress,course.turn)});continue;}
    const before=anchors[i-1],length=a.distance-before.distance;
    if(length<=0)continue;
    const steps=Math.max(1,Math.ceil(length/5));
    for(let j=1;j<=steps;j++){
      const t=j/steps;
      points.push({distance:before.distance+length*t,...ovalPoint(before.progress+(a.progress-before.progress)*t,course.turn)});
    }
  }
  mapCache.set(course, points); return points;
}
export function coursePoint(course: CourseReference, distance: number, lane = 0): { x: number; y: number; angle: number } {
  const points = courseMap(course), d = Math.max(0, Math.min(course.distance, distance));
  let i = 1; while (i < points.length - 1 && points[i].distance < d) i++;
  const a = points[i - 1] ?? points[0], b = points[i] ?? a;
  const t = b.distance === a.distance ? 0 : (d - a.distance) / (b.distance - a.distance);
  const delta = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
  const angle = a.angle + delta * t;
  // Mirroring travel direction also reverses the tangent's normal: positive
  // lane offsets stay outside the oval for both clockwise and anticlockwise.
  const offset=course.turn===1?-lane:lane;
  return { x: a.x + (b.x - a.x) * t - Math.sin(angle) * offset,
    y: a.y + (b.y - a.y) * t + Math.cos(angle) * offset, angle };
}
export function coursePath(course: CourseReference): string {
  if (course.gameGeometry) return projectGeometry(course.gameGeometry).outline;
  if(!course.corners.length)return 'M120,220 L880,220';
  return `M${ovalLeft},${ovalY+ovalRadius} H${ovalRight} A${ovalRadius},${ovalRadius} 0 0 0 ${ovalRight},${ovalY-ovalRadius} H${ovalLeft} A${ovalRadius},${ovalRadius} 0 0 0 ${ovalLeft},${ovalY+ovalRadius} Z`;
}
