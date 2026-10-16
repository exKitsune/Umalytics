import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const runFile = promisify(execFile);

export async function findWiresharkTool(name) {
  const candidates = process.platform === 'win32'
    ? [join('E:\\Program Files\\Wireshark', `${name}.exe`),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'Wireshark', `${name}.exe`),
      `${name}.exe`]
    : [name];
  for (const executable of [...new Set(candidates)]) {
    try {
      const { stdout } = await runFile(executable, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 });
      return { executable, version: stdout.split(/\r?\n/)[0] };
    } catch { /* Try the next installed location. */ }
  }
  return null;
}
