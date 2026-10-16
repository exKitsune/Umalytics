import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { publicJson } from './scripts/public-json.mjs';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function analysisRevision(){
  const hash=createHash('sha256');
  const visit=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,entry.name);if(entry.isDirectory())visit(file);else if(/\.(ts|json)$/.test(file)){hash.update(file.replaceAll('\\','/'));hash.update(readFileSync(file));}}};
  visit('src/data');visit('src/analysis');hash.update(readFileSync('src/view-model.ts'));return hash.digest('hex');
}
const publicText=():Plugin=>({name:'generic-public-text',enforce:'post',renderChunk:{order:'post',handler(code){return {code:publicJson(code),map:null};}}});
export default defineConfig({
  define:{__ANALYSIS_REVISION__:JSON.stringify(analysisRevision())},
  plugins: [svelte(),publicText(),{name:'analysis-cache-revision',handleHotUpdate(context){
    if(/\/src\/(?:data\/|analysis\/|view-model\.ts$)/.test(context.file.replaceAll('\\','/'))){void context.server.restart();return [];}
  }}], worker:{plugins:()=>[publicText()]},base: './', server: { host: '127.0.0.1', strictPort: true, watch: { ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/.cache/**', '**/tmp-*/**', '**/artifacts/**', '**/research/**', '**/src-tauri/target/**'] } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.endsWith('/ui-icons.json')) return 'game-icons';
  } } } },
});
