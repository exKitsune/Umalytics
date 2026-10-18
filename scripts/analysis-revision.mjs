import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function analysisRevision(){
  const hash=createHash('sha256');
  const visit=path=>{for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,entry.name);if(entry.isDirectory())visit(file);else if(/\.(ts|json|svelte)$/.test(file)){hash.update(file.replaceAll('\\','/'));hash.update(readFileSync(file));}}};
  visit('src/data');visit('src/analysis');visit('src/simulation');
  visit('src/components');visit('src/replay');hash.update(readFileSync('src/App.svelte'));
  hash.update(readFileSync('src/view-model.ts'));hash.update(readFileSync('simulation/engine-registry.json'));
  return hash.digest('hex');
}
