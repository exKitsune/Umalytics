import { canUseSimulatedCapability, type AnalysisGateReport, type JsonObject } from './contracts';
export const TRACE_SCHEMA = 'umalytics-decisions-v1';
export interface DecisionEvent {
  sequence:number; lastSequence:number; tick:number; lastTick:number; time:number; lastTime:number;
  count:number; horseIndex:number|null; stage:string; skillId:string; detail:number; kind:string; data:JsonObject;
}
export interface DecisionTrace {
  schema:typeof TRACE_SCHEMA; complete:true; dropped:0; observations:number;
  events:DecisionEvent[]; motion:number[][]; motionColumns:string[];
}
export const motionIndex = {
  tick:0,time:1,horse:2,dt:3,position:4,hp:5,lane:6,target:7,base:8,section:9,pace:10,
  acceleration:11,unclamped:12,cap:13,minimum:14,blocker:15,gap:16,selfSpeed:17,
  skillSpeed:18,speed:19,selfLoss:20,finalLoss:21,phase:22,spurt:23,spurtStart:24,
  spurtSpeed:25,spurtResult:26,spurtCount:27,rushing:28,downhill:29,paceMode:30,
  forceIn:31,forceInCoefficient:32,laneTarget:33,spotStruggle:34,duel:35,conservePower:36,
  blockedFrontSeconds:37,blockedSideSeconds:38,blockedAllSeconds:39,nearFrontSeconds:40,nearBehindSeconds:41,overtakeTargetSeconds:42,
} as const;
export const paceModes = ['Normal','Speed up','Overtake','Pace up','Pace down','Extra pace up'];
/** Simulated execution trace, never original hidden game telemetry. */
export function decisionTrace(report:AnalysisGateReport|null):DecisionTrace|null {
  const value=report?.simulation?.modeled?.decisionTrace;
  if(!canUseSimulatedCapability(report,'recordedResults',report?.binding)
      ||report?.simulation?.capabilities.hiddenState!=='simulated_trace'
      ||!value||typeof value!=='object'||Array.isArray(value))return null;
  if(value.schema!==TRACE_SCHEMA||value.complete!==true||value.dropped!==0
      ||!Array.isArray(value.events)||!Array.isArray(value.motion)||!Array.isArray(value.motionColumns))return null;
  return value as unknown as DecisionTrace;
}
/** Never interpolate discrete decisions or select a future tick. */
export function motionAt(rows:readonly number[][],time:number):number[]|null {
  if(!rows.length||time<rows[0][motionIndex.time])return null;
  let low=0,high=rows.length;
  while(low+1<high){const middle=(low+high)>>>1;if(rows[middle][motionIndex.time]<=time)low=middle;else high=middle;}
  return rows[low];
}
/** The two clamps are separate stages, not a counterfactual finish-time loss. */
export function blockingSummary(rows:readonly number[][]) {
  const i=motionIndex;
  return rows.reduce((sum,row)=>({
    blockedSeconds:sum.blockedSeconds+(row[i.blocker]>=0?row[i.dt]:0),
    constrainedSeconds:sum.constrainedSeconds+(row[i.selfLoss]>0||row[i.finalLoss]>0?row[i.dt]:0),
    maximumSelfClamp:Math.max(sum.maximumSelfClamp,row[i.selfLoss]),
    maximumFinalClamp:Math.max(sum.maximumFinalClamp,row[i.finalLoss]),
  }),{blockedSeconds:0,constrainedSeconds:0,maximumSelfClamp:0,maximumFinalClamp:0});
}
export type BlockingSummary = ReturnType<typeof blockingSummary>;
