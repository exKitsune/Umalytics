/* Binary layout adapted from SSHZ.ORG replay reference src/data/RaceDataParser.ts.
 * Copyright (c) 2021 SSHZ.ORG, MIT; see THIRD_PARTY_LICENSE.txt.
 * This is an offline decoder, not a description of current network encryption. */
import { Inflate } from 'pako';

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
export const MAX_RUNNERS = 64;
export const MAX_FRAMES = 100_000;
export const MAX_SAMPLES = 1_000_000;

export interface BinarySample { distance: number; speed: number; hp: number; lane: number; temptationMode: number; blockFrontRunnerIndex: number | null }
export interface BinaryRace {
  frames: { time: number; samples: BinarySample[] }[];
  results: { finishOrder: number | null; finishTime: number | null; finishTimeRaw: number | null; startDelay: number | null; finishGap: number | null; lastSpurtDistance: number | null; strategy: number; gutsOrder: number; wisdomOrder: number; defeatFlags: number }[];
  events: { time: number; type: number; params: number[] }[];
  runnerCount: number;
  warnings: string[];
}

export function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/\s/g, '');
  if (!clean || clean.length > MAX_FILE_BYTES * 4 / 3 + 4 || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('Invalid or oversized base64 race payload. Export the complete decoded response again.');
  }
  try { return Uint8Array.from(atob(clean), c => c.charCodeAt(0)); }
  catch { throw new Error('Invalid base64 race payload. Export the complete decoded response again.'); }
}

