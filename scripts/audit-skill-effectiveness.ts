import { publicJson } from './public-json.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {ReferenceMetadata,SkillReference} from '../src/data/reference';
import {skillEffectDefinitions,valueUsageDefinitions,durationUsageDefinitions,additionalActivationDefinitions,localEffectTypes,initialContextEffectTypes,unknownCalculation} from '../src/data/skill-effect-catalog';
import {readReferenceBytes,referenceDirectory,runCli} from './offline-analysis.ts';
const args=process.argv.slice(2),[output,option,directory]=args;
if(!output || !(args.length===1||args.length===3) || (option!==undefined && (option!=='--reference-dir'||!directory))){
  console.error('Usage: node --import tsx scripts/audit-skill-effectiveness.ts <output.json> [--reference-dir <folder>]');process.exitCode=1;
}else await runCli('Skill audit failed',async()=>{
  const input=resolve(referenceDirectory(directory),'metadata.json');
  if(resolve(output).toLowerCase()===input.toLowerCase())throw new Error('Audit output must not replace its source metadata.');
  const bytes=await readReferenceBytes(directory,'metadata.json'),metadata:ReferenceMetadata=JSON.parse(bytes.toString('utf8'));
  type Effect=SkillReference['branches'][number]['effects'][number];
  const occurrences:{skillId:number;branchId:string;effect:Effect}[]=[],branches:any[]=[];
  const classification:Record<string,number>={};
  for(const [sid,skill] of Object.entries(metadata.skills).sort(([a],[b])=>Number(a)-Number(b)))for(const [i,branch] of skill.branches.entries()){
    const branchIndex=branch.branchIndex??i,branchId=`${sid}:${branchIndex}`;
    const effectTypes=[...new Set(branch.effects.map(e=>e.type))].sort((a,b)=>a-b);
    const magnitudeSupported=branch.effects.every(e=>e.valueUsage===1&&e.levelUsage===1&&(e.additionalActivateType??0)===0);
    const candidate=branch.effects.length>0&&magnitudeSupported&&effectTypes.every(t=>localEffectTypes.has(t));
    const status=candidate?'local-effect-formula-candidate':branch.rawDuration<0&&effectTypes.length>0&&effectTypes.every(t=>initialContextEffectTypes.has(t))?'initial-context-only':'partial-or-unsupported';
    classification[status]=(classification[status]??0)+1;
    const gaps:string[]=[];
    if(!magnitudeSupported)gaps.push('Dynamic magnitude/level/additional-trigger context required.');
    if(branch.rawDuration>0&&branch.durationUsage!==1)gaps.push('Missing replay end requires conditional duration context.');
    if(branch.effects.some(e=>(e.targetType??1)!==1))gaps.push('Recorded recipient mask and team immunity required; geometric targets are not hits.');
    if(effectTypes.some(t=>!skillEffectDefinitions[t]))gaps.push('Unknown effect type retained explicitly.');
    if(effectTypes.some(t=>!localEffectTypes.has(t)))gaps.push('This branch has effects outside the local movement/HP evaluator.');
    branches.push({skillId:Number(sid),name:skill.name,branchIndex,effectTypes,status,directMagnitudeEncodingSupported:magnitudeSupported,
      timing:{rawDuration:branch.rawDuration,durationUsage:branch.durationUsage,referenceFallback:branch.rawDuration>0&&branch.durationUsage===1?'direct-distance-scaled-candidate':branch.rawDuration<0?'passive':branch.rawDuration===0?'effect-specific-instant-or-unsupported':'conditional-unresolved'},
      effects:branch.effects.map(e=>({type:e.type,rawValue:e.rawValue,valueUsage:e.valueUsage,levelUsage:e.levelUsage,targetType:e.targetType??1,targetValue:e.targetValue??0,additionalActivateType:e.additionalActivateType??0,
        formulaState:skillEffectDefinitions[e.type]?.formulaState??'unverified',currentMetric:skillEffectDefinitions[e.type]?.implementation??'unsupported',directValueEncodingSupported:e.valueUsage===1&&e.levelUsage===1&&(e.additionalActivateType??0)===0})),unresolvedInputs:gaps});
    for(const effect of branch.effects)occurrences.push({skillId:Number(sid),branchId,effect});
  }
  const unique=<T>(v:T[])=>[...new Set(v)];
  function inventory(key:'type'|'valueUsage'|'levelUsage'|'targetType'|'additionalActivateType',definitions:typeof skillEffectDefinitions){
    return unique(occurrences.map(o=>o.effect[key]??(key==='targetType'?1:0))).sort((a,b)=>a-b).map(code=>{
      const rows=occurrences.filter(o=>(o.effect[key]??(key==='targetType'?1:0))===code);
      return {code,effectRecords:rows.length,skillCount:unique(rows.map(r=>r.skillId)).length,branchCount:unique(rows.map(r=>r.branchId)).length,skillIds:unique(rows.map(r=>r.skillId)).sort((a,b)=>a-b),branchIds:unique(rows.map(r=>r.branchId)),
        calculation:definitions[code]??unknownCalculation(`${key}${code}`)};
    });
  }
  const patterns=new Map<string,{pattern:number[];effectRecords:number;skillIds:Set<number>;branchIds:Set<string>}>();
  for(const o of occurrences){const e=o.effect,pattern=[e.type,e.valueUsage,e.levelUsage,e.targetType??1,e.additionalActivateType??0],key=pattern.join(':');const row=patterns.get(key)??{pattern,effectRecords:0,skillIds:new Set(),branchIds:new Set()};row.effectRecords++;row.skillIds.add(o.skillId);row.branchIds.add(o.branchId);patterns.set(key,row);}
  const durationCodes=unique(branches.map(b=>b.timing.durationUsage as number)).sort((a,b)=>a-b);
  const effects=inventory('type',skillEffectDefinitions);
  // The application loads fallback definitions too. Audit the same precedence,
  // while keeping the original primary catalog inventory independently visible.
  const fallbackSkills=(metadata as ReferenceMetadata&{fallback?:{skills?:Record<string,SkillReference>}}).fallback?.skills??{};
  const mergedSkills={...fallbackSkills,...metadata.skills};
  const mergedRows=Object.entries(mergedSkills).flatMap(([id,skill])=>skill.branches.flatMap((branch,index)=>branch.effects.map(effect=>({skillId:Number(id),branchIndex:branch.branchIndex??index,branch,effect}))));
  const mergedInventory=(key:'type'|'valueUsage'|'levelUsage'|'additionalActivateType',definitions:typeof skillEffectDefinitions)=>{
    const codes=unique(mergedRows.map(r=>r.effect[key]??0)).sort((a,b)=>a-b);
    return codes.map(code=>{const rows=mergedRows.filter(r=>(r.effect[key]??0)===code);return {code,effectRecords:rows.length,skillIds:unique(rows.map(r=>r.skillId)).sort((a,b)=>a-b),known:!!definitions[code],implementation:definitions[code]?.implementation??'unsupported'};});
  };
  const fallbackCoverage={fallbackSkills:Object.keys(fallbackSkills).length,effectiveSkills:Object.keys(mergedSkills).length,precedence:'Primary definition wins; fallback supplies missing IDs.',
    effectTypes:mergedInventory('type',skillEffectDefinitions),valueUsages:mergedInventory('valueUsage',valueUsageDefinitions),levelUsages:mergedInventory('levelUsage',{1:valueUsageDefinitions[1]}),additionalActivations:mergedInventory('additionalActivateType',additionalActivationDefinitions),
    durationUsages:unique(mergedRows.map(r=>r.branch.durationUsage)).sort((a,b)=>a-b).map(code=>({code,known:!!durationUsageDefinitions[code],skillIds:unique(mergedRows.filter(r=>r.branch.durationUsage===code).map(r=>r.skillId)).sort((a,b)=>a-b)}))};
  const report={schemaVersion:1,scope:'All bundled localized installed Global skill definitions, including inherited and event-only records. Declaration/formula coverage; not achieved per-race coverage.',
    source:{metadataSha256:createHash('sha256').update(bytes).digest('hex'),master:metadata.source,mechanics:{name:'Race Mechanics notes',author:'KuromiAK',sha256:'fb63c86215a4f06fadcca2cca6d4f5bbf5e5d399a9bb955c2b2382c8f7e9649b'},simulator:{repository:'https://github.com/kachi-dev/uma-tools',revision:'4401e259',qualification:'Independent reference implementation; not native runtime call trace.'}},
    totals:{skills:Object.keys(metadata.skills).length,branches:branches.length,effectRecords:occurrences.length,effectTypes:effects.length,directMagnitudeEffectRecords:occurrences.filter(o=>o.effect.valueUsage===1&&o.effect.levelUsage===1&&(o.effect.additionalActivateType??0)===0).length,nonDirectMagnitudeEffectRecords:occurrences.filter(o=>o.effect.valueUsage!==1||o.effect.levelUsage!==1||(o.effect.additionalActivateType??0)!==0).length,branchClassification:classification},fallbackCoverage,
    methodology:{formula:'Separate semantic/formula understanding from implemented replay metric and required observations.',directEncoding:'Direct value encoding support describes the current value normalizer only; it does not establish effect semantics or per-race magnitude for unknown/event-only types.',branchCandidates:'A formula-candidate branch uses only 9/21/22/27/31 with direct magnitudes; its duration, level, target, samples, immunity and mechanics context can still be unknown.',initialContext:'Initial passive/stat/vision/style inputs are modelled elsewhere, not per-skill race effectiveness.',applicability:'Positive target-speed score uses zero/half/full credited time by user convention; acceleration and direct-speed rows retain separate applicability metrics. None is exact causal race gain.',causality:'No universal percentage or exact finish gain is identifiable for every skill. Type-specific model metrics and partial/unknown coverage remain separate. Do not sum overlapping nonlinear marginal effects.',unsupported:'All unknown codes are retained with unverified/unsupported state. No missing formula becomes zero effectiveness.'},
    effectTypes:effects,valueUsages:inventory('valueUsage',valueUsageDefinitions),levelUsages:inventory('levelUsage',{1:valueUsageDefinitions[1]}),additionalActivations:inventory('additionalActivateType',additionalActivationDefinitions),
    durationUsages:durationCodes.map(code=>{const rows=branches.filter(b=>b.timing.durationUsage===code);return{code,branches:rows.length,skillIds:unique(rows.map(b=>b.skillId)).sort((a,b)=>a-b),branchIds:rows.map(b=>`${b.skillId}:${b.branchIndex}`),calculation:durationUsageDefinitions[code]??unknownCalculation(`Duration${code}`)};}),
    targetTypes:unique(occurrences.map(o=>o.effect.targetType??1)).sort((a,b)=>a-b).map(code=>{const rows=occurrences.filter(o=>(o.effect.targetType??1)===code);return{code,effectRecords:rows.length,skillIds:unique(rows.map(r=>r.skillId)).sort((a,b)=>a-b),selectionEvidence:code===1?'Self target.':'Use recorded recipient mask; geometric target enum alone does not establish applied effect or immunity.'};}),
    patterns:[...patterns.values()].sort((a,b)=>a.pattern.join(':').localeCompare(b.pattern.join(':'))).map(p=>({type:p.pattern[0],valueUsage:p.pattern[1],levelUsage:p.pattern[2],targetType:p.pattern[3],additionalActivateType:p.pattern[4],effectRecords:p.effectRecords,skillIds:[...p.skillIds].sort((a,b)=>a-b),branchIds:[...p.branchIds]})),branches,
    unknownCodes:{effectTypes:effects.filter(e=>!skillEffectDefinitions[e.code]).map(e=>e.code),valueUsages:unique(occurrences.map(o=>o.effect.valueUsage)).filter(c=>!valueUsageDefinitions[c]),durationUsages:durationCodes.filter(c=>!durationUsageDefinitions[c]),levelUsages:unique(occurrences.map(o=>o.effect.levelUsage)).filter(c=>c!==1),additionalActivations:unique(occurrences.map(o=>o.effect.additionalActivateType??0)).filter(c=>!additionalActivationDefinitions[c])},
  };
  await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(resolve(output),publicJson(JSON.stringify(report,null,2))+'\n');
  console.log(JSON.stringify({output:output,totals:report.totals,unknownCodes:report.unknownCodes,qualification:'Branch/formula coverage only; no per-race effectiveness claim.'}));
});
