// Run the browser worker unchanged in an isolated Node worker for system tests.
import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';
register();
globalThis.self={postMessage:(message,options)=>parentPort.postMessage(message,options?.transfer)};
await import('../src/analysis/worker.ts');
parentPort.on('message',data=>self.onmessage({data}));