function inflateBounded(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  const inflater = new Inflate({ chunkSize: 64 * 1024 });
  const originalOnEnd = inflater.onEnd.bind(inflater);
  inflater.onEnd = status => { complete = status === 0; originalOnEnd(status); };
  inflater.onData = (chunk: Uint8Array) => {
    total += chunk.byteLength;
    if (total > MAX_DECODED_BYTES) throw new Error('Decompressed race exceeds the 128 MB safety limit.');
    chunks.push(chunk);
  };
  try {
    inflater.push(bytes, true);
    if (inflater.err || !complete) throw new Error(inflater.msg || 'incomplete compressed stream');
  } catch (error) {
    throw new Error(`Cannot inflate race scenario: ${error instanceof Error ? error.message : String(error)}. Expected a complete base64 zlib/gzip payload.`);
  }
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

/** Strict decoder for the length-prefixed replay layout.
 * New layouts are deliberately rejected rather than guessed from plausible floats. */
export function parseScenario(base64: string): BinaryRace {
  const bytes = inflateBounded(base64Bytes(base64));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  const fail = (detail: string): never => { throw new Error(`Unsupported or damaged race scenario at byte ${cursor}: ${detail}. This viewer supports the length-prefixed Global layout; JP/new layouts may differ.`); };
  const need = (size: number) => { if (!Number.isSafeInteger(size) || size < 0 || cursor + size > view.byteLength) fail(`need ${size} bytes, only ${view.byteLength - cursor} remain`); };
  const i32 = () => { need(4); const n = view.getInt32(cursor, true); cursor += 4; return n; };
  const f32 = () => { need(4); const n = view.getFloat32(cursor, true); cursor += 4; if (!Number.isFinite(n)) fail('non-finite float'); return n; };
  const skip = (n: number) => { need(n); cursor += n; };
  const padding = () => { const n = i32(); if (n < 0) fail('negative padding length'); skip(n); };
  const headerSize = i32();
  if (headerSize < 4 || headerSize > 4096) fail(`invalid header length ${headerSize}`);
  i32(); // Header version is retained by upstream but has no published compatibility table.
  skip(headerSize - 4);
  f32(); // distanceDiffMax is not the course distance.
  const runnerCount = i32();
  const horseFrameSize = i32();
  const horseResultSize = i32();
  if (runnerCount < 1 || runnerCount > MAX_RUNNERS) fail(`invalid runner count ${runnerCount}`);
  if (horseFrameSize < 12 || horseFrameSize > 4096) fail(`invalid horse frame size ${horseFrameSize}`);
  if (horseResultSize < 31 || horseResultSize > 65536) fail(`invalid horse result size ${horseResultSize}`);
  padding();
  const frameCount = i32();
  const frameSize = i32();
  if (frameCount < 1 || frameCount > MAX_FRAMES || frameCount * runnerCount > MAX_SAMPLES) fail(`invalid/excessive frame count ${frameCount}`);
  if (frameSize < 4 + runnerCount * horseFrameSize) fail('frame stride is smaller than its runner records');
  need(frameSize * frameCount);
  const frames: BinaryRace['frames'] = [];
  let lastTime = -Infinity;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const start = cursor;
    const time = f32();
    if (time < 0 || time > 3600 || time <= lastTime) fail('frame times must be finite, nonnegative and strictly increasing');
    lastTime = time;
    const samples: BinarySample[] = [];
    for (let index = 0; index < runnerCount; index++) {
      const horseStart = cursor;
      const distance = f32();
      if (distance < -100 || distance > 100_000) fail('implausible distance');
      const lane = view.getUint16(cursor, true) / 10000;
      const speed = view.getUint16(cursor + 2, true) / 100;
      const hp = view.getUint16(cursor + 4, true);
      const temptationMode = view.getInt8(horseStart + 10);
      const blockIndex = view.getInt8(horseStart + 11);
      const blockFrontRunnerIndex = blockIndex >= -1 && blockIndex < runnerCount ? blockIndex : null;
      samples.push({ distance, lane, speed, hp, temptationMode, blockFrontRunnerIndex });
      cursor = horseStart + horseFrameSize;
    }
    cursor = start + frameSize;
    frames.push({ time, samples });
  }
  padding();
  need(runnerCount * horseResultSize);
  const results: BinaryRace['results'] = [];
  for (let index = 0; index < runnerCount; index++) {
    const start = cursor;
    const finishOrder = i32();
    const finishTime = f32();
    const finishGap = f32();
    const startDelay = f32();
    cursor = start + 18;
    const lastSpurtDistance = f32();
    const strategy = view.getUint8(start + 22);
    cursor = start + 27;
    const finishTimeRaw = f32();
    results.push({ finishOrder: finishOrder >= 0 && finishOrder < runnerCount ? finishOrder + 1 : null, finishTime: finishTime > 0 ? finishTime : null,
      finishTimeRaw: finishTimeRaw > 0 ? finishTimeRaw : null, finishGap: finishGap >= 0 ? finishGap : null,
      startDelay: startDelay >= 0 ? startDelay : null, lastSpurtDistance: lastSpurtDistance >= -1 ? lastSpurtDistance : null, strategy,
      gutsOrder: view.getUint8(start + 16), wisdomOrder: view.getUint8(start + 17), defeatFlags: view.getInt32(start + 23, true) });
    cursor = start + horseResultSize;
  }
  padding();
  const eventCount = i32();
  if (eventCount < 0 || eventCount > 100_000) fail(`invalid event count ${eventCount}`);
  const events: BinaryRace['events'] = [];
  for (let index = 0; index < eventCount; index++) {
    need(2);
    const size = view.getInt16(cursor, true); cursor += 2;
    if (size < 6) fail('event record is shorter than its header');
    need(size);
    const start = cursor;
    const time = f32();
    const type = view.getInt8(cursor);
    const paramCount = view.getInt8(cursor + 1);
    cursor += 2;
    if (time < 0 || time > 3600 || paramCount < 0 || 6 + paramCount * 4 > size) fail('invalid event parameters');
    const params = Array.from({ length: paramCount }, i32);
    events.push({ time, type, params });
    cursor = start + size;
  }
  const warnings = cursor < bytes.length ? [`${bytes.length - cursor} trailing scenario bytes were not interpreted.`] : [];
  if (horseFrameSize !== 12 || horseResultSize !== 31) warnings.push('Extended record fields were skipped; only the documented core telemetry was decoded.');
  return { frames, results, events, runnerCount, warnings };
}
