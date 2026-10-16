/* Bounded adaptation of SSHZ.ORG replay reference utils/witLottery.ts (MIT).
 * Alignment is evidence for a reference model, not execution of game code.
 * Require one unique stream match across every recorded float32 start delay,
 * complete equipped inventories/reference lottery flags, and compatible procs. */
import type { Race } from './types';
import { getSkillReference, type ReferenceData } from './reference';
import { referenceEquippedSkillId } from './equipped-skills';
export interface SkillLotteryEvidence { won: boolean; method: 'aligned-rng' | 'start-delay-bound'; roll: number | null; threshold: number | null; measuredBase: number | null; matchedRunners: number; detail: string }
const MBIG = 2147483647;
export class ReferenceRandom {
  private seeds = new Int32Array(56); private i = 0; private j = 21;
  constructor(seed: number) {
    let mj = (161803398 - (seed === -2147483648 ? MBIG : Math.abs(seed))) | 0, mk = 1;
    this.seeds[55] = mj;
    for (let i = 1; i < 55; i++) { const ii = 21 * i % 55; this.seeds[ii] = mk; mk = (mj - mk) | 0; if (mk < 0) mk = (mk + MBIG) | 0; mj = this.seeds[ii]; }
    for (let k = 1; k < 5; k++) for (let i = 1; i < 56; i++) { this.seeds[i] = (this.seeds[i] - this.seeds[1 + (i + 30) % 55]) | 0; if (this.seeds[i] < 0) this.seeds[i] = (this.seeds[i] + MBIG) | 0; }
  }
  next(): number {
    if (++this.i >= 56) this.i = 1; if (++this.j >= 56) this.j = 1;
    let value = (this.seeds[this.i] - this.seeds[this.j]) | 0;
    if (value === MBIG) value--; if (value < 0) value = (value + MBIG) | 0;
    this.seeds[this.i] = value; return value / MBIG;
  }
}
export function referenceStartDelay(sample: number, rawMultiplier: number): number {
  const ability = Math.fround(rawMultiplier / 10000 - 1);
  return Math.fround(Math.fround(Math.fround(.1) * Math.fround(sample)) * Math.fround(1 + ability));
}
/** A gate-delay value outside Concentration's entire supported range is stronger
 * than an absent event. Require a complete known inventory and no other gate
 * modifier/override. This bounds a reference model; it does not reveal RNG bits. */
