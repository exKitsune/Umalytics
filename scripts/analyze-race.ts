import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeRace } from '../src/data/analytics.ts';
import { inferCourse } from '../src/data/course-inference.ts';
import { importRaceFile, loadReference, runCli } from './offline-analysis.ts';

// Offline whole-file analysis. Public reference definitions never replace observations.
const [input, output, option, directory] = process.argv.slice(2);
if (!input || !output || (process.argv.length !== 4 && !(process.argv.length === 6 && option === '--reference-dir' && directory))) {
  console.error('Usage: node --import tsx scripts/analyze-race.ts <race.json> <analysis.json> [--reference-dir <folder>]');
  process.exitCode = 1;
} else {
  await runCli('Race analysis failed', async () => {
    if (resolve(input).toLowerCase() === resolve(output).toLowerCase()) throw new Error('The report must not replace its capture.');
    const reference = await loadReference(directory);
    const races = await importRaceFile(input);
    await writeFile(resolve(output), JSON.stringify(races.map(race => {
      const courseInference = inferCourse(race, reference);
      return { courseId: race.courseId, distance: race.distance, courseIdentity: race.courseIdentity, distanceEvidence: race.distanceEvidence,
        courseInference, analysis: analyzeRace(race, reference, race.courseId ?? courseInference?.courseId) };
    })));
    console.log(`Analyzed ${races.length} race(s).`);
  });
}
