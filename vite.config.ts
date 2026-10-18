import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { publicJson } from './scripts/public-json.mjs';
import { analysisRevision } from './scripts/analysis-revision.mjs';
const publicText=():Plugin=>({name:'generic-public-text',enforce:'post',renderChunk:{order:'post',handler(code){return {code:publicJson(code),map:null};}}});
export default defineConfig({
  define:{__ANALYSIS_REVISION__:JSON.stringify(analysisRevision())},
  plugins: [svelte(),publicText(),{name:'analysis-cache-revision',handleHotUpdate(context){
    if(/\/(?:src\/(?:data\/|analysis\/|simulation\/|components\/|replay\/|App\.svelte$|view-model\.ts$)|simulation\/engine-registry\.json$)/.test(context.file.replaceAll('\\','/'))){void context.server.restart();return [];}
  }}], worker:{plugins:()=>[publicText()]},base: './', server: { host: '127.0.0.1', strictPort: true, watch: { ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/.cache/**', '**/tmp-*/**', '**/artifacts/**', '**/research/**', '**/src-tauri/target/**'] } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.endsWith('/ui-icons.json')) return 'game-icons';
  } } } },
});
