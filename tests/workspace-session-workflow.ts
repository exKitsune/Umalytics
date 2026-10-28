import assert from 'node:assert/strict';
import {blankSetup,blankUma,participant} from '../src/sandbox/model';
import {SESSION_KEY,readWorkspaceSession,checkpointWorkspace,flushWorkspaceSession} from '../src/sandbox/session';
const values=new Map<string,string>();
const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)};
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
const setup=blankSetup();setup.seed=12345;setup.keepSeed=true;setup.shuffleGates=false;setup.participants=[participant(blankUma(),0)];setup.participants[0].uma.stats.speed=1375;
const editing=structuredClone(setup.participants[0].uma);editing.memo='Unfinished edit';editing.stats.power=1250;
checkpointWorkspace({route:{kind:'simulator',view:'results',jobId:'finished-job'}});
checkpointWorkspace({simulator:{setup,warnings:['confirm course'],view:'results',jobId:'finished-job',editing,editingSlot:0,libraryView:'unfiled'}});
checkpointWorkspace({race:{id:'capture-test~0',selected:'runner2',time:94.62,speed:2}});
flushWorkspaceSession();
const restored=readWorkspaceSession();
assert.deepEqual(restored.simulator?.setup,setup,'Every setup input and pinned seed survives');
assert.deepEqual(restored.simulator?.editing,editing,'Unsaved Uma modal fields survive separately from applied participant stats');
assert.deepEqual(restored.route,{kind:'simulator',view:'results',jobId:'finished-job'});
assert.equal(restored.race?.time,94.62);
checkpointWorkspace({route:{kind:'races',id:'capture-test~0'},lastCapturedId:'capture-test~0'});flushWorkspaceSession();
assert.deepEqual(readWorkspaceSession().simulator,restored.simulator,'Route changes retain unfinished simulator work');
assert.equal(readWorkspaceSession().route?.kind,'races');
assert.equal(readWorkspaceSession().lastCapturedId,'capture-test~0');
for(const raw of ['{',JSON.stringify({schemaVersion:99}),JSON.stringify({schemaVersion:1,simulator:{setup:{participants:'broken'}}})]){
  values.set(SESSION_KEY,raw);assert.equal(readWorkspaceSession().simulator,undefined,'Malformed or incompatible checkpoints are ignored');
}
assert.deepEqual(readWorkspaceSession({getItem(){throw new Error('Storage unavailable');}}),{schemaVersion:1});
Object.defineProperty(globalThis,'localStorage',{get(){throw new Error('Storage getter denied');},configurable:true});
assert.deepEqual(readWorkspaceSession(),{schemaVersion:1});
console.log('Workspace session: draft, open editor, exact seed flags, results route, captured race position, merged checkpoints and malformed storage passed.');
