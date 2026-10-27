import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdir, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const emptyRace = { filename: null, receivedAt: null, sha256: null, data: null };
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

/** Only enumerated, regular files immediately inside the inbox are candidates. */
export async function readLatestRace(inbox, maxBytes = 16 * 1024 * 1024) {
  const root = await realpath(inbox);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
    .map(async (entry) => {
      const path = join(root, entry.name);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.size > maxBytes) return null;
        return { filename: entry.name, path, modified: info.mtimeMs };
      } catch { return null; } // A producer can be atomically renaming its export.
    }));
  candidates.sort((a, b) => (b?.modified ?? -Infinity) - (a?.modified ?? -Infinity));
  for (const candidate of candidates) {
    if (!candidate) continue;
    let handle;
    try {
      const canonical = await realpath(candidate.path);
      if (dirname(canonical) !== root || !(await lstat(candidate.path)).isFile()) continue;
      handle = await open(canonical, 'r');
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) continue;
      // A bounded read prevents a file growing during readFile from bypassing the limit.
      const buffer = Buffer.alloc(before.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat();
      if (bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
      const bytes = buffer.subarray(0, bytesRead);
      const data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (data === null || typeof data !== 'object') continue;
      return {
        filename: candidate.filename,
        receivedAt: after.mtime.toISOString(),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        data,
      };
    } catch {
      // A partial/invalid new file must not displace the previous usable export.
    } finally {
      await handle?.close();
    }
  }
  return { ...emptyRace };
}

/** Snapshot the build once; HTTP paths never become filesystem paths. */
async function loadStaticBuild(dist) {
  const assets = new Map();
  let root;
  try { root = await realpath(dist); } catch (error) {
    if (error.code === 'ENOENT') return assets;
    throw error;
  }
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.isFile()) continue;
      const canonical = await realpath(path);
      const local = relative(root, canonical);
      if (local.startsWith(`..${sep}`) || local === '..' || resolve(root, local) !== canonical) continue;
      const info = await stat(canonical);
      if (info.size > 32 * 1024 * 1024) continue;
      assets.set(`/${local.split(sep).map(encodeURIComponent).join('/')}`, {
        bytes: await readFile(canonical),
        type: contentTypes[extname(entry.name).toLowerCase()] ?? 'application/octet-stream',
      });
    }
  }
  await visit(root);
  if (assets.has('/index.html')) assets.set('/', assets.get('/index.html'));
  return assets;
}

export async function startBridge({
  inbox = join(projectRoot, 'captures', 'inbox'),
  dist = join(projectRoot, 'dist'),
  port = 4318,
  maxBytes = 16 * 1024 * 1024,
} = {}) {
  await mkdir(inbox, { recursive: true });
  const assets = await loadStaticBuild(dist);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    const activePort = server.address().port;
    const localHosts = [`127.0.0.1:${activePort}`, `localhost:${activePort}`];
    if (!localHosts.includes(request.headers.host)) return send(403, { error: 'Local host required.' });
    const allowedOrigins = new Set([
      ...localHosts.map((host) => `http://${host}`),
      'http://localhost:5173', 'http://127.0.0.1:5173',
      'http://localhost:4173', 'http://127.0.0.1:4173',
    ]);
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return send(403, { error: 'Origin is not allowed.' });
    if (!origin && request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-site request refused.' });
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      if (request.headers['access-control-request-method'] !== 'GET' || request.headers['access-control-request-headers']) {
        return send(403, { error: 'Only simple GET requests are allowed.' });
      }
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET' });
      return response.end();
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return send(405, { error: 'Read-only bridge.' });
    }
    // Match the raw path against a fixed API/static manifest. Do not normalize ../.
    const path = (request.url ?? '').split('?')[0];
    try {
      if (path === '/api/health') return send(200, { ok: true, mode: 'json-folder', staticReady: assets.has('/') });
      if (path === '/api/races/latest') return send(200, await readLatestRace(inbox, maxBytes));
      const asset = assets.get(path);
      if (!asset) return send(404, { error: path === '/' ? 'Build the viewer with npm run build, then restart the bridge.' : 'Not found.' });
      response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length });
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
    } catch {
      send(500, { error: 'The race inbox could not be read.' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    inbox: resolve(inbox),
    staticReady: assets.has('/'),
    close: () => new Promise((accept, reject) => {
      server.close((error) => error ? reject(error) : accept());
      server.closeIdleConnections();
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--port': 'port', '--inbox': 'inbox', '--dist': 'dist' }[args[i]];
      if (!key || args[i + 1] === undefined) throw new Error('Use --port, --inbox, or --dist with a value.');
      options[key] = key === 'port' ? Number(args[i + 1]) : resolve(args[i + 1]);
    }
    const bridge = await startBridge(options);
    console.log(`Race viewer bridge: ${bridge.url}`);
    console.log(`JSON inbox: ${bridge.inbox}`);
    console.log(bridge.staticReady ? 'Viewer ready. Open the URL above.' : 'API ready. Run npm run build, then restart to serve the viewer.');
    console.log('Reads local JSON files only. No game access or packet capture is performed.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => bridge.close().then(() => process.exit(0)));
  } catch (error) {
    console.error(`Bridge could not start: ${error.message}`);
    process.exitCode = 1;
  }
}
