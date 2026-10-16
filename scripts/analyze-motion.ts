/** Whole-file reference simulation and per-skill report. Never rewrites captures. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeRace } from '../src/data/analytics';
import { inferCourse } from '../src/data/course-inference';
import { motionFor } from '../src/data/motion-analysis';
import { motionSkillImpact } from '../src/data/motion-skill-impact';
import { metricsForSkill } from '../src/data/skill-metrics';
import { skillTotals } from '../src/data/skill-totals';
import { importRaceFile, loadReference, runCli } from './offline-analysis.ts';

const [input, output, option, directory] = process.argv.slice(2);
if (!input || !output || !(process.argv.length === 4 || process.argv.length === 6 && option === '--reference-dir' && directory)) {
  console.error('Usage: node --import tsx scripts/analyze-motion.ts <race.json> <report.json> [--reference-dir <folder>]');
  process.exitCode = 1;
} else {
  await runCli('Motion analysis failed', async () => {
    if (resolve(input).toLowerCase() === resolve(output).toLowerCase()) throw new Error('The report must not replace its capture.');
    const reference = await loadReference(directory);
    const races = await importRaceFile(input);
    const reports = races.map(race => {
      const courseId = race.courseId ?? inferCourse(race, reference)?.courseId, analysis = analyzeRace(race, reference, courseId);
      return { courseId, distance: race.distance, synthetic: race.synthetic, analysis, runners: race.runners.map(runner => ({ id: runner.id, gate: runner.gate,
        motion: motionFor(race, reference, analysis, runner.id, courseId), totals:skillTotals(race,reference,analysis,runner.id,courseId), skills: analysis.runners[runner.id].skillRows.map(row => ({ skillId: row.skillId, activationStatus: row.activationStatus,
          motion: motionSkillImpact(race, reference, analysis, runner.id, row.skillId, courseId), metrics: metricsForSkill(race, reference, analysis, runner.id, row.skillId) })) })) };
    });
    await writeFile(resolve(output), JSON.stringify(reports));
    console.log(JSON.stringify({ races: reports.length, runners: reports.reduce((n, r) => n + r.runners.length, 0), reports: 'written', capture: 'unchanged' }));
  });
}
