import type { Race } from '../data/types';
import type { RaceAnalysis } from '../data/analytics';
import type { RunnerMotion } from '../data/race-motion';
import type { StatusModeImpact } from '../data/status-mode-impact';
import type { MotionSkillImpact } from '../data/motion-skill-impact';
import type { SkillMetric } from '../data/skill-metrics';
import type { skillTotals } from '../data/skill-totals';
import type { SpurtComparison } from '../data/spurt-comparison';
import type { SpeedChange } from '../data/speed-changes';

export interface PreparedRunner {
  spurt: SpurtComparison;
  speedChanges: SpeedChange[];
  motion: RunnerMotion;
  inferredMotion: RunnerMotion;
  modes: StatusModeImpact[];
  totals: ReturnType<typeof skillTotals>;
  impacts: Record<number, MotionSkillImpact | null>;
  metrics: Record<number, SkillMetric[]>;
}
export interface PreparedRace {
  authorization?: {cacheKey:string;plan:import('../simulation/contracts').InferencePlan};
  race: Race;
  analysis: RaceAnalysis;
  runners: Record<string, PreparedRunner>;
}
// Only display results cross the worker boundary. Scenario engines and their
// temporary trajectories stay in the worker and are released after a job.
const prepared = new WeakMap<RaceAnalysis, PreparedRace>();
export const preparedFor = (analysis: RaceAnalysis) => prepared.get(analysis);
export function attachPrepared(value: PreparedRace) { prepared.set(value.analysis, value); }
