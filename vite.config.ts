import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { publicJson } from './scripts/public-json.mjs';
export default defineConfig({
  plugins: [svelte(), {name:'generic-public-text', enforce:'post', renderChunk:{order:'post', handler(code){
    // Minifiers can expand source escapes; retain exact values without exposing
    // full external names in the published JavaScript source.
    return {code:publicJson(code), map:null};
  }}}], base: './', server: { host: '127.0.0.1', strictPort: true, watch: { ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/.cache/**', '**/tmp-*/**', '**/artifacts/**', '**/research/**', '**/src-tauri/target/**'] } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.endsWith('/ui-icons.json')) return 'game-icons';
  } } } },
});
