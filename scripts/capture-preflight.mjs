import { findWiresharkTool, runFile } from './wireshark-tools.mjs';

console.log('Read-only capture tooling check. This does not start capture or touch the game.');
console.log(`Node: ${process.version}`);
for (const name of ['tshark', 'dumpcap']) {
  const found = await findWiresharkTool(name);
  console.log(found ? `${name}: ${found.executable}\n  ${found.version}` : `${name}: not found`);
}
if (process.platform === 'win32') {
  try {
    await runFile('where.exe', ['pktmon.exe'], { windowsHide: true, timeout: 5000 });
    console.log('pktmon: built into this Windows installation');
  } catch { console.log('pktmon: not found'); }
}
console.log('Next: follow docs/capture-guide.md to choose the game connection and capture interface.');
