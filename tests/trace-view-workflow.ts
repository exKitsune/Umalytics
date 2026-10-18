import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { blockingSummary, decisionTrace, motionAt, motionIndex as i, TRACE_SCHEMA } from '../src/simulation/trace';

const fixtures=JSON.parse(execFileSync('python',['tests/globalsim/export_contract_fixtures.py'],{encoding:'utf8',windowsHide:true}));
const report=fixtures.trial;
report.simulation.capabilities.hiddenState='simulated_trace';
const row=(time:number,loss:number,finalLoss:number,blocker=-1)=>{
  const result=Array(43).fill(0);result[i.time]=time;result[i.dt]=.1;
  result[i.selfLoss]=loss;result[i.finalLoss]=finalLoss;result[i.blocker]=blocker;return result;
};
const rows=[row(1,2,.5,1),row(1.1,0,0),row(1.2,.5,0,2)];
report.simulation.modeled={decisionTrace:{schema:TRACE_SCHEMA,complete:true,dropped:0,observations:3,events:[],motion:rows,motionColumns:[]}};
assert.ok(decisionTrace(report),'A replay-matched unknown-version trial can provide modeled decisions');
assert.equal(motionAt(rows,.99),null,'Never show future decisions before the first tick');
assert.equal(motionAt(rows,1.05),rows[0],'Never interpolate a discrete decision');
assert.equal(motionAt(rows,1.2),rows[2]);
assert.deepEqual(blockingSummary(rows),{blockedSeconds:.2,constrainedSeconds:.2,maximumSelfClamp:2,maximumFinalClamp:.5});
for(const mutate of [
  (r:any)=>r.simulation.status='mismatch',
  (r:any)=>r.mode='recorded_only',
  (r:any)=>r.simulation.capabilities.hiddenState='not_provided',
  (r:any)=>r.simulation.modeled.decisionTrace.complete=false,
  (r:any)=>r.simulation.modeled.decisionTrace.schema='unknown',
  (r:any)=>r.compatibility.selectionSha256='0'.repeat(64),
]){const changed=structuredClone(report);mutate(changed);assert.equal(decisionTrace(changed),null);}
console.log('Trace UI gates, trial authorization, discrete tick selection and separate clamp summaries passed.');
