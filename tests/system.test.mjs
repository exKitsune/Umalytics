import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { availableParallelism, tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
const execute = promisify(execFile);
async function stopOwnedTree(child) {
  if(child.exitCode!==null||child.signalCode!==null)return;
  if(process.platform==='win32') {
    // Killing only a timed-out TS driver leaves its Python service/CLI children
    // alive. This PID belongs to the command this runner just started.
    await execute('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000,maxBuffer:64*1024}).catch(error=>{if(child.exitCode===null&&child.signalCode===null)throw error;});
  } else {
    try {process.kill(-child.pid,'SIGKILL');} catch(error) {if(error.code!=='ESRCH')throw error;}
  }
}
function run(command,args,{timeout=15000,...options}={}) {
  return new Promise((resolve,reject)=>{
    let expired=false,captured={stdout:'',stderr:''};
    // A separate POSIX process group lets the watchdog stop only this command
    // tree. Windows uses taskkill /T against its recorded owned child PID.
    const child=execFile(command,args,{...options,detached:process.platform!=='win32'},(error,stdout,stderr)=>{
      captured={stdout,stderr};if(expired)return;clearTimeout(timer);
      if(error)reject(Object.assign(error,captured));else resolve(captured);
    });
    const timer=setTimeout(async()=>{
      expired=true;
      try {await stopOwnedTree(child);reject(Object.assign(new Error(`Functional command exceeded ${timeout} ms; its process tree was stopped.`),{code:'ETIMEDOUT',killed:true,...captured}));}
      catch(error){reject(Object.assign(new Error(`Functional command timed out and its process tree could not stop: ${error.message}`),captured));}
    },timeout);
  });
}
const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'tests/fixtures/race.json');
const fetch = (url, options={}) => globalThis.fetch(url,{signal:AbortSignal.timeout(10000),...options});
// Each workflow owns its temporary installation, output files and ephemeral
// ports. Bound the number of workflow drivers, including their real CLI children.
const concurrency = Number(process.env.UMALYTICS_TEST_CONCURRENCY ?? Math.min(2, availableParallelism()));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('UMALYTICS_TEST_CONCURRENCY must be an integer from 1 to 4.');
describe('isolated functional workflows', {concurrency}, () => {
test('Global skill refresh and regional fallback survive replay analysis and export',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/reference-fallback-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  for(const key of ['globalPriority','regionalVariants','wholeReplay','brianVariants','jpFallback','portable','deterministic'])assert.equal(report[key],'passed');
  assert.equal(report.unknownCodes,'preserved');
});
test('initial acceleration markers require conditions and a unique replay fit',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/initial-skills-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=19);
  for(const key of ['wholeFilePipeline','initialInference','recordedCountsPreserved','ambiguousAndMissingWithheld','portable'])assert.equal(report[key],'passed');
});
test('traffic and exhaustion losses include continuous approach and recovery',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/traffic-loss-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=18);
  for(const key of ['trafficApproachAndRegain','recordedDurationSeparate','exactLocalAreas','exhaustionHealthyReference','zeroCrossingBounds','unknownGaps','gatePhysics'])assert.equal(report[key],'passed');
  assert.equal(report.capture,'unchanged');
});
test('position keeping follows skill-adjusted acceleration through phase and hill changes',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/mode-inference-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=17);
  for(const key of ['paceOnset','phaseAndHeal','skillNormalization','noInventedMode','positionLimit','independentDownhill','reachableGains','unknownGaps','sharedEngine','nearContinuity','nearThreshold'])assert.equal(report[key],'passed');
});
test('last-spurt decisions and NPC classification survive capture, analysis and export',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/spurt-capture-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=25);
  for(const key of ['spurtCategories','decisionHistory','recoveryRecalculation','noFutureHp','unresolvedGreens','perSkillCounts','boundedCounts','characterPresence','npcClass','privacy','portable'])assert.equal(report[key],'passed');
});
test('GameTora condition rules hold through whole replay import and analysis',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/gametora-conditions-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=40);assert.equal(report.globalPredicateKeys,100);
  for(const key of ['wholeFilePipeline','wholeInventory','distanceUnits','spatialBoundaries','laneDirection','proximityTimers','targetDirection','healingNotifications','duelExistence','rushedEnemyScope','samePlayerConjunction','legacyUnknownNpc','randomAndRank','sourceUnchanged','portablePrivacy'])assert.equal(report[key],'passed');
});
test('running desktop service upgrades stale reference snapshots and preserves complete repository data',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/reference-upgrade-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:30000});
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.serviceBoots,10);assert.ok(report.skillDefinitions>700);
  assert.equal(report.legacyBundledUpgrade,'passed');assert.equal(report.legacyRepositoryUpgrade,'passed');assert.equal(report.legacyConditionsUpgrade,'passed');assert.equal(report.legacyTagsUpgrade,'passed');
  assert.equal(report.snapshotBytes,'verified-active-copy');assert.equal(report.restartPointer,'unchanged');
  assert.equal(report.completeRepository,'preserved');assert.equal(report.certificateChanges,false);
});
test('all Global conditions have replay evaluation and explicit source evidence',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/condition-catalog-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.globalSkills,734);assert.equal(report.globalBranches,788);assert.equal(report.predicateKeys,100);
  for(const key of ['wholeCatalog','sourceAudit','specificSkillHistory','inferenceBoundaries','visionTiming'])assert.equal(report[key],'passed');
});
test('non-motion skill metrics survive whole-file analysis and portable export',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/skill-metrics-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=16);assert.equal(report.synthetic,true);
  for(const key of ['wholeFilePipeline','passiveCoefficients','gateInversion','lateralSampling','rushedAndRunaway','randomAssociation','unsupportedWithheld','portable'])assert.equal(report[key],'passed');
});
test('shared motion paths include acceleration, nearby constraints and skill scenarios',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/race-motion-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=18);
  for(const key of ['sharedTargets','reachableVelocity','skillsAndDebuffs','sectionCalibration','downhillBonus','neighborhoodGeometry','unknownCoverage','pairedCache'])assert.equal(report[key],'passed');
});
test('skill motion scores include acceleration credit, debuffs, blocking and carryover',async t=>{
  const folder=await workspace(t);
  // Full import/model CLI per scenario; each child retains its 30s watchdog.
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/motion-skills-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
  const report=JSON.parse(result.stdout.trim());assert.ok(report.cases>=18);
    for(const key of ['wholeFileImport','halfCreditAndScenarios','debuffBaseline','blockedZeroCredit','mixedAcceleration','scheduledDuration','durationScalings','carryover','accelerationDirectGain','speedPotential','beneficialDeceleration','retainedCapArrival','instantArea','jointTotals','stackPriority','tailCoverage'])assert.equal(report[key],'passed');
  assert.equal(report.originals,'unchanged');
});
async function convert(input, output) {
  return run(process.execPath, ['--import','tsx',join(root,'scripts/import-race.ts'),input,output], {cwd:root,windowsHide:true,timeout:15000});
}

test('captured condition context survives import, whole-race evaluation and portable export',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/condition-engine-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.globalSkills>=734);assert.ok(report.globalBranches>=788);assert.ok(report.predicateKeys>=100);
  assert.equal(report.syntaxCoverage,'complete');
  for(const field of ['observedHistory','randomWindowSeparation','spatialProxies','rankContinuity','eventOrder','captureContext','privacy','portable'])assert.equal(report[field],'passed');
  t.diagnostic(`${report.understoodKeys} understood and ${report.partialKeys} partially understood condition keys; replay evidence is evaluated separately.`);
});

