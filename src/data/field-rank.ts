import type { Race, Frame } from './types';

/** One-based position among the complete race inventory, never strategy rank
 * or finishing order. Equal distances and missing opponents leave a range. */
export function fieldRankRange(race: Pick<Race, 'runners'>, frame: Frame, runnerId: string): [number, number] | null {
  const samples = frame.runners.filter(s => s.runnerId === runnerId);
  const distance = samples.length === 1 ? samples[0].distance : null;
  if (distance == null || !Number.isFinite(distance)) return null;
  let ahead = 0, uncertain = 0;
  for (const runner of race.runners) {
    if (runner.id === runnerId) continue;
    const rows = frame.runners.filter(s => s.runnerId === runner.id);
    const other = rows.length === 1 ? rows[0].distance : null;
    if (other == null || !Number.isFinite(other) || other === distance) uncertain++;
    else if (other > distance) ahead++;
  }
  return [ahead + 1, ahead + uncertain + 1];
}

export function completeFieldDistances(race: Pick<Race, 'runners'>, frame: Frame): boolean {
  return frame.runners.length === race.runners.length && race.runners.every(r => {
    const rows = frame.runners.filter(s => s.runnerId === r.id);
    return rows.length === 1 && rows[0].distance != null && Number.isFinite(rows[0].distance);
  });
}

export function rankThreshold(key: string, argument: number, fieldSize: number): number {
  return key === 'order_rate' ? Math.round(fieldSize * argument / 100) : argument;
}

export function compareRankRange(range: readonly [number, number], op: string, argument: number): boolean | null {
  const [low, high] = range;
  switch (op) {
    case '<=': return high <= argument ? true : low > argument ? false : null;
    case '<': return high < argument ? true : low >= argument ? false : null;
    case '>=': return low >= argument ? true : high < argument ? false : null;
    case '>': return low > argument ? true : high <= argument ? false : null;
    case '==': return low === high && low === argument ? true : argument < low || argument > high ? false : null;
    case '!=': return argument < low || argument > high ? true : low === high && low === argument ? false : null;
    default: return null;
  }
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
function placeList(places: number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < places.length; i++) {
    const first = places[i]; let last = first;
    while (places[i + 1] === last + 1) last = places[++i];
    ranges.push(first === last ? ordinal(first) : `${ordinal(first)}–${ordinal(last)}`);
  }
  return ranges.join(' or ');
}
/** The percentage is converted to a rounded rank cutoff before comparison.
 * E.g. >50 in a nine-runner race means sixth or farther back. */
export function explainFieldRankCondition(expression: string, fieldSize?: number): string | null {
  const m = expression.trim().match(/^(order|order_rate)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [, key, op, raw] = m, argument = Number(raw);
  if (fieldSize == null || !Number.isInteger(fieldSize) || fieldSize < 1) {
    const symbol = ({ '==': '=', '!=': '≠', '<=': '≤', '>=': '≥', '<': '<', '>': '>' } as Record<string, string>)[op];
    return key === 'order' ? `Position in the whole field ${symbol} ${raw}.` : `Position ${symbol} the rounded ${raw}% field boundary.`;
  }
  const threshold = rankThreshold(key, argument, fieldSize);
  const places = Array.from({ length: fieldSize }, (_, i) => i + 1).filter(rank => compareRankRange([rank, rank], op, threshold));
  return places.length ? `${placeList(places)} of ${fieldSize} runners.` : `No position in this ${fieldSize}-runner field satisfies the rule.`;
}
