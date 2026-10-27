import type {Job} from './model';

/** Runs arrive in execution order, which differs from their stable index in
 * paired comparisons. Merge by index, never by a list offset or max index. */
export function mergeJobProgress(previous:Job,next:Job):Job {
  if(!next.runsPartial||next.id!==previous.id)return next;
  if(!next.runs.length)return {...next,runs:previous.runs,runsPartial:false};
  const runs=new Map(previous.runs.map(run=>[run.index,run]));
  for(const run of next.runs)runs.set(run.index,run);
  return {...next,runs:[...runs.values()].sort((a,b)=>a.index-b.index),runsPartial:false};
}
