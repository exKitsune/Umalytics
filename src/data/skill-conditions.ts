import type { Race, Runner } from './types';
import type { CourseReference, SkillReference, ReferenceMetadata } from './reference';
import { conditionMechanic, explainConditionPredicate, predicateSupportIssue,type MechanicsState } from './condition-mechanics';
import { compareRankRange, rankThreshold } from './field-rank';
import { referenceEquippedSkillId } from './equipped-skills';
import { conditionSourceAudit } from './condition-source';
import { conditionStaticValues, conditionTimeline, comparePredicate, type PredicateValue, type ConditionObservation, type ConditionContextOptions } from './condition-observations';

export type ConditionState = 'met' | 'unmet' | 'unknown';
export type EligibilityState = 'eligible' | 'ineligible' | 'unresolved';
export interface PredicateExplanation {
  expression: string; key: string; meaning: string; mechanicsState: MechanicsState;
  observation: string; limitation: string | null;
  /** Evidence at one coherent eligible candidate; earlier latched preconditions
   * carry their own time. Absent when the branch has no eligible candidate. */
  state?: ConditionState; observed?: string; time?: number | null;
  role?: 'condition' | 'precondition' | 'both';
}
export interface BranchConditionEvaluation {
  branchIndex: number; state: ConditionState; staticOnly: boolean;
  firstOpportunity: number | null; opportunities: number; unresolved: string[]; detail: string;
  mechanicsState: MechanicsState; eligibilityState: EligibilityState; randomTrigger: boolean;
  definitiveOpportunity: boolean;
  observations: string[]; proxies: string[]; missingInputs: string[]; hiddenState: string[];
  predicates: PredicateExplanation[];
  inferredState:ConditionState;inferenceBasis:'observed'|'replay-proxy'|'complete-random-region'|'recorded-conjunction'|'unresolved';
  absenceAssessment:'conditions-excluded'|'conditions-supported'|'random-trigger-unobserved'|'replay-inputs-missing'|'mechanics-partial'|'no-observed-candidate';
}
export interface SkillConditionEvaluation {
  state: ConditionState; branches: BranchConditionEvaluation[]; mechanicsState: MechanicsState;
  eligibilityState: EligibilityState; definitiveOpportunity: boolean; randomTrigger: boolean;
  inferredState:ConditionState;
}
type Atom = { text: string; key: string; op: string; value: number };
type Expression = (Atom | null)[][];
function parse(text: string): Expression {
  return !text.trim() ? [[]] : text.split('@').map(group => group.split('&').map(text => {
    const m = text.trim().match(/^(\w+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    return m ? { text: text.trim(), key: m[1], op: m[2], value: Number(m[3]) } : null;
  }));
}
function logic(groups: (boolean | null)[][]): boolean | null {
  const alternatives = groups.map(group => group.includes(false) ? false : group.every(value => value === true) ? true : null);
  return alternatives.includes(true) ? true : alternatives.every(value => value === false) ? false : null;
}
function phaseBounds(distance: number, phase: number): [number, number] | null {
  return [0, 1, 2, 3].includes(phase) ? [[0, distance / 6], [distance / 6, distance * 2 / 3], [distance * 2 / 3, distance * 5 / 6], [distance * 5 / 6, distance]][phase] as [number, number] : null;
}
/** Candidate regions are understood; the preselected 10 m trigger is not
 * synthesized, and the independent wit draw is not reused as trigger RNG. */
function randomRegions(atom: Atom, race: Race, course: CourseReference | null): [number, number][] | null {
  if (atom.op !== '==') return null;
  if (atom.key === 'random_lot') return atom.value > 0 ? [[0, race.distance ?? Infinity]] : [];
  if (atom.key.startsWith('phase_')) {
    if (race.distance == null) return null;
    const bounds = phaseBounds(race.distance, atom.value); if (!bounds) return [];
    if (atom.key === 'phase_firsthalf_random') bounds[1] = (bounds[0] + bounds[1]) / 2;
    if (atom.key === 'phase_laterhalf_random') bounds[0] = (bounds[0] + bounds[1]) / 2;
    return [bounds];
  }
  if (atom.key === 'distance_rate_after_random') return race.distance == null ? null : [[race.distance * atom.value / 100, race.distance]];
  if (!course) return null;
  if (atom.key === 'corner_random') { const c = course.corners[course.corners.length + atom.value - 5]; return c ? [[c.start, c.start + c.length]] : []; }
  if (atom.key === 'all_corner_random') return course.corners.map(c => [c.start, c.start + c.length]);
  if (atom.key === 'straight_random') return course.straights.map(s => [s.start, s.end]);
  if (atom.key === 'last_straight_random') { const s = course.straights.at(-1); return s ? [[s.start, s.end]] : []; }
  if (atom.key === 'is_finalcorner_random') { const c = course.corners.at(-1); return c ? [[c.start, c.start + c.length]] : []; }
  if (atom.key === 'up_slope_random' || atom.key === 'down_slope_random') return course.slopes.filter(s => atom.key === 'up_slope_random' ? s.slopePercent > 0 : s.slopePercent < 0).map(s => [s.start, s.start + s.length]);
  return null;
}
function lowerBoundCompare(minimum: number, op: string, argument: number): boolean | null {
  if (op === '>=' && minimum >= argument || op === '>' && minimum > argument || op === '!=' && minimum > argument) return true;
  if ((op === '<=' || op === '<' || op === '==') && minimum > argument || op === '<' && minimum === argument) return false;
  return null;
}
function definitionEventId(race:Race,event:Race['events'][number]):number|null {
  const source=race.runners.find(r=>r.id===event.runnerId)??race.runners.find(r=>r.index===event.params[0]);
  return source&&event.skillId!==null?referenceEquippedSkillId(source,event.skillId):event.skillId;
}
function eventsFor(observation: ConditionObservation, race:Race, skillId?: number) {
  return [...observation.priorEvents, ...observation.sameTimeEvents.filter(e => {const id=definitionEventId(race,e);return skillId !== undefined && id!==null&&id < skillId;})];
}
function eventValue(atom: Atom, observation: ConditionObservation, race: Race, options: ConditionContextOptions): PredicateValue | null {
  if(atom.key==='is_other_character_activate_advantage_skill'){
    let unknown=false;
    for(const event of race.events){
      if((event.type!==3&&event.type!=='skill')||(event.params[2]===-1&&event.time!==0)||event.skillId==null||event.time>observation.time+.001||observation.time-event.time>1/15+.001)continue;
      const source=race.runners.find(r=>r.id===event.runnerId)??race.runners.find(r=>r.index===event.params[0]);if(!source){unknown=true;continue;}if(source.id===observation.runnerId)continue;
      const id=definitionEventId(race,event),definition=id==null?null:options.reference?.metadata.skills[id],branch=definition?.branches.find((b,i)=>(b.branchIndex??i)===event.params[3])??(definition?.branches.length===1?definition.branches[0]:null);
      if(!branch){unknown=true;continue;}if(branch.effects.some(e=>e.type===9&&e.rawValue>0))return{value:9,confidence:'proxy',reason:'Another runner has a recorded successful healing activation on this or the preceding simulation tick; internal cross-runner notification order remains inferred.'};
    }
    return{value:null,confidence:'proxy',reason:unknown?'A nearby other-runner activation has an unresolved effect branch.':'No recorded other-runner healing notification at this tick; absence of an internal notification is not proved.'};
  }
  const events = eventsFor(observation, race, options.skillId), eventKeys = new Set(['activate_count_all', 'activate_count_start', 'activate_count_middle', 'activate_count_end_after', 'activate_count_later_half', 'activate_count_heal', 'is_activate_any_skill', 'is_used_skill_id', 'is_activate_other_skill_detail']);
  if (!eventKeys.has(atom.key)) return null;
  if (atom.key === 'is_activate_any_skill') {
    const definitionId=(e:Race['events'][number])=>definitionEventId(race,e);
    const sameTick=observation.sameTimeEvents.some(e=>options.skillId!==undefined&&definitionId(e)!==null&&definitionId(e)!<options.skillId);
    const previousTick=observation.priorEvents.some(e=>definitionId(e)!==null&&definitionId(e)!==options.skillId&&Math.abs(observation.time-e.time-1/15)<.001);
    const ownRecorded=observation.sameTimeEvents.some(e=>definitionId(e)===options.skillId);
    return {value:sameTick||previousTick?1:null,confidence:sameTick||ownRecorded?'known':'proxy',reason:'Transient successful-skill notification: lower ID on the same tick or a recorded activation one simulation tick earlier. A missing proc does not establish the internal trigger or wit outcome.'};
  }
  if (atom.key === 'is_used_skill_id') return { value: events.some(e => e.skillId === atom.value||definitionEventId(race,e)===atom.value) ? atom.value : null, confidence: 'known',reason:'Requested skill ID has a prior successful activation; missing events do not prove absence.' };
  if (atom.key === 'is_activate_other_skill_detail') return { value: options.skillId === undefined||options.branchIndex===undefined ? null : Number(events.some(e => definitionEventId(race,e) === options.skillId&&Number.isInteger(e.params[3])&&e.params[3]!==options.branchIndex)), confidence: 'lower-bound',reason:'A prior different branch of this same normalized skill must be recorded.' };
  const classified = events.filter(event => {
    if (atom.key === 'activate_count_all') return true;
    if (atom.key === 'activate_count_heal') {
      const definition = options.reference?.metadata.skills[definitionEventId(race,event)??event.skillId!], branch = definition?.branches.find((b, i) => (b.branchIndex ?? i) === event.params[3]) ?? (definition?.branches.length === 1 ? definition.branches[0] : null);
      return branch?.effects.some(e => e.type === 9 && e.rawValue > 0) ?? false;
    }
    const index = race.frames.findIndex(f => f.time >= event.time), a = index >= 0 ? race.frames[index] : null, b = index > 0 ? race.frames[index - 1] : a;
    const id = event.runnerId ?? race.runners.find(r=>r.index===event.params[0])?.id;
    const distanceA = a?.runners.find(s => s.runnerId === id)?.distance, distanceB = b?.runners.find(s => s.runnerId === id)?.distance;
    if (race.distance == null || distanceA == null || distanceB == null) return false;
    if (atom.key === 'activate_count_start') return distanceA < race.distance / 6;
    if (atom.key === 'activate_count_middle') return distanceB >= race.distance / 6 && distanceA < race.distance * 2 / 3;
    if (atom.key === 'activate_count_end_after') return distanceB >= race.distance * 2 / 3;
    return distanceB >= race.distance / 2;
  });
  return { value: classified.length, confidence: 'known', reason: 'Replay count of skills that activated in this phase, including start activations. A skill with no event did not activate.' };
}
interface Checks { observations: Set<string>; proxies: Set<string>; missingInputs: Set<string>; hiddenState: Set<string> }
function viewerClause(atoms:Atom[],observation:ConditionObservation|null,eligibility:boolean,checks?:Checks):boolean|null {
  const item=observation?.values.remain_distance_viewer_id;
  if(!item?.candidates){checks?.missingInputs.add('remain_distance_viewer_id: player membership and remaining distances');return null;}
  const result=logic(item.candidates.filter(c=>c.member!==false).map(c=>atoms.map(a=>c.value===null?null:comparePredicate(c.value,a.op,a.value)?c.member===null?null:true:false)));
  const description=`${atoms.map(a=>a.text).join('&')}: one qualifying non-NPC runner must satisfy the complete range`;
  if(result===null){checks?.missingInputs.add(description);return null;}
  if(item.confidence==='proxy'){checks?.proxies.add(description);return eligibility?result:null;}
  checks?.observations.add(description);return result;
}
function checkAtom(atom: Atom | null, observation: ConditionObservation | null, statics: Record<string, PredicateValue>, race: Race, course: CourseReference | null,
  options: ConditionContextOptions, eligibility: boolean, checks?: Checks): boolean | null {
  if (!atom) return null;
  const mechanic = conditionMechanic(atom.key);
  if (!mechanic) { checks?.hiddenState.add(`Unknown predicate: ${atom.text}`); return null; }
  const issue=predicateSupportIssue(atom.key,atom.op,atom.value);if(issue){checks?.hiddenState.add(`${atom.text}: ${issue}`);return null;}
  if(atom.key==='remain_distance_viewer_id')return viewerClause([atom],observation,eligibility,checks);
  if (atom.key === 'is_exist_chara_id') {
    if (atom.op !== '==' && atom.op !== '!=') return null;
    const found = race.runners.some(r => r.charaId === atom.value);
    if (!found && race.runners.some(r => r.charaId === null)) { checks?.missingInputs.add(`${atom.text}: complete field character IDs`); return null; }
    checks?.observations.add(atom.text); return atom.op === '==' ? found : !found;
  }
  if (mechanic.observation === 'random') {
    const regions = randomRegions(atom, race, course);
    if (regions?.length === 0) return false;
    if (regions === null) { checks?.missingInputs.add(`${atom.text}: ${mechanic.required.join(', ')}`); return null; }
    // A percentage draw is still hidden. A random point on the course is not:
    // a horse that runs the region passes every point in it.
    if (atom.key === 'random_lot') {
      checks?.hiddenState.add(`${atom.text}: selected random trigger is not recorded`);
      if (!eligibility || options.coverRandom) return null;
      return true;
    }
    const d = observation?.values.distance_rate?.value;
    if (d == null || race.distance == null) return null;
    const distance = d * race.distance / 100;
    const inside = regions.some(([start, end]) => distance >= start && distance < end);
    if (options.coverRandom) {
      if (inside) checks?.observations.add(`${atom.text}: the recorded path crosses this region`);
      return inside;
    }
    checks?.hiddenState.add(`${atom.text}: selected random trigger is not recorded`);
    if (!eligibility) return null;
    return inside;
  }
  const item = statics[atom.key] ?? (observation ? eventValue(atom, observation, race, options) ?? observation.values[atom.key] : undefined);
  if (item?.range && (atom.key === 'order' || atom.key === 'order_rate')) {
    const result = compareRankRange(item.range, atom.op, rankThreshold(atom.key, atom.value, race.runners.length));
    const description = `${atom.text}: position ${item.range[0] === item.range[1] ? item.range[0] : item.range.join('–')} of ${race.runners.length} (${result === true ? 'satisfied' : 'not satisfied'})`;
    if (result === null) { checks?.missingInputs.add(`${atom.text}: ordering within positions ${item.range.join('–')}`); return null; }
    if (item.confidence === 'proxy') { checks?.proxies.add(description); return eligibility ? result : null; }
    checks?.observations.add(description); return result;
  }
  if(item?.range){
    const result=compareRankRange(item.range,atom.op,atom.value),description=`${atom.text}: supported value range ${item.range.join('–')}`;
    if(result===null){checks?.missingInputs.add(`${description}; ${item.reason??'unresolved input'}`);return null;}
    if(item.confidence==='proxy'){checks?.proxies.add(description);return eligibility?result:null;}
    checks?.observations.add(description);return result;
  }
  if (!item || item.value === null) {
    if (mechanic.observation === 'hidden' || mechanic.mechanics === 'partial') checks?.hiddenState.add(`${atom.text}: ${mechanic.limitation ?? mechanic.required.join(', ')}`);
    else checks?.missingInputs.add(`${atom.text}: ${item?.reason??mechanic.required.join(', ')}`);
    return null;
  }
  const rhs = rankThreshold(atom.key, atom.value, race.runners.length);
  if (item.confidence === 'proxy') { checks?.proxies.add(atom.text); return eligibility ? comparePredicate(item.value, atom.op, rhs) : null; }
  if (item.confidence === 'lower-bound') {
    const proven = lowerBoundCompare(item.value, atom.op, rhs);
    if (proven !== null) { checks?.observations.add(`${atom.text}: recorded lower bound ${item.value}`); return proven; }
    if (options.coverRandom) { checks?.missingInputs.add(`${atom.text}: recorded lower bound ${item.value} does not prove this`); return null; }
    checks?.proxies.add(`${atom.text}: recorded lower bound ${item.value}`);
    return eligibility ? comparePredicate(item.value, atom.op, rhs) : null;
  }
  checks?.observations.add(atom.text);
  return comparePredicate(item.value, atom.op, rhs);
}
function evaluate(expression: Expression, observation: ConditionObservation | null, statics: Record<string, PredicateValue>, race: Race, course: CourseReference | null,
  options: ConditionContextOptions, eligibility: boolean, checks?: Checks) {
  return logic(expression.map(group => {const viewer=group.filter((a):a is Atom=>a!==null&&a.key==='remain_distance_viewer_id');return [...group.filter(a=>a?.key!=='remain_distance_viewer_id').map(atom => checkAtom(atom, observation, statics, race, course, options, eligibility, checks)),...(viewer.length?[viewerClause(viewer,observation,eligibility,checks)]:[])];}));
}
function reconstructedTimer(key: string): boolean {
  return /continuetime$/.test(key) || /_near_lane_time(_set\d+)?$/.test(key) || key === 'overtake_target_time' || key === 'overtake_target_no_order_up_time';
}
function formatObservedValue(value: number, key: string, confidence: PredicateValue['confidence']): string {
  const amount = reconstructedTimer(key) || !Number.isInteger(value) ? value.toFixed(2) : String(value);
  if (confidence === 'lower-bound') return `Recorded lower bound ${amount}.`;
  if (confidence === 'proxy' && reconstructedTimer(key)) return `Reconstructed timer ${amount} s.`;
  if (confidence === 'proxy') return `Replay proxy ${amount}.`;
  return `Value ${amount}.`;
}
function predicateEvidence(atom: Atom, observation: ConditionObservation | null, statics: Record<string, PredicateValue>, race: Race, course: CourseReference | null,
  options: ConditionContextOptions): Pick<PredicateExplanation, 'state' | 'observed' | 'time'> {
  const observedSatisfied = checkAtom(atom, observation, statics, race, course, options, false);
  const item = statics[atom.key] ?? (observation ? eventValue(atom, observation, race, options) ?? observation.values[atom.key] : undefined);
  // A reconstructed timer still has a numeric sample. Use it for the predicate
  // display; it does not become a definitive / non-proxy witness.
  // A calculated sample is evidence. Interpolated rank stays unresolved: the
  // position can be true on a straight-line guess without being recorded.
  const modeledSatisfied = observedSatisfied === null && item?.confidence === 'proxy' && item.value != null && atom.key !== 'order' && atom.key !== 'order_rate'
    ? checkAtom(atom, observation, statics, race, course, options, true) : null;
  const satisfied = observedSatisfied ?? modeledSatisfied;
  let observed = conditionMechanic(atom.key)?.observation === 'random' ? (options.coverRandom ? (satisfied === true ? 'The recorded path crosses this region.' : satisfied === false ? 'The recorded path misses this region.' : 'Region not recorded.') : 'Candidate region; selected random trigger unrecorded.') : satisfied === true ? 'Rule satisfied.' : satisfied === false ? 'Rule not satisfied.' : 'Input unrecorded.';
  if (item?.range) observed = atom.key==='order'||atom.key==='order_rate'?`${item.confidence === 'proxy' ? 'Interpolated position' : 'Position'} ${item.range[0] === item.range[1] ? item.range[0] : item.range.join('–')} of ${race.runners.length}.`:`${item.confidence==='proxy'?'Replay-inferred':'Supported'} value range ${item.range.join('–')}.`;
  else if ((satisfied === true || satisfied === false) && (atom.key === 'blocked_front' || atom.key === 'blocked_side' || atom.key.startsWith('is_')) && item?.value != null && (item.value === 0 || item.value === 1)) observed = satisfied ? 'Rule satisfied.' : 'Rule not satisfied.';
  else if (item?.value != null) observed = formatObservedValue(item.value, atom.key, item.confidence);
  return { state: satisfied === true ? 'met' : satisfied === false ? 'unmet' : 'unknown', observed,
    time: Object.hasOwn(statics, atom.key) ? null : observation?.time ?? null };
}
function completeRandomOpportunity(condition:Expression,precondition:Expression,statics:Record<string,PredicateValue>,race:Race,runner:Runner,course:CourseReference|null,options:ConditionContextOptions):boolean {
  if(evaluate(precondition,null,statics,race,course,options,false)!==true||race.distance==null||runner.finishTimeRaw==null||race.frames[0]?.time!==0)return false;
  const first=race.frames[0].runners.find(s=>s.runnerId===runner.id)?.distance,last=race.frames.at(-1)?.runners.find(s=>s.runnerId===runner.id)?.distance;
  if(first==null||first>.5||last==null||last<race.distance-.1)return false;
  return condition.some(group=>{
    const random=group.filter((a):a is Atom=>a!==null&&conditionMechanic(a.key)?.observation==='random');
    if(random.length!==1||random[0].key==='random_lot')return false;
    if(group.some(a=>a===null||a!==random[0]&&(!Object.hasOwn(statics,a.key)||checkAtom(a,null,statics,race,course,options,false)!==true)))return false;
    const regions=randomRegions(random[0],race,course);
    return !!regions?.length&&regions.every(([a,b])=>b-a>=10&&a>=first&&b<=last);
  });
}
function raceFullyRecorded(race: Race, runner: Runner): boolean {
  if (race.distance == null || runner.finishTimeRaw == null || race.frames[0]?.time !== 0) return false;
  const first = race.frames[0].runners.find(s => s.runnerId === runner.id)?.distance, last = race.frames.at(-1)?.runners.find(s => s.runnerId === runner.id)?.distance;
  return first != null && first <= .5 && last != null && last >= race.distance - .1;
}
/** Mechanics, observable satisfaction and candidate eligibility are separate.
 * A random region / positional proxy may be eligible while its trigger remains
 * unobserved. A sampled miss never proves failure between samples. */
export function evaluateSkillConditions(race: Race, runner: Runner, course: CourseReference | null, skill: SkillReference, evaluationOptions: ConditionContextOptions = {}): SkillConditionEvaluation {
  const statics = conditionStaticValues(race, runner, course, evaluationOptions), timeline = conditionTimeline(race, runner, course, evaluationOptions);
  const branches = skill.branches.map((branch, index): BranchConditionEvaluation => {
    const options={...evaluationOptions,branchIndex:branch.branchIndex??index};
    const condition = parse(branch.condition), precondition = parse(branch.precondition ?? ''), atoms = [...condition.flat(), ...precondition.flat()];
    const unique = [...new Map(atoms.filter((a): a is Atom => a !== null).map(a => [a.text, a])).values()];
    const predicates: PredicateExplanation[] = unique.map(atom => { const m = conditionMechanic(atom.key),issue=predicateSupportIssue(atom.key,atom.op,atom.value), inCondition = condition.flat().some(a => a?.text === atom.text), inPrecondition = precondition.flat().some(a => a?.text === atom.text); return { expression: atom.text, key: atom.key, meaning: m ? explainConditionPredicate(atom.text, race.runners.length) : 'Meaning not established.', mechanicsState: issue?'partial':m?.mechanics ?? 'unsupported', observation: m?.observation ?? 'hidden', limitation: issue??m?.limitation ?? null,
      role: inCondition && inPrecondition ? 'both' : inPrecondition ? 'precondition' : 'condition' }; });
    const mechanicsState: MechanicsState = atoms.includes(null) || predicates.some(p => p.mechanicsState === 'unsupported') ? 'unsupported' : predicates.some(p => p.mechanicsState === 'partial') ? 'partial' : 'understood';
    const staticOnly = atoms.every(atom => atom !== null && Object.hasOwn(statics, atom.key));
    const randomTrigger = predicates.some(p => p.observation === 'random');
    const checks: Checks = { observations: new Set(), proxies: new Set(), missingInputs: new Set(), hiddenState: new Set() };
    const initialCondition = evaluate(condition, null, statics, race, course, options, false), initialPre = evaluate(precondition, null, statics, race, course, options, false);
    const impossible = initialCondition === false || initialPre === false;
    let actualPre = initialPre === true, eligiblePre = evaluate(precondition, null, statics, race, course, options, true) === true;
    let eligiblePreContextChosen = eligiblePre, eligiblePreContext: ConditionObservation | null = null;
    let candidateContext: ConditionObservation | null = null, candidatePreContext: ConditionObservation | null = null;
    let actualOpportunities = 0, opportunities = 0, firstOpportunity: number | null = null, witnessedOpportunity = false;
    let preconditionWitness: Checks | null = initialPre === true ? { observations: new Set(), proxies: new Set(), missingInputs: new Set(), hiddenState: new Set() } : null;
    if (!impossible && staticOnly && initialCondition === true && initialPre === true) { actualOpportunities = 1; opportunities = 1; firstOpportunity = 0; witnessedOpportunity = true; evaluate(condition, null, statics, race, course, options, false, checks); evaluate(precondition, null, statics, race, course, options, false, checks); }
    else if (!impossible) for (const observation of timeline) {
      if (evaluate(precondition, observation, statics, race, course, options, false) === true) {
        actualPre = true;
        const witness: Checks = { observations: new Set(), proxies: new Set(), missingInputs: new Set(), hiddenState: new Set() };
        evaluate(precondition, observation, statics, race, course, options, false, witness);
        if (!preconditionWitness || !witness.proxies.size && !witness.missingInputs.size && !witness.hiddenState.size) preconditionWitness = witness;
      }
      if (evaluate(precondition, observation, statics, race, course, options, true) === true) {
        eligiblePre = true;
        if (!eligiblePreContextChosen) { eligiblePreContextChosen = true; eligiblePreContext = observation; }
      }
      if (actualPre && evaluate(condition, observation, statics, race, course, options, false) === true) {
        actualOpportunities++;
        const witness: Checks = { observations: new Set(), proxies: new Set(), missingInputs: new Set(), hiddenState: new Set() };
        evaluate(condition, observation, statics, race, course, options, false, witness);
        if (!witness.proxies.size && !witness.missingInputs.size && !witness.hiddenState.size && preconditionWitness && !preconditionWitness.proxies.size && !preconditionWitness.missingInputs.size && !preconditionWitness.hiddenState.size) witnessedOpportunity = true;
      }
      if (eligiblePre && evaluate(condition, observation, statics, race, course, options, true) === true) {
        // Keep earliest-opportunity timing; explain a sampled coherent candidate
        // in preference to an earlier inserted/interpolated proxy.
        if (firstOpportunity === null || candidateContext?.interpolated && !observation.interpolated) { candidateContext = observation; candidatePreContext = eligiblePreContext; }
        opportunities++; firstOpportunity ??= observation.time;
      }
      evaluate(condition, observation, statics, race, course, options, true, checks); evaluate(precondition, observation, statics, race, course, options, true, checks);
    }
    if (!timeline.length || impossible) { evaluate(condition, null, statics, race, course, options, false, checks); evaluate(precondition, null, statics, race, course, options, false, checks); }
    const covered = { ...options, coverRandom: true };
    let coveredHit = false, firmHit = false, coveredClear = !impossible && mechanicsState === 'understood' && raceFullyRecorded(race, runner) && timeline.length > 0;
    if (coveredClear) {
      let pre = evaluate(precondition, null, statics, race, course, covered, true) === true;
      for (const observation of timeline) {
        if (evaluate(precondition, observation, statics, race, course, covered, true) === true) pre = true;
        const result = pre ? evaluate(condition, observation, statics, race, course, covered, true) : false;
        if (result === true) {
          coveredHit = true;
          const witness: Checks = { observations: new Set(), proxies: new Set(), missingInputs: new Set(), hiddenState: new Set() };
          evaluate(condition, observation, statics, race, course, covered, true, witness);
          if (pre) evaluate(precondition, observation, statics, race, course, covered, true, witness);
          if (!witness.proxies.size && !witness.missingInputs.size && !witness.hiddenState.size) firmHit = true;
        } else if (result !== false) coveredClear = false;
      }
    }
    const recordedMiss = coveredClear && !coveredHit && !actualOpportunities;
    const recordedHit = firmHit && mechanicsState === 'understood';
    const state: ConditionState = impossible || recordedMiss ? 'unmet' : actualOpportunities ? 'met' : 'unknown';
    const eligibilityState: EligibilityState = impossible ? 'ineligible' : opportunities || recordedHit ? 'eligible' : 'unresolved';
    const definitiveOpportunity = witnessedOpportunity && !randomTrigger;
    const guaranteedWindow=!impossible&&completeRandomOpportunity(condition,precondition,statics,race,runner,course,options);
    const inferredState:ConditionState=state==='unmet'?'unmet':state==='met'||mechanicsState==='understood'&&(guaranteedWindow||recordedHit||opportunities>0&&!randomTrigger)?'met':'unknown';
    const inferenceBasis:BranchConditionEvaluation['inferenceBasis']=state!=='unknown'&&!recordedMiss?'observed':guaranteedWindow?'complete-random-region':recordedMiss||recordedHit?'recorded-conjunction':inferredState==='met'?'replay-proxy':'unresolved';
    // Explain the coherent qualifying candidate, not every unrelated missing
    // value encountered at the gate or in a different OR branch/time window.
    const explainOptions = (atom: Atom) => conditionMechanic(atom.key)?.observation === 'random' ? covered : options;
    if(opportunities>0){for(const set of Object.values(checks))set.clear();evaluate(condition,candidateContext,statics,race,course,covered,true,checks);evaluate(precondition,candidatePreContext,statics,race,course,covered,true,checks);}
    if (opportunities > 0) for (const predicate of predicates) {
      const atom = unique.find(a => a.text === predicate.expression)!;
      const evidence = predicateEvidence(atom, predicate.role === 'precondition' ? candidatePreContext : candidateContext, statics, race, course, explainOptions(atom));
      if (predicate.role === 'both') {
        const preEvidence = predicateEvidence(atom, candidatePreContext, statics, race, course, explainOptions(atom));
        evidence.state = evidence.state === 'unmet' || preEvidence.state === 'unmet' ? 'unmet' : evidence.state === 'met' && preEvidence.state === 'met' ? 'met' : 'unknown';
        if (preEvidence.time !== evidence.time) evidence.observed += ` Earlier precondition${preEvidence.time === null ? '' : ` at ${preEvidence.time!.toFixed(2)} s`}: ${preEvidence.observed}`;
      }
      Object.assign(predicate, evidence);
    } else if (state === 'unmet') {
      const known = (atom: Atom, observation: ConditionObservation) => checkAtom(atom, observation, statics, race, course, covered, true);
      const region = (atom: Atom) => {
        const kind = conditionMechanic(atom.key)?.observation;
        return kind === 'static' || kind === 'random' || ['phase', 'corner', 'is_finalcorner', 'is_finalcorner_laterhalf', 'slope', 'straight_front_type', 'is_last_straight', 'distance_rate', 'remain_distance', 'distance_type'].includes(atom.key);
      };
      for (const group of [...condition, ...precondition]) {
        const atoms = group.filter((atom): atom is Atom => atom !== null);
        if (!atoms.length) continue;
        const regions = atoms.filter(region), varying = atoms.filter(atom => !region(atom));
        const window = timeline.filter(observation => regions.every(atom => known(atom, observation) === true));
        const scope = window.length ? window : timeline;
        for (const atom of atoms) {
          const predicate = predicates.find(item => item.expression === atom.text);
          if (!predicate || predicate.state === 'unmet') continue;
          const samples = varying.includes(atom) && window.length ? window : scope;
          let ever: boolean | null = false;
          for (const observation of samples) {
            const one = known(atom, observation);
            if (one === true) ever = true;
            else if (one === null && ever !== true) ever = null;
          }
          if (ever === true) { predicate.state = 'met'; predicate.observed = varying.includes(atom) && window.length ? 'True during the part of the race the other conditions describe.' : 'True in the recorded race.'; }
          else if (ever === false) { predicate.state = 'unmet'; predicate.observed = window.length && varying.includes(atom) ? 'Never true during the part of the race the other conditions describe.' : 'Never true in the recorded race.'; }
          else if (predicate.state !== 'met') { predicate.state = 'unknown'; predicate.observed = 'Not resolved on every sample.'; }
          predicate.time = null;
        }
        if (window.length && varying.length > 1) {
          let best = 0;
          const inAll = varying.map(() => true), inSome = varying.map(() => false);
          for (let mask = 1; mask < (1 << varying.length); mask++) {
            const held = window.some(observation => varying.every((atom, index) => (mask & (1 << index)) === 0 || known(atom, observation) === true));
            const size = varying.reduce((count, _, index) => count + ((mask & (1 << index)) ? 1 : 0), 0);
            if (!held || size < best) continue;
            if (size > best) { best = size; inAll.fill(true); inSome.fill(false); }
            varying.forEach((_, index) => { if (mask & (1 << index)) inSome[index] = true; else inAll[index] = false; });
          }
          if (best < varying.length) varying.forEach((atom, index) => {
            const predicate = predicates.find(item => item.expression === atom.text);
            if (!predicate || (inAll[index] && inSome[index])) return;
            predicate.state = 'unmet'; predicate.observed = 'Never true at the same time as the other requirements.'; predicate.time = null;
          });
        }
      }
    }
    // A branch can fail to show a conjunction and still have calculated values.
    // Record those before any activation is allowed to fill a remaining gap.
    if (opportunities === 0 && state !== 'unmet') for (const predicate of predicates) {
      if (predicate.state) continue;
      const atom = unique.find(item => item.text === predicate.expression)!;
      const samples = timeline.length ? timeline : [null];
      let chosen: ReturnType<typeof predicateEvidence> | null = null, disagreed = false;
      for (const observation of samples) {
        const evidence = predicateEvidence(atom, observation, statics, race, course, explainOptions(atom));
        if (evidence.state === 'met') { disagreed = true; break; }
        if (evidence.state === 'unmet') chosen = evidence;
        else disagreed = true;
      }
      if (!disagreed && chosen) Object.assign(predicate, chosen);
    }
    for (const missing of checks.missingInputs) if ([...checks.observations].some(observed => missing.startsWith(observed.split(':')[0] + ':'))) checks.missingInputs.delete(missing);
    const missingInputs = [...checks.missingInputs], hiddenState = [...checks.hiddenState], proxies = [...checks.proxies], unresolved = [...missingInputs, ...hiddenState];
    const absenceAssessment:BranchConditionEvaluation['absenceAssessment']=impossible||recordedMiss?'conditions-excluded':inferredState==='met'?'conditions-supported':randomTrigger&&opportunities>0&&!recordedHit?'random-trigger-unobserved':missingInputs.length?'replay-inputs-missing':mechanicsState!=='understood'?'mechanics-partial':'no-observed-candidate';
    const detail = recordedMiss ? 'These conditions are never all true at the same time in the recorded race.'
      : recordedHit && randomTrigger ? 'The runner passes every point in the random region, and the other conditions are true on that path.'
      : impossible ? 'Known race/runner settings or course geometry rule out this branch.'
      : staticOnly && state === 'met' ? 'Known race/runner settings satisfy this branch.'
      : guaranteedWindow?'The complete race crosses every candidate window region and all other rules are static and satisfied; a trigger opportunity is inferred under the reference mechanics.'
      : eligibilityState === 'eligible' ? `${opportunities} ${proxies.length ? 'sampled/model' : 'sampled'} opportunit${opportunities === 1 ? 'y' : 'ies'}; first at ${firstOpportunity!.toFixed(2)} s.${randomTrigger ? ' The runner passes every point in that region.' : proxies.length ? ' Internal transition/timer remains a replay proxy.' : ' This does not establish a proc.'}`
      : missingInputs.length ? `Rule ${mechanicsState === 'understood' ? 'understood' : 'partly understood'}; missing ${missingInputs.length} replay input${missingInputs.length === 1 ? '' : 's'}.`
      : hiddenState.length ? `Rule ${mechanicsState === 'understood' ? 'understood' : 'partly understood'}; ${hiddenState.length} hidden/random input${hiddenState.length === 1 ? '' : 's'} unobserved.`
      : 'No qualifying observed opportunity. Between-sample timing remains unresolved.';
    return { branchIndex: branch.branchIndex ?? index, state, staticOnly, firstOpportunity, opportunities, unresolved, detail, mechanicsState, eligibilityState,
      randomTrigger, definitiveOpportunity, inferredState,inferenceBasis,absenceAssessment,observations: [...checks.observations], proxies, missingInputs, hiddenState, predicates };
  });
  return { state: branches.some(b => b.state === 'met') ? 'met' : branches.length && branches.every(b => b.state === 'unmet') ? 'unmet' : 'unknown', branches,
    mechanicsState: branches.some(b => b.mechanicsState === 'unsupported') ? 'unsupported' : branches.some(b => b.mechanicsState === 'partial') ? 'partial' : 'understood',
    eligibilityState: branches.some(b => b.eligibilityState === 'eligible') ? 'eligible' : branches.length && branches.every(b => b.eligibilityState === 'ineligible') ? 'ineligible' : 'unresolved',
    definitiveOpportunity: branches.some(b => b.definitiveOpportunity), randomTrigger: branches.some(b => b.randomTrigger),
    inferredState:branches.some(b=>b.inferredState==='met')?'met':branches.length&&branches.every(b=>b.inferredState==='unmet')?'unmet':'unknown' };
}

function provedByActivation(expression: string, predicates: PredicateExplanation[], role: 'condition' | 'precondition'): Set<string> {
  const groups = parse(expression);
  const status = (text: string) => predicates.find(item => item.expression === text && (!item.role || item.role === 'both' || item.role === role))?.state;
  const eliminated = groups.map(group => group.some(atom => atom && status(atom.text) === 'unmet'));
  const confirmed = groups.map(group => group.every(atom => !atom || status(atom.text) === 'met'));
  if (confirmed.some((done, index) => done && !eliminated[index])) return new Set();
  const possible = groups.filter((_, index) => !eliminated[index]);
  if (!possible.length) return new Set();
  const proved = new Set<string>();
  for (const text of new Set(possible.flatMap(group => group.flatMap(atom => atom ? [atom.text] : [])))) {
    if (!possible.every(group => group.some(atom => atom?.text === text))) continue;
    const state = status(text);
    if (state !== 'met' && state !== 'unmet') proved.add(text);
  }
  return proved;
}
/** A recorded proc fills only checks that are still unknown, and only when
 * every remaining alternative requires them. Known values and rejected
 * alternatives stay as calculated. */
export function applyRecordedBranchEvidence(
  evaluation: SkillConditionEvaluation,
  activations: { effectBranch: number | null; start: number }[],
  skill?: SkillReference,
): SkillConditionEvaluation {
  for (const activation of activations) {
    if (activation.effectBranch == null) continue;
    const branch = evaluation.branches.find(item => item.branchIndex === activation.effectBranch);
    if (!branch) continue;
    const definition = skill?.branches.find((item, index) => (item.branchIndex ?? index) === branch.branchIndex);
    branch.state = 'met';
    branch.inferredState = 'met';
    if (branch.inferenceBasis === 'unresolved') branch.inferenceBasis = 'observed';
    const proved = new Set([
      ...provedByActivation(definition?.condition ?? '', branch.predicates, 'condition'),
      ...provedByActivation(definition?.precondition ?? '', branch.predicates, 'precondition'),
    ]);
    for (const predicate of branch.predicates) {
      if (!proved.has(predicate.expression) || predicate.state === 'met' || predicate.state === 'unmet') continue;
      const previous = predicate.observed;
      predicate.state = 'met';
      predicate.observed = previous && previous !== 'Input unrecorded.'
        ? `Recorded activation proves this was met. ${previous}`
        : 'Recorded activation of this branch requires this condition.';
      predicate.time ??= activation.start;
    }
  }
  evaluation.state = evaluation.branches.some(branch => branch.state === 'met') ? 'met'
    : evaluation.branches.length && evaluation.branches.every(branch => branch.state === 'unmet') ? 'unmet' : 'unknown';
  evaluation.inferredState = evaluation.branches.some(branch => branch.inferredState === 'met') ? 'met'
    : evaluation.branches.length && evaluation.branches.every(branch => branch.inferredState === 'unmet') ? 'unmet' : 'unknown';
  return evaluation;
}

export function conditionCoverage(metadata: ReferenceMetadata) {
  const occurrences = new Map<string, number>(); let branches = 0, parsedAtoms = 0, invalidExpressions = 0;
  const examples=new Map<string,{skillIds:Set<number>;branches:Set<string>;expressions:Set<string>}>();
  let understoodBranches = 0, partialBranches = 0, unsupportedBranches = 0, randomBranches = 0;
  for (const [skillId,skill] of Object.entries(metadata.skills)) for (const [branchIndex,branch] of skill.branches.entries()) {
    branches++;
    const atoms = [...parse(branch.condition).flat(), ...parse(branch.precondition ?? '').flat()];
    const states: MechanicsState[] = [];
    for (const atom of atoms) { if (!atom) { invalidExpressions++; states.push('unsupported'); continue; } parsedAtoms++; occurrences.set(atom.key, (occurrences.get(atom.key) ?? 0) + 1); states.push(conditionMechanic(atom.key)?.mechanics ?? 'unsupported');
      let ids=examples.get(atom.key);if(!ids)examples.set(atom.key,ids={skillIds:new Set(),branches:new Set(),expressions:new Set()});ids.skillIds.add(Number(skillId));ids.branches.add(`${skillId}:${branch.branchIndex??branchIndex}`);ids.expressions.add(atom.text);
    }
    if (states.includes('unsupported')) unsupportedBranches++; else if (states.includes('partial')) partialBranches++; else understoodBranches++;
    if (atoms.some(atom => atom && conditionMechanic(atom.key)?.observation === 'random')) randomBranches++;
  }
  const keys = [...occurrences].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ key, occurrences: count, skillIds:[...examples.get(key)!.skillIds].sort((a,b)=>a-b),branches:[...examples.get(key)!.branches].sort(),expressions:[...examples.get(key)!.expressions].sort(),...(conditionMechanic(key) ?? { mechanics: 'unsupported', observation: 'hidden', meaning: 'Unestablished predicate.', required: [] }),simulator:conditionSourceAudit[key]??null,
    replayTreatment:conditionMechanic(key)?.observation==='random'?'candidate region / hidden draw':conditionMechanic(key)?.observation==='hidden'?'unavailable internal input':conditionMechanic(key)?.observation==='position-proxy'?'explicit replay inference':conditionMechanic(key)?.observation==='history'?'recorded history / conservative bounds':'recorded or deterministic derived input' }));
  return { skills: Object.keys(metadata.skills).length, branches, parsedAtoms, invalidExpressions, predicateKeys: keys.length,
    understoodKeys: keys.filter(k => k.mechanics === 'understood').length, partialKeys: keys.filter(k => k.mechanics === 'partial').length, unsupportedKeys: keys.filter(k => k.mechanics === 'unsupported').length,
    understoodBranches, partialBranches, unsupportedBranches, randomBranches, keys };
}
