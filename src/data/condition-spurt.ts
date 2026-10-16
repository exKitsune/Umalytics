import type { Frame, Race, Runner } from './types';
import type { CourseReference, ReferenceData } from './reference';
import { aptitudeRank, distanceAptitude, statKeys } from './race-stats';
import { referenceEquippedSkillId } from './equipped-skills';
import { effectValue } from './effect-value';

/** GameTora's HP-feasibility categories, not the simulator's uncertain 1/2/3 mapping. */
export interface SpurtConditionValue {
  value: 0 | 1 | 2 | null;
  confidence: 'proxy';
  reason: string;
  maxHpNeeded: number | null;
  baseHpNeeded: number | null;
  decisionTime: number | null;
}
type StaticValues = Record<string, { value: number | null; range?: [number, number] }>;
function intervalCompare(low: number, high: number, op: string, expected: number): boolean | null {
  if (op === '==') return low === high ? low === expected : expected < low || expected > high ? false : null;
  if (op === '!=') { const eq = intervalCompare(low, high, '==', expected); return eq === null ? null : !eq; }
  if (op === '>=') return low >= expected ? true : high < expected ? false : null;
  if (op === '>') return low > expected ? true : high <= expected ? false : null;
  if (op === '<=') return high <= expected ? true : low > expected ? false : null;
  return high < expected ? true : low >= expected ? false : null;
}
function staticCondition(text: string, values: StaticValues, race: Race): boolean | null {
  if (!text.trim()) return true;
  const groups = text.split('@').map(group => group.split('&').map(atom => {
    const match = atom.trim().match(/^(\w+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    if (match[1] === 'is_exist_chara_id') {
      if (!['==', '!='].includes(match[2])) return null;
      const present = race.runners.some(r => r.charaId === Number(match[3]));
      if (!present && race.runners.some(r => r.charaId == null)) return null;
      return match[2] === '==' ? present : !present;
    }
    const observation = values[match[1]], range = observation?.range ?? (observation?.value == null ? null : [observation.value, observation.value]);
    return range ? intervalCompare(range[0], range[1], match[2], Number(match[3])) : null;
  }));
  return groups.some(group => group.every(v => v === true)) ? true : groups.every(group => group.includes(false)) ? false : null;
}
/** No recursive skill-condition/stat-row construction. Only recorded initial
 * branches and guaranteed, statically established greens resolve stat inputs. */
function initialInputs(race: Race, runner: Runner, course: CourseReference, reference: ReferenceData, values: StaticValues) {
  const mood = runner.mood != null && runner.mood >= 1 && runner.mood <= 5 ? 1 + .02 * (runner.mood - 3) : null;
  const base = (key: typeof statKeys[number]) => {
    const raw = runner.stats?.[key];
    return raw == null || mood === null ? null : Math.max(1, Math.min(2000, (raw > 1200 ? 1200 + (raw - 1200) / 2 : raw) * mood));
  };
  const career = race.category === 'career' ? 400 : ['practice', 'team-trials', 'champions-meeting'].includes(race.category ?? '') ? 0 : null;
  const thresholds = course.courseSetStatus.map(id => statKeys[id - 1] ? base(statKeys[id - 1]) : null);
  const track = thresholds.some(v => v === null) ? null : thresholds.length ? thresholds.reduce<number>((n, v) => n + (v! > 900 ? 1.2 : v! > 600 ? 1.15 : v! > 300 ? 1.1 : 1.05), 0) / thresholds.length : 1;
  const bonuses = new Map([[1, 0], [4, 0]]), unresolved = new Set<number>();
  let style = runner.strategyCode ?? null;
  if (!runner.skills) { unresolved.add(1); unresolved.add(4); }
  const ids = new Set((runner.skills ?? []).map(skill => referenceEquippedSkillId(runner, skill.id)));
  for (const event of race.events) if (event.time === 0 && event.runnerId === runner.id && event.skillId != null && (event.type === 3 || event.type === 'skill')) ids.add(referenceEquippedSkillId(runner, event.skillId));
  for (const id of ids) {
    const definition = id == null ? null : reference.metadata.skills[id];
    if (!definition) { unresolved.add(1); unresolved.add(4); continue; }
    // This value belongs to the passive being checked, not to whichever skill
    // originally requested a shared condition timeline. Preserve bounded counts
    // when a runner inventory or a foreign unique's identity is unresolved.
    let countLow = 0, countHigh = 0;
    for (const other of race.runners) {
      if (other.skills === undefined) { countHigh++; continue; }
      let found = false, possibleMatch = false;
      for (const equipped of other.skills) {
        const normalized = referenceEquippedSkillId(other, equipped.id);
        if (normalized === id) found = true;
        else if (normalized === null && (equipped.id === id || Number(`9${String(equipped.id).slice(1)}`) === id)) possibleMatch = true;
      }
      if (found) { countLow++; countHigh++; } else if (possibleMatch) countHigh++;
    }
    const skillValues = { ...values, same_skill_horse_count: { value: countLow === countHigh ? countLow : null, range: [countLow, countHigh] as [number, number] } };
    const active: number[] = [], possible: number[] = [];
    for (const [i, branch] of definition.branches.entries()) {
      if (branch.rawDuration >= 0) continue;
      const index = branch.branchIndex ?? i;
      const recorded = race.events.some(e => e.time === 0 && e.runnerId === runner.id && (e.type === 3 || e.type === 'skill') && e.skillId != null && referenceEquippedSkillId(runner, e.skillId) === id && (e.params[3] === index || definition.branches.length === 1));
      const pre = staticCondition(branch.precondition ?? '', skillValues, race), condition = staticCondition(branch.condition, skillValues, race);
      if (recorded || definition.activateLot === 0 && pre === true && condition === true) active.push(i);
      else if (pre !== false && condition !== false) possible.push(i);
    }
    for (const i of possible) for (const effect of definition.branches[i].effects) {
      if (bonuses.has(effect.type)) unresolved.add(effect.type);
      if (effect.type === 6 && style === 1) style = null;
    }
    if (active.length > 1) {
      for (const i of active) for (const effect of definition.branches[i].effects) if (bonuses.has(effect.type)) unresolved.add(effect.type);
    } else if (active.length === 1) for (const effect of definition.branches[active[0]].effects) {
      if (effect.type === 6 && style === 1) style = 5;
      if (!bonuses.has(effect.type)) continue;
      const amount = effectValue(runner, id!, effect);
      if (amount === null || (effect.targetType ?? 1) !== 1 || (effect.additionalActivateType ?? 0) !== 0) unresolved.add(effect.type);
      else bonuses.set(effect.type, bonuses.get(effect.type)! + amount);
    }
  }
  const ground = Number(race.conditions?.ground), knownGround = Number.isInteger(ground) && ground >= 1 && ground <= 4 && [1, 2].includes(course.surface);
  const speedBase = base('speed'), gutsBase = base('guts');
  const speed = speedBase === null || track === null || career === null || !knownGround || unresolved.has(1) ? null : Math.max(1, Math.min(2000, speedBase * track + (ground === 4 ? -50 : 0) + career + bonuses.get(1)!));
  const guts = gutsBase === null || career === null || unresolved.has(4) ? null : Math.max(1, Math.min(2000, gutsBase + career + bonuses.get(4)!));
  return { speed, guts, style, ground, knownGround, unresolved };
}

/** Build once per runner/timeline. The last-spurt feasibility decision is made
 * at late entry and reconsidered after own recovery, not from future HP or a
 * later HP-debuff sample. All outputs remain inferred budget proxies. */
export function createLastSpurtCondition(race: Race, runner: Runner, course: CourseReference | null, reference: ReferenceData | null, staticValues: StaticValues = {}) {
  const unknown = (reason: string, decisionTime: number | null = null): SpurtConditionValue => ({ value: null, confidence: 'proxy', reason, maxHpNeeded: null, baseHpNeeded: null, decisionTime });
  if (!course || !reference || race.distance !== course.distance) return (_frame: Frame) => unknown('Course/reference inputs for the last-spurt HP budget are missing.');
  const values: StaticValues = { always: { value: 1 }, ...staticValues }, inputs = initialInputs(race, runner, course, reference, values);
  const distanceKey = course.distance <= 1400 ? 'short' : course.distance <= 1800 ? 'mile' : course.distance <= 2400 ? 'middle' : 'long';
  const rank = aptitudeRank(runner.aptitudes?.[distanceKey]), styleCoef = inputs.style == null ? null : ({ 1: .962, 2: .975, 3: .994, 4: 1, 5: .95 } as Record<number, number>)[inputs.style];
  const rows = race.frames.map(frame => ({ time: frame.time, sample: frame.runners.find(r => r.runnerId === runner.id) }));
  const entry = course.distance * 2 / 3, decisions: { time: number; available: number; distance: number | null; hp: number | null; reason: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i], ad = a.sample?.distance, bd = b.sample?.distance;
    if (ad == null || bd == null || !(ad < entry && bd >= entry)) continue;
    const time = a.time + (entry - ad) / (bd - ad) * (b.time - a.time);
    const hpEvent = race.events.some(e => e.time > a.time && e.time <= b.time && e.skillId != null && reference.metadata.skills[referenceEquippedSkillId(runner, e.skillId) ?? e.skillId]?.branches.some(branch => branch.effects.some(effect => effect.type === 9)));
    const hp = b.time - a.time <= 2 && a.sample?.hp != null && b.sample?.hp != null && !hpEvent ? a.sample.hp + (b.sample.hp - a.sample.hp) * (time - a.time) / (b.time - a.time) : null;
    decisions.push({ time, available: time, distance: entry, hp, reason: hp === null ? 'Late-entry HP is missing, spans a long gap or shares an HP-event bracket.' : 'Late-entry HP interpolated within one retained bracket.' }); break;
  }
  for (const event of race.events.filter(e => (e.type === 3 || e.type === 'skill') && e.runnerId === runner.id && e.skillId != null && (e.params[2] !== -1 || e.time === 0))) {
    const definition = reference.metadata.skills[referenceEquippedSkillId(runner, event.skillId!) ?? event.skillId!];
    const branches = definition?.branches.filter((branch, i) => definition.branches.length === 1 || (branch.branchIndex ?? i) === event.params[3]);
    if (!branches?.some(branch => branch.effects.some(effect => effect.type === 9 && effect.rawValue > 0))) continue;
    const post = rows.find(row => row.time >= event.time && row.sample?.distance != null && row.sample.distance >= entry);
    if (event.time < (decisions[0]?.time ?? Infinity)) continue;
    if (!post || post.time - event.time > 2) {
      decisions.push({ time: event.time, available: event.time, distance: null, hp: null, reason: 'Recovery recalculated the decision, but no retained post-event HP/distance sample is available within 2 s.' });
    } else decisions.push({ time: event.time, available: post.time, distance: post.sample!.distance, hp: post.sample!.hp, reason: 'Recovery recalculation approximated by the first retained post-event HP/distance; drain within that bracket is unreported.' });
  }
  decisions.sort((a, b) => a.time - b.time);
  const calculated = new Map<typeof decisions[number], SpurtConditionValue>();
  return (frame: Frame): SpurtConditionValue => {
    const decision = decisions.filter(d => d.time <= frame.time).at(-1);
    if (!decision) return unknown('No observed late-entry/recovery decision is available yet.');
    if (frame.time < decision.available) return unknown('Recovery decision falls before its retained post-event HP sample; no future sample is used.', decision.time);
    const cached = calculated.get(decision); if (cached) return cached;
    if (inputs.speed === null || inputs.guts === null || rank === null || styleCoef == null || !inputs.knownGround) return unknown('Last-spurt budget requires resolved initial speed/guts, mood/course/ground, race category, style and distance aptitude; unresolved relevant greens are not zero.', decision.time);
    if (decision.hp === null || decision.distance === null) return unknown(decision.reason, decision.time);
    const base = 20 - (course.distance - 2000) / 1000, term = Math.sqrt(500 * inputs.speed) * distanceAptitude[rank - 1] * .002;
    const late = base * styleCoef + term, maximum = (late + .01 * base) * 1.05 + term + (450 * inputs.guts) ** .597 * .0001;
    const ground = inputs.ground === 4 ? 1.02 : inputs.ground === 3 ? course.surface === 1 ? 1.02 : 1.01 : 1, guts = 1 + 200 / Math.sqrt(600 * inputs.guts);
    const remaining = Math.max(0, course.distance - 60 - decision.distance);
    const cost = (speed: number) => 20 * Math.max(0, speed - base + 12) ** 2 / 144 * ground * guts * remaining / speed;
    const baseHpNeeded = cost(late), maxHpNeeded = cost(maximum);
    const result: SpurtConditionValue = { value: decision.hp >= maxHpNeeded ? 2 : decision.hp >= baseHpNeeded ? 1 : 0, confidence: 'proxy', maxHpNeeded, baseHpNeeded, decisionTime: decision.time,
      reason: `${decision.reason} Inferred HP budget to 60 m before goal: 0 below late-base budget, 1 covers base but not maximum spurt, 2 covers maximum. Ignores acceleration, future skills, terrain and random/status drain reductions as the reference decision calculation does; not a recorded selected speed or wit result.` };
    calculated.set(decision, result); return result;
  };
}

export function lastSpurtCondition(race: Race, runner: Runner, course: CourseReference | null, reference: ReferenceData | null, frame: Frame, staticValues?: StaticValues): SpurtConditionValue {
  return createLastSpurtCondition(race, runner, course, reference, staticValues)(frame);
}
