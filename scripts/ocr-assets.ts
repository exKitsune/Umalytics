import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';
/** Vendored from lockfile-installed packages. No runtime CDN requests. */
export function ocrAssets():Plugin {
  const files:Record<string,string>={'worker.min.js':'tesseract.js/dist/worker.min.js','eng.traineddata.gz':'@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'};
  // Ship binary WASM separately: smaller than the base64-inlined wrappers and
  // keeps the normal public text audit applicable to JavaScript assets.
  for(const variant of ['lstm','simd-lstm','relaxedsimd-lstm']){
    files[`tesseract-core-${variant}.wasm.js`]=`tesseract.js-core/tesseract-core-${variant}.js`;
    files[`tesseract-core-${variant}.wasm`]=`tesseract.js-core/tesseract-core-${variant}.wasm`;
  }
  files['CORE-LICENSE.txt']='tesseract.js-core/LICENSE';
  files['TESSERACT-LICENSE.txt']='tesseract.js/LICENSE.md';
  const entries=()=>Object.entries(files).map(([name,file])=>({name:`ocr/${name}`,data:readFileSync(resolve('node_modules',file))}));
  return {name:'offline-screenshot-ocr',generateBundle(){for(const {name,data} of entries())this.emitFile({type:'asset',fileName:name,source:data});},
    configureServer(server){const assets=new Map(entries().map(e=>[`/${e.name}`,e.data]));server.middlewares.use((req,res,next)=>{const path=req.url?.split('?')[0],data=path&&assets.get(path);if(!data)return next();res.setHeader('Content-Type',path!.endsWith('.js')?'text/javascript':path!.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(data);});}};
}
