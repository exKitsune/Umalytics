import { publicJson } from './public-json.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { conditionCoverage } from '../src/data/skill-conditions';
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.slice(2).length!==2) throw new Error('Usage: node --import tsx scripts/report-condition-coverage.ts <public metadata.json> <report.json>');
if(resolve(input).toLowerCase()===resolve(output).toLowerCase())throw new Error('Report output must differ from the metadata input.');
const metadata = JSON.parse(await readFile(resolve(input), 'utf8'));
const coverage=conditionCoverage(metadata);
const audit=JSON.parse(await readFile(new URL('../docs/gametora-condition-audit.json',import.meta.url),'utf8'));
const reviewed=new Map<string,{key:string;reviewed:boolean;sectionSha256:string;reviewNote?:string}>(audit.keys.map((k:any)=>[k.key,k]));
const report = { schemaVersion: 1, source: metadata.source, ...coverage,
  conditionReference:{...audit.source,reviewedKeys:coverage.keys.filter(k=>reviewed.has(k.key)).length,unreviewedKeys:coverage.keys.filter(k=>!reviewed.has(k.key)).map(k=>k.key)},
  keys:coverage.keys.map(k=>({...k,gametora:reviewed.has(k.key)?{...reviewed.get(k.key),url:audit.source.url,reviewedOn:audit.source.reviewedOn}:null})) };
await writeFile(resolve(output), publicJson(JSON.stringify(report, null, 2)) + '\n');
const { keys, ...summary } = report; console.log(publicJson(JSON.stringify(summary)));
