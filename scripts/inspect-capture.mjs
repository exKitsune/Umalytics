import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { findWiresharkTool, runFile } from './wireshark-tools.mjs';

// Offline only: no live-interface arguments, key extraction, game process access,
// or network name resolution. This report intentionally excludes packet bodies.
const [captureArgument, outputArgument, ...extraArguments] = process.argv.slice(2);
if (!captureArgument || extraArguments.length || captureArgument === '--help') {
  console.log('Usage: node scripts/inspect-capture.mjs <capture.pcapng> [new-output-directory]');
  console.log('Writes transport/TLS/HTTP metadata from an existing capture; does not recover race JSON.');
  process.exitCode = captureArgument === '--help' ? 0 : 1;
} else {
  try {
    const capture = resolve(captureArgument);
    if (!(await stat(capture)).isFile()) throw new Error('Capture must be a regular file.');
    const tshark = await findWiresharkTool('tshark');
    if (!tshark) throw new Error('TShark was not found. Install Wireshark with TShark, or add its folder to PATH.');
    const output = resolve(outputArgument ?? `${capture}.analysis-${Date.now()}`);
    // Fail instead of overwriting an earlier analysis.
    await mkdir(output);
    const base = ['-n', '-r', capture];
    const csv = ['-T', 'fields', '-E', 'header=y', '-E', 'separator=,', '-E', 'quote=d'];
    const jobs = [
      ['transport.txt', ['-q', '-z', 'io,phs', '-z', 'conv,tcp', '-z', 'conv,udp']],
      ['tls-client-hellos.csv', ['-Y', 'tls.handshake.type == 1', ...csv,
        '-e', 'frame.number', '-e', 'frame.time_relative', '-e', 'ip.src', '-e', 'ipv6.src',
        '-e', 'ip.dst', '-e', 'ipv6.dst', '-e', 'tcp.stream', '-e', 'tls.handshake.extensions_server_name']],
      ['http-responses.csv', ['-Y', 'http.response', ...csv,
        '-e', 'frame.number', '-e', 'frame.time_relative', '-e', 'tcp.stream',
        '-e', 'http.response.code', '-e', 'http.content_type', '-e', 'http.content_length']],
    ];
    for (const [filename, args] of jobs) {
      const { stdout, stderr } = await runFile(tshark.executable, [...base, ...args], {
        windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
      });
      await writeFile(resolve(output, filename), stdout, 'utf8');
      if (stderr.trim()) console.warn(stderr.trim());
    }
    await writeFile(resolve(output, 'report.json'), JSON.stringify({
      kind: 'packet-metadata-report',
      source: basename(capture),
      inspectedAt: new Date().toISOString(),
      tsharkVersion: tshark.version,
      files: jobs.map(([filename]) => filename),
      limitations: [
        'This is network metadata, not race data. Do not import this report into the race viewer.',
        'No HTTP responses can mean encrypted traffic, an incomplete capture, or an unsupported protocol.',
        'TLS ClientHello server names may be absent on reused connections or encrypted ClientHello.',
        'TLS decryption requires appropriate session secrets; this script does not obtain them.',
        'IP addresses and hostnames can still be private. Inspect before sharing.',
      ],
    }, null, 2), 'utf8');
    console.log(`Offline analysis written to ${output}`);
    console.log('These are packet metadata reports, not race JSON. Inspect transport.txt first.');
  } catch (error) {
    console.error(`Capture inspection failed: ${error.message}`);
    process.exitCode = 1;
  }
}
