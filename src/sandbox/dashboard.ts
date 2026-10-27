import {inflate} from 'pako';
import {assembleReferenceData} from '../data/reference';
import {readGeometry} from '../data/geometry';
import {restoreDashboard} from '../analysis/dashboard-codec';
import {attachPrepared} from '../analysis/prepared';
/** Completed dashboards retain the reference snapshot used to calculate them. */
export async function loadSimulationDashboard(jobId:string,index:number){
  const response=await fetch(`/api/simulator/dashboard?id=${encodeURIComponent(jobId)}&index=${index}`);
  if(!response.ok)throw new Error('Could not load the simulation dashboard.');
  const packed=JSON.parse(inflate(new Uint8Array(await response.arrayBuffer()),{to:'string'}));
  const refResponse=await fetch(`/api/analysis/reference/${packed.referenceKey}`);
  if(!refResponse.ok)throw new Error('The result reference is no longer installed.');
  const data=JSON.parse(inflate(new Uint8Array(await refResponse.arrayBuffer()),{to:'string'}));
  const refs=assembleReferenceData(data.metadata,data.courses,data.source,data.skillIds,readGeometry(data.geometry));
  const value=restoreDashboard(packed,true);attachPrepared(value);return {value,refs};
}
