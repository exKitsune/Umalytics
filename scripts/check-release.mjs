// The same source checks run locally and in Actions. Packaging smoke tests
// still run against the actual release executable in the Windows job.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';

let group,python=process.env.UMALYTICS_CHECK_PYTHON??'python',staged=false;
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--group')group=process.argv[++i];
  else if(arg==='--python')python=process.argv[++i];
  else if(arg==='--staged')staged=true;
  else throw new Error(`Unknown option: ${arg}`);
}
if(!python)throw new Error('--python needs an executable.');
const py=(...args)=>[python,args];
const npmCli=process.env.npm_execpath??[
  join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
  join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),
  join(dirname(process.execPath),'npm'),
].filter(existsSync).map(path=>realpathSync(path)).find(path=>path.endsWith('.js'));
const npm=(...args)=>{
  if(!npmCli)throw new Error('npm CLI unavailable beside Node. Run this command through npm.');
  return [process.execPath,[npmCli,...args]];
};
const files=names=>names.map(name=>py(`tests/${name}.py`));
const groups={
  frontend:[npm('run','build'),npm('run','build:inference'),py('scripts/audit-public-files.py','--dist')],
  inputs:[py('scripts/audit-public-files.py',...(staged?['--staged']:[])),...files(['public-inventory-workflow']),py('desktop/generate_manifest.py','--check'),...files(['history-retirement-workflow','simulator-checkout-workflow','simulator-source-workflow','source-package-workflow'])],
  system:[npm('test')],
  compatibility:[py('-m','unittest','discover','-s','tests/globalsim','-p','test_*.py'),[process.execPath,['tests/globalsim/test_contracts.mjs','--python',python]],...files(['launcher-identity-workflow'])],
  'windows-service':files(['app-components-workflow','updater/test_release_flow','portable-storage-workflow']),
  'windows-handoff':files(['frozen-handoff-workflow']),
  'windows-capture':files(['proxy-envelope-workflow','local-catalog-workflow','debug-controls-workflow','debug-writer-workflow','saved-data-workflow','root-constraints-workflow','capture-identity-workflow','capture-inspection-workflow']),
};
if(group&&!Object.hasOwn(groups,group))throw new Error(`Unknown check group: ${group}`);
const selected=group?[group]:Object.keys(groups).filter(name=>process.platform==='win32'||!name.startsWith('windows-'));
for(const name of selected){
  if(name.startsWith('windows-')&&process.platform!=='win32')throw new Error(`${name} requires Windows.`);
  for(const [command,args] of groups[name]){
    console.log(`[release checks: ${name}] ${args.join(' ')}`);
    const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true,shell:false});
    if(result.error)throw result.error;
    if(result.status!==0){console.error(`Release checks failed in ${name}: ${args.join(' ')}`);process.exit(result.status??1);}
  }
  if(name==='frontend'&&!readFileSync('public/data/update-manifest.json').equals(readFileSync('dist/data/update-manifest.json')))
    throw new Error('Bundled reference manifest differs from its source.');
}
console.log(`Release checks passed: ${selected.join(', ')}.`);
