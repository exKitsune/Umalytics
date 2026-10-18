import type { AnalysisGateReportSummary } from './contracts';
export const UNKNOWN_VERSION='The original race version could not be established. Showing recorded replay only.';
export const FUTURE_WARNING='Inference has not been validated for this game update and may be inaccurate.';
export function analysisNotice(report:AnalysisGateReportSummary|null):string {
  if(report?.mode==='inference_plan')return report.inferencePlan?.provisional?FUTURE_WARNING:'Inferred analysis · '+report.inferencePlan?.engine.version;
  if(report?.mode==='verified_simulation')return 'Recorded values match. Simulated details are limited to the compared observations.';
  switch(report?.compatibility?.compatibilityClass){
    case 'unsupported_old':return 'This race uses an older game version. No compatible analysis engine is available. Showing recorded replay only.';
    case 'unsupported_future':return 'This race is from a newer game update that analysis does not yet support. Showing recorded replay only.';
    case 'conflicting':return 'The original race date and version evidence disagree. Analysis is unavailable. Showing recorded replay only.';
    case 'covered':return 'A compatible analysis engine could not complete this race. Showing recorded replay only.';
    default:return UNKNOWN_VERSION;
  }
}
