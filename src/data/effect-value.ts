import type { Runner } from './types';
import type { SkillReference } from './reference';
import { referenceEquippedSkillId } from './equipped-skills';

// Direct installed Global skill_level_value, master SHA a866b847…; also
// documented in KuromiAK's Skill Level table. Unsupported usages stay unknown.
const stat = [1,1.01,1.02,1.03,1.04,1.05,1.06,1.07,1.08,1.10];
const target = [1,1.01,1.04,1.07,1.10,1.13,1.16,1.19,1.22,1.25];
const accel = [1,1.02,1.04,1.06,1.08,1.10,1.125,1.15,1.175,1.20];
const other = [1,1.02,1.04,1.06,1.08,1.10,1.12,1.14,1.16,1.18];
export interface EffectValueContext {activeGreenCount?:number|null;additionalActivations?:number|null;teamStatTotal?:number|null;randomMultiplier?:number|null}
const teamStatKeys=['speed','stamina','power','guts','wisdom'] as const;
export function racingTeamStatTotal(runner:Runner,valueUsage:number):number|null {
  const key=teamStatKeys[valueUsage-3];
  if(!key)return null;
  const total=runner.teamStatTotals?.[key];
  return total==null||!Number.isFinite(total)||total<0?null:total;
}
export function teamStatScale(total:number):number {
  return total<1200?0.8:total<1800?0.9:total<2600?1:total<3600?1.1:1.2;
}
export function effectValue(runner: Runner, skillId: number, effect: SkillReference['branches'][number]['effects'][number],context?:EffectValueContext): number | null {
  if (effect.levelUsage !== 1) return null;
  const additional=effect.additionalActivateType??0;
  let repeat=1;
  if(additional!==0){
    const count=context?.additionalActivations;
    if(![1,2,3].includes(additional)||count==null||!Number.isInteger(count)||count<0)return null;
    repeat=Math.min(additional===3?2:3,count);
  }
  let scale=1;
  if(effect.valueUsage===10){
    const wins=runner.raceWinCount;
    scale=wins==null||!Number.isInteger(wins)||wins<0?1.2:wins<6?0.8:wins<14?0.9:wins<18?1:wins<25?1.1:1.2;
  }else if(effect.valueUsage===12){
    const fans=runner.fanCount;
    scale=fans==null||!Number.isInteger(fans)||fans<0?1.2:fans<20000?0.8:fans<50000?0.9:fans<100000?1:fans<160000?1.1:1.2;
  }else if(effect.valueUsage===13){
    const values=['speed','stamina','power','guts','wisdom'].map(k=>runner.stats?.[k as keyof NonNullable<Runner['stats']>]);
    if(values.some(v=>v==null||!Number.isFinite(v)||v<0))return null;
    const highest=Math.max(...values as number[]);
    scale=highest<600?0.8:highest<800?0.9:highest<1000?1:highest<1100?1.1:1.2;
  }else if(effect.valueUsage===14){
    const count=context?.activeGreenCount;
    if(count==null||!Number.isInteger(count)||count<0)return null;
    scale=count<3?0:count<5?1:count===5?2:3;
  }else if(effect.valueUsage>=3&&effect.valueUsage<=7){
    const total=context?.teamStatTotal??racingTeamStatTotal(runner,effect.valueUsage);
    if(total==null)return null;
    scale=teamStatScale(total);
  }else if([8,9].includes(effect.valueUsage)){
    const value=context?.randomMultiplier;
    if(value==null||![0,.02,.04].includes(value))return null;
    scale=value;
  }else if(effect.valueUsage!==1)return null;
  const level = ownedSkillLevel(runner, skillId);
  if (level === null) return null;
  return effect.rawValue / 10000 * levelCoefficient(effect.type, level) * scale * repeat;
}
/** Ordinary acquired skills are level 1. A missing unique or inherited level stays unknown. */
export function ownedSkillLevel(runner: Runner, skillId: number): number | null {
  const owned = runner.skills?.find(s => s.id === skillId || referenceEquippedSkillId(runner, s.id) === skillId);
  const level = owned?.level ?? (skillId >= 200000 && skillId < 900000 ? 1 : null);
  if (level === null || !Number.isInteger(level) || level < 1 || level > 10) return null;
  return level;
}
/** Skill-level multipliers. Target speed, acceleration, stats, and every other effect each have their own column. */
export function levelCoefficient(type: number, level: number): number {
  const table = type >= 1 && type <= 5 ? stat : type === 27 ? target : type === 31 ? accel : other;
  return table[level - 1];
}
