<script lang="ts">
  import { explainConditionPredicate, explainFieldRankCondition } from '../data/condition-mechanics';
  import type { ReferenceData } from '../data/reference';
  import type { PredicateExplanation } from '../data/skill-conditions';
  export let expression:string;
  export let reference:ReferenceData|null=null;
  export let showCode=false;
  export let fieldSize:number|undefined=undefined;
  export let predicates:PredicateExplanation[]=[];
  export let role:'condition'|'precondition'='condition';
  const evidence=(atom:string)=>predicates.find(p=>p.expression===atom.trim()&&(!p.role||p.role==='both'||p.role===role));
  function explain(atom:string){
    const rank=explainFieldRankCondition(atom,fieldSize);if(rank)return rank;
    const match=atom.trim().match(/^(\w+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if(!match)return explainConditionPredicate(atom);
    const [,key,op,raw]=match,value=Number(raw);
    const enums:Record<string,Record<number,string>>={
      running_style:{1:'Front Runner (including Runaway)',2:'Pace Chaser',3:'Late Surger',4:'End Closer'},
      ground_type:{1:'Turf',2:'Dirt'},distance_type:{1:'Sprint',2:'Mile',3:'Medium',4:'Long'},
      weather:{1:'Sunny',2:'Cloudy',3:'Rainy',4:'Snowy'},ground_condition:{1:'Firm',2:'Good',3:'Soft',4:'Heavy'},
      season:{1:'Spring',2:'Summer',3:'Autumn',4:'Winter',5:'Cherry blossom season'},motivation:{1:'Awful mood',2:'Bad mood',3:'Normal mood',4:'Good mood',5:'Great mood'},
      phase:{0:'Opening leg',1:'Middle leg',2:'Final leg',3:'Final sixth'},
      lane_type:{0:'Inner lane (≤ 0.2)',1:'Middle lane (> 0.2–0.4)',2:'Outer lane (> 0.4–0.6)',3:'Outside lane (> 0.6)'},
      is_move_lane:{1:'Moved toward the inner fence',2:'Moved away from the inner fence'},
      rotation:{1:'Right-handed course',2:'Left-handed course'},
      time:{0:'Any time of day',1:'Morning',2:'Daytime',3:'Evening',4:'Night'},
      straight_front_type:{1:'Home straight',2:'Back straight'},
      lastspurt:{0:'Not enough HP to finish at base speed',1:'Enough HP for a reduced final spurt',2:'Enough HP for a full-speed final spurt'},
    };
    if((op==='=='||op==='!=')&&enums[key]?.[value])return `${op==='!='?'Not ':''}${enums[key][value]}.`;
    if(key==='always'&&op==='=='&&value===1)return 'Always satisfied.';
    if(key==='track_id'&&['==','!='].includes(op))return `${op==='!='?'Not ':''}${reference?.metadata.trackNames[value]??`Course ${raw}`}.`;
    if(['distance','course_distance'].includes(key))return `Race distance ${op==='=='?'=':op} ${raw} m.`;
    if(key==='phase_random')return `Random point in ${({0:'the opening leg',1:'the middle leg',2:'the final leg',3:'the final sixth'} as Record<number,string>)[value]??'the required phase'}.`;
    if(['phase_firsthalf_random','phase_laterhalf_random'].includes(key))return `Random point in the ${key==='phase_firsthalf_random'?'first':'second'} half of ${({0:'the opening leg',1:'the middle leg',2:'the final leg',3:'the final sixth'} as Record<number,string>)[value]??'the required phase'}.`;
    const random:Record<string,string>={straight_random:'a straight',all_corner_random:'a corner',last_straight_random:'the final straight',is_finalcorner_random:'the final corner',up_slope_random:'an uphill',down_slope_random:'a downhill'};
    if(random[key])return `Random point on ${random[key]}.`;
    if(key==='is_activate_any_skill'&&op==='=='&&value===1)return 'Another skill activates.';
    if(key==='phase'&&op==='>='&&value===2)return 'Final leg or later.';
    if(key==='phase'&&op==='>='&&value===1)return 'Middle leg or later.';
    if(key==='corner'&&value===0)return op==='=='?'On a straight.':op==='!='?'On a corner.':explainConditionPredicate(atom);
    if(key==='corner'&&op==='==')return `Corner ${value}.`;
    if(key==='is_other_character_activate_advantage_skill'&&op==='=='&&value===9)return 'Another runner activates a recovery skill.';
    if(key==='remain_distance_viewer_id')return `A player runner has ${op==='=='?'=':op} ${raw} m remaining.`;
    if(key==='distance_diff_rate')return `Gap to the leader ${op==='=='?'=':op} ${raw}% of the leader-to-last gap.`;
    if(key==='distance_diff_top')return `Gap to the leader ${op==='=='?'=':op} ${raw} m (whole metres).`;
    if(key==='random_lot'&&op==='==')return `${raw}% separate random chance.`;
    const flags:Record<string,string>={is_finalcorner:'From the final corner onward',is_finalcorner_laterhalf:'In the second half of the final corner',is_last_straight:'On the final straight',is_last_straight_onetime:'Entering the final straight',is_lastspurt:'During the final spurt',is_badstart:'Slow start (over 80 ms)',is_temptation:'Rushed',blocked_front:'Blocked in front',is_surrounded:'Surrounded by runners',is_overtake:'Trying to overtake',is_basis_distance:'Race distance is a multiple of 400 m',is_behind_in:'The runner behind is closer to the inner fence'};
    if(flags[key]&&['==','!='].includes(op))return `${(op==='=='&&value===0||op==='!='&&value===1)?'Not: ':''}${flags[key]}.`;
    if(key==='slope'&&op==='==')return ({0:'On level ground.',1:'Going uphill.',2:'Going downhill.'} as Record<number,string>)[value]??'On the required slope.';
    const counts:Record<string,string>={activate_count_all:'Skills activated',activate_count_start:'Skills activated in the opening leg',activate_count_middle:'Skills activated in the middle leg',activate_count_end_after:'Skills activated in the final leg or later',activate_count_later_half:'Skills activated in the second half',activate_count_heal:'Recovery skills activated',near_count:'Nearby runners',visiblehorse:'Runners in view',temptation_count:'Rushed episodes',running_style_count_same:'Runners with the same strategy',same_skill_horse_count:'Runners with this skill'};
    if(counts[key])return `${counts[key]} ${({ '==':'=', '!=':'≠','>=':'≥','<=':'≤','>':'>','<':'<' } as Record<string,string>)[op]} ${raw}.`;
    const names:Record<string,string>={hp_per:'HP remaining',order:'Position',order_rate:'Position percentile',remain_distance:'Distance remaining',distance_rate:'Race distance completed',accumulatetime:'Race time',base_speed:'Base speed',base_stamina:'Base stamina',base_power:'Base power',base_guts:'Base guts',base_wiz:'Base wit',popularity:'Popularity rank'};
    if(names[key])return `${names[key]} ${({ '==':'=', '!=':'≠','>=':'≥','<=':'≤','>':'>','<':'<' } as Record<string,string>)[op]} ${raw}${['hp_per','order_rate','distance_rate'].includes(key)?'%':key==='remain_distance'?' m':key==='accumulatetime'?' s':''}.`;
    return explainConditionPredicate(atom);
  }
</script>
<div class="condition-rules">
  {#each expression.split('@') as alternative,i}
    {#if i}<span class="condition-or">or</span>{/if}
    <div class="condition-group">{#each alternative.split('&').filter(Boolean) as atom}{@const item=evidence(atom)}<div class="rule">{#if item?.state}<span class="predicate-state" class:met={item.state==='met'} class:unmet={item.state==='unmet'} title={`${item.observed??''}${item.time!=null?` At ${item.time.toFixed(2)} s.`:''}`} aria-label={item.state==='met'?'Condition met':item.state==='unmet'?'Condition not met':'Condition uncertain'}>{item.state==='met'?'✓':item.state==='unmet'?'×':'?'}</span>{/if}<div>{explain(atom)}{#if showCode}<code>{atom}</code>{/if}</div></div>{:else}<div>No additional condition.</div>{/each}</div>
  {/each}
</div>
<style>
  .condition-rules{background:var(--bg);border-radius:5px;padding:10px 12px}.condition-group{display:grid;gap:6px;font-size:var(--font-11);line-height:1.5;color:var(--muted)}.condition-or{display:block;margin:8px 0;color:var(--accent-text,var(--accent));font-size:var(--font-11)}
  code{display:block;margin-top:3px;color:var(--text);font-size:var(--font-11);overflow-wrap:anywhere}
  .rule{display:flex;gap:8px;align-items:flex-start}.predicate-state{width:13px;flex-shrink:0;font-weight:700;color:var(--muted)}.predicate-state.met{color:var(--accent-text,var(--accent))}.predicate-state.unmet{color:#e48087}
</style>
