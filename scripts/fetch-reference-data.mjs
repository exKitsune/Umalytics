/** Refresh a pinned, licensed course snapshot. No remote code is executed. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = '5ce95905fef753a33f7519b5559a86e92f5d56cc';
const base = `https://raw.githubusercontent.com/TheCing/uma-tools/${revision}/`;
await mkdir('public/data', { recursive: true });
const files = {
  'umalator-global/course_data.json': 'public/data/courses.json',
  LICENSE: 'public/data/UMA-TOOLS-LICENSE.txt',
};
const hashes = {};
for (const [source, target] of Object.entries(files)) {
  const response = await fetch(base + source);
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (source.endsWith('.json')) JSON.parse(new TextDecoder().decode(bytes));
  await writeFile(target, bytes);
  hashes[source] = createHash('sha256').update(bytes).digest('hex');
}
const skillResponse = await fetch(base + 'umalator-global/skill_data.json');
if (!skillResponse.ok) throw new Error(`skill_data: HTTP ${skillResponse.status}`);
const skillBytes = new Uint8Array(await skillResponse.arrayBuffer());
const skills = JSON.parse(new TextDecoder().decode(skillBytes));
await writeFile('public/data/simulator-skill-ids.json', JSON.stringify(Object.keys(skills)));
hashes['umalator-global/skill_data.json'] = createHash('sha256').update(skillBytes).digest('hex');
await writeFile('public/data/reference-source.json', JSON.stringify({
  name: 'Moomoolator Global course snapshot', revision,
  url: `https://github.com/TheCing/uma-tools/tree/${revision}`,
  license: 'GPL-3.0-or-later', retrieved: new Date().toISOString(), hashes,
  notes: ['Game data © the UM:PD rights holders. No artwork, icons or simulator implementation included.',
    'Course segment distances and grades are versioned reference data, not surveyed map coordinates.',
    'The Global simulator snapshot may include courses and skills not yet released on your server.'],
}, null, 2));
console.log(`Pinned ${Object.keys(skills).length} supported simulator skill IDs and course snapshot ${revision}.`);
