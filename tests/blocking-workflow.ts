/** Whole-process import/analysis cases. Controlled modes are explicitly labeled
 * component-integration scenarios, not recovered replay inference. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if (process.argv[2] === '--scenario') {
  const { importRace } = await import('../src/data/import'); const { assembleReferenceData } = await import('../src/data/reference');
  const { analyzeRace } = await import('../src/data/analytics'); const { slowdownFor } = await import('../src/data/slowdown-impact');
  const folder = resolve(process.argv[3]), input = JSON.parse(await readFile(process.argv[4], 'utf8'));
  const json = async (name: string) => JSON.parse(await readFile(join(folder, name), 'utf8'));
  const reference = assembleReferenceData(await json('metadata.json'), await json('courses.json'), await json('reference-source.json'), await json('simulator-skill-ids.json'));
  const bytes = new TextEncoder().encode(JSON.stringify(input.race)); const race = (await importRace(bytes.buffer as ArrayBuffer, 'synthetic-blocking.json'))[0];
  const analysis = analyzeRace(race, reference), runner = race.runners[0];
  // Isolate the explicitly chosen mode context for these integral scenarios.
  // Ordinary replay inference can correctly carry an earlier overtake mode
  // through this block; that behavior is exercised by mode-inference-workflow.
  analysis.runners[runner.id].intervals=analysis.runners[runner.id].intervals.filter(interval=>!['pace-up-model','pace-down-model','speed-up-model','overtake-model'].includes(interval.kind));
  if (input.mode) {
    analysis.runners[runner.id].intervals.push(...input.mode.map((mode: any) => ({ ...mode, label: 'Controlled supported-mode scenario', evidence: 'estimated',
      detail: 'Explicit component-integration scenario; not claimed to be inferred from this blocked replay.' })));
  }
  analysis.runners[runner.id].slowdown = slowdownFor(race, runner, reference.courses[99994], analysis);
  console.log(JSON.stringify({ slowdown: analysis.runners[runner.id].slowdown.blocking, stats: analysis.runners[runner.id].statBreakdown,
    controlledMode: !!input.mode }));
} else {
  const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), folder = resolve(process.argv[2]);
  await mkdir(folder, { recursive: true }); const reference = join(folder, 'reference'); await mkdir(reference);
  for (const name of ['metadata.json', 'reference-source.json', 'simulator-skill-ids.json']) await writeFile(join(reference, name), await readFile(join(root, 'public/data', name)));
  const metadata = JSON.parse(await readFile(join(reference, 'metadata.json'), 'utf8'));
  for (const [id,type,value,targetType] of [[840001,27,5000,1],[840002,27,-5000,2],[840003,31,4000,1],[840004,21,10000,1],[840005,27,5000,1],[840006,27,200000,1],[840007,27,-150000,2]]) metadata.skills[id] = {
    name: `Synthetic blocking modifier${id}`, rarity:1, activateLot:0, branches:[{branchIndex:0,condition:'always==1',rawDuration:100000,durationUsage:1,
      effects:[{type,rawValue:value,valueUsage:id===840005?2:1,levelUsage:1,targetType,additionalActivateType:0}]}]};
  await writeFile(join(reference,'metadata.json'),JSON.stringify(metadata));
  const course = {distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:15000,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[] as any[]};
  await writeFile(join(reference,'courses.json'),JSON.stringify({99994:course}));
  function base(start=50,length=8,actual=18,style=1): any {
    return {schemaVersion:1,synthetic:true,title:'Synthetic blocking integration',courseId:99994,distance:2000,category:'practice',conditions:{ground:'1',weather:'1',season:'1'},
      runners:[0,1].map(i=>({id:`fixture-${i}`,name:`Synthetic runner${i}`,gate:i+1,strategyCode:i===0?style:1,cardId:100101+i*100,mood:3,finishTime:100,finishTimeRaw:100,lastSpurtDistance:-1,
        stats:{speed:1000,stamina:1000,power:1200,guts:500,wisdom:600},aptitudes:{turf:7,middle:7,front:7,late:7,pace:7,end:7},skills:[840001,840002,840003,840004,840005,840006,840007].map(id=>({id,level:1}))})),
      frames:Array.from({length:401},(_,i)=>i/4).map(time=>({time,runners:[0,1].map(i=>({runnerId:`fixture-${i}`,distance:(time<start?20*time:time<=start+length?20*start+actual*(time-start):20*start+actual*length+20*(time-start-length))+(i===1?1:0),
        speed:time===0?3:time>=start&&time<=start+length?i===0?actual:actual/.994:20,hp:2760-time*20,lane:.1+i*.1,temptationMode:0,blockFrontRunnerIndex:i===0&&time>=start&&time<=start+length?1:-1}))})),events:[],warnings:[]};
  }
  const event=(id:number,time=50,source=0,mask=1)=>({time,type:3,runnerId:`fixture-${source}`,skillId:id,label:'Synthetic skill modifier',params:[source,id,200000,0,mask]});
  let cases=0;
  async function analyze(name:string,race:any,mode?:any[]) {const input=join(folder,`${name}.json`);await writeFile(input,JSON.stringify({race,mode}));
    const output=await run(process.execPath,['--import','tsx',resolve(import.meta.filename),'--scenario',reference,input],{cwd:root,windowsHide:true,timeout:30000});cases++;return JSON.parse(output.stdout);}
  const near=(a:number,b:number,t=.00001)=>assert.ok(Math.abs(a-b)<t,`${a} vs${b}`);
  const target=(style:number,phase:number,wisdom=600)=>{const coefficient=({1:[1,.98,.962],3:[.938,.998,.994]} as Record<number,number[]>)[style][phase],wit=wisdom/5500*Math.log10(.1*wisdom);
    return {min:20*coefficient+20*(wit-.65)/100,max:20*coefficient+20*wit/100};};
  const loss=(speed:number,ceiling:number,accel:number,length:number)=>{const gap=Math.max(0,ceiling-speed),ramp=Math.min(length,gap/accel);return .5*accel*ramp*ramp+gap*(length-ramp);};
  const acceleration=.0006*Math.sqrt(500*1200),late=target(1,1);
  let race=base(),value=await analyze('constant-cap-plus-acceleration-ramp',race),normal=value.slowdown;
  near(normal.assessedDistanceLossMin,loss(18,late.min,acceleration,8));near(normal.assessedDistanceLossMax,loss(18,late.max,acceleration,8));
  assert.equal(normal.distanceLossMin,null);assert.ok(normal.coverageRate<1);assert.match(normal.unavailableReasons.join(' '),/Front-block|front block|cap|geometry/i);
  race=base(50,2);value=await analyze('pure-acceleration-ramp-area',race);near(value.slowdown.assessedDistanceLossMin,.5*acceleration*4);near(value.slowdown.assessedDistanceLossMax,.5*acceleration*4);
  race=base();race.events=[event(840001)];value=await analyze('target-buff-adjusts-free-ceiling',race);near(value.slowdown.assessedDistanceLossMin,loss(18,late.min+.5,acceleration,8));assert.ok(value.slowdown.assessedDistanceLossMin>normal.assessedDistanceLossMin);
  race=base();race.events=[event(840002,50,1)];value=await analyze('target-debuff-adjusts-free-ceiling',race);near(value.slowdown.assessedDistanceLossMin,loss(18,late.min-.5,acceleration,8));assert.ok(value.slowdown.assessedDistanceLossMin<normal.assessedDistanceLossMin);
  race=base();race.events=[event(840003)];value=await analyze('acceleration-buff-adjusts-ramp',race);near(value.slowdown.assessedDistanceLossMin,loss(18,late.min,acceleration+.4,8));
  race=base();race.events=[event(840006),event(840007,50,1)];value=await analyze('signed-target-effects-before-final-cap',race);near(value.slowdown.assessedDistanceLossMin,loss(18,late.min+5,acceleration,8));
  race=base();for(const frame of race.frames)if(frame.time>=50&&frame.time<=58)frame.runners[0].temptationMode=4;
  value=await analyze('rushed-base-coefficient-before-wit',race);near(value.slowdown.assessedDistanceLossMin,loss(18,late.min+19.6*.04,acceleration,8));
  race=base(70,8);race.runners[0].lastSpurtDistance=1333.3333333333333;value=await analyze('spurt-retains-lower-upper-target-scenarios',race);
  const term=Math.sqrt(500*1000)*.002,lower=20*.962+term,upper=(lower+.2)*1.05+term+(450*500)**.597*.0001;
  near(value.slowdown.assessedDistanceLossMin,loss(18,lower,acceleration*.996,8));near(value.slowdown.assessedDistanceLossMax,loss(18,upper,acceleration*.996,8));assert.ok(value.slowdown.assessedDistanceLossMax>value.slowdown.assessedDistanceLossMin);
  race=base(70,8);race.runners[0].lastSpurtDistance=null;value=await analyze('unknown-late-spurt-target-withheld',race);assert.equal(value.slowdown.assessedDistanceLossMin,null);
  race=base(50,8,19);race.events=[event(840004)];for(const frame of race.frames)if(frame.time>=50&&frame.time<=58)frame.runners[1].speed=18/.994;
  value=await analyze('direct-speed-separated-from-self-speed',race);near(value.slowdown.assessedDistanceLossMin,normal.assessedDistanceLossMin);
  race=base();race.events=[event(840005)];value=await analyze('unknown-scaling-withholds-area',race);assert.equal(value.slowdown.assessedDistanceLossMin,null);
  race=base();race.events=[event(840002,50,1)];race.events[0].params.pop();value=await analyze('unknown-recipient-withholds-area',race);assert.equal(value.slowdown.assessedDistanceLossMin,null);
  race=base();race.events=[event(840002,50,1)];race.runners.forEach((r:any)=>r.teamGroup=1);value=await analyze('teammate-debuff-immunity',race);near(value.slowdown.assessedDistanceLossMin,normal.assessedDistanceLossMin);
  race=base();race.frames[204].runners[1].distance=null;value=await analyze('missing-blocker-geometry-withholds-subwindow',race);assert.ok(value.slowdown.coverageRate<normal.coverageRate);assert.equal(value.slowdown.distanceLossMin,null);
  race=base(10,6,19);value=await analyze('early-unresolved-mode-remains-unknown',race);assert.equal(value.slowdown.assessedDistanceLossMin,null);
  const mode=(kind:string,multiplier:number,start=10,end=16)=>({kind:`${kind}-model`,start,end,model:{speedMultiplier:multiplier,speedDelta:99}});
  value=await analyze('early-supported-speed-up',base(10,6,19),[mode('speed-up',1.04)]);const early=target(1,0);near(value.slowdown.assessedDistanceLossMin,loss(19,early.min+20*.04,acceleration,6));assert.equal(value.controlledMode,true);
  value=await analyze('early-supported-overtake',base(10,6,19),[mode('overtake',1.05)]);near(value.slowdown.assessedDistanceLossMin,loss(19,early.min+20*.05,acceleration,6));
  value=await analyze('early-supported-pace-up',base(10,6,19,3),[mode('pace-up',1.04)]);const lateStyle=target(3,0);near(value.slowdown.assessedDistanceLossMin,loss(19,lateStyle.min+20*.938*.04,acceleration*.975,6));
  value=await analyze('early-supported-pace-down',base(10,6,17,3),[mode('pace-down',.915)]);near(value.slowdown.assessedDistanceLossMax,loss(17,17+Math.sqrt(200*500)*.001,acceleration*.975,6));
  course.slopes=[{start:0,length:2000,slope:10000}];await writeFile(join(reference,'courses.json'),JSON.stringify({99994:course}));
  value=await analyze('mode-before-wit-terrain-and-skill-offsets',base(10,6,19),[mode('speed-up',1.04)]);near(value.slowdown.assessedDistanceLossMin,loss(19,early.min+20*.04-200/1200,acceleration*2/3,6));
  course.slopes=[];await writeFile(join(reference,'courses.json'),JSON.stringify({99994:course}));
  value=await analyze('conflicting-mode-scenarios-withheld',base(10,6,19),[mode('speed-up',1.04),mode('overtake',1.05)]);assert.equal(value.slowdown.assessedDistanceLossMin,null);
  value=await analyze('unsupported-mode-gap-not-joined',base(10,6,19),[mode('speed-up',1.04,10,12),mode('speed-up',1.04,14,16)]);assert.ok(value.slowdown.assessedDuration<4.01);assert.equal(value.slowdown.distanceLossMin,null);
  console.log(JSON.stringify({cases,integral:'passed',accelerationRamp:'passed',buffDebuffContext:'passed',controlledPaceContexts:'passed',unknownGapsWithheld:'passed',modeEvidence:'controlled-component-integration'}));
}
