import { analyzeRaceSteps, rememberAnalysis, type RaceAnalysis } from '../data/analytics';
import { resolveCourseIdentity } from '../data/course-detection';
import { inferCourse } from '../data/course-inference';
import type { Race } from '../data/types';
import type { ReferenceData } from '../data/reference';
import { motionFor } from '../data/motion-analysis';
import { modeImpactsFor } from '../data/status-mode-impact';
import { motionSkillImpact } from '../data/motion-skill-impact';
import { metricsForSkill } from '../data/skill-metrics';
import { skillTotals } from '../data/skill-totals';
import type { PreparedRace, PreparedRunner } from './prepared';
import { spurtComparison } from '../data/spurt-comparison';
import { explainSpeedChanges } from '../data/speed-changes';

export function resolveAnalysisRace(input: Race, reference: ReferenceData, override?: number): Race {
  const race=resolveCourseIdentity(input,reference), inferred=inferCourse(race,reference);
  const id=override??race.courseId??inferred?.courseId, course=id?reference.courses[id]:null;
  if(override&&course)return {...race,courseId:id!,distance:course.distance,courseIdentity:{source:'manual'},distanceEvidence:'course-reference'};
  if(!race.courseId&&course&&course.distance===race.distance)return {...race,courseId:course.id,courseIdentity:{...race.courseIdentity,source:'skill-conditions'}};
  return race;
}

/** Checkpoints surround the same synchronous calculations used offline. */
export async function prepareRace(race: Race, reference: ReferenceData, checkpoint:()=>Promise<void>,
  onBase:(analysis:RaceAnalysis)=>void=()=>{}, onProgress:(done:number,total:number,id:string,runner:PreparedRunner)=>void=()=>{}):Promise<PreparedRace> {
  const steps=analyzeRaceSteps(race,reference);let step=steps.next();
  while(!step.done){await checkpoint();step=steps.next();}
  const analysis=step.value;rememberAnalysis(race,reference,analysis);onBase(analysis);
  const runners:PreparedRace['runners']={};let done=0;
  for(const runner of race.runners){
    await checkpoint();const motion=motionFor(race,reference,analysis,runner.id);
    await checkpoint();const inferredMotion=motionFor(race,reference,analysis,runner.id,undefined,undefined,true);
    await checkpoint();const modes=modeImpactsFor(race,reference,analysis,runner.id);
    const impacts:PreparedRunner['impacts']={},metrics:PreparedRunner['metrics']={};
    for(const row of analysis.runners[runner.id].skillRows){
      await checkpoint();impacts[row.skillId]=motionSkillImpact(race,reference,analysis,runner.id,row.skillId);
      metrics[row.skillId]=metricsForSkill(race,reference,analysis,runner.id,row.skillId);
    }
    await checkpoint();const totals=skillTotals(race,reference,analysis,runner.id);
    const spurt=spurtComparison(race,reference,analysis,runner,motion);
    const speedChanges=explainSpeedChanges(race,reference,analysis,runner,inferredMotion);
    runners[runner.id]={motion,inferredMotion,modes,impacts,metrics,totals,spurt,speedChanges};onProgress(++done,race.runners.length,runner.id,runners[runner.id]);
  }
  return {race,analysis,runners};
}
