import type { Race, Runner } from './types';
import type { CourseReference, ReferenceData } from './reference';
import type { SkillRow } from './analytics';
import type { RunnerStatBreakdown, StatKey } from './effect-types';
import { unresolvedPassiveLabels, unresolvedPassiveStats } from './passive-inputs';
import { effectValue } from './effect-value';
import { effectiveStrategyCode } from './skill-details';

export const statKeys: StatKey[] = ['speed','stamina','power','guts','wisdom'];
export const styleAptitude = [.1,.2,.4,.6,.75,.85,1,1.1];
export const distanceAptitude = [.1,.2,.4,.6,.8,.9,1,1.05];
export function aptitudeRank(value: number | string | null | undefined): number | null {
  const n = typeof value === 'string' ? ({G:1,F:2,E:3,D:4,C:5,B:6,A:7,S:8} as Record<string,number>)[value.toUpperCase()] : value;
  return n != null && Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}
export function statBreakdownFor(race: Race, runner: Runner, course: CourseReference | null, reference: ReferenceData | null, rows: SkillRow[]): RunnerStatBreakdown {
  const mood = runner.mood != null && runner.mood >= 1 && runner.mood <= 5 ? 1+.02*(runner.mood-3) : null;
  const career = race.category === 'career' ? 400 : ['practice','team-trials','champions-meeting'].includes(race.category??'') ? 0 : null;
  const ground = Number(race.conditions?.ground), knownGround = Number.isInteger(ground) && ground >= 1 && ground <= 4 && course && [1,2].includes(course.surface);
  const style = effectiveStrategyCode(runner, rows), styleKey = ({1:'front',2:'pace',3:'late',4:'end',5:'front'} as const)[style as 1|2|3|4|5];
  const rank = styleKey ? aptitudeRank(runner.aptitudes?.[styleKey]) : null;
  const unresolved = unresolvedPassiveStats(runner,rows,reference), passiveLabels = unresolvedPassiveLabels(runner,rows,reference), passive = [0,0,0,0,0];
  for (const row of rows) {
    const definition = reference?.metadata.skills[row.skillId];
    const indices = new Set([...row.inferredBranches,...row.activations.filter(a=>a.start===0).flatMap(a=>a.effectBranch!==null?[a.effectBranch]:definition?.branches.length===1?[definition.branches[0].branchIndex??0]:[])]);
    if (row.inferredBranches.length > 1) for (const b of definition?.branches??[]) for (const e of b.effects) if(e.type>=1&&e.type<=5) unresolved.add(e.type);
    for (const index of indices) for (const effect of definition?.branches.find((b,i)=>(b.branchIndex??i)===index)?.effects??[]) {
      if (effect.type<1||effect.type>5) continue;
      const value=effectValue(runner,row.skillId,effect);
      if(value===null||(effect.targetType??1)!==1) unresolved.add(effect.type); else passive[effect.type-1]+=value;
    }
  }
  const baseFor=(key:StatKey)=>runner.stats?.[key]!=null&&mood!==null ? Math.max(1,Math.min(2000,(runner.stats[key]!>1200?1200+(runner.stats[key]!-1200)/2:runner.stats[key]!)*mood)) : null;
  const thresholds=course?.courseSetStatus.map(id=>statKeys[id-1]?baseFor(statKeys[id-1]):null);
  const track=course ? !thresholds?.length ? 1 : thresholds.every(n=>n!==null) ? thresholds.reduce((sum,n)=>sum+(n!>900?1.2:n!>600?1.15:n!>300?1.1:1.05),0)/thresholds.length : null : null;
  const stats={} as RunnerStatBreakdown['stats'];
  for(const [i,key] of statKeys.entries()) {
    const raw=runner.stats?.[key]??null,overcap=raw===null?null:raw>1200?1200+(raw-1200)/2:raw,base=baseFor(key);
    const courseMultiplier=key==='speed'?track:1,strategyMultiplier=key==='wisdom'?rank===null?null:styleAptitude[rank-1]:1;
    const groundGain=key==='speed'?knownGround?(ground===4?-50:0):null:key==='power'?knownGround?(course!.surface===2?(ground===2?-50:-100):(ground===1?0:-50)):null:0;
    const courseGain=base!==null&&courseMultiplier!==null?base*(courseMultiplier-1):null;
    const strategyGain=base!==null&&strategyMultiplier!==null?base*(strategyMultiplier-1):null;
    const passiveGain=unresolved.has(i+1)?null:passive[i];
    const inputs=[base,courseGain,strategyGain,groundGain,career,passiveGain];
    const beforeCap=inputs.every(n=>n!==null)?inputs.reduce<number>((sum,n)=>sum+n!,0):null;
    const final=beforeCap===null?null:Math.max(1,Math.min(2000,beforeCap));
    stats[key]={raw,overcap,base,moodMultiplier:mood,moodGain:overcap!==null&&mood!==null?overcap*(mood-1):null,
      baseCapGain:overcap!==null&&mood!==null&&base!==null?base-overcap*mood:null,capGain:final!==null&&beforeCap!==null?final-beforeCap:null,
      courseMultiplier,courseGain,strategyMultiplier,strategyGain,groundGain,careerGain:career,passiveGain,
      final,
      detail:`Reference initial ${key}: over-1200 halving, motivation, base/final1–2000 clamps, course thresholds (base stats), style aptitude for wit, ground, career +400 and resolved initial passive effects. ${unresolved.has(i+1)?`Final ${key} withheld: ${(passiveLabels.get(i+1)??['an equipped passive']).join(', ')} ${(passiveLabels.get(i+1)?.length??1)>1?'are':'is'} not proven active. `:''}This is the pre-5th-anniversary reference regime; uncapped later regimes and scenario/team-rank bonuses are not reconstructed.`};
  }
  const coefficient=style===null?null:({1:.95,2:.89,3:1,4:.995,5:.86} as Record<number,number>)[style]??null;
  const observed=race.frames[0]?.runners.find(s=>s.runnerId===runner.id)?.hp??null;
  const staminaContribution = stats.stamina.final !== null && coefficient !== null ? 0.8 * coefficient * stats.stamina.final : null;
  const modeled=staminaContribution!==null&&race.distance!==null?staminaContribution+race.distance:null;
  return {stats,startingHp:{observed,modeled,difference:observed!==null&&modeled!==null?observed-modeled:null,
    staminaContribution,distanceContribution:race.distance,strategyCoefficient:coefficient,
    detail:'Reference maximum starting HP = course distance + 0.8 × style coefficient × adjusted stamina. Observed initial HP is the first retained sample, which may be after start drain or effects; a difference is not attributed to a skill.'},
    evidence:statKeys.every(k=>stats[k].final!==null)?'estimated':'unknown',detail:'Initial reference stat decomposition, not a stat field measured inside the simulator. Mood/course/passive additions are distinct and unknown inputs stay null.'};
}
/** Low/high final when one passive of this stat is unproven. Null when another
 * required input is missing, so the caller cannot invent a number. */
