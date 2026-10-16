/** Package exact, pinned upstream PNG bytes as local UI assets. No image transforms. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const revision='4401e25987d9c78707f2d3f8a9dcd02c1c56529c';
const root=resolve(import.meta.dirname,'..');
const sourceIndex=process.argv.indexOf('--source');
if(sourceIndex<0||!process.argv[sourceIndex+1])throw new Error('Usage: node scripts/build-ui-icons.mjs --source <uma-tools-checkout>');
const source=resolve(process.argv[sourceIndex+1]);
const metadata=JSON.parse(await readFile(join(root,'public/data/metadata.json'),'utf8'));
const choices={};
for(const [i,name] of ['speed','stamina','power','guts','wisdom'].entries())choices[`stat-${name}`]=`icons/status_0${i}.png`;
for(let i=0;i<5;i++)choices[`mood-${i+1}`]=`icons/global/utx_ico_motivation_m_0${i}.png`;
for(const [i,name] of ['G','F','E','D','C','B','A','S'].entries())choices[`rank-${name}`]=`icons/utx_ico_statusrank_0${i}.png`;
for(let i=0;i<4;i++){
  choices[`weather-${i+1}`]=`icons/utx_ico_weather_0${i}.png`;
  choices[`season-${i+1}`]=`icons/global/utx_txt_season_0${i}.png`;
}
for(const id of new Set(Object.values(metadata.skills).map(skill=>skill.iconId).filter(Number.isSafeInteger)))choices[`skill-${id}`]=`icons/${id}.png`;
const images={},records=[];
for(const [key,path] of Object.entries(choices).sort(([a],[b])=>a.localeCompare(b))){
  const raw=await readFile(join(source,path));
  if(raw.length>256*1024||raw.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error(`Invalid PNG: ${path}`);
  const blob=createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
  const expected=execFileSync('git',['-C',source,'rev-parse',`${revision}:${path}`],{encoding:'utf8',windowsHide:true}).trim();
  if(blob!==expected)throw new Error(`Source differs from pinned revision: ${path}`);
  images[key]=`data:image/png;base64,${raw.toString('base64')}`;
  records.push({key,path,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length,width:raw.readUInt32BE(16),height:raw.readUInt32BE(20)});
}
const output=join(root,'src/data/ui-icons.json');
await writeFile(output,JSON.stringify(images)+'\n');
await mkdir(join(root,'public/icons'),{recursive:true});
await writeFile(join(root,'public/icons/source.json'),JSON.stringify({repository:'https://github.com/kachi-dev/uma-tools',revision,encoding:'Unchanged PNG bytes in data URLs; no image transforms',records},null,2)+'\n');
console.log(`Packaged ${records.length} icons (${(await readFile(output)).length} bytes).`);
