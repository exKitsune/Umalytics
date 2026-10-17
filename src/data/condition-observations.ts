import type { Race, Runner, Frame, RunnerSample, RaceEvent } from './types';
import type { CourseReference, ReferenceData } from './reference';
import { referenceEquippedSkillId } from './equipped-skills';
import { effectValue } from './effect-value';
import { resolveSkillTiming } from './skill-timing';
import { fieldRankRange, completeFieldDistances, compareRankRange } from './field-rank';
import { createLastSpurtCondition } from './condition-spurt';
export type ObservationConfidence = 'known' | 'sampled' | 'proxy' | 'lower-bound';
export interface PredicateValue { value: number | null; confidence: ObservationConfidence; reason?: string; range?: [number, number];candidates?:{value:number|null;member:boolean|null}[] }
export interface ConditionObservation { time: number; values: Record<string, PredicateValue>; interpolated: boolean; priorEvents: RaceEvent[]; sameTimeEvents: RaceEvent[];runnerId?:string }
export interface ConditionContextOptions { reference?: ReferenceData | null; skillId?: number;branchIndex?:number;coverRandom?:boolean }
const value = (n: number | null | undefined, confidence: ObservationConfidence = 'known', reason?: string): PredicateValue => ({ value: n ?? null, confidence, ...(reason ? { reason } : {}) });
const code = (raw: string | null | undefined, max: number) => { const n = raw != null && /^\d+$/.test(raw) ? Number(raw) : NaN; return Number.isInteger(n) && n >= 1 && n <= max ? n : null; };
const selectedStyle = (runner: Runner) => runner.strategyCode === 5 ? 1 : runner.strategyCode ?? null;
const bounded=(low:number,high:number,reason:string):PredicateValue=>({value:low===high?low:null,range:[low,high],confidence:'known',reason});
/** Eight brackets, filled from the inside. Up to eight starters, bracket equals
 * gate. Larger fields give every bracket the same base count and put each
 * extra horse in an outer bracket. */
