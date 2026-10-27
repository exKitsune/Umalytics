export const DEFAULT_IMPACT_PAIRS=100;
export interface AutomaticSkills {
  enabled:boolean;pairs:number;completeSkills:number;totalSkills:number;
  phase:'queued'|'running'|'waiting'|'paused'|'complete'|'error';error?:string|null;
  activeJob:{id:string;phase:string;completed:number;total:number}|null;
  jobs:{id:string;phase:string;completed:number;total:number;autoImpact:boolean}[];
}
