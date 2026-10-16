import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { importRace } from '../src/data/index.ts';
import { toPortableRace } from '../src/data/share.ts';

// Offline conversion only: no HTTP client, bot runtime, or game process access.
const args = process.argv.slice(2);
if (!args[0] || args.length > 2 || args[0] === '--help') {
  console.log('Usage: npm run import:race -- <decoded JSON, JSONL, HAR, or MessagePack> [output-folder]');
  console.log('Defaults to captures/inbox. Reads an existing file and writes race-only JSON.');
  process.exitCode = args[0] === '--help' ? 0 : 1;
} else {
  try {
    const source = resolve(args[0]), destination = resolve(args[1] ?? 'captures/inbox');
    const info = await stat(source);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Input must be a file no larger than 64 MiB.');
    const bytes = await readFile(source);
    const races = await importRace(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, basename(source));
    // The bridge intentionally reads one JSON document at a time. Keep multiple
    // races together so its latest-file poll cannot skip earlier sibling files.
    const data = races.map(toPortableRace);
    const output = JSON.stringify(data.length === 1 ? data[0] : data);
    if (Buffer.byteLength(output) > 16 * 1024 * 1024) throw new Error('Normalized output exceeds the local bridge limit of 16 MiB. Import the original file in the browser instead.');
    await mkdir(destination, { recursive: true });
    const name = `race-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const temporary = join(destination, `${name}.partial`), target = join(destination, `${name}.json`);
    await writeFile(temporary, output, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
    console.log(`Extracted ${races.length} race(s) to ${target}`);
    console.log('Account/session fields excluded. Runner names and event labels remain; review before sharing.');
  } catch (error) {
    console.error(`Race import failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