export function startingBracket(fieldSize: number, gate: number | null | undefined): number | null {
  if (gate == null || !Number.isInteger(fieldSize) || fieldSize < 1 || !Number.isInteger(gate) || gate < 1 || gate > fieldSize) return null;
  if (fieldSize <= 8) return gate;
  const base = Math.floor(fieldSize / 8), extra = fieldSize % 8;
  let cursor = 0;
  for (let bracket = 1; bracket <= 8; bracket++) {
    cursor += base + (bracket > 8 - extra ? 1 : 0);
    if (gate <= cursor) return bracket;
  }
  return null;
}
export function conditionStaticValues(race: Race, runner: Runner, course: CourseReference | null, options: ConditionContextOptions = {}): Record<string, PredicateValue> {
  const style = selectedStyle(runner), styles = race.runners.map(selectedStyle);
  const stat = (key: keyof NonNullable<Runner['stats']>) => {
    const raw = runner.stats?.[key];
    return raw != null && runner.mood != null && runner.mood >= 1 && runner.mood <= 5 ? Math.min(2000, Math.max(1, (raw > 1200 ? 1200 + (raw - 1200) / 2 : raw) * (1 + .02 * (runner.mood - 3)))) : null;
  };
  const same = style!==null?styles.filter(s=>s===style).length:null,unknownStyles=styles.filter(s=>s===null).length;
  const result: Record<string, PredicateValue> = {
    always: value(1), running_style: value(style), ground_type: value(course?.surface), distance_type: value(race.distance == null ? null : race.distance <= 1400 ? 1 : race.distance <= 1800 ? 2 : race.distance <= 2400 ? 3 : 4),
    rotation: value(course?.turn), track_id: value(course?.raceTrackId), distance: value(race.distance), course_distance: value(race.distance),
    weather: value(code(race.conditions?.weather, 4)), ground_condition: value(code(race.conditions?.ground, 4)), season: value(code(race.conditions?.season, 5)),
    is_basis_distance: value(race.distance == null ? null : Number(race.distance % 400 === 0)), motivation: value(runner.mood),
    popularity: value(runner.popularity), grade: value(race.grade), time: value(code(race.conditions?.timeOfDay, 4)),
    post_number: value(startingBracket(race.runners.length, runner.gate), 'known', runner.gate == null ? 'Recorded frame order is required to place this horse in a starting bracket.' : undefined),
    is_exist_chara_id: value(null),
    base_power: value(stat('power')), base_speed: value(stat('speed')), base_stamina: value(stat('stamina')), base_guts: value(stat('guts')), base_wiz: value(stat('wisdom')),
    is_badstart: value(runner.startDelay == null ? null : Number(runner.startDelay > .08)), corner_count: value(course?.corners.length),
    is_dirtgrade: value(course ? Number([10101, 10103, 10104, 10105].includes(course.raceTrackId)) : null),
    running_style_count_same: same===null?value(null):bounded(same,same+unknownStyles,'Unknown selected strategies widen the field count.'), running_style_count_same_rate:same===null?value(null):bounded(same*100/race.runners.length,(same+unknownStyles)*100/race.runners.length,'Unknown selected strategies widen the percentage.'),
  };
  const mostPopular = race.runners.find(r => r.popularity === 1);
  result.running_style_equal_popularity_one = value(mostPopular && style !== null && selectedStyle(mostPopular) !== null ? Number(selectedStyle(mostPopular) === style) : null);
  for (const [key, namedStyle] of Object.entries({ running_style_count_nige_otherself: 1, running_style_count_senko_otherself: 2, running_style_count_sashi_otherself: 3, running_style_count_oikomi_otherself: 4 })){const others=race.runners.filter(r=>r.id!==runner.id),low=others.filter(r=>selectedStyle(r)===namedStyle).length;result[key]=bounded(low,low+others.filter(r=>selectedStyle(r)===null).length,'Unknown selected strategies widen the opponent count.');}
  if (options.skillId !== undefined){let low=0,high=0;for(const r of race.runners){if(r.skills===undefined){high++;continue;}const ids=r.skills.map(s=>referenceEquippedSkillId(r,s.id));if(ids.includes(options.skillId)){low++;high++;}else if(ids.some(id=>id===null))high++;}result.same_skill_horse_count=bounded(low,high,'Missing inventory or unresolved inherited identity widens the count.');}
  return result;
}
function localEvent(race: Race, event: RaceEvent, runner: Runner): boolean { return event.runnerId === runner.id || event.runnerId === null && race.runners.find(r=>r.index===event.params[0])?.id === runner.id; }
function sample(frame: Frame, id: string): RunnerSample | undefined { return frame.runners.find(s => s.runnerId === id); }
function ranks(race: Race, frame: Frame): Map<string, number> {
  const result = new Map<string, number>();
  for (const runner of race.runners) {
    const range = fieldRankRange(race, frame, runner.id);
    if (range && range[0] === range[1]) result.set(runner.id, range[0]);
  }
  return result;
}
function interpolatedFrames(race: Race): { frame: Frame; interpolated: boolean }[] {
  const frames = race.frames.map(frame => ({ frame, interpolated: false })), times = new Set(race.frames.map(f => f.time));
  for (const time of new Set(race.events.filter(e => (e.type === 3 || e.type === 'skill') && e.params[2] !== -1).flatMap(e => [e.time,e.time+1/15]))) {
    if (times.has(time) || time < race.frames[0].time || time > race.duration) continue;
    const index = race.frames.findIndex(f => f.time > time); if (index < 1) continue;
    const a = race.frames[index - 1], b = race.frames[index], fraction = (time - a.time) / (b.time - a.time);
    const runners = a.runners.map(s => {
      const other = sample(b, s.runnerId), next = { ...s };
      for (const key of ['distance', 'speed', 'hp', 'lane'] as const) next[key] = s[key] == null || other?.[key] == null ? null : s[key]! + (other[key]! - s[key]!) * fraction;
      return next;
    });
    frames.push({ frame: { time, runners }, interpolated: true });
  }
  return frames.sort((a, b) => a.frame.time - b.frame.time);
}
function knownVision(race: Race, runner: Runner, time: number, staticValues: Record<string, PredicateValue>, reference: ReferenceData | null): number | null {
  if (!reference || !runner.skills) return null;
  let vision = 20;
  const added = new Set<number>();
  for (const equipped of runner.skills) {
    const id = referenceEquippedSkillId(runner, equipped.id), definition = id === null ? null : reference.metadata.skills[id];
    if (!definition) return null;
    const events = race.events.filter(e => (e.type === 3 || e.type === 'skill') && e.skillId !== null && referenceEquippedSkillId(runner, e.skillId) === id && localEvent(race, e, runner) && (e.params[2] !== -1 || e.time === 0) && e.time <= time);
    // A proc with an unrecognized branch can still change vision. Treat its
    // possible active window as unknown, rather than silently using base vision.
    for (const event of events) {
      if (definition.branches.length === 1 || definition.branches.some((b, i) => (b.branchIndex ?? i) === event.params[3])) continue;
      if (definition.branches.some(branch => {
        if (!branch.effects.some(e => e.type === 8 && (e.targetType ?? 1) === 1)) return false;
        const timing = resolveSkillTiming(race, runner, reference, branch, event.time, event.params[2] > 0 ? event.params[2] / 10000 : null, definition);
        return timing.effectiveEnd === null || time < timing.effectiveEnd;
      })) return null;
    }
    for (let i = 0; i < definition.branches.length; i++) {
      const branch = definition.branches[i], effects = branch.effects.filter(e => e.type === 8 && (e.targetType ?? 1) === 1);
      if (!effects.length) continue;
      const event = events.filter(e => e.params[3] === (branch.branchIndex ?? i) || definition.branches.length === 1).at(-1);
      const timing=event?resolveSkillTiming(race,runner,reference,branch,event.time,event.params[2]>0?event.params[2]/10000:null,definition):null;
      let active: boolean | null = event ? branch.rawDuration < 0 ? true : timing?.effectiveEnd!=null ? time < timing.effectiveEnd : null : false;
      if (!event && branch.rawDuration < 0) {
        if (definition.activateLot !== 0 || branch.precondition) return null;
        const alternatives = branch.condition.split('@').map(group => group.split('&').map(atom => {
          const m = atom.match(/^(\w+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/), a = m && staticValues[m[1]]?.value;
          if (!m || a == null) return null;
          return comparePredicate(a, m[2], Number(m[3]));
        }));
        active = alternatives.some(group => group.every(v => v === true)) ? true : alternatives.every(group => group.includes(false)) ? false : null;
      }
      if (active === null) return null;
      if (active && !added.has(id!)) {
        if (effects.some(e => e.valueUsage !== 1 || e.levelUsage !== 1 || e.targetType !== undefined && e.targetType !== 1)) return null;
        const values=effects.map(e=>effectValue(runner,id!,e));if(values.some(v=>v===null))return null;
        vision += values.reduce<number>((n,v)=>n+v!,0); added.add(id!);
      }
    }
  }
  // A foreign vision debuff with missing target/timing evidence cannot be ignored.
  for (const event of race.events) {
    if ((event.type !== 3 && event.type !== 'skill') || event.skillId == null || localEvent(race, event, runner) || event.time > time || event.params[2] === -1 && event.time !== 0) continue;
    const source=race.runners.find(r=>r.id===event.runnerId)??race.runners.find(r=>r.index===event.params[0]);if(!source)return null;
    const definitionId=referenceEquippedSkillId(source,event.skillId),def=definitionId==null?null:reference.metadata.skills[definitionId];
    const branch=def?.branches.find((b,i)=>(b.branchIndex??i)===event.params[3])??(def?.branches.length===1?def.branches[0]:null);
    const candidates=branch?[branch]:def?.branches??[];
    if(!candidates.some(b=>b.effects.some(e=>e.type===8&&(e.targetType??1)!==1)))continue;
    const timing=branch?resolveSkillTiming(race,source,reference,branch,event.time,event.params[2]>0?event.params[2]/10000:null,def??undefined):null;
    if(timing?.effectiveEnd!=null&&time>=timing.effectiveEnd)continue;
    if(!branch){
      const possiblyActive=candidates.some(b=>{
        if(!b.effects.some(e=>e.type===8&&(e.targetType??1)!==1))return false;
        const timing=resolveSkillTiming(race,source,reference,b,event.time,event.params[2]>0?event.params[2]/10000:null,def??undefined);
        return timing.effectiveEnd===null||time<timing.effectiveEnd;
      });
      if(!possiblyActive)continue;
    }
    // Expired effects cannot change vision, even when their old mask is missing.
    if(!Number.isInteger(event.params[4])||race.runners.length>32||runner.index<0||runner.index>=32)return null;
    if(!(event.params[4]&(1<<runner.index)))continue;
    if(source.teamGroup!=null&&runner.teamGroup!=null&&source.teamGroup===runner.teamGroup)continue;
    if(!branch||source.teamGroup==null||runner.teamGroup==null||timing?.effectiveEnd==null)return null;
    for(const effect of branch.effects.filter(e=>e.type===8&&(e.targetType??1)!==1)){const magnitude=effectValue(source,definitionId!,effect);if(magnitude===null)return null;vision+=magnitude;}
  }
  return vision > 0 ? vision : null;
}
export function comparePredicate(a: number, op: string, b: number): boolean { return ({ '==': a === b, '!=': a !== b, '>=': a >= b, '<=': a <= b, '>': a > b, '<': a < b } as Record<string, boolean>)[op]; }
const cache = new WeakMap<Race, Map<string, { reference: ReferenceData | null; timeline: ConditionObservation[] }>>();
export function conditionTimeline(race: Race, runner: Runner, course: CourseReference | null, options: ConditionContextOptions = {}): ConditionObservation[] {
  const reference = options.reference ?? null, key = `${runner.id}:${course?.id ?? ''}`;
  let entries = cache.get(race); if (!entries) cache.set(race, entries = new Map());
  const existing = entries.get(key); if (existing?.reference === reference) return existing.timeline;
  const statics = conditionStaticValues(race, runner, course), stop = Math.min(race.duration, runner.finishTimeRaw ?? race.duration);
  const spurtCondition=createLastSpurtCondition(race,runner,course,reference,statics);
  // A start activation is stored with duration -1. It is a proc. Later events carry a positive duration.
  const events = race.events.filter(e => (e.type === 3 || e.type === 'skill') && e.skillId !== null && (e.params[2] !== -1 || e.time === 0) && localEvent(race, e, runner)).sort((a, b) => a.time - b.time || a.skillId! - b.skillId!);
  let priorRank: number | null = null, priorDistance: number | null = null, priorLane: number | null = null, priorTime: number | null = null;
  let rushedCount = 0, priorRushed: boolean | null = null, upEnd = 0, upFinal = 0, frontTimer = 0, sideTimer = 0, behindTimer = 0, behindWideTimer=0,infrontTimer = 0, overtakeTimer = 0, overtakeNoUpTimer = 0;
  let priorFront = false, priorSide = false, priorBehind = false,priorBehindWide=false, priorInfront = false, priorOvertake = false,priorTargeted=false,priorLastStraight:boolean|null=null;
  const continuations = new Map<string, boolean>();
  const first = sample(race.frames[0], runner.id), initialHp = race.frames[0].time === 0 && first?.distance != null && first.distance <= .5 && first.hp != null && first.hp > 0 ? first.hp : null;
  const timeline: ConditionObservation[] = [];
  for (const { frame, interpolated } of interpolatedFrames(race)) {
    if (frame.time > stop) break;
    const s = sample(frame, runner.id), d = s?.distance, rankMap = ranks(race, frame), rank = rankMap.get(runner.id) ?? null, rankRange = fieldRankRange(race, frame, runner.id);
    const complete = completeFieldDistances(race, frame), allLanes = complete && frame.runners.every(s => s.lane != null), others = frame.runners.filter(s => s.runnerId !== runner.id);
    const ordered = complete ? frame.runners.slice().sort((a, b) => b.distance! - a.distance!) : [];
    const position = rank == null ? -1 : ordered.findIndex(s => s.runnerId === runner.id), ahead = position > 0 ? ordered[position - 1] : null, behind = position >= 0 ? ordered[position + 1] : null;
    const final = course?.corners.at(-1), lastStraight = course?.straights.at(-1), cornerIndex = d == null ? -1 : course?.corners.findIndex(c => d >= c.start && d < c.start + c.length) ?? -1;
    const slope = d == null ? null : course?.slopes.find(g => d >= g.start && d < g.start + g.length)?.slopePercent ?? (course ? 0 : null);
    const rushed = s?.temptationMode == null ? null : s.temptationMode >= 1 && s.temptationMode <= 4;
    if (rushed && priorRushed === false) rushedCount++;
    else if (rushed && rushedCount === 0) rushedCount = 1;
    const deltaRank = rank == null || priorRank == null ? null : rank - priorRank;
    if (deltaRank != null && deltaRank < 0) { if (d != null && race.distance != null && priorDistance != null && priorDistance >= race.distance * 2 / 3) upEnd += -deltaRank; if (final && priorDistance != null && priorDistance >= final.start) upFinal += -deltaRank; }
    const dt = priorTime === null ? 0 : frame.time - priorTime, horseLane = 1 / 18;
    const closeAny=(direction:number,gap:number,width:number)=>!complete||!allLanes||d==null||s?.lane==null?null:others.some(o=>(o.distance!-d)*direction>0&&(o.distance!-d)*direction<=gap+1e-9&&Math.abs(o.lane!-s.lane!)<=width*horseLane+1e-9);
    const closeFront=closeAny(1,2.5,1),closeBehind=closeAny(-1,2.5,1),closeBehindWide=closeAny(-1,5,2.7),frontBlocked = s?.blockFrontRunnerIndex == null ? null : s.blockFrontRunnerIndex >= 0;
    const sideBlocked = !complete || !allLanes || d == null || s?.lane == null ? null : others.some(o => Math.abs(o.distance! - d) < 1.05 && Math.abs(o.lane! - s.lane!) < 2 * horseLane);
    frontTimer = frontBlocked === true ? priorFront ? frontTimer + dt : 0 : 0;
    sideTimer = sideBlocked === true ? priorSide ? sideTimer + dt : 0 : 0;
    infrontTimer = closeFront === true ? priorInfront && deltaRank === 0 ? infrontTimer + dt : 0 : 0;
    behindTimer = closeBehind === true ? priorBehind && deltaRank === 0 ? behindTimer + dt : 0 : 0;
    behindWideTimer=closeBehindWide===true?priorBehindWide&&deltaRank===0?behindWideTimer+dt:0:0;
    const vision = knownVision(race, runner, frame.time, statics, reference);
    const visible = !complete || !allLanes || d == null || s?.lane == null || vision == null ? null : others.filter(o => {
      const gap = o.distance! - d; return gap > 0 && gap <= vision && Math.abs(o.lane! - s.lane!) <= (gap / vision * 11.5 * horseLane + 2 * horseLane) / 2;
    });
    const candidate = frontBlocked===true?true:visible == null || s?.speed == null || visible.some(o => o.speed == null) ? null : visible.some(o => {const gap=o.distance!-d!,closing=s.speed!-o.speed!;return gap>0&&gap<=20&&closing>0;});
    const targeted=!complete||!allLanes||d==null||s?.lane==null||s.speed==null?null:(()=>{let uncertain=false;for(const other of race.runners){if(other.id===runner.id)continue;const o=sample(frame,other.id);if(o?.distance==null||o.lane==null||o.speed==null){uncertain=true;continue;}const gap=d-o.distance,closing=o.speed-s.speed!;if(gap<=0||gap>20||closing<=0||gap/closing>15)continue;const ov=knownVision(race,other,frame.time,conditionStaticValues(race,other,course),reference);if(ov===null){uncertain=true;continue;}if(gap<=ov&&Math.abs(s.lane!-o.lane)<=(gap/ov*11.5*horseLane+2*horseLane)/2)return true;}return uncertain?null:false;})();
    overtakeTimer = targeted === true ? priorTargeted ? overtakeTimer + dt : 0 : 0;
    overtakeNoUpTimer = candidate === true ? priorOvertake ? overtakeNoUpTimer + dt : 0 : 0;
    const sampled: ObservationConfidence = interpolated ? 'proxy' : 'sampled';
    const nextIndex=interpolated?race.frames.findIndex(f=>f.time>frame.time):-1;
    const bracket=nextIndex>0?[sample(race.frames[nextIndex-1],runner.id)?.distance,sample(race.frames[nextIndex],runner.id)?.distance]:[];
    const phaseOf=(distance:number)=>race.distance===null?null:distance<race.distance/6?0:distance<race.distance*2/3?1:distance<race.distance*5/6?2:3;
    const cornerOf=(distance:number)=>course?.corners.findIndex(c=>distance>=c.start&&distance<c.start+c.length)??-1;
    const phaseConfidence=bracket.length===2&&bracket.every(v=>v!=null)&&phaseOf(bracket[0]!)===phaseOf(bracket[1]!)?'sampled':sampled;
    const cornerConfidence=bracket.length===2&&bracket.every(v=>v!=null)&&cornerOf(bracket[0]!)===cornerOf(bracket[1]!)?'sampled':sampled;
    const finalConfidence=final&&bracket.length===2&&bracket.every(v=>v!=null)&&Number(bracket[0]!>=final.start)===Number(bracket[1]!>=final.start)?'sampled':sampled;
    const inLastStraight=d==null||!course?null:Boolean(lastStraight&&d>=lastStraight.start&&d<lastStraight.end);
    const distances=complete?frame.runners.map(o=>o.distance!):[],leader=complete?Math.max(...distances):null,last=complete?Math.min(...distances):null;
    const values: Record<string, PredicateValue> = {
      accumulatetime: value(frame.time), phase: value(d == null || race.distance == null ? null : phaseOf(d), phaseConfidence),
      distance_rate: value(d == null || race.distance == null ? null : 100 * d / race.distance, sampled), remain_distance: value(d == null || race.distance == null ? null : Math.trunc(race.distance) - Math.floor(d), sampled),
      order: { ...value(rank, sampled), ...(rankRange ? { range: rankRange } : {}) }, order_rate: { ...value(rank, sampled), ...(rankRange ? { range: rankRange } : {}) }, distance_diff_top: value(d == null || leader===null ? null : Math.floor(Math.max(0,leader-d)), sampled),
      distance_diff_rate:value(d==null||leader===null||last===null||leader===last?null:100*(leader-d)/(leader-last),sampled,'Field spread is zero or field distances are incomplete.'),
      lane_type:value(s?.lane==null?null:s.lane<=.2?0:s.lane<=.4?1:s.lane<=.6?2:3,sampled),
      is_behind_in:value(!complete||rank===null||s?.lane==null?null:!behind?0:behind.lane===null||others.filter(o=>o.distance===behind.distance).length!==1?null:Number(behind.lane<s.lane),sampled,'Requires an unambiguous immediately trailing runner and lane fractions.'),
      bashin_diff_infront: value(d == null || !complete ? null : ahead ? (ahead.distance! - d) / 2.5 : Infinity, sampled), bashin_diff_behind: value(d == null || !complete ? null : behind ? (d - behind.distance!) / 2.5 : Infinity, sampled),
      is_finalcorner: value(d == null || !course ? null : Number(Boolean(final && d >= final.start)), finalConfidence), is_finalcorner_laterhalf: value(d == null || !course ? null : Number(Boolean(final && d >= final.start + final.length / 2 && d < final.start + final.length)), sampled),
      corner: value(d == null || !course ? null : cornerIndex < 0 ? 0 : 4 - ((course.corners.length - 1 - cornerIndex) % 4), cornerConfidence), slope: value(slope == null ? null : slope > 0 ? 1 : slope < 0 ? 2 : 0, sampled),
      straight_front_type: value(d == null || !course ? null : course.straights.find(st => d >= st.start && d < st.end)?.frontType, sampled),
      is_last_straight: value(inLastStraight==null?null:Number(inLastStraight), sampled),
      is_last_straight_onetime: value(inLastStraight===null?null:priorLastStraight===null?frame.time===0&&d===0&&lastStraight?.start===0?1:null:Number(inLastStraight&&!priorLastStraight), 'proxy','Sampled entry transition; exact simulation-tick notification is unrecorded.'),
      is_lastspurt: value(d == null || runner.lastSpurtDistance == null ? null : Number(runner.lastSpurtDistance >= 0 && d >= runner.lastSpurtDistance), sampled),
      lastspurt:spurtCondition(frame),
      remain_distance_viewer_id:{value:null,confidence:sampled,candidates:race.runners.map(other=>({value:race.distance==null||sample(frame,other.id)?.distance==null?null:Math.trunc(race.distance)-Math.floor(sample(frame,other.id)!.distance!),member:other.isNpc==null?null:!other.isNpc})),reason:'Any non-NPC player runner; unresolved NPC membership remains unknown.'},
      is_temptation: value(rushed == null ? null : Number(rushed), sampled), blocked_front: value(frontBlocked == null ? null : Number(frontBlocked), sampled),
      temptation_count: value(rushedCount, 'lower-bound'), change_order_onetime: value(deltaRank, 'proxy'), change_order_up_end_after: value(upEnd, 'lower-bound'), change_order_up_finalcorner_after: value(upFinal, 'lower-bound'),
      hp_per: value(s?.hp == null || initialHp === null ? null : s.hp * 100 / initialHp, 'proxy'),
      is_move_lane: value(s?.lane == null || priorLane === null ? null : Math.abs(s.lane-priorLane)<=.00005?0:s.lane<priorLane?1:2, 'proxy'),
      near_count: value(!complete || !allLanes || d == null || s?.lane == null ? null : others.filter(o => Math.abs(o.distance! - d) <= 3+1e-9 && Math.abs(o.lane! - s.lane!) <= 3 * horseLane+1e-9).length, 'proxy'),
      is_surrounded: value(!complete || !allLanes || d == null || s?.lane == null ? null : Number(
        others.some(o => Math.abs(o.distance! - d) < 1.5 && Math.abs(o.lane!-s.lane!)>0 && Math.abs(o.lane!-s.lane!) < 3 * horseLane)
        && others.some(o => o.distance! > d && o.distance! - d <= 3+1e-9 && Math.abs(o.lane! - s.lane!) < 1.5 * horseLane)
        && others.some(o => o.distance! < d && d - o.distance! <= 3+1e-9 && Math.abs(o.lane! - s.lane!) < 1.5 * horseLane)), 'proxy'),
      blocked_front_continuetime: value(frontBlocked === null ? null : frontTimer, 'proxy'), blocked_side_continuetime: value(sideBlocked === null ? null : sideTimer, 'proxy'),
      infront_near_lane_time: value(closeFront === null ? null : infrontTimer, 'proxy'), behind_near_lane_time: value(closeBehind === null ? null : behindTimer, 'proxy'), behind_near_lane_time_set1: value(closeBehindWide === null ? null : behindWideTimer, 'proxy'),
      visiblehorse: value(visible?.length, 'proxy'), is_overtake: value(candidate === null ? null : Number(candidate), 'proxy'), overtake_target_time: value(targeted === null ? null : overtakeTimer, 'proxy'), overtake_target_no_order_up_time: value(candidate === null ? null : overtakeNoUpTimer, 'proxy'),
      compete_fight_count: value(race.events.some(e => e.type === 5 && e.time <= frame.time && localEvent(race, e, runner))?1:0, 'lower-bound','A recorded duel establishes at least one showdown; resume/episode counts beyond that are not recovered.'),
    };
    for (const key of ['order_rate_in20_continue', 'order_rate_in40_continue', 'order_rate_in50_continue', 'order_rate_in80_continue', 'order_rate_out20_continue', 'order_rate_out40_continue', 'order_rate_out50_continue', 'order_rate_out70_continue']) {
      const m = key.match(/order_rate_(in|out)(\d+)_continue/)!, threshold = Math.round(race.runners.length * Number(m[2]) / 100), within = rankRange === null ? null : compareRankRange(rankRange, m[1] === 'in' ? '<=' : '>=', threshold);
      if (frame.time >= 5 && within === false) continuations.set(key, false);
      const violated = continuations.get(key) === false;
      values[key] = value(violated ? 0 : within === null ? null : 1, violated ? 'known' : 'proxy', 'Continuity between recorded samples is not observed.');
    }
    const opponentRushed=(style?:number,direction?:number):PredicateValue=>{let low=0,high=0;for(const other of race.runners){if(other.id===runner.id)continue;const o=sample(frame,other.id),sameTeam=runner.teamGroup!=null&&other.teamGroup!=null?runner.teamGroup===other.teamGroup:null;if(sameTeam===true)continue;const rushed=o?.temptationMode==null?null:o.temptationMode>=1&&o.temptationMode<=4,named=selectedStyle(other);if(rushed===false||style!==undefined&&named!==null&&named!==style||direction!==undefined&&d!=null&&o?.distance!=null&&(o.distance-d)*direction<=0)continue;high++;if(sameTeam===false&&rushed===true&&(style===undefined||named===style)&&(direction===undefined||d!=null&&o?.distance!=null&&(o.distance-d)*direction>0))low++;}return{value:low===high?low:null,range:[low,high],confidence:sampled,reason:'Current enemy rushed count; missing team/style/position/state widens the count interval.'};};
    for (const [key, namedStyle] of Object.entries({ running_style_temptation_opponent_count_nige: 1, running_style_temptation_opponent_count_senko: 2, running_style_temptation_opponent_count_sashi: 3, running_style_temptation_opponent_count_oikomi: 4 })) values[key]=opponentRushed(namedStyle);
    for (const [key, direction] of [['temptation_opponent_count_infront', 1], ['temptation_opponent_count_behind', -1]] as const) values[key]=opponentRushed(undefined,direction);
    timeline.push({ time: frame.time, values, interpolated,runnerId:runner.id, priorEvents: events.filter(e => e.time < frame.time), sameTimeEvents: events.filter(e => e.time === frame.time) });
    priorRank = rank; priorDistance = d ?? null; priorLane = s?.lane ?? null; priorTime = frame.time; priorRushed = rushed;
    priorFront = frontBlocked === true; priorSide = sideBlocked === true; priorBehind = closeBehind === true;priorBehindWide=closeBehindWide===true; priorInfront = closeFront === true; priorOvertake = candidate === true;priorTargeted=targeted===true;priorLastStraight=inLastStraight;
  }
  entries.set(key, { reference, timeline }); return timeline;
}
