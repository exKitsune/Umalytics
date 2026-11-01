import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {expandTrace} from '../src/simulation/compact-trace';
const fixture=JSON.parse(execFileSync('python',['tests/globalsim/test_compact_trace.py','--fixture'],{encoding:'utf8',windowsHide:true}));
const original=structuredClone(fixture.wire),trace=expandTrace(fixture.wire);
assert.deepEqual(trace.motion,fixture.motion);assert.deepEqual(trace.events,fixture.events);assert.deepEqual(trace.motionColumns,fixture.columns);
assert.deepEqual(fixture.wire,original);assert.equal(expandTrace(fixture.wire),trace);assert.equal(expandTrace(trace),trace);
const changes=[(v:any)=>v.motionCount=true,(v:any)=>v.motionData=v.motionData.slice(0,-4),(v:any)=>v.motionData='!'.repeat(v.motionData.length),
 (v:any)=>v.motionIndices.reverse(),(v:any)=>v.events[0][8]=99,(v:any)=>v.events[0][8]=true,(v:any)=>v.events[0][0]=1.5,(v:any)=>v.events[0][7]=true,(v:any)=>v.states=[],
 (v:any)=>v.states[0][0]=0,(v:any)=>v.states[1][0]=2,(v:any)=>v.states[1][1]=.25,(v:any)=>v.states[1][2]=1,
 (v:any)=>v.states[0][5]=2,(v:any)=>v.observations=6,(v:any)=>v.complete=false];
for(const change of changes){const packet=structuredClone(fixture.wire);change(packet);assert.throws(()=>expandTrace(packet),/Invalid compact/);}
console.log('Compact trace: Python/browser agreement, exact state boundaries, immutability and malformed-packet rejection passed.');
