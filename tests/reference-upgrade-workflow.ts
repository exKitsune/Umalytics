// Real no-proxy service upgrades in disposable synthetic installations.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, realpath, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const folder=resolve(process.argv[2]),root=resolve(import.meta.dirname,'..');
const virtualenvPython=join(root,'.cache/proxy-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const python=process.env.UMALYTICS_TEST_PYTHON??(existsSync(virtualenvPython)?virtualenvPython:'python');
assert.equal(dirname(folder),resolve(tmpdir()));assert.ok(basename(folder).startsWith('umalytics-system-'));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const bundledDir=join(root,'public/data');
const bundledManifest=await readFile(join(bundledDir,'update-manifest.json'));
const manifest=JSON.parse(bundledManifest.toString()),bundledDigest=sha(bundledManifest);
const contents=new Map<string,Buffer>();
for(const name of Object.keys(manifest.files))contents.set(name,await readFile(join(bundledDir,name)));
const current=JSON.parse(contents.get('metadata.json')!.toString());
const skills=Object.values(current.skills) as Record<string,unknown>[];
assert.ok(skills.length>700);assert.ok(skills.every(skill=>'activateLot' in skill&&'iconId' in skill));
await mkdir(join(folder,'dist'),{recursive:true});await cp(bundledDir,join(folder,'dist/data'),{recursive:true});
await writeFile(join(folder,'dist/index.html'),'<!doctype html><title>Synthetic reference upgrade workflow</title>');
await mkdir(join(folder,'desktop'));
for(const name of ['build-info.json','update-public-key.txt'])await cp(join(root,'desktop',name),join(folder,'desktop',name));

async function seed(name:string,source:'bundled'|'repository',metadata:unknown,currentBundle=false){
  const install=join(folder,name),files=new Map(contents),modifiedManifest=structuredClone(manifest);
  files.set('metadata.json',Buffer.from(JSON.stringify(metadata)));
  for(const [file,raw]of files)modifiedManifest.files[file]={sha256:sha(raw),bytes:raw.length};
  const manifestBytes=Buffer.from(JSON.stringify(modifiedManifest)),digest=sha(manifestBytes),snapshot=join(install,'data',digest);
  await mkdir(snapshot,{recursive:true});await writeFile(join(snapshot,'update-manifest.json'),manifestBytes);
  for(const [file,raw]of files)await writeFile(join(snapshot,file),raw);
  const pointer=join(install,'data/active.json');
  await writeFile(pointer,JSON.stringify({source,manifestSha256:digest,...(currentBundle?{bundledManifestSha256:bundledDigest}:{}),updatedAt:'2001-01-01T00:00:00Z'}));
  return {install,snapshot,pointer,digest,files,manifestBytes};
}
async function migrated(saved:Awaited<ReturnType<typeof seed>>,expected:Map<string,Buffer>,expectedManifest:Buffer){
  assert.ok(!(await readdir(join(saved.install,'data'))).includes(saved.digest),'Verified generated snapshot was not cleaned.');
  assert.deepEqual(await readFile(join(saved.install,'data/update-manifest.json')),expectedManifest);
  for(const [name,bytes]of expected)assert.deepEqual(await readFile(join(saved.install,'data',name)),bytes);
}
async function pointerState(path:string){return {bytes:await readFile(path),mtime:(await stat(path,{bigint:true})).mtimeNs};}
async function serve(install:string,check:(get:(path:string)=>Promise<Response>)=>Promise<void>){
  const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));
  const port=(probe.address() as {port:number}).port;await new Promise<void>(done=>probe.close(()=>done()));
  const child=spawn(python,[join(root,'tests/desktop-service-fixture.py'),folder,String(process.pid),'--serve','--no-proxy','--port',String(port),'--data-dir',install],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='',health:any,primaryError:unknown;child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-4096));
  const base=`http://127.0.0.1:${port}`;
  const get=async(path:string)=>{const response=await fetch(base+path);assert.ok(response.ok,`HTTP ${response.status}`);return response;};
  const samePath=async()=>{const paths=await Promise.all([realpath(health.dataDirectory),realpath(install)]);return process.platform==='win32'?paths[0].toLowerCase()===paths[1].toLowerCase():paths[0]===paths[1];};
  try{
    for(let i=0;i<100;i++){try{health=await(await get('/api/health')).json();break;}catch{if(child.exitCode!==null)throw new Error('Synthetic reference service exited.');await new Promise(done=>setTimeout(done,100));}}
    if(!health)throw new Error(`Synthetic reference service did not become ready. ${stderr}`);
    assert.ok(await samePath());assert.equal(health.certificate.exists,false);assert.equal(health.proxy.running,false);assert.equal(health.proxy.state,'disabled');
    await check(get);
    assert.deepEqual(await readdir(join(install,'capture')),[]);
  }catch(error){primaryError=error;throw error;}finally{
    try{
      if(health&&await samePath())await fetch(base+'/api/app/exit',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'X-UmaTrace-CSRF':health.csrfToken},body:'{}'});
      await new Promise<void>((done,reject)=>{if(child.exitCode!==null){done();return;}child.once('exit',()=>done());setTimeout(()=>reject(new Error('Owned synthetic reference service did not exit.')),5000).unref();});
    }catch(error){if(child.exitCode===null){const stopped=new Promise<void>(done=>child.once('exit',()=>done()));child.kill();await stopped;}if(!primaryError)throw error;}
  }
}