export function concentrationFailureBound(race: Race, runnerId: string, reference: ReferenceData | null): SkillLotteryEvidence | undefined {
  const runner = race.runners.find(r => r.id === runnerId), definition = getSkillReference(reference, 200431);
  if (!runner?.skills?.some(s => s.id === 200431) || runner.startDelay == null || definition?.activateLot !== 1
    || definition.branches.length !== 1 || definition.branches[0].condition !== 'always==1' || definition.branches[0].precondition) return;
  const gate = definition.branches[0].effects;
  if (gate.length !== 1 || gate[0].type !== 10 || gate[0].rawValue !== 4000 || gate[0].valueUsage !== 1 || gate[0].levelUsage !== 1) return;
  for (const equipped of runner.skills) {
    const id = referenceEquippedSkillId(runner, equipped.id);
    if (id === null) return;
    const skill = getSkillReference(reference, id);
    if (!skill) return;
    if (equipped.id !== 200431 && skill.branches.some(b => b.effects.some(e => e.type === 10 || e.type === 14))) return;
  }
  const maximum = referenceStartDelay(1, 4000);
  if (runner.startDelay <= maximum || runner.startDelay > Math.fround(.1)) return;
  return { won: false, method: 'start-delay-bound', roll: null, threshold: null, measuredBase: null, matchedRunners: 1,
    detail: `Concentration's always==1 branch has a wit lottery and scales the modeled base gate delay (0–0.1 s) by 0.4. Recorded start delay ${runner.startDelay.toFixed(5)} s exceeds its whole activated range (≤${maximum.toFixed(5)} s). All equipped definitions are available and no other gate modifier/override is equipped. This supports lottery failure under the reference gate model; no exact RNG roll is reconstructed.` };
}
const cache = new WeakMap<Race, WeakMap<ReferenceData, Map<string, Map<number, SkillLotteryEvidence>>>>();
export function alignedSkillLottery(race: Race, reference: ReferenceData | null): Map<string, Map<number, SkillLotteryEvidence>> {
  if (!reference) return new Map();
  let refs = cache.get(race); if (!refs) cache.set(race, refs = new WeakMap());
  const cached = refs.get(reference); if (cached) return cached;
  const result = new Map<string, Map<number, SkillLotteryEvidence>>(); refs.set(reference, result);
  const seed = race.randomSeed;
  if (!Number.isInteger(seed) || seed! < -2147483648 || seed! > 4294967295 || race.runners.length < 2) return result;
  const horses = race.runners.slice().sort((a, b) => a.index - b.index).map(runner => {
    if (runner.startDelay == null || runner.startDelay < 0 || runner.stats?.wisdom == null || runner.stats.wisdom <= 0 || !runner.skills || runner.mood == null || runner.mood < 1 || runner.mood > 5) return null;
    const skills = runner.skills.map(s => { const id = referenceEquippedSkillId(runner, s.id); return { id: s.id, normalizedId: id, definition: id === null ? null : getSkillReference(reference, id) }; });
    if (skills.some(s => !s.definition || ![0, 1].includes(s.definition.activateLot!))) return null;
    // Arbitrary start-delay effects/overrides need their own simulation implementation.
    if (skills.some(s => s.definition!.branches.some(b => b.effects.some(e => e.type === 14 || e.type === 10 && ![200431, 200432, 200433].includes(s.id))))) return null;
    const wit = runner.stats.wisdom > 1200 ? 1200 + (runner.stats.wisdom - 1200) / 2 : runner.stats.wisdom;
    return { runner, skills, threshold: Math.max(20, 100 - 9000 / Math.min(2000, Math.max(1, wit * (1 + .02 * (runner.mood - 3))))) };
  });
  if (horses.some(h => h === null)) return result;
  const known = horses.filter(h => h !== null), lots = known.reduce((n, h) => n + h.skills.filter(s => s.definition!.activateLot === 1).length, 0);
  if (!lots || lots > 10000) return result;
  const rng = new ReferenceRandom(seed! | 0), samples = Array.from({ length: 2501 + known.length }, () => rng.next());
  const matches: number[] = [];
  for (let base = lots; base <= 2500; base++) {
    let position = base - lots, matchesAll = true;
    for (const h of known) {
      let multiplier = 10000;
      for (const s of h.skills) if (s.definition!.activateLot === 1) {
        const won = Math.fround(100 * Math.fround(samples[position++])) < h.threshold;
        if (won && [200431, 200432, 200433].includes(s.id)) multiplier = s.id === 200431 ? 4000 : s.id === 200432 ? 9000 : 15000;
      }
      if (referenceStartDelay(samples[base + h.runner.index], multiplier) !== Math.fround(h.runner.startDelay!)) { matchesAll = false; break; }
    }
    if (matchesAll) { matches.push(base); if (matches.length > 1) return result; }
  }
  if (matches.length !== 1) return result;
  const base = matches[0]; let position = base - lots;
  for (const h of known) {
    const skills = new Map<number, SkillLotteryEvidence>();
    for (const s of h.skills) if (s.definition!.activateLot === 1) {
      const roll = Math.fround(100 * Math.fround(samples[position++])), won = roll < h.threshold;
      const observed = race.events.filter(e => (e.type === 3 || e.type === 'skill') && (e.skillId === s.id || e.skillId === s.normalizedId) && (e.params[2] !== -1 || e.time === 0) && (e.runnerId === h.runner.id || e.runnerId === null && e.params[0] === h.runner.index));
      // Unknown bypass semantics or contradictory recorded procs invalidate this race's model.
      if (!won && observed.length) { result.clear(); return result; }
      skills.set(s.id, { won, method: 'aligned-rng', roll, threshold: h.threshold, measuredBase: base, matchedRunners: known.length,
        detail: `Lottery model: one stream offset (${base}) matches all ${known.length} recorded float32 start delays. Equipped skill order and master activate_lot flags retained. Roll ${roll.toFixed(3)} versus threshold ${h.threshold.toFixed(3)}. Reference reconstruction; server execution is not directly recorded.` });
    }
    for (const s of h.skills) if (s.normalizedId !== null && skills.has(s.id)) skills.set(s.normalizedId, skills.get(s.id)!);
    result.set(h.runner.id, skills);
  }
  return result;
}
