import type { Runner } from './types';
/** Public replay/simulator convention: foreign character uniques use their
 * inherited (9xxxxx) definition. Captured skill inventory stays untouched. */
export function referenceEquippedSkillId(runner: Runner, rawId: number): number | null {
  if (!/^1\d{5}$/.test(String(rawId))) return rawId;
  const card = runner.cardId == null ? '' : String(runner.cardId);
  if (!/^\d{6}$/.test(card)) return null;
  const chara = Number(card.slice(1, -2)), outfit = Number(card.slice(-2));
  if (!chara || outfit < 1) return null;
  const ownedUnique = 100000 + 10000 * (outfit - 1) + chara * 10 + 1;
  return rawId === ownedUnique ? rawId : Number(`9${String(rawId).slice(1)}`);
}
