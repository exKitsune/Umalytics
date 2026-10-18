import { getSkillReference, type ReferenceData, type SkillReference } from './reference';
import type { SkillRow } from './analytics';
import type { Runner } from './types';
import { effectValue, levelCoefficient, ownedSkillLevel, racingTeamStatTotal, teamStatScale } from './effect-value';

const names: Record<number,string> = {1:'Speed stat',2:'Stamina stat',3:'Power stat',4:'Guts stat',5:'Wit stat',8:'Vision',9:'HP recovery',10:'Start delay multiplier',14:'Start delay',21:'Current speed',22:'Current speed · coast',27:'Target speed',28:'Lane speed',31:'Acceleration',35:'Lane change',37:'Random gold skill',42:'Duration multiplier'};
/** Target speed eases onto a new ceiling. Current speed jumps now. Coast keeps that jump and eases it away afterward. */
export type VelocityKind = 'target' | 'current' | 'coast';
export function velocityKind(type:number): VelocityKind | null {
  return type===27?'target':type===21?'current':type===22?'coast':null;
}
const teamStatNames:Record<number,string>={3:'Speed',4:'Stamina',5:'Power',6:'Guts',7:'Wit'};
export function effectText(effect: SkillReference['branches'][number]['effects'][number],runner?:Runner|null,skillId?:number): string {
  const resolved=runner&&skillId!=null?effectValue(runner,skillId,effect):null;
  const value=resolved??effect.rawValue/10000;
  const signed=value>0?`+${Number(value.toFixed(5))}`:String(Number(value.toFixed(5)));
  const amount=[10,42].includes(effect.type)?String(Number(value.toFixed(5))):effect.type===9?`${Number((value*100).toFixed(3))}%`:signed;
  const unit=[21,22,27,28].includes(effect.type)?' m/s':effect.type===31?' m/s²':effect.type===14?' s':effect.type===10||effect.type===42?'×':'';
  const label=effect.type===9&&value<0?'HP cost':names[effect.type]??`Effect ${effect.type}`;
  if(resolved!==null&&effect.levelUsage===1)return `${label} ${amount}${unit}`;
  if(effect.valueUsage>=3&&effect.valueUsage<=7)return `${label} · scales with racing-team ${teamStatNames[effect.valueUsage]}`;
  // Usage 1 is the normal master reference value, not a variable-value flag.
  // Other usage codes need special skill logic; their coefficient is not a
  // resolved effect magnitude (e.g. HP cost usage 8 is not a -100% HP hit).
  if(effect.valueUsage!==1||(effect.additionalActivateType??0)!==0)return `${label} · varies by condition`;
  if(effect.levelUsage!==1)return `${label} · depends on skill level`;
  return `${label} ${amount}${unit}`;
}
export function teamScaleNote(runner:Runner|null|undefined,effect:SkillReference['branches'][number]['effects'][number]):string|null {
  if(!runner||effect.valueUsage<3||effect.valueUsage>7)return null;
  const total=racingTeamStatTotal(runner,effect.valueUsage),stat=teamStatNames[effect.valueUsage];
  if(total==null)return `Racing-team ${stat} is unavailable, so this magnitude stays unknown.`;
  const scale=teamStatScale(total);
  return `Racing-team ${stat} ${Math.round(total)} uses the ×${scale} tier.`;
}
export function usedBranchIndexes(row?:SkillRow|null):number[] {
  const recorded=[...new Set(row?.activations.map(activation=>activation.effectBranch).filter((index):index is number=>index!==null)??[])];
  if(recorded.length)return recorded;
  return row?.inferredBranches.length===1?row.inferredBranches:[];
}
export function displayedSkillBranches(skill:SkillReference,row?:SkillRow|null):SkillReference['branches'] {
  const used=new Set(usedBranchIndexes(row));
  if(!used.size)return skill.branches;
  return skill.branches.filter((branch,index)=>used.has(branch.branchIndex??index));
}
export interface SkillBranchNode {
  index:number;
  label:string;
  taken:boolean|null;
  state:'met'|'unmet'|'unknown';
  precondition:string;
  condition:string;
  effects:SkillReference['branches'][number]['effects'];
}
export function skillBranchNodes(skill:SkillReference,row?:SkillRow|null):SkillBranchNode[] {
  const used=usedBranchIndexes(row);
  return skill.branches.map((branch,position)=>{
    const index=branch.branchIndex??position;
    const evaluated=row?.conditionEvaluation?.branches.find(item=>item.branchIndex===index);
    const taken=used.length?used.includes(index):null;
    const state:SkillBranchNode['state']=taken===true?'met':evaluated?.state==='unmet'?'unmet'
      :evaluated?.state==='met'||evaluated?.inferredState==='met'?'met':evaluated?.state??'unknown';
    return {
      index,
      label:position===0?'If':position===skill.branches.length-1?'Otherwise':'Else if',
      taken,
      state,
      precondition:branch.precondition??'',
      condition:branch.condition??'',
      effects:branch.effects,
    };
  });
}
function baseAmount(effect: SkillReference['branches'][number]['effects'][number]): string {
  const value = effect.rawValue / 10000;
  if (effect.type === 9) return `${Number((value * 100).toFixed(3))}%`;
  const signed = value > 0 ? `+${Number(value.toFixed(5))}` : String(Number(value.toFixed(5)));
  const unit = [21, 22, 27, 28].includes(effect.type) ? ' m/s' : effect.type === 31 ? ' m/s²' : effect.type === 14 ? ' s' : effect.type === 10 || effect.type === 42 ? '×' : '';
  return `${signed}${unit}`;
}
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words.at(-1)}`;
}
/** Unique and inherited levels raise the level 1 value. The percent depends on the effect type. */
export function levelBuffExplanation(reference: ReferenceData | null, runner: Runner, skillId: number, effects?: SkillReference['branches'][number]['effects']): { summary: string; detail: string } | null {
  const level = ownedSkillLevel(runner, skillId);
  if (level === null || level <= 1) return null;
  const skill = getSkillReference(reference, skillId);
  const listed = effects ?? skill?.branches.flatMap(branch => branch.effects) ?? [];
  const scaled = listed.filter(effect => effect.valueUsage === 1 && effect.levelUsage === 1 && (effect.additionalActivateType ?? 0) === 0 && levelCoefficient(effect.type, level) !== 1);
  if (!scaled.length) return null;
  const byScale = new Map<number, Map<string, string[]>>();
  for (const effect of scaled) {
    const scale = levelCoefficient(effect.type, level);
    const family = effect.type === 21 || effect.type === 22 ? 'current speed' : effect.type === 27 ? 'target speed' : (names[effect.type] ?? `effect ${effect.type}`).toLowerCase();
    const families = byScale.get(scale) ?? new Map<string, string[]>();
    const bases = families.get(family) ?? [];
    const amount = baseAmount(effect);
    if (!bases.includes(amount)) bases.push(amount);
    families.set(family, bases);
    byScale.set(scale, families);
  }
  const clauses = [...byScale.entries()].map(([scale, families]) => {
    const percent = `${Number(((scale - 1) * 100).toFixed(3))}%`;
    const described = [...families.entries()].map(([family, bases]) => `${family} (${bases.join(', ')})`);
    const noun = described.length === 1 && [...families.values()].every(bases => bases.length === 1) ? 'value' : 'values';
    return `${percent} to the level 1 ${noun} of ${joinWords(described)}`;
  });
  const { inherited, unique } = uniqueIdentity(reference, skillId);
  const who = inherited ? 'Inherited unique' : unique ? 'Unique' : 'Skill';
  const percents = [...byScale.entries()].map(([scale, families]) => `+${Number(((scale - 1) * 100).toFixed(3))}% ${joinWords([...families.keys()])}`);
  return {
    summary: percents.length === 1 ? `${who} level ${level}, ${percents[0].split(' ')[0]}` : `${who} level ${level}, ${percents.join(', ')}`,
    detail: `${who} level ${level} adds ${joinWords(clauses)}.`,
  };
}
function uniqueIdentity(reference: ReferenceData | null, skillId: number): { inherited: boolean; unique: boolean } {
  const skill = getSkillReference(reference, skillId);
  const inherited = skillId >= 900000;
  const base = inherited ? getSkillReference(reference, Number(`1${String(skillId).slice(1)}`)) : skill;
  return { inherited, unique: inherited || (skill?.rarity ?? 0) >= 5 || (base?.rarity ?? 0) >= 5 };
}
/** Level shown beside a unique or inherited unique. Ordinary skills stay unlabeled. */
export function uniqueLevelLabel(reference: ReferenceData | null, runner: Runner | null | undefined, skillId: number): string | null {
  if (!runner || !uniqueIdentity(reference, skillId).unique) return null;
  const level = ownedSkillLevel(runner, skillId);
  return level === null ? null : `Lv${level}`;
}
export function effectsText(reference:ReferenceData|null,id:number):string {
  const skill=getSkillReference(reference,id);
  return skill?[...new Set(skill.branches.map(b=>b.effects.map(e=>effectText(e)).join(' · ')))].join(' or '):'Effect data unavailable';
}
export function durationText(branch:SkillReference['branches'][number],distance:number|null):string {
  if(branch.rawDuration<0)return 'Passive';
  if(branch.rawDuration===0)return 'Instant';
  const base=branch.rawDuration/10000;
  if(branch.durationUsage!==1)return 'Varies by condition';
  return distance?`${Number((base*distance/1000).toFixed(3))} s`:`${Number(base.toFixed(3))} s base`;
}
/** Public master prose; a reference description does not establish a proc. */
export function getSkillDescription(reference:ReferenceData|null,id:number):string|null {
  return getSkillReference(reference,id)?.description?.trim()||null;
}
export interface ConditionSplit { met: string[]; unmet: string[] }
/** Observed predicate results. A condition that never succeeded is listed even when a wit check is also possible. */
export function conditionSplit(row:SkillRow): ConditionSplit {
  const met = new Map<string, string>(), unmet = new Map<string, string>(), explicit = new Set<string>();
  for (const branch of row.conditionEvaluation?.branches ?? []) {
    for (const predicate of branch.predicates) {
      if (predicate.state === 'met') { met.set(predicate.expression, predicate.observed ?? predicate.meaning); explicit.add(predicate.expression); }
      if (predicate.state === 'unmet') { unmet.set(predicate.expression, predicate.observed ?? predicate.meaning); explicit.add(predicate.expression); }
    }
    for (const line of branch.observations) {
      const key = line.split(':')[0]?.trim();
      if (!key || explicit.has(key)) continue;
      if (line.includes('not satisfied')) unmet.set(key, line);
      else if (line.includes('(satisfied)')) met.set(key, line);
    }
  }
  for (const key of met.keys()) if (!unmet.has(key) || !explicit.has(key)) unmet.delete(key);
  return { met: [...met.keys()], unmet: [...unmet.keys()] };
}
/** Short presentation of what an absent activation can actually establish. */
export function nonProcLabel(row:SkillRow,reference:ReferenceData|null):string {
  if(row.simulation)return row.activationCount?'Activated':row.simulation.wit.some(w=>w.data.checked&&w.data.passed===false)?'Wit check failed':row.conditionEvaluation?.state==='unmet'?'Conditions unmet':'Not activated';
  const failed = conditionSplit(row).unmet;
  if(row.activationCount)return 'Activated';
  if(row.activationStatus==='inferred-initial')return 'Activated · inferred';
  if(row.activationStatus==='inferred-passive')return 'Active';
  if(row.activationStatus==='conditions-unmet')return failed.length?`Conditions unmet · ${failed.join(', ')}`:'Conditions never met together';
  if(row.activationStatus==='wit-failure-supported')return 'Wit check failed';
  if(row.activationStatus==='wit-failure-inferred')return 'Wit check failed';
  if(row.activationStatus==='conditions-inferred')return getSkillReference(reference,row.skillId)?.activateLot===0?'Conditions met · inferred':'Conditions met · wit uncertain';
  if(row.activationStatus==='conditions-met')return 'Conditions met · trigger uncertain';
  return getSkillReference(reference,row.skillId)?.activateLot===0?'Condition result uncertain':'Condition or wit check uncertain';
}
export type SkillTone = 'unique' | 'accel' | 'speed' | 'recovery' | 'debuff' | 'other';
/** Unique outranks acceleration, then speed, recovery, and debuff. */
export function skillTone(reference:ReferenceData|null, skillId:number): SkillTone {
  const skill = getSkillReference(reference, skillId);
  if (!skill) return 'other';
  if (skill.rarity >= 5) return 'unique';
  const effects = skill.branches.flatMap(branch => branch.effects);
  if (effects.some(effect => effect.type === 31)) return 'accel';
  if (effects.some(effect => [21, 22, 27].includes(effect.type))) return 'speed';
  if (effects.some(effect => effect.type === 9 && effect.rawValue > 0)) return 'recovery';
  if (effects.some(effect => effect.rawValue < 0 || (effect.targetType ?? 1) !== 1 && [21, 22, 27, 31, 9].includes(effect.type))) return 'debuff';
  return 'other';
}
export const skillToneColor: Record<SkillTone, string> = {
  unique: '#3dbe6a', accel: '#e07a2f', speed: '#e2c04a', recovery: '#4aa0e0', debuff: '#e05050', other: '#9aa394',
};
/** Game skill sheet order: own unique, inherited unique, gold, then the rest. Within a tier, lower skill id comes first. */
export function compareDisplayedSkills(reference: ReferenceData | null, a: number, b: number): number {
  const tier = (id: number) => {
    const skill = getSkillReference(reference, id);
    const rarity = skill?.rarity ?? 0;
    if (rarity >= 3) return 0;
    if (id >= 900000) {
      const original = getSkillReference(reference, id - 800000);
      if ((original?.rarity ?? 0) >= 3) return 1;
    }
    if (rarity >= 2) return 2;
    return 3;
  };
  return tier(a) - tier(b) || a - b;
}
/** Simulator style 5 is distinct; original captured selection remains unchanged. */
export function effectiveStrategyCode(runner: import('./types').Runner, rows: SkillRow[]): number | null {
  return runner.strategyCode === 5 || runner.strategyCode === 1 && rows.some(r => r.skillId === 202051 && r.effectiveActive) ? 5 : runner.strategyCode ?? null;
}
