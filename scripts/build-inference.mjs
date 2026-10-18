// Build an immutable implementation/data snapshot without declaring era support.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { analysisRevision } from './analysis-revision.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result=await build({absWorkingDir:process.cwd(),entryPoints:['./src/analysis/version-worker.ts'],tsconfigRaw:{compilerOptions:{target:'ES2022'}},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,metafile:true});
const artifact=result.outputFiles[0].contents,artifactHash=sha(artifact);
const read=async name=>JSON.parse(await readFile(`public/data/${name}.json`,'utf8'));
const data=Buffer.from(JSON.stringify({metadata:await read('metadata'),courses:await read('courses'),source:await read('reference-source'),skillIds:await read('simulator-skill-ids'),geometry:await read('course-geometry')}));
const dataHash=sha(data),engineId=`umalytics-inference-${artifactHash.slice(0,16)}-${dataHash.slice(0,16)}`;
const directory=`simulation/bundles/${engineId}`;
await mkdir(directory,{recursive:true});
await writeFile(`${directory}/worker.mjs`,artifact);await writeFile(`${directory}/data.json`,data);
const sourceFiles={};for(const path of Object.keys(result.metafile.inputs).sort())sourceFiles[path]=sha(await readFile(path));
await writeFile(`${directory}/build.json`,JSON.stringify({schemaVersion:1,artifactSha256:artifactHash,dataSha256:dataHash,sourceFiles},null,2));
let manifest;try{manifest=JSON.parse(await readFile('simulation/installed-bundles.json','utf8'));}catch{manifest={schemaVersion:1,bundles:[]};}
const row={kind:'inference',engine_id:engineId,version:engineId,profile:'umalytics-prepared-v1',artifact_sha256:artifactHash,data_sha256:dataHash,
  artifact:`${directory}/worker.mjs`,data:`${directory}/data.json`,uiRevision:analysisRevision()};
manifest.bundles=manifest.bundles.filter(item=>item.engine_id!==engineId);manifest.bundles.push(row);
await writeFile('simulation/installed-bundles.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(row,null,2));
