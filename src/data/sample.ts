import type { Race, RunnerSample } from './types';
import type { ReferenceData } from './reference';
import { hpAt } from './hp-timeline';
import { sampleRecordedAt } from './observational-sample';

/** Interpolates observations for playback. A missing endpoint stays unknown. */
export function sampleAt(race: Race, time: number, reference: ReferenceData | null = null): RunnerSample[] {
  if((race.analysisSource==='simulation'||race.analysisSource==='recorded'))return sampleRecordedAt(race,time);
  const frames = race.frames;
  if (!frames.length) return [];
  if (!Number.isFinite(time) || time <= frames[0].time) return frames[0].runners.map(r => ({ ...r }));
  if (time >= frames[frames.length - 1].time) return frames[frames.length - 1].runners.map(r => ({ ...r }));
  let low = 0;
  let high = frames.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (frames[middle].time <= time) low = middle; else high = middle;
  }
  if (time === frames[low].time) return frames[low].runners.map(r => ({ ...r }));
  if (time === frames[high].time) return frames[high].runners.map(r => ({ ...r }));
  const factor = (time - frames[low].time) / (frames[high].time - frames[low].time);
  const later = new Map(frames[high].runners.map(r => [r.runnerId, r]));
  return frames[low].runners.map(before => {
    const after = later.get(before.runnerId);
    const lerp = (field: 'distance' | 'speed' | 'hp' | 'lane') => before[field] === null || after?.[field] === null || after?.[field] === undefined ? null : before[field] + (after[field] - before[field]) * factor;
    // State enums and runner indices are held from the preceding observation, never interpolated.
    return { runnerId: before.runnerId, distance: lerp('distance'), speed: lerp('speed'), hp: hpAt(race,before.runnerId,time,reference), lane: lerp('lane'),
      ...('temptationMode' in before ? { temptationMode: before.temptationMode } : {}),
      ...('blockFrontRunnerIndex' in before ? { blockFrontRunnerIndex: before.blockFrontRunnerIndex } : {}),
    };
  });
}
