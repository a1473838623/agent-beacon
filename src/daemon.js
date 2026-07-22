// Beacon daemon: tiny local HTTP server over the activity store.
// Zero dependencies. Single instance guaranteed by binding a fixed port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, BEACON_HOME } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BEACON_PORT) || 4517;
const PIDFILE = path.join(BEACON_HOME, 'daemon.pid');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const store = new Store();

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && u.pathname === '/report') {
    return json(res, 200, store.report(await readBody(req)));
  }
  if (req.method === 'GET' && u.pathname === '/activity') {
    return json(res, 200, { activities: store.list(u.searchParams.get('exclude')) });
  }
  if (req.method === 'GET' && u.pathname === '/health') {
    return json(res, 200, { ok: true, version: pkg.version, count: store.list().length });
  }
  if (req.method === 'GET' && u.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(store.list())}\n\n`);
    const off = store.onChange((snap) => res.write(`data: ${JSON.stringify(snap)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { off(); clearInterval(ping); });
    return;
  }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
  }
  json(res, 404, { error: 'not found' });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Another daemon already owns the port — that's fine, exit quietly.
    process.exit(0);
  }
  console.error('beacon daemon error:', e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  try { fs.writeFileSync(PIDFILE, String(process.pid)); } catch { /* */ }
  console.log(`beacon v${pkg.version} listening on http://127.0.0.1:${PORT}  (dashboard in your browser)`);
});

function shutdown() {
  try { if (fs.existsSync(PIDFILE) && fs.readFileSync(PIDFILE, 'utf8') === String(process.pid)) fs.unlinkSync(PIDFILE); } catch { /* */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