test('whole-race effect analysis handles acceleration, hills, debuffs and incomplete coverage',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/effects-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=68);assert.equal(report.synthetic,true);assert.equal(report.speedHalfCredit,'passed');
  for(const field of ['wholeFilePipeline','directSpeedHpSeparation','partialCoverage','overlapTotals','accelerationAndTargetBinding','recipientMasksAndImmunity','instantHpBracket','statDecomposition','hillPowerAndDownhill','inheritedAttribution','portable'])assert.equal(report[field],'passed');
  for(const field of ['durationFallback','instantUtilization','carryoverSeparation','finalCornerNotification'])assert.equal(report[field],'passed');
  for(const field of ['blockingAwareSkill','slowdownContributions','recoverySpurtBudget'])assert.equal(report[field],'passed');
  for(const field of ['perEffectUtilization','overlapIntersection','finishDurationAccounting'])assert.equal(report[field],'passed');
});

test('whole-file corner path analysis preserves lane scale, coverage and portable facts',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/corner-path-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:30000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=18);
  for(const field of ['laneScale','canonicalHeading','referenceLane','straightExclusion','missingTotalsWithheld','partialCoverage','portable'])assert.equal(report[field],'passed');
  assert.equal(report.evidence,'reference-path-only');
});

test('blocking loss integrates acceleration, target modifiers and supported mode contexts',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/blocking-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=22);
  for(const field of ['integral','accelerationRamp','buffDebuffContext','controlledPaceContexts','unknownGapsWithheld'])assert.equal(report[field],'passed');
  assert.equal(report.modeEvidence,'controlled-component-integration');
});

test('whole-file downhill inference isolates HP drain from skills and instant recoveries',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/downhill-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=13);
  for(const field of ['independentHpInference','resolvedSkills','currentSpeedRemoval','instantBrackets','unknownInputsWithheld'])assert.equal(report[field],'passed');
  assert.equal(report.modeEvidence,'inferred-only');
});

test('whole-file pace inference separates skill offsets, strategy modes and continuation gaps',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/pace-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=18);assert.equal(report.rushedPhaseInputs,'passed');
  for(const field of ['resolvedSkillNormalization','noSkillOnlyMode','startDashCompetitionExclusions','frontStrategySemantics','continuationExitBand','unknownGapsPreserved'])assert.equal(report[field],'passed');
  assert.equal(report.evidence,'inferred-only');
});

test('imported HP recoveries jump at activation in playback and plotted paths',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/hp-timeline-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=40);assert.equal(report.sampledDisplay,'passed');assert.equal(report.perHitEvidence,'passed');assert.equal(report.runningHpHypotheses,'passed');
  for(const field of ['instantSteps','eventTimeCap','unknownTransitions','exactEndpoints','playbackAndSvg'])assert.equal(report[field],'passed');
  assert.equal(report.portableFacts,'unchanged');
});

test('whole-file rank conditions use the complete field and rounded percentage cutoffs',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/field-rank-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:60000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.cases>=8);
  for(const field of ['wholeFieldInsteadOfStrategyOrFinish','roundedPercentBoundaries','missingAndTiedRankBounds','randomAndInterpolatedTriggerSeparation'])assert.equal(report[field],'passed');
});

