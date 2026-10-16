/** Predicate meanings come from the selected master definitions, readable
 * simulator and replay reference sources and the provided mechanics notes. Simulator
 * approximations are not promoted to observed game-internal state. */
import { explainFieldRankCondition } from './field-rank';
export { explainFieldRankCondition } from './field-rank';
export type MechanicsState = 'understood' | 'partial' | 'unsupported';
export type ObservationKind = 'static' | 'sampled' | 'history' | 'position-proxy' | 'hidden' | 'random';
export interface ConditionMechanic {
  meaning: string; mechanics: Exclude<MechanicsState, 'unsupported'>;
  observation: ObservationKind; required: string[]; limitation?: string;
}
const catalog: Record<string, ConditionMechanic> = {};
function add(keys: string, meaning: string, observation: ObservationKind, required: string[], limitation?: string, mechanics: ConditionMechanic['mechanics'] = 'understood') {
  for (const key of keys.split(' ')) catalog[key] = { meaning, mechanics, observation, required, ...(limitation ? { limitation } : {}) };
}
add('always', 'Unconditional reference predicate.', 'static', []);
add('running_style', 'Selected strategy; Front and effective Runaway share Front skill selection.', 'static', ['strategy selection']);
add('ground_type distance_type rotation track_id distance course_distance is_basis_distance is_dirtgrade corner_count', 'Course surface, distance class, direction, venue, official distance, 400 m divisibility or dirt-track class.', 'static', ['course identity / distance']);
add('ground_condition weather season', 'Recorded ground, weather or season enum.', 'static', ['race condition enum']);
add('motivation', 'Recorded motivation enum (1–5).', 'static', ['motivation']);
add('base_power base_speed base_stamina base_guts base_wiz', 'Base stat after overcap adjustment and motivation, before green/passive stat effects.', 'static', ['raw stat', 'motivation']);
add('is_badstart', 'Recorded gate delay exceeds 0.08 s.', 'static', ['start delay']);
add('is_exist_chara_id', 'The specified character is present in the field.', 'static', ['field character IDs']);
add('running_style_count_same running_style_count_same_rate', 'Count or percentage of the field sharing this selected strategy, including self.', 'static', ['field strategy selections']);
add('running_style_count_nige_otherself running_style_count_senko_otherself running_style_count_sashi_otherself running_style_count_oikomi_otherself', 'Count other runners using the named selected strategy.', 'static', ['field strategy selections']);
add('same_skill_horse_count', 'Number of field runners equipped with this skill, including self.', 'static', ['complete equipped inventories', 'skill identity']);
add('popularity', 'Pre-race popularity rank.', 'static', ['recorded popularity rank']);
add('running_style_equal_popularity_one', 'Whether the most popular runner shares this selected strategy.', 'static', ['recorded popularity rank', 'field strategy selections']);
add('post_number', 'Starting bracket 1–8. Recorded frame order is the individual gate; fields larger than eight place the extra horses in the outer brackets.', 'static', ['recorded frame order', 'field size']);
add('grade time', 'Race grade or time-of-day enum; time is not elapsed replay time.', 'static', ['race grade / time-of-day enum']);
add('phase distance_rate remain_distance accumulatetime', 'Race phase, percentage distance, integer remaining distance or elapsed race seconds.', 'sampled', ['runner distance / time', 'official distance']);
add('corner is_finalcorner is_finalcorner_laterhalf slope straight_front_type is_last_straight', 'Reference course segment at the observed distance; final-corner flag stays set into the final straight.', 'sampled', ['runner distance', 'course segments']);
add('is_last_straight_onetime', 'Entry into the last straight, detected from the sampled segment transition.', 'position-proxy', ['runner distance history', 'last straight'], 'The exact simulation-tick notification is absent; no arbitrary 10 m active region is invented.');
add('is_lastspurt', 'Runner has reached the recorded final-spurt start distance.', 'sampled', ['runner distance', 'recorded spurt distance']);
add('lastspurt', 'HP-feasibility state: 0 cannot finish at base speed, 1 can exceed base but not sustain maximum, 2 can sustain maximum spurt.', 'position-proxy', ['late-entry HP','initial speed/guts stats','course/ground','recovery history'], 'Reference budget state latches from late entry and recalculates on positive recovery; selected target and wit choice remain unreported.');
add('order order_rate', 'One-based current position in the whole field. Percentage rules compare position with the rounded field-size cutoff; they do not use rank within a strategy group.', 'sampled', ['field distances'], 'Ties or missing opponents may leave a rank interval; a condition is established only if every possible position satisfies it. Event-time interpolation remains a proxy.');
add('distance_diff_top', 'Whole metres behind the leader of the whole field; the separate float predicate uses decimetres.', 'sampled', ['complete field distances']);
add('bashin_diff_infront bashin_diff_behind', 'Gap to the immediately adjacent runner in rank order, in horse lengths (2.5 m).', 'sampled', ['complete field distances']);
add('hp_per', 'Remaining HP as a percentage of maximum HP.', 'position-proxy', ['recorded HP', 'known maximum HP'], 'A time-zero HP observation supplies a replay proxy for maximum HP; absent start coverage leaves it unknown.');
add('is_temptation blocked_front', 'Recorded rushed-mode or front-block state.', 'sampled', ['rushed / blocking flag']);
add('temptation_count', 'Number of rushed episodes since the start.', 'history', ['rushed-state history'], 'Samples provide a lower bound; short unobserved episodes cannot be excluded.');
add('activate_count_all activate_count_start activate_count_middle activate_count_end_after activate_count_later_half activate_count_heal is_activate_any_skill', 'Skills that activated in the named part of the race. The opening phase includes start activations, not only the tick-0 instant. Lower skill IDs can trigger higher IDs on the same timestamp.', 'history', ['recorded skill events', 'skill definitions'], 'The replay event list is the activation record. A skill with no event did not activate.');
add('is_used_skill_id is_activate_other_skill_detail', 'Whether the specified skill has successfully activated earlier.', 'history', ['recorded skill events']);
add('change_order_onetime change_order_up_end_after change_order_up_finalcorner_after', 'An improvement/change in rank, or accumulated overtakes after late-race/final-corner entry.', 'position-proxy', ['field rank history'], 'Sampled rank changes give opportunities/lower bounds, not the exact simulation transition flags.');
add('order_rate_in20_continue order_rate_in40_continue order_rate_in50_continue order_rate_in80_continue order_rate_out20_continue order_rate_out40_continue order_rate_out50_continue order_rate_out70_continue', 'Remain continuously inside/outside a rounded rank threshold; first five seconds are excluded.', 'position-proxy', ['field rank history'], 'A sampled violation is known; uninterrupted simulation-frame compliance is not proved by coarse samples.');
add('is_move_lane', 'Recent lane movement: 1 inward toward the fence, 2 outward; 0 means no sampled movement.', 'position-proxy', ['lane history'], 'Recorded lane changes show motion, not the exact simulation-tick transition.');
add('near_count is_surrounded', 'Nearby/surrounding opponents using longitudinal gaps and horse-lane width thresholds.', 'position-proxy', ['field distances', 'lane fractions'], 'Uses the documented course-width/18 horse-lane scale and reference spatial rules, not a recorded internal neighborhood.');
add('behind_near_lane_time infront_near_lane_time', 'Continuous proximity to any runner within 2.5 m and one horse lane; own rank changes reset the timer, replacement neighbors do not.', 'position-proxy', ['rank history', 'field distances', 'lane fractions'], 'GameTora reference spatial policy; sample-held timers may differ from hidden between-sample transitions.');
add('behind_near_lane_time_set1','Continuous proximity to any runner behind within 5 m and 2.7 horse lanes; own rank changes reset the timer.','position-proxy',['rank history','field distances','lane fractions'],'Sample-held timer proxy; replacing a qualifying neighbor does not reset the timer.');
add('blocked_front_continuetime blocked_side_continuetime', 'Continuous front/side blocking timer.', 'position-proxy', ['blocking flag / field positions', 'lane fractions'], 'Front flag is recorded; timer is sampled. Side blocking is a geometric proxy, not a recorded state.');
add('is_overtake overtake_target_no_order_up_time', 'Having an overtake target: a visible runner up to 20 m ahead, catchable within 15 seconds at current actual speeds.', 'position-proxy', ['field positions / speeds', 'vision', 'lane fractions'], 'Visible faster-approach candidates are modeled; the selected target and timers are not recorded.');
add('overtake_target_time','Time spent being an overtake target of another runner behind.','position-proxy',['field positions / speeds','other-runner vision','lane fractions'],'The other runner must be able to catch this runner within 15 seconds; selected target and internal timers remain inferred.');
add('visiblehorse', 'Opponents inside the vision cone; base vision is 20 m with skill modifiers.', 'position-proxy', ['field positions', 'lane fractions', 'known vision modifiers']);
add('compete_fight_count', 'Number of showdowns; current Global rules only ask whether at least one occurred.', 'history', ['recorded dueling starts'], 'A recorded showdown proves >0; episode/resume counts beyond that remain unsupported.');
add('is_behind_in','The immediately trailing runner is closer to the inner fence than this runner.','sampled',['unambiguous field rank','lane fractions'],'Tied placement or an unknown trailing runner/lane leaves the selection unresolved.');
add('lane_type','Course-width lane class: 0 at <=0.2, 1 at <=0.4, 2 at <=0.6, otherwise 3.','sampled',['decoded course-width lane fraction']);
add('distance_diff_rate','100 × (leader distance − own distance) / (leader distance − last distance).','sampled',['complete field distances'],'A zero field spread leaves the ratio undefined.');
add('remain_distance_viewer_id','Remaining distance of any non-NPC player runner.','sampled',['field distances','explicit NPC/player markers'],'Missing NPC markers are bounded; a character-presence rule does not identify player ownership.');
add('is_other_character_activate_advantage_skill','Another runner has just activated a beneficial effect of the specified type; Global value9 means healing.','history',['successful other-runner skill events','effect branches'],'Same/preceding-tick healing notifications are inferred; missing events do not prove absence. Other effect values remain unsupported.');
add('temptation_opponent_count_behind temptation_opponent_count_infront running_style_temptation_opponent_count_nige running_style_temptation_opponent_count_senko running_style_temptation_opponent_count_sashi running_style_temptation_opponent_count_oikomi','Current rushing enemies, excluding self and known teammates, filtered by direction or strategy.','sampled',['field rushed states','anonymous team membership','positions / strategies'],'Unknown teams, state or selectors widen the possible count; they do not become zero.');
add('phase_random phase_firsthalf_random phase_laterhalf_random corner_random all_corner_random straight_random last_straight_random is_finalcorner_random up_slope_random down_slope_random distance_rate_after_random', 'Preselected random activation window within the named phase/course region.', 'random', ['course / phase geometry', 'random trigger selection'], 'Being in the candidate region does not prove the selected random window coincided with other conditions.');
add('random_lot', 'Separate random gate: reference draw must be below the stated percentage.', 'random', ['separate random draw'], 'This random gate is distinct from the skill activation wit lottery.');