let boots=0;
for(const scenario of [{name:'bundled',source:'bundled',field:'skills'},{name:'repository',source:'repository',field:'skills'},{name:'conditions',source:'repository',field:'conditions'},{name:'tags',source:'repository',field:'tags'}] as const){
  const old=structuredClone(current);
  if(scenario.field==='skills')for(const skill of Object.values(old.skills) as Record<string,unknown>[]){delete skill.activateLot;delete skill.iconId;}
  else if(scenario.field==='tags')for(const skill of Object.values(old.skills) as Record<string,unknown>[])delete skill.tagIds;
  else delete old.raceInstanceConditions;
  const saved=await seed('legacy-'+scenario.name,scenario.source,old);
  const check=async(get:(path:string)=>Promise<Response>)=>{
    boots++;const status=await(await get('/api/data/status')).json();assert.equal(status.source,'bundled');assert.equal(status.manifestSha256,bundledDigest);
    for(const [name,bytes]of contents)assert.deepEqual(Buffer.from(await(await get('/data/'+name)).arrayBuffer()),bytes);
    const served=await(await get('/data/metadata.json')).json();
    assert.deepEqual(served.raceInstanceConditions,current.raceInstanceConditions);
    assert.equal(Object.keys(served.skills).length,skills.length);assert.ok(Object.values(served.skills).every((skill:any)=>'activateLot' in skill&&'iconId' in skill));
  };
  await serve(saved.install,check);await migrated(saved,contents,bundledManifest);
  // An old mtime makes even a byte-identical rewrite on a fast restart visible.
  await utimes(saved.pointer,new Date('2002-01-01T00:00:00Z'),new Date('2002-01-01T00:00:00Z'));
  const before=await pointerState(saved.pointer);
  await serve(saved.install,check);assert.deepEqual(await pointerState(saved.pointer),before);await migrated(saved,contents,bundledManifest);
}
const repository=structuredClone(current),first=Object.keys(repository.skills)[0];
repository.skills[first].name='Synthetic repository skill';repository.skillNames[first]='Synthetic repository skill';
const saved=await seed('complete-repository','repository',repository,true);
let before:Awaited<ReturnType<typeof pointerState>>|undefined;
for(let i=0;i<2;i++){await serve(saved.install,async get=>{
  boots++;const status=await(await get('/api/data/status')).json();assert.equal(status.source,'repository');assert.equal(status.manifestSha256,saved.digest);
  assert.deepEqual(Buffer.from(await(await get('/data/metadata.json')).arrayBuffer()),saved.files.get('metadata.json'));
  assert.equal((await(await get('/data/metadata.json')).json()).skillNames[first],'Synthetic repository skill');
});
if(before)assert.deepEqual(await pointerState(saved.pointer),before);else before=await pointerState(saved.pointer);
await migrated(saved,saved.files,saved.manifestBytes);
}
assert.deepEqual(await readFile(join(bundledDir,'update-manifest.json')),bundledManifest);
console.log(JSON.stringify({serviceBoots:boots,skillDefinitions:skills.length,legacyBundledUpgrade:'passed',legacyRepositoryUpgrade:'passed',legacyConditionsUpgrade:'passed',legacyTagsUpgrade:'passed',snapshotBytes:'verified-active-copy',restartPointer:'unchanged',completeRepository:'preserved',certificateChanges:false}));
