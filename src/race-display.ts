import type { Race } from './data/types';
import type { ReferenceData } from './data/reference';
import { instanceCourse, resolveCourseIdentity } from './data/course-detection';
import { inferCourse, type CourseInference } from './data/course-inference';
export interface RaceCaption { courseId?:number|null; distance?:number|null; conditions?:Race['conditions']; raceInstanceId?:number; courseIdentity?:Race['courseIdentity']; courseInference?:CourseInference|null }
export function captionInference(race:RaceCaption|undefined,reference:ReferenceData|null) {
  if(race?.courseInference)return race.courseInference;
  // A bounded background history scan can supply only compact inference evidence.
  if(!race||!('events' in race)||!('frames' in race)||!('runners' in race)||!Array.isArray(race.events)||!Array.isArray(race.frames)||!Array.isArray(race.runners))return null;
  return inferCourse(resolveCourseIdentity(race as Race,reference),reference);
}
export function courseCaption(race:RaceCaption|undefined,reference:ReferenceData|null,override?:number):string {
  const id=override??race?.courseId??instanceCourse(race?.raceInstanceId??race?.courseIdentity?.raceInstanceId??null,reference)??race?.courseInference?.courseId;
  const course=id==null?null:reference?.courses[id];
  if(course)return `${course.trackName} · ${course.distance} m`;
  const inference=captionInference(race,reference);
  const inferred=inference?.courseId==null?null:reference?.courses[inference.courseId];
  if(inferred)return `${inferred.trackName} · ${inferred.distance} m`;
  if(inference?.trackId&&race?.distance)return `${reference?.metadata.trackNames[inference.trackId]??`Track ${inference.trackId}`} · ${race.distance} m`;
  return race?.distance?`${race.distance} m · Course unknown`:'Course unknown';
}
export function conditionsCaption(race:RaceCaption|undefined):string {
  const names:Record<string,Record<string,string>>={weather:{1:'Sunny',2:'Cloudy',3:'Rainy',4:'Snowy'},ground:{1:'Firm',2:'Good',3:'Soft',4:'Heavy'},season:{1:'Spring',2:'Summer',3:'Autumn',4:'Winter',5:'Spring'}};
  return (['weather','ground','season'] as const).flatMap(key=>{const v=race?.conditions?.[key];return v==null?[]:[names[key][v]??String(v)]}).join(' · ');
}
