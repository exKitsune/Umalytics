import type { PreparedRace } from './prepared';
export async function compressAnalysis(value:PreparedRace):Promise<Uint8Array> {
  const stream=new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function decompressAnalysis(bytes:Uint8Array):Promise<PreparedRace> {
  const stream=new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const value=JSON.parse(await new Response(stream).text());
  if(!Array.isArray(value?.race?.frames)||!Array.isArray(value.race.runners)||!value.analysis?.runners||!value.runners||value.race.runners.some((r:{id:string})=>!value.runners[r.id]?.totals||!value.runners[r.id]?.spurt))throw new Error('Saved analysis is incomplete.');
  return value;
}
export async function digest(value:string):Promise<string> {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
