import type { Race } from './types';
import type { ReferenceData } from './reference';
import { resolveCourseIdentity } from './course-detection';
import { inferCourse, type CourseInference } from './course-inference';

export interface LibraryCaption {
  courseId:number|null;distance:number|null;conditions?:Race['conditions'];
  raceInstanceId?:number;courseIdentity?:Race['courseIdentity'];courseInference:CourseInference|null;
}
/** Keep provenance and finite caption metadata; never retain runners or telemetry. */
export function libraryCaption(race:Race,reference:ReferenceData):LibraryCaption {
  const resolved=resolveCourseIdentity(race,reference),inference=inferCourse(resolved,reference);
  return {courseId:resolved.courseId??inference?.courseId??null,distance:resolved.distance,conditions:resolved.conditions,
    raceInstanceId:resolved.courseIdentity?.raceInstanceId,
    courseIdentity:inference?.courseId?{...resolved.courseIdentity,source:'skill-conditions'}:resolved.courseIdentity,
    courseInference:inference};
}
