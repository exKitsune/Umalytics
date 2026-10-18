import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
const original=globalThis.fetch;
globalThis.fetch=(url,options={})=>original(new URL(url,workerData.url),{...options,headers:{...options.headers,Origin:workerData.url}});
globalThis.self=globalThis;
self.postMessage=(message,options)=>parentPort.postMessage(message,options?.transfer);
await import(pathToFileURL(workerData.artifact).href);
parentPort.on('message',data=>self.onmessage({data}));
