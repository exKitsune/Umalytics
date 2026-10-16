import type { Race, Runner, RunnerSample } from './types';

/** Deterministic invented telemetry. It is not a captured race or a game-accurate simulation. */
export function createDemoRace(): Race {
  const names = ['Special Week', 'Silence Suzuka', 'Tokai Teio', 'Mejiro McQueen', 'Gold Ship', 'Rice Shower', 'Oguri Cap', 'Daiwa Scarlet', 'Vodka'];
  const styles = ['Late Surger', 'Front Runner', 'Pace Chaser', 'Pace Chaser', 'End Closer', 'Late Surger', 'Late Surger', 'Front Runner', 'Late Surger'];
  const runners: Runner[] = names.map((name, index) => ({
    id: `demo-${index + 1}`, index, gate: index + 1, name, charaId: null, cardId: null, trainer: null,
    strategy: styles[index], finishOrder: null, finishTime: null, finishTimeRaw: null,
  }));
  const race: Race = {
    id: 'synthetic-demo', title: 'The final stretch', source: 'demo', sourceLabel: 'Synthetic demonstration',
    distance: 2400, duration: 136, courseId: null, runners, frames: [], events: [], synthetic: true,
    warnings: ['All demo telemetry and event labels are invented for interface testing. This is not a captured race or a game-accurate simulation.'],
  };
  const positions = new Array<number>(runners.length).fill(0);
  const finishers: { index: number; time: number }[] = [];
  for (let frameIndex = 0; frameIndex <= 272; frameIndex++) {
    const time = frameIndex / 2;
    const samples: RunnerSample[] = runners.map((runner, index) => {
      const front = index === 1 || index === 7;
      const surge = Math.max(0, Math.min(1, (time - 92 - index * .35) / 14));
      const speed = Math.max(0, 18.8 + Math.sin(time / 9 + index) * .35 + (front ? 1.5 * Math.exp(-time / 58) : -.35) + surge * (front ? .1 : 2.7 + (index % 3) * .3) - index * .028);
      const previous = positions[index];
      if (frameIndex && previous < 2400) {
        positions[index] = Math.min(2400, previous + speed * .5);
        if (positions[index] >= 2400) {
          const finishTime = time - .5 + (2400 - previous) / speed;
          finishers.push({ index, time: finishTime });
          runner.finishTime = finishTime;
          runner.finishTimeRaw = finishTime;
        }
      }
      return {
        runnerId: runner.id, distance: positions[index], speed: positions[index] >= 2400 ? 0 : speed,
        hp: Math.max(0, 1050 - time * (7.0 + index * .11) + (time >= 65 && index % 3 === 0 ? 100 : 0)),
        lane: Math.min(.92, Math.max(.04, .12 + index * .065 + Math.sin(time / 14 + index) * .045 - surge * .05)),
      };
    });
    race.frames.push({ time, runners: samples });
  }
  finishers.sort((a, b) => a.time - b.time).forEach((finish, index) => { runners[finish.index].finishOrder = index + 1; });
  for (const [index, runner] of runners.entries()) {
    race.events.push({ time: 92 + index * .35, type: 3, runnerId: runner.id, skillId: null, label: 'Final push · synthetic', params: [] });
    if (index % 3 === 0) race.events.push({ time: 65, type: 3, runnerId: runner.id, skillId: null, label: 'Recovery · synthetic', params: [] });
  }
  race.events.sort((a, b) => a.time - b.time);
  return race;
}
