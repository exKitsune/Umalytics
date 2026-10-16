import type { Runner } from './types';
import type { SkillRow } from './analytics';
import type { ReferenceData } from './reference';
/** An equipped unobserved passive is not a zero stat modifier. Only a proven
 * incompatible branch, a recorded time-zero branch, or a conditions-proven
 * guaranteed passive can resolve the baseline input. */
function scanUnresolvedPassives(runner: Runner, rows: SkillRow[], reference: ReferenceData | null) {
  const unresolved = new Set<number>();
  const labels = new Map<number, string[]>();
  const add = (stat: number, label: string) => {
    unresolved.add(stat);
    const list = labels.get(stat) ?? [];
    if (!list.includes(label)) list.push(label);
    labels.set(stat, list);
  };
  if (!runner.skills) {
    for (const stat of [1, 2, 3, 4, 5]) add(stat, 'equipped skill list missing');
    return { unresolved, labels };
  }
  for (const row of rows.filter(r => r.equipped)) {
    if (row.activationStatus === 'conditions-unmet') continue;
    const definition = reference?.metadata.skills[row.skillId];
    if (!definition) { for (const stat of [1, 2, 3, 4, 5]) add(stat, `unlisted skill ${row.skillId}`); continue; }
    for (let i = 0; i < definition.branches.length; i++) {
      const branch = definition.branches[i], index = branch.branchIndex ?? i;
      if (branch.rawDuration >= 0 || row.conditionEvaluation?.branches.find(b => b.branchIndex === index)?.state === 'unmet') continue;
      const established = row.inferredBranches.includes(index) || row.activations.some(a => a.start === 0 && (a.effectBranch === index || a.effectBranch === null && definition.branches.length === 1));
      if (!established) for (const effect of branch.effects) if ([1, 2, 3, 4, 5].includes(effect.type)) add(effect.type, definition.name);
    }
  }
  return { unresolved, labels };
}
export function unresolvedPassiveStats(runner: Runner, rows: SkillRow[], reference: ReferenceData | null): Set<number> {
  return scanUnresolvedPassives(runner, rows, reference).unresolved;
}
/** Skill names that keep each stat type from a single final value. */
export function unresolvedPassiveLabels(runner: Runner, rows: SkillRow[], reference: ReferenceData | null): Map<number, string[]> {
  return scanUnresolvedPassives(runner, rows, reference).labels;
}