test('imported race and game reference render a stable camera through course corners',async t=>{
  const folder=await workspace(t),imported=join(folder,'imported');await convert(fixture,imported);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/replay-camera-workflow.ts'),imported],{cwd:root,windowsHide:true,timeout:30000});
  const report=JSON.parse(result.stdout.trim());
  assert.ok(report.gameCourses>=14);assert.ok(report.cornerBoundaries>20);assert.ok(report.renderedFrames>100);
  for(const field of ['smoothCamera','worldTicks','sharedCanvas','markerToggles'])assert.equal(report[field],'passed');
  for(const field of ['closerCamera','flatCuts','automaticDebuffCone','visionModifiers'])assert.equal(report[field],'passed');
  for(const field of ['cardSideStability','cardClocks','seekClipDeterminism','receivedCards','cardViewport','teamImmunity','doubledTrack'])assert.equal(report[field],'passed');
  for(const field of ['singleRunnerHeader','runnerHeaderColor','ownerAnchoredLayout','allEffectRowsVisible','fontScaling','wideViewSpacing','selectedStackOnTop'])assert.equal(report[field],'passed');
  assert.equal(report.visionCandidates,'separate');assert.ok(report.outfitMappings>=224);
  t.diagnostic(`Rendered ${report.renderedFrames} frames across ${report.gameCourses} game courses and ${report.cornerBoundaries} corner boundaries.`);
});
async function workspace(t) {
  const folder=await mkdtemp(join(tmpdir(),'umalytics-system-'));
  t.after(()=>{if(dirname(resolve(folder))!==resolve(tmpdir())||!basename(folder).startsWith('umalytics-system-'))throw new Error('Unexpected test folder');return rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  return folder;
}
async function bridge(t, folder) {
  const inbox=join(folder,'inbox'),dist=join(folder,'dist');await mkdir(inbox,{recursive:true});await mkdir(dist);
  await writeFile(join(dist,'index.html'),'<!doctype html><title>System fixture</title>');
  const child=spawn(process.execPath,[join(root,'scripts/bridge.mjs'),'--port','0','--inbox',inbox,'--dist',dist],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Owned fixture bridge did not stop.')),5000);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
      child.kill();
    });
  },{timeout:6000});
  let text='';
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Bridge startup timed out')),10000);
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Bridge exited: ${code}`))});
    child.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/Race viewer bridge: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.stderr.on('data',chunk=>{text+=chunk});
  });
  return {inbox,url};
}
function raw(url,path,headers={}) {
  return new Promise((resolve,reject)=>{const req=request(url,{path,headers},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.setTimeout(10000,()=>req.destroy(new Error('Fixture bridge request timed out.')));req.on('error',reject);req.end();});
}
test('race import → running library → exported JSON → second import preserves the replay',async t=>{
  const folder=await workspace(t),server=await bridge(t,folder);
  await convert(fixture,server.inbox);
  const first=await(await fetch(`${server.url}/api/races/latest`)).json();
  assert.equal(first.data.title,'Synthetic system test');assert.equal(first.data.synthetic,true);
  assert.equal(first.data.runners.length,2);assert.equal(first.data.frames.length,3);assert.equal(first.data.events.length,1);
  assert.equal(first.data.runners[0].stats.speed,1100);assert.deepEqual(first.data.events[0].params,[0,100011]);
  assert.ok(!JSON.stringify(first.data).includes('PRIVATE_FIXTURE'));
  const exported=join(folder,'downloaded.json');await writeFile(exported,JSON.stringify(first.data));
  const secondFolder=join(folder,'reimport');await convert(exported,secondFolder);
  const saved=JSON.parse(await readFile(join(secondFolder,(await readdir(secondFolder))[0]),'utf8'));
  for(const field of ['runners','frames','events','distance','courseId','category','capturedAt'])assert.deepEqual(saved[field],first.data[field]);
  assert.equal((await fetch(server.url)).status,200);
});
test('a running library retains valid races during failed imports and rejects unrelated requests',async t=>{
  const folder=await workspace(t),server=await bridge(t,folder);
  await convert(fixture,server.inbox);
  const current=await(await fetch(`${server.url}/api/races/latest`)).json();
  const broken=join(folder,'broken.json');await writeFile(broken,'{"races":');
  await assert.rejects(convert(broken,server.inbox));
  assert.equal((await readdir(server.inbox)).length,1);
  assert.equal((await(await fetch(`${server.url}/api/races/latest`)).json()).sha256,current.sha256);
  await writeFile(join(server.inbox,'unfinished.partial'),'{"races":');
  await writeFile(join(folder,'private.json'),'PRIVATE_FILE_FIXTURE');
  for(const path of ['/../private.json','/%2e%2e/private.json','/private.json','/api/races/latest/private.json']){
    const result=await raw(server.url,path);assert.equal(result.status,404);assert.ok(!result.body.includes('PRIVATE_FILE_FIXTURE'));
  }
  assert.equal((await raw(server.url,'/api/races/latest',{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await raw(server.url,'/api/races/latest',{Host:'unrelated.example'})).status,403);
  assert.equal((await(await fetch(`${server.url}/api/races/latest`)).json()).sha256,current.sha256);
});

// Explicit synthetic binary fixture, encoded using the documented Global strides.
// Exercises the actual offline sanitization/import/analysis/export processes.
function encodedFixture() {
  const chunks=[];
  const int=n=>{const b=Buffer.alloc(4);b.writeInt32LE(n);chunks.push(b)};
  const float=n=>{const b=Buffer.alloc(4);b.writeFloatLE(n);chunks.push(b)};
  int(4);int(100000002);float(20);int(2);int(12);int(31);int(0);int(6);int(28);
  for(let t=0;t<=5;t++){
    float(t);
    for(let slot=0;slot<2;slot++){
      const b=Buffer.alloc(12);b.writeFloatLE(t*400,0);b.writeUInt16LE(1000+slot*100,4);
      b.writeUInt16LE(t===5?10000:2000,6);b.writeUInt16LE([1000,900,800,850,700,0][t],8);
      b.writeInt8(t>=1&&t<3?4:0,10);b.writeInt8(t>=2&&t<4?1-slot:-1,11);chunks.push(b);
    }
  }
  int(0);
  for(let slot=0;slot<2;slot++){
    const b=Buffer.alloc(31);b.writeInt32LE(slot,0);b.writeFloatLE(80+slot,4);b.writeFloatLE(slot*.2,8);
    b.writeFloatLE(.1,12);b.writeUInt8(slot,16);b.writeUInt8(1-slot,17);b.writeFloatLE(1200,18);
    b.writeUInt8(1,22);b.writeInt32LE(4,23);b.writeFloatLE(4,27);chunks.push(b);
  }
  int(0);int(3);
  for(const e of [{t:1,type:3,p:[0,200331,20000,0]},{t:2,type:3,p:[0,200432,-1,0]},{t:2,type:4,p:[0]}]){
    const b=Buffer.alloc(8+e.p.length*4);b.writeInt16LE(6+e.p.length*4,0);b.writeFloatLE(e.t,2);b.writeInt8(e.type,6);b.writeInt8(e.p.length,7);
    e.p.forEach((p,i)=>b.writeInt32LE(p,8+i*4));chunks.push(b);
  }
  return gzipSync(Buffer.concat(chunks)).toString('base64');
}
test('decoded response → sanitizer → Kyoto course import → analytics → portable reimport retains facts and unknowns',async t=>{
  const folder=await workspace(t),input=join(folder,'response.json'),sanitized=join(folder,'sanitized.json'),out=join(folder,'inbox');
  const response={data:{race_scenario:encodedFixture(),room_info:{raceInstanceId:101801,weather:1,ground_condition:1},
    race_horse_data_array:[1,2].map(frame_order=>({frame_order,skill_array:[{id:200331,level:1},{id:200432,level:1},{id:200021,level:1}],running_style:1})),
    auth:{token:'PRIVATE_FIXTURE_TOKEN'},trainer_info:{id:'PRIVATE_FIXTURE_TRAINER'}}};
  await writeFile(input,JSON.stringify(response));
  await run('python',[join(root,'scripts/proxy/extract-file.py'),input,sanitized,'--endpoint','/\x75mamusume/room_match/result'],{cwd:root,windowsHide:true,timeout:15000});
  const safe=await readFile(sanitized,'utf8');assert.ok(!safe.includes('PRIVATE_FIXTURE'));
  await convert(sanitized,out);
  const savedPath=join(out,(await readdir(out))[0]),race=JSON.parse(await readFile(savedPath,'utf8'));
  assert.equal(race.courseId,10805);assert.equal(race.distance,1600);assert.equal(race.distanceEvidence,'course-reference');
  assert.equal(race.courseIdentity.source,'race-instance');assert.equal(race.courseIdentity.raceInstanceId,101801);
  assert.equal(race.runners[0].wisdomOrder,1);assert.equal(race.runners[0].defeatFlags,4);
  const analysisPath=join(folder,'analysis.json');
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),savedPath,analysisPath],{cwd:root,windowsHide:true,timeout:15000});
  const analytics=JSON.parse(await readFile(analysisPath,'utf8'))[0].analysis.runners['runner-1'];
  assert.equal(analytics.summary.maxSpeed,20);assert.equal(analytics.summary.hpFinish,700);
  assert.equal(analytics.summary.hpUsed,350);assert.equal(analytics.summary.hpRecovered,50);
  assert.equal(analytics.summary.rushedDuration,2);assert.equal(analytics.summary.blockedDuration,2);
  assert.equal(analytics.summary.spurtTime,3);assert.equal(analytics.summary.spurtDistance,1200);
  assert.equal(analytics.summary.spurtSpeed,20);assert.equal(analytics.summary.finishGapDistance,0);
  assert.equal(analytics.skillActivations.length,1);assert.equal(analytics.skillActivations[0].end,3);
  assert.equal(analytics.skillActivations[0].durationEvidence,'recorded');
  assert.equal(analytics.intervals.find(i=>i.kind==='spot-struggle').end,null);
  const absentFocus=analytics.skillRows.find(s=>s.skillId===200432);
  assert.equal(absentFocus.activationStatus,'wit-failure-inferred');
  assert.equal(absentFocus.conditionEvaluation.state,'met');assert.equal(absentFocus.conditionEvaluation.branches[0].staticOnly,true);
  assert.equal(absentFocus.activationCount,0);assert.match(absentFocus.nonProcReason,/inferred.*complete recording/i);
  assert.equal(analytics.skillRows.find(s=>s.skillId===200021).evidence,'derived');
  race.courseIdentity={source:'manual'};const manual=join(folder,'manual.json');await writeFile(manual,JSON.stringify(race));
  const reimport=join(folder,'again');await convert(manual,reimport);
  const restored=JSON.parse(await readFile(join(reimport,(await readdir(reimport))[0]),'utf8'));
  assert.equal(restored.courseIdentity.source,'manual');assert.deepEqual(restored.events,race.events);
  // Interpolated spurt speed and the winner-time distance gap use actual replay
  // samples, and incomplete field evidence keeps the distance gap unknown.
  race.runners[0].lastSpurtDistance=1000;
  race.frames[2].runners[0].speed=18;race.frames[3].runners[0].speed=22;
  for(const frame of race.frames)frame.runners[1].distance-=frame.time*10;
  await writeFile(manual,JSON.stringify(race));
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),manual,analysisPath],{cwd:root,windowsHide:true,timeout:15000});
  const gaps=JSON.parse(await readFile(analysisPath,'utf8'))[0].analysis.runners;
  assert.equal(gaps['runner-1'].summary.spurtTime,2.5);assert.equal(gaps['runner-1'].summary.spurtSpeed,20);
  assert.equal(gaps['runner-2'].summary.finishGapDistance,40);
  race.frames[4].runners[1].distance=null;await writeFile(manual,JSON.stringify(race));
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),manual,analysisPath],{cwd:root,windowsHide:true,timeout:15000});
  const missingGap=JSON.parse(await readFile(analysisPath,'utf8'))[0].analysis.runners;
  assert.equal(missingGap['runner-2'].summary.finishGapDistance,null);
});
test('binary finish distance excludes runout and explicit course aliases remain independent of filename guesses',async t=>{
  const folder=await workspace(t);
  const noCourse=join(folder,'unknown.json');await writeFile(noCourse,JSON.stringify({race_scenario:encodedFixture()}));
  const unknownOut=join(folder,'unknown');await convert(noCourse,unknownOut);
  const unknown=JSON.parse(await readFile(join(unknownOut,(await readdir(unknownOut))[0]),'utf8'));
  assert.equal(unknown.courseId,null);assert.equal(unknown.distance,1600);assert.equal(unknown.distanceEvidence,'finish-derived');
  assert.equal(unknown.frames.at(-1).runners[0].distance,2000);
  for(const [name,data,source] of [
    ['aliases.json',{RaceCourseSet:{Id:10804}},'recorded'],
    ['101801_fixture.json',{},'filename-race-instance'],
  ]){
    const input=join(folder,name),out=join(folder,name+'.out');await writeFile(input,JSON.stringify({race_scenario:encodedFixture(),...data}));await convert(input,out);
    const race=JSON.parse(await readFile(join(out,(await readdir(out))[0]),'utf8'));
    assert.equal(race.courseId,name==='aliases.json'?10804:10805);assert.equal(race.distance,1600);assert.equal(race.courseIdentity.source,source);
  }
  const namedAnalysis=join(folder,'filename-analysis.json');
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),join(folder,'101801_fixture.json'),namedAnalysis],{cwd:root,windowsHide:true,timeout:15000});
  const named=JSON.parse(await readFile(namedAnalysis,'utf8'))[0];
  assert.equal(named.courseId,10805);assert.equal(named.courseIdentity.source,'filename-race-instance');assert.equal(named.courseInference,null);
});

test('offline analysis labels model candidates separately and suppresses incomplete input estimates',async t=>{
  const folder=await workspace(t),base=JSON.parse(await readFile(fixture,'utf8'));
  const distances=[0,20,40,100,300,320,340,600,800,850,900,950];
  // Early pace-chaser base is 19.9512 m/s at these inputs; +4% pace up
  // with its section-wit range permits approximately 20.69–20.82 m/s.
  // 22 m/s is unexplained surplus and must not be labeled pace up.
  const speeds=[20,20.75,20.75,20,18,18,20,20,21,21,21,20];
  const hps=[1000,980,960,940,930,925,920,900,895,890,885,880];
  base.distance=1600;base.courseId=10805;base.category='practice';base.events=[];
  base.runners=base.runners.map((r,i)=>({...r,finishTime:20,finishTimeRaw:20,strategyCode:i===0?2:1,mood:3,lastSpurtDistance:-1,
    stats:{speed:1000,stamina:1000,power:1000,guts:1000,wisdom:1000},skills:[],
    aptitudes:{turf:7,dirt:7,mile:7,front:7,pace:7,late:7,end:7}}));
  base.conditions={weather:'1',ground:'1',season:'3'};
  base.frames=distances.map((distance,time)=>({time,runners:base.runners.map((r,i)=>({runnerId:r.id,distance:distance+(i===1?(time>=4&&time<=6?1:20):0),
    speed:speeds[time],hp:hps[time],lane:.1+i*.1,temptationMode:0,blockFrontRunnerIndex:-1}))}));
  const input=join(folder,'modeled.json'),output=join(folder,'modeled-analysis.json');await writeFile(input,JSON.stringify(base));
  const captureBytes=await readFile(input);
  await assert.rejects(run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,input],{cwd:root,windowsHide:true,timeout:15000}),error=>{
    assert.match(error.stderr,/The report must not replace its capture/);return true;
  });
  assert.deepEqual(await readFile(input),captureBytes);
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const first=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  for(const kind of ['pace-up-model','pace-down-model','downhill-mode-model']){
    const interval=first.intervals.find(i=>i.kind===kind);assert.ok(interval,kind);assert.equal(interval.evidence,'estimated');assert.ok(!interval.label.includes('(est.)'));assert.ok(interval.model.baselineHpRate>0);
  }
  assert.equal(first.intervals.find(i=>i.kind==='pace-down-model').model.hpDrainMultiplier,.6);
  assert.equal(first.intervals.find(i=>i.kind==='downhill-mode-model').model.hpDrainMultiplier,.4);
  assert.equal(first.summary.hpRecovered,0); // No modeled multiplier changes the observed totals.
  base.frames[1].runners[0].speed=22;base.frames[2].runners[0].speed=22;
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const excessive=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(excessive.intervals.some(i=>i.kind==='pace-up-model'),false);
  base.frames[1].runners[0].speed=speeds[1];base.frames[2].runners[0].speed=speeds[2];
  base.events=[{time:1,type:4,runnerId:base.runners[0].id,skillId:null,label:'Synthetic spot-struggle event',params:[0]}];
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const spot=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(spot.intervals.find(i=>i.kind==='spot-struggle').end,null);
  // Both endpoints already sit on the ordinary pace-up ceiling. The recorded
  // start survives, while the unsupported added struggle speed ends immediately.
  assert.equal(spot.intervals.find(i=>i.kind==='spot-struggle').estimatedEnd,1);
  assert.equal(spot.intervals.find(i=>i.kind==='spot-struggle-model').end,1);
  assert.equal(spot.intervals.find(i=>i.kind==='spot-struggle-model').model.hpDrainMultiplier,1.4);
  // A venue is unnecessary for competition timing. Missing baseline inputs must
  // omit the speed bonus rather than throw away the independently supported duration.
  base.courseId=null;delete base.category;delete base.runners[0].mood;
  base.runners[0].stats={guts:1000};base.runners[0].aptitudes={front:7};
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const independent=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(independent.intervals.find(i=>i.kind==='spot-struggle-model').end,7);
  assert.equal(independent.intervals.find(i=>i.kind==='spot-struggle-model').model.speedDelta,undefined);
  base.runners[0].stats={speed:1000,stamina:1000,power:1000,guts:1000,wisdom:1000};
  base.runners[0].mood=3;base.runners[0].aptitudes={turf:7,dirt:7,mile:7,front:7,pace:7,late:7,end:7};
  base.category='practice';base.courseId=10805;
  // Normalize raw event slots through the same CLI and ensure self is never an opponent.
  base.events=base.runners.map((r,i)=>({time:1,type:5,runnerId:null,skillId:null,label:'Synthetic dueling',params:[i]}));
  base.frames[1].runners[1].distance=base.frames[1].runners[0].distance+2;
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const duel=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(duel.intervals.find(i=>i.kind==='dueling').end,null);
  const duelCrossing=1+(5-2)/(20-2);
  assert.ok(Math.abs(duel.intervals.find(i=>i.kind==='dueling').estimatedEnd-duelCrossing)<1e-9);
  assert.ok(Math.abs(duel.intervals.find(i=>i.kind==='dueling-model').end-duelCrossing)<1e-9);
  assert.ok(duel.intervals.find(i=>i.kind==='dueling-model').model.speedDelta>0);
  base.frames[2].runners[1].distance=null;
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const missingOpponent=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(missingOpponent.intervals.find(i=>i.kind==='dueling-model').end,3);
  // HP below 5% independently ends the model even when opponent distance is
  // missing; zero HP is a separate recorded sampled state, not a duel event.
  base.frames[2].runners[0].hp=49;
  for(const frame of base.frames.slice(3))frame.runners[0].hp=0;
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const depleted=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(depleted.intervals.find(i=>i.kind==='dueling').end,null);
  assert.equal(depleted.intervals.find(i=>i.kind==='dueling-model').end,2);
  const empty=depleted.intervals.find(i=>i.kind==='hp-empty');
  assert.equal(empty.start,3-(speeds[2]-speeds[3])/1.2);assert.equal(empty.evidence,'recorded');assert.equal(empty.end,null);
  assert.equal(depleted.samples.find(sample=>sample.hp===0).time,3); // The retained zero sample is unchanged.
  base.frames.forEach((frame,time)=>{frame.runners[0].hp=hps[time];});
  base.frames[1].runners[1].distance=distances[1]+20;base.frames[2].runners[1].distance=distances[2]+20;
  base.events=[{time:1,type:3,runnerId:base.runners[1].id,skillId:999999,label:'Unknown synthetic foreign effect',params:[1,999999,100000,0]}];
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const confounded=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(confounded.intervals.filter(i=>i.kind.endsWith('-model')).length,0);
  assert.ok(confounded.intervals.some(i=>i.kind==='near-slowdown')); // Independent sampled neighborhood evidence survives.
  base.events=[];
  delete base.runners[0].aptitudes;
  await writeFile(input,JSON.stringify(base));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
  const incomplete=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[base.runners[0].id];
  assert.equal(incomplete.intervals.filter(i=>i.kind.endsWith('-model')).length,0);
  assert.deepEqual(incomplete.summary,first.summary);
});

test('whole-file course inference uses selected successful branches and bounded geometry without inventing IDs',async t=>{
  const folder=await workspace(t),base=JSON.parse(await readFile(fixture,'utf8'));
  base.distance=2500;base.courseId=null;base.courseIdentity={source:'unknown'};base.category='champions-meeting';
  base.conditions={weather:'2',ground:'2',season:'4'};
  base.runners=base.runners.map(r=>({...r,finishTime:110,finishTimeRaw:110,lastSpurtDistance:-1,skills:[{id:200151,level:1},{id:200211,level:1},{id:200201,level:1}]}));
  base.frames=[[0,0],[80,1955],[90,1965],[110,2500]].map(([time,distance])=>({time,runners:base.runners.map(r=>({runnerId:r.id,distance,speed:20,hp:1000,lane:.1,temptationMode:0,blockFrontRunnerIndex:-1}))}));
  const proc={time:85,type:3,runnerId:base.runners[0].id,skillId:120011,label:'Synthetic course-dependent proc',params:[0,120011,125000,0]};
  base.events=[proc];
  const input=join(folder,'inference.json'),output=join(folder,'analysis.json');
  async function analyze(value){await writeFile(input,JSON.stringify(value));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});return JSON.parse(await readFile(output,'utf8'))[0];}
  const unique=await analyze(base);
  assert.equal(unique.courseId,null);assert.equal(unique.courseInference.courseId,10506);assert.equal(unique.courseInference.trackId,10005);
  assert.deepEqual(unique.courseInference.candidateCourseIds,[10506]);assert.ok(unique.courseInference.evidence.some(s=>s.includes('observation bracket')));
  const rows=unique.analysis.runners[base.runners[0].id].skillRows;
  assert.equal(rows.find(s=>s.skillId===200151).evidence,'derived');assert.equal(rows.find(s=>s.skillId===200211).evidence,'derived');
  assert.equal(rows.find(s=>s.skillId===200201).activationStatus,'inferred-passive');
  const boundary=structuredClone(base);boundary.frames[1].runners.forEach(r=>r.distance=1990);boundary.frames[2].runners.forEach(r=>r.distance=2010);
  const ambiguous=await analyze(boundary);
  assert.equal(ambiguous.courseInference.courseId,null);assert.equal(ambiguous.courseInference.trackId,10005);
  assert.deepEqual(ambiguous.courseInference.candidateCourseIds,[10506,10511]);
  for(const [kind,params] of [['failed',[0,120011,-1,0]],['unknown-branch',[0,120011,125000,99]]]){
    const value=structuredClone(base);value.events[0].params=params;
    assert.equal((await analyze(value)).courseInference,null,kind);
  }
  const alternative=structuredClone(base);alternative.events[0].params[3]=1;
  assert.deepEqual((await analyze(alternative)).courseInference.candidateCourseIds,[10506,10607]);
  const knownOr=structuredClone(base);knownOr.events=[{...proc,skillId:202241,params:[0,202241,0,0]}];
  assert.deepEqual((await analyze(knownOr)).courseInference.candidateCourseIds,[]); // None of these OR venues has a 2500m reference course.
  const unknownOr=structuredClone(base);unknownOr.events=[{...proc,skillId:202341,params:[0,202341,10000,0]}];
  const dirtAlternatives=(await analyze(unknownOr)).courseInference;
  assert.equal(dirtAlternatives.courseId,null);assert.deepEqual(dirtAlternatives.candidateCourseIds,[10312,10511]); // Unknown ground-condition alternatives remain possible.
  const conflict=structuredClone(base);conflict.events.unshift({...proc,time:0,skillId:200021,params:[0,200021,0,0]});
  const contradicted=await analyze(conflict);
  assert.equal(contradicted.courseInference.courseId,null);assert.equal(contradicted.courseInference.trackId,null);
  assert.deepEqual(contradicted.courseInference.candidateCourseIds,[]);assert.ok(contradicted.courseInference.evidence.some(s=>s.includes('conflicts')));
  const unresolved=structuredClone(base);delete unresolved.conditions;
  const absentGreen=(await analyze(unresolved)).analysis.runners[base.runners[0].id].skillRows.find(s=>s.skillId===200151);
  // Complete start-to-finish capture plus inventory excludes an unrecorded
  // no-wit skill, even though the missing ground setting stays unresolved.
  assert.equal(absentGreen.conditionEvaluation.state,'unknown');assert.equal(absentGreen.activationStatus,'conditions-unmet');assert.equal(absentGreen.evidence,'derived');
  const partial=structuredClone(unresolved);partial.frames.pop();
  assert.equal((await analyze(partial)).analysis.runners[base.runners[0].id].skillRows.find(s=>s.skillId===200151).evidence,'unknown');
  base.courseId=10506;base.courseIdentity={source:'skill-conditions'};await writeFile(input,JSON.stringify(base));
  const reimport=join(folder,'reimport');await convert(input,reimport);
  const restored=JSON.parse(await readFile(join(reimport,(await readdir(reimport))[0]),'utf8'));
  assert.equal(restored.courseIdentity.source,'skill-conditions');assert.equal((await analyze(restored)).courseInference,null);
});

test('declared replay response shapes retain public instance IDs while excluding saved-room identities and unrelated siblings',async t=>{
  const folder=await workspace(t),scenario=encodedFixture();
  const cases=[
    ['saved-room','/\x75mamusume/room_match/get_saved_race_result',{data:{race_scenario:scenario,race_result:{race_instance_id:101801,
      saved_room_id:'PRIVATE_FIXTURE_ROOM',host_viewer_id:'PRIVATE_FIXTURE_PLAYER',register_id:'PRIVATE_FIXTURE_REGISTER',
      room_name:'PRIVATE_FIXTURE_ROOM_NAME',race_horse_data_array:[{frame_order:1,chara_name:'PRIVATE_FIXTURE_BORROWED_RUNNER'}]},
      auth:{token:'PRIVATE_FIXTURE_TOKEN'}}},101801,'practice'],
    ['practice-replay','/\x75mamusume/practice_race/race_replay',{data:{race_result_info:{race_instance_id:101801,race_scenario:scenario},
      practice_partner_owner_info_array:[{viewer_id:'PRIVATE_FIXTURE_OWNER'}]}},101801,'practice'],
    ['champions-room','/\x75mamusume/champions/race_history',{data:{room_info:{race_instance_id:101801,race_scenario:scenario,
      room_id:'PRIVATE_FIXTURE_ROOM',user_entry_num:9},trainer_info:{id:'PRIVATE_FIXTURE_TRAINER'}}},101801,'champions-meeting'],
    ['unrelated-array','/\x75mamusume/room_match/result',{race_result:{race_instance_id:101801},races:[{race_scenario:scenario}]},null,'practice'],
    ['result-array','/\x75mamusume/room_match/result',{race_scenario:scenario,race_result:[{race_instance_id:101801}]},null,'practice'],
    ['invalid-id','/\x75mamusume/room_match/result',{race_scenario:scenario,race_result:{race_instance_id:true,host_viewer_id:'PRIVATE_FIXTURE_PLAYER'}},null,'practice'],
  ];
  for(const [name,endpoint,response,instance,category] of cases){
    const input=join(folder,name+'.json'),sanitized=join(folder,name+'-safe.json'),out=join(folder,name+'-import');
    await writeFile(input,JSON.stringify(response));
    await run('python',[join(root,'scripts/proxy/extract-file.py'),input,sanitized,'--endpoint',endpoint],{cwd:root,windowsHide:true,timeout:15000});
    const text=await readFile(sanitized,'utf8');assert.ok(!text.includes('PRIVATE_FIXTURE'),name);
    const safe=JSON.parse(text);assert.equal(safe.length,1,name);assert.equal(safe[0].race_instance_id??null,instance,name);
    assert.equal(safe[0].race_category,category);assert.equal(safe[0].race_horse_data_array,undefined);
    await convert(sanitized,out);
    const race=JSON.parse(await readFile(join(out,(await readdir(out))[0]),'utf8'));
    assert.equal(race.courseId,instance===null?null:10805);assert.equal(race.category,category);
    assert.equal(race.courseIdentity.source,instance===null?'unknown':'race-instance');
    // Import the original declared response directly as well as the sanitized
    // projection. Only the co-located public numeric context can cross over.
    const rawOut=join(folder,name+'-raw-import');await convert(input,rawOut);
    const rawRace=JSON.parse(await readFile(join(rawOut,(await readdir(rawOut))[0]),'utf8'));
    assert.equal(rawRace.courseId,instance===null?null:10805,name+' raw');
    assert.ok(!JSON.stringify(rawRace).includes('PRIVATE_FIXTURE'),name+' raw privacy');
    assert.ok(rawRace.runners.every(r=>r.stats===undefined),name+' no borrowed runner metadata');
  }
  const excessive=join(folder,'excessive.json');await writeFile(excessive,JSON.stringify({race_scenario:scenario,race_result:Object.fromEntries(Array.from({length:1001},(_,i)=>['private'+i,i]))}));
  await assert.rejects(run('python',[join(root,'scripts/proxy/extract-file.py'),excessive,join(folder,'rejected.json')],{cwd:root,windowsHide:true,timeout:15000}));
  await assert.rejects(convert(excessive,join(folder,'rejected-import')));
});

test('offline master/event extraction generates a reproducible reference consumed by the real analysis process',async t=>{
  const folder=await workspace(t),source=join(folder,'input'),events=join(source,'events');await mkdir(events,{recursive:true});
  const master=join(source,'master.mdb'),setup=join(folder,'make-master.py');
  await writeFile(setup,`import sqlite3,sys\nfrom pathlib import Path\ndb=sqlite3.connect(sys.argv[1])\nfields={'id':'INTEGER','rarity':'INTEGER','group_id':'INTEGER','activate_lot':'INTEGER','icon_id':'INTEGER'}\nfor b in (1,2):\n for k in ['condition','precondition']:fields[f'{k}_{b}']='TEXT'\n for k in ['float_cooldown_time','float_ability_time','ability_time_usage']:fields[f'{k}_{b}']='INTEGER'\n for i in (1,2,3):\n  for k in ['ability_type','float_ability_value','ability_value_usage','ability_value_level_usage','target_type','target_value','additional_activate_type']:fields[f'{k}_{b}_{i}']='INTEGER'\ndb.execute('CREATE TABLE skill_data ('+','.join(k+' '+v for k,v in fields.items())+')')\nrow={k:('' if v=='TEXT' else 0) for k,v in fields.items()}\nrow.update(id=200331,rarity=2,group_id=20033,activate_lot=1,icon_id=20011,condition_1='all_corner_random==1',float_ability_time_1=20000,ability_time_usage_1=1,ability_type_1_1=27,float_ability_value_1_1=1500,ability_value_usage_1_1=1,ability_value_level_usage_1_1=1,target_type_1_1=1)\ndb.execute('INSERT INTO skill_data VALUES('+','.join('?' for k in row)+')',list(row.values()))\ndb.execute('CREATE TABLE text_data (id INTEGER,category INTEGER,[index] INTEGER,text TEXT)')\ndb.executemany('INSERT INTO text_data VALUES (?,?,?,?)',[(1,6,1001,'Synthetic runner'),(2,5,100101,'Synthetic outfit'),(3,35,10005,'Synthetic venue'),(4,47,200331,'Synthetic corner skill'),(5,48,200331,'Synthetic effect description'),(6,999,1,'PRIVATE_FIXTURE_AUTH')])\ndb.execute('CREATE TABLE race_course_set (id INTEGER,race_track_id INTEGER,distance INTEGER,ground INTEGER,inout INTEGER,turn INTEGER,float_lane_max INTEGER,course_set_status_id INTEGER,finish_time_min INTEGER,finish_time_max INTEGER)')\ndb.executemany('INSERT INTO race_course_set VALUES (?,?,?,?,?,?,?,?,?,?)',[(10506,10005,2500,1,2,1,12000,8,1487000,1570000),(11201,10201,1000,1,1,4,12000,0,10000,20000),(11202,10201,1400,1,1,1,12000,0,10000,20000)])\ndb.execute('CREATE TABLE race_course_set_status (course_set_status_id INTEGER,target_status_1 INTEGER,target_status_2 INTEGER)')\ndb.execute('INSERT INTO race_course_set_status VALUES (8,2,3)')\ndb.execute('CREATE TABLE race (id INTEGER,course_set INTEGER)');db.execute('INSERT INTO race VALUES (1,10506)')\ndb.execute('CREATE TABLE race_instance (id INTEGER,race_id INTEGER)');db.execute('INSERT INTO race_instance VALUES (101801,1)')\ndb.execute('CREATE TABLE private_accounts (token TEXT)');db.execute('INSERT INTO private_accounts VALUES ("PRIVATE_FIXTURE_ACCOUNT_TOKEN")')\ndb.commit();db.close()\n`);
  await run('python',[setup,master],{cwd:root,windowsHide:true,timeout:15000});
  const eventParams=[{_paramType:2,_distance:0,_values:[1,1]},{_paramType:2,_distance:1700,_values:[2,1]},
    {_paramType:0,_distance:1700,_values:[3,250]},{_paramType:0,_distance:1950,_values:[4,240]},
    {_paramType:2,_distance:2190,_values:[1,1]},{_paramType:2,_distance:2500,_values:[2,1]},
    {_paramType:11,_distance:2325,_values:[20000,110]}];
  await writeFile(join(events,'10506.json'),JSON.stringify({courseParams:eventParams}));
  const before=await readFile(master),identityBefore=await readFile(join(root,'src/data/course-identities.json'));
  const generated=join(folder,'generated'),repeat=join(folder,'repeat');
  for(const output of [generated,repeat])await run('python',[join(root,'scripts/extract-game-reference.py'),'--master',master,'--course-events',events,'--output',output],{cwd:root,windowsHide:true,timeout:15000});
  assert.deepEqual(await readFile(master),before);assert.deepEqual(await readFile(join(root,'src/data/course-identities.json')),identityBefore);
  for(const name of ['metadata.json','course-identities.json','courses.json','reference-source.json','course-event-source.json']){
    const bytes=await readFile(join(generated,name));assert.deepEqual(bytes,await readFile(join(repeat,name)),name);
    assert.ok(!bytes.toString().includes('PRIVATE_FIXTURE'),name+' privacy');assert.ok(!bytes.toString().includes(folder),name+' source paths');
  }
  const courses=JSON.parse(await readFile(join(generated,'courses.json'),'utf8'));
  assert.deepEqual(Object.keys(courses),['10506']);assert.deepEqual(courses['10506'].courseSetStatus,[2,3]);
  assert.deepEqual(courses['10506'].corners,[{start:1700,length:250},{start:1950,length:240}]);
  assert.deepEqual(courses['10506'].slopes,[{start:2325,length:110,slope:20000}]);
  const metadata=JSON.parse(await readFile(join(generated,'metadata.json'),'utf8'));
  assert.equal(metadata.skills['200331'].description,'Synthetic effect description');assert.equal(metadata.skills['200331'].branches[0].effects[0].rawValue,1500);
  assert.equal(metadata.raceInstances['101801'],10506);
  const race=JSON.parse(await readFile(fixture,'utf8'));race.courseId=10506;race.distance=2500;
  race.events=[{time:1,type:3,runnerId:race.runners[0].id,skillId:200331,label:'Synthetic proc',params:[0,200331,20000,0]}];
  const input=join(folder,'race.json'),output=join(folder,'analysis.json');await writeFile(input,JSON.stringify(race));
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output,'--reference-dir',generated],{cwd:root,windowsHide:true,timeout:15000});
  const analysis=JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[race.runners[0].id];
  assert.equal(analysis.skillActivations[0].effects[0].rawValue,1500);assert.equal(analysis.skillActivations[0].duration,2);
  await assert.rejects(run('python',[join(root,'scripts/extract-game-reference.py'),'--master',master,'--course-events',events,'--output',join(source,'forbidden')],{cwd:root,windowsHide:true,timeout:15000}));
});

test('running desktop history identifies compact captions, refreshes preserved IDs and resumes bounded work',async t=>{
  const folder=await workspace(t);
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/library-caption-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:30000});
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.syntheticHistoryRows,45);assert.equal(report.budgetResume,'passed');
  assert.equal(report.compactInferredCaptions,'passed');assert.equal(report.recordedInstanceSource,'passed');
  assert.equal(report.captionCache,'passed');assert.equal(report.pendingDisposal,'passed');
  assert.equal(report.sourceCapture,'unchanged');assert.equal(report.certificateChanges,false);
});

test('whole replay skill conditions → modeled statuses → portable import preserves recorded facts and bounded inference',async t=>{
  const folder=await workspace(t),base=JSON.parse(await readFile(fixture,'utf8'));
  base.conditions={ground:'2',weather:'1',season:'4'};
  base.runners[0]={...base.runners[0],strategy:'Late Surger',strategyCode:3,mood:3,startDelay:.02,lastSpurtDistance:1600,
    skills:[201541,200162,201521,200431,100031,200331,200332,300061].map(id=>({id,level:1})),aptitudes:{turf:7,middle:7,late:7,front:7}};
  base.runners[1]={...base.runners[1],stats:{...base.runners[0].stats,guts:500},strategyCode:1,mood:3,startDelay:.08,lastSpurtDistance:1600,
    skills:[202051,200431].map(id=>({id,level:1})),aptitudes:{turf:7,middle:7,front:7}};
  base.frames=[0,10,20,40,60,70,90,100,120].map(time=>({time,runners:base.runners.map((r,i)=>({runnerId:r.id,distance:20*time-i,
    speed:20,hp:1000-7*time,lane:.2+i*.2,temptationMode:time>=20&&time<40?4:0,blockFrontRunnerIndex:-1}))}));
  base.events=[{time:10,type:4,runnerId:base.runners[1].id,skillId:null,label:'Synthetic spot struggle',params:[1]},
    ...[70,90].map(time=>({time,type:5,runnerId:base.runners[0].id,skillId:null,label:'Synthetic dueling',params:[0]})),
    {time:60,type:3,runnerId:base.runners[0].id,skillId:200331,label:'Synthetic proc',params:[0,200331,20000,0]}];
  const analyze=async(race,name)=>{
    const input=join(folder,name+'.json'),output=join(folder,name+'-analysis.json');await writeFile(input,JSON.stringify(race));
    await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output],{cwd:root,windowsHide:true,timeout:15000});
    return {input,report:JSON.parse(await readFile(output,'utf8'))[0].analysis};
  };
  const first=await analyze(base,'conditions'),late=first.report.runners[base.runners[0].id],front=first.report.runners[base.runners[1].id];
  const row=(runner,id)=>runner.skillRows.find(r=>r.skillId===id);
  for(const id of [201541,200162]){assert.equal(row(late,id).activationStatus,'inferred-passive');assert.equal(row(late,id).effectiveActive,true);assert.equal(row(late,id).activationCount,0);assert.deepEqual(row(late,id).activations,[]);}
  assert.equal(row(late,201521).activationStatus,'conditions-unmet');assert.equal(row(late,201521).effectiveActive,false);
  assert.equal(row(late,200431).conditionEvaluation.state,'met');assert.equal(row(late,200431).activationStatus,'wit-failure-inferred');
  assert.equal(row(late,200431).conditionEvaluation.branches[0].staticOnly,true);assert.equal(row(late,200431).lottery,undefined);assert.match(row(late,200431).nonProcReason,/No exact random roll/);
  assert.equal(row(front,200431).activationStatus,'wit-failure-supported');assert.equal(row(front,200431).lottery.method,'start-delay-bound');assert.equal(row(front,200431).lottery.roll,null);
  assert.equal(row(late,300061).conditionEvaluation.state,'met');assert.equal(row(late,300061).conditionEvaluation.branches[0].firstOpportunity,100);
  // She leads at every retained sample; the required runner ahead and outgoing
  // overtake never occur together, even though the final straight is known.
  assert.equal(row(late,900031).conditionEvaluation.state,'unmet');
  assert.ok(!row(late,100031));assert.equal(row(late,200332).activationStatus,'conditions-inferred');assert.match(row(late,200332).nonProcReason,/shares this activation group/);
  assert.equal(row(front,202051).activationStatus,'inferred-passive');
  const spot=front.intervals.find(i=>i.kind==='spot-struggle-model');assert.equal(spot.model.hpDrainMultiplier,3.5);
  assert.ok(spot.impact.modeledExtraDistance>0);assert.ok(spot.impact.modeledExtraHp>0);assert.ok(spot.impact.observedHpConsumed>0);
  const rushed=late.statusImpacts.find(i=>i.kind==='rushed');assert.equal(rushed.observedDistance,400);assert.equal(rushed.observedHpConsumed,140);assert.ok(rushed.modeledExtraDistance>0);assert.ok(rushed.modeledExtraHp>0);
  const dueling=late.statusImpacts.find(i=>i.kind==='dueling');assert.equal(dueling.duration,50);assert.equal(dueling.intervals,2);assert.equal(dueling.observedHpConsumed,null);assert.equal(dueling.modeledExtraDistance,null);assert.match(dueling.detail,/overlap/);
  assert.equal(late.skillActivations.length,1);assert.equal(late.skillActivations[0].duration,2);
  const portable=join(folder,'portable');await convert(first.input,portable);const saved=JSON.parse(await readFile(join(portable,(await readdir(portable))[0]),'utf8'));
  assert.equal(saved.runners[1].strategyCode,1);assert.equal(saved.runners[0].skills.find(s=>s.id===100031).id,100031);assert.deepEqual(saved.events,base.events.map(e=>({...e,runnerId:e.runnerId==='fixture-1'?'runner-1':'runner-2'})).sort((a,b)=>a.time-b.time));
  const reimported=await analyze(saved,'reimport');assert.equal(row(reimported.report.runners['runner-1'],201541).activationStatus,'inferred-passive');
  const missing=structuredClone(base);missing.courseId=null;missing.runners[1].mood=null;
  const unknown=await analyze(missing,'missing-inputs');assert.equal(unknown.report.runners[base.runners[1].id].intervals.find(i=>i.kind==='spot-struggle-model').impact.modeledExtraHp,null);
  for(const id of [200291,202441]){
    const uncertain=structuredClone(base);uncertain.runners[0].skills.push({id,level:1});uncertain.runners[1].skills.push({id,level:1});
    uncertain.frames=uncertain.frames.filter(frame=>frame.time<120); // Censored proc coverage cannot prove the passive inactive.
    const result=(await analyze(uncertain,'uncertain-passive-'+id)).report;
    assert.equal(row(result.runners[base.runners[0].id],id).activationStatus,'unknown');
    const interval=result.runners[base.runners[1].id].intervals.find(i=>i.kind==='spot-struggle-model');
    assert.equal(interval.model.speedDelta,undefined);assert.equal(interval.impact.modeledExtraHp,null);assert.ok(interval.impact.observedHpConsumed>0);
    assert.equal(result.runners[base.runners[0].id].statusImpacts.find(i=>i.kind==='rushed').modeledExtraHp,null);
    assert.ok(Object.values(result.runners).every(r=>!r.intervals.some(i=>['pace-up-model','pace-down-model','speed-up-model','overtake-model'].includes(i.kind))));
  }
  const conflictingGate=structuredClone(base);conflictingGate.runners[1].skills.push({id:200433,level:1});
  const excludedGate=row((await analyze(conflictingGate,'gate-conflict')).report.runners[base.runners[1].id],200431);
  assert.equal(excludedGate.activationStatus,'conditions-met');assert.match(excludedGate.nonProcReason,/shares this activation group/);assert.equal(excludedGate.lottery,undefined);
  // Explicit synthetic .NET seed42 oracle: draws .6681064659,.1409072984,
  // .1255182895,.5227642760,.1684342242. Three lottery draws precede two
  // float32 start delays; the foreign unique must consume the second draw.
  const seeded=structuredClone(base);seeded.randomSeed=42;seeded.events=[];
  seeded.runners[0].skills=[200431,100031].map(id=>({id,level:1}));seeded.runners[1].skills=[202051,200431].map(id=>({id,level:1}));
  seeded.runners[0].stats.wisdom=100;seeded.runners[1].stats.wisdom=100;
  seeded.runners[0].startDelay=.052276428788900375;seeded.runners[1].startDelay=.006737368181347847;
  const aligned=(await analyze(seeded,'aligned')).report;const inherited=row(aligned.runners[base.runners[0].id],900031),concentration=row(aligned.runners[base.runners[0].id],200431);
  assert.equal(concentration.activationStatus,'wit-failure-supported');assert.equal(concentration.lottery.method,'aligned-rng');assert.equal(concentration.lottery.measuredBase,3);assert.equal(concentration.lottery.matchedRunners,2);assert.ok(concentration.lottery.roll>66&&concentration.lottery.roll<67);
  assert.equal(inherited.activationStatus,'conditions-unmet');assert.equal(inherited.lottery.won,true);
  const noCard=structuredClone(seeded);noCard.runners[0].cardId=null;
  const unsupported=(await analyze(noCard,'no-card')).report;assert.ok(Object.values(unsupported.runners).every(r=>r.skillRows.every(s=>!s.lottery)));assert.ok(Object.values(unsupported.runners).every(r=>r.skillRows.every(s=>s.activationStatus!=='wit-failure-supported')));
  const contradiction=structuredClone(seeded);contradiction.events=[{time:0,type:3,runnerId:base.runners[0].id,skillId:200431,label:'Synthetic contradictory proc',params:[0,200431,0,0]}];
  const rejected=(await analyze(contradiction,'contradiction')).report;assert.equal(row(rejected.runners[base.runners[0].id],200431).activationStatus,'recorded');assert.ok(Object.values(rejected.runners).every(r=>r.skillRows.every(s=>!s.lottery)));
  t.diagnostic('Public/synthetic whole-analysis workflow: guaranteed passives, always==1, static exclusions, final-corner latch, inherited lottery normalization, Runaway, bounded RNG evidence, censored/overlapping status totals and portable facts passed.');
});

test('whole skill catalog audit preserves every Global effect and withholds unknown mechanics',async t=>{
  const folder=await workspace(t);
  // This workflow starts five TypeScript CLI processes on a cold Windows runner.
  const result=await run(process.execPath,['--import','tsx',join(root,'tests/skill-effect-catalog-workflow.ts'),folder],{cwd:root,windowsHide:true,timeout:120000});
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.skills,734);assert.equal(report.branches,788);assert.equal(report.effectRecords,971);assert.equal(report.effectTypes,22);
  assert.equal(report.wholeCatalog,'passed');assert.equal(report.deterministic,'passed');assert.equal(report.unknownCodes,'withheld');assert.equal(report.sourceMetadata,'unchanged');
});
});