export function conditionMechanic(key: string): ConditionMechanic | null { return catalog[key] ?? null; }
export function conditionMechanicsCatalog(): Readonly<Record<string, ConditionMechanic>> { return catalog; }
/** Finite reference selector domains are explicit. Future unsupported arguments
 * remain unresolved and diagnosed rather than silently taking a false branch. */
export function predicateSupportIssue(key:string,op:string,argument:number):string|null {
  if(key==='compete_fight_count'&&!(op==='>'&&argument===0))return 'Only the current Global >0 showdown rule is established from recorded starts.';
  if(key==='is_other_character_activate_advantage_skill'&&!(op==='=='&&argument===9))return 'Only the current Global healing-effect selector ==9 is implemented.';
  if(key==='is_exist_chara_id'&&!['==','!='].includes(op))return 'Character-presence predicates support equality/inequality selectors only.';
  const domains:Record<string,number[]>={lane_type:[0,1,2,3],is_behind_in:[0,1],is_move_lane:[0,1,2],lastspurt:[0,1,2]};
  if(domains[key]&&!domains[key].includes(argument))return 'This selector value is outside the established reference enum.';
  if(catalog[key]?.observation==='random'){
    if(op!=='==')return 'Random selectors require the reference equality form.';
    const valid=key==='random_lot'||key==='distance_rate_after_random'?argument>=0&&argument<=100:key.startsWith('phase_')?[0,1,2,3].includes(argument):key==='corner_random'?[1,2,3,4].includes(argument):argument===1;
    if(!valid)return 'This random selector value is outside the established reference domain.';
  }
  return null;
}
export function explainConditionPredicate(expression: string, fieldSize?: number): string {
  const rank = explainFieldRankCondition(expression, fieldSize);
  if (rank) return rank;
  const key = expression.trim().match(/^(\w+)(?:==|!=|>=|<=|>|<)/)?.[1] ?? expression.trim();
  return catalog[key]?.meaning ?? 'Predicate meaning not established in the inspected references.';
}