export function boundedStat(runner: Runner, rows: SkillRow[], reference: ReferenceData | null, stat: RunnerStatBreakdown['stats'][StatKey], type: number): { low: number; high: number } | null {
  if (stat.final !== null) return { low: stat.final, high: stat.final };
  const components = [stat.base, stat.courseGain, stat.strategyGain, stat.groundGain, stat.careerGain];
  if (components.some(n => n === null)) return null;
  let low = components.reduce<number>((n, v) => n + v!, 0), high = low, unknown = false;
  for (const row of rows) {
    const definition = reference?.metadata.skills[row.skillId];
    if (!definition) { if (row.equipped) { unknown = true; break; } continue; }
    const candidates = definition.branches.filter(b => b.rawDuration < 0 && b.effects.some(e => e.type === type));
    if (!candidates.length || row.activationStatus === 'conditions-unmet') continue;
    const deltas = candidates.map(b => b.effects.filter(e => e.type === type).map(e => (e.targetType ?? 1) === 1 ? effectValue(runner, row.skillId, e) : null));
    if (deltas.some(values => values.some(n => n === null))) { unknown = true; break; }
    const values = deltas.map(values => values.reduce<number>((n, v) => n + v!, 0));
    const applied = row.effectiveActive && candidates.length === 1;
    low += Math.min(...values, ...(applied ? [] : [0]));
    high += Math.max(...values, ...(applied ? [] : [0]));
  }
  if (unknown) return null;
  const clamp = (n: number) => Math.max(1, Math.min(2000, n));
  return { low: clamp(low), high: clamp(high) };
}
