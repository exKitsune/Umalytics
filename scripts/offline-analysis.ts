import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importRace } from '../src/data/import.ts';
import { assembleReferenceData, type ReferenceData } from '../src/data/reference.ts';
import { readGeometry } from '../src/data/geometry.ts';

export function referenceDirectory(override?: string): string {
  return override ? resolve(override) : fileURLToPath(new URL('../public/data/', import.meta.url));
}

export async function readReferenceBytes(override: string | undefined, name: string) {
  return readFile(resolve(referenceDirectory(override), name));
}

async function readJson(override: string | undefined, name: string) {
  return JSON.parse((await readReferenceBytes(override, name)).toString('utf8'));
}

/** Load the offline catalog once. A custom directory may omit simulator ids;
 * missing course geometry stays absent instead of failing the whole load. */
export async function loadReference(override?: string): Promise<ReferenceData> {
  const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
  const [metadata, courses, source, ids, geometry] = await Promise.all([
    readJson(override, 'metadata.json'),
    readJson(override, 'courses.json'),
    readJson(override, 'reference-source.json'),
    readJson(override, 'simulator-skill-ids.json').catch(error => {
      if (override && missing(error)) return [];
      throw error;
    }),
    readJson(override, 'course-geometry.json').then(readGeometry).catch(error => {
      if (missing(error)) return null;
      throw error;
    }),
  ]);
  return assembleReferenceData(metadata, courses, source, ids, geometry);
}

export async function importRaceFile(input: string) {
  const path = resolve(input);
  const bytes = await readFile(path);
  return importRace(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, basename(path));
}

export async function runCli(label: string, work: () => Promise<void>) {
  try { await work(); }
  catch (error) { console.error(`${label}: ${(error as Error).message}`); process.exitCode = 1; }
}
