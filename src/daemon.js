// Beacon daemon: tiny local HTTP server over the activity store.
// Zero dependencies. Single instance guaranteed by binding a fixed port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, BEACON_HOME } from './store.js';
import { log, listLogDays, readLogDay, deleteLogDay } from './log.js';
import { getSettings, saveSettings } from './settings.js';
import { setAutoStart, isAutoStartEnabled } from './autostart.js';

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.BEACON_PORT) || 4517;
const PIDFILE = path.join(BEACON_HOME, 'daemon.pid');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const store = new Store();

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}

// Allow no-Origin (curl/CLI) or same-origin browser requests only.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { const h = new URL(o).host; return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`; } catch { return false; }
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
    const body = await readBody(req);
    const result = store.report(body);
    if (result.conflicts && result.conflicts.length) {
      log('info', 'daemon', 'overlap detected', { actor: body.actor, target: body.target, others: result.conflicts.length });
    } else {
      log('debug', 'daemon', 'report', { actor: body.actor, action: body.action, target: body.target });
    }
    return json(res, 200, result);
  }
  if (req.method === 'GET' && u.pathname === '/activity') {
    return json(res, 200, { activities: store.list(u.searchParams.get('exclude')) });
  }
  if (req.method === 'GET' && u.pathname === '/health') {
    return json(res, 200, { ok: true, version: pkg.version, count: store.list().length });
  }

  // --- settings ---
  if (u.pathname === '/settings') {
    if (req.method === 'GET') return json(res, 200, { ...getSettings(), startOnBoot: isAutoStartEnabled(), platform: process.platform });
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
      const body = await readBody(req);
      let autoStart = null;
      if (typeof body.startOnBoot === 'boolean') autoStart = setAutoStart(body.startOnBoot);
      const saved = saveSettings(body);
      log('info', 'daemon', 'settings updated', { autoCheckUpdates: saved.autoCheckUpdates, startOnBoot: isAutoStartEnabled() });
      return json(res, 200, { ...saved, startOnBoot: isAutoStartEnabled(), autoStart });
    }
  }

  // --- logs (per day) ---
  if (req.method === 'GET' && u.pathname === '/logs/days') return json(res, 200, { days: listLogDays() });
  if (req.method === 'GET' && u.pathname === '/logs') {
    const date = u.searchParams.get('date') || '';
    return json(res, 200, { date, content: readLogDay(date, Number(u.searchParams.get('tail')) || 0) });
  }
  if (req.method === 'POST' && u.pathname === '/logs/delete') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    const n = deleteLogDay(body.date || '');
    log('info', 'daemon', 'logs deleted', { date: body.date, files: n });
    return json(res, 200, { deleted: n });
  }

  // --- update check (network — only when called) ---
  if (req.method === 'GET' && u.pathname === '/update/check') {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 6000);
      const r = await fetch('https://api.github.com/repos/a1473838623/agent-beacon/releases/latest', {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'beacon' }, signal: ac.signal,
      });
      clearTimeout(t);
      const j = await r.json();
      const latest = (j.tag_name || '').replace(/^v/, '');
      return json(res, 200, {
        current: pkg.version, latest,
        updateAvailable: !!latest && cmpVer(latest, pkg.version) > 0,
        url: j.html_url || 'https://github.com/a1473838623/agent-beacon/releases',
        isGitRepo: fs.existsSync(path.join(__dirname, '..', '.git')),
      });
    } catch (e) {
      return json(res, 200, { current: pkg.version, error: 'check failed (offline?): ' + ((e && e.message) || e) });
    }
  }
  if (req.method === 'POST' && u.pathname === '/update/apply') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
    const root = path.join(__dirname, '..');
    if (!fs.existsSync(path.join(root, '.git'))) return json(res, 200, { ok: false, message: 'Not a git checkout — update with `npm i -g agent-beacon` or re-pull your install.' });
    execFile('git', ['-C', root, 'pull', '--ff-only'], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return json(res, 200, { ok: false, message: ((stderr || err.message) || '').trim() });
      json(res, 200, { ok: true, message: ((stdout || '').trim() + '\nRestart to apply: beacon restart').trim() });
    });
    return;
  }

  // Control endpoints — localhost is already enforced by the bind address; also reject
  // cross-origin browser requests so a random web page can't clear/stop your daemon.
  if (req.method === 'POST' && (u.pathname === '/clear' || u.pathname === '/shutdown' || u.pathname === '/restart')) {
    if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    if (u.pathname === '/clear') {
      const n = store.clearActor(body.actor);
      log('info', 'daemon', 'cleared', { actor: body.actor || '*', count: n });
      return json(res, 200, { cleared: n });
    }
    json(res, 200, { ok: true });
    if (u.pathname === '/restart') {
      log('info', 'daemon', 'restart requested');
      try { spawn(process.execPath, [__filename], { detached: true, stdio: 'ignore', env: { ...process.env, BEACON_WAIT_PORT: '1' } }).unref(); }
      catch (e) { log('error', 'daemon', 'restart spawn failed: ' + e.message); }
      return setTimeout(shutdown, 150);
    }
    log('info', 'daemon', 'shutdown requested');
    return setTimeout(shutdown, 100);
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

let bindAttempts = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // On a restart, wait for the old daemon to release the port instead of bailing.
    if (process.env.BEACON_WAIT_PORT && bindAttempts < 50) {
      bindAttempts++;
      return setTimeout(() => server.listen(PORT, '127.0.0.1'), 200);
    }
    // Otherwise another daemon already owns the port — that's fine, exit quietly.
    log('info', 'daemon', `port ${PORT} already in use; another daemon owns it, exiting`);
    process.exit(0);
  }
  log('error', 'daemon', 'server error: ' + e.message);
  console.error('beacon daemon error:', e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  try { fs.writeFileSync(PIDFILE, String(process.pid)); } catch { /* */ }
  log('info', 'daemon', 'listening', { port: PORT, version: pkg.version });
  console.log(`beacon v${pkg.version} listening on http://127.0.0.1:${PORT}  (dashboard in your browser)`);
});

process.on('uncaughtException', (e) => { log('error', 'daemon', 'uncaughtException: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { log('error', 'daemon', 'unhandledRejection: ' + (e && e.message || e)); });

function shutdown() {
  log('info', 'daemon', 'shutting down');
  try { if (fs.existsSync(PIDFILE) && fs.readFileSync(PIDFILE, 'utf8') === String(process.pid)) fs.unlinkSync(PIDFILE); } catch { /* */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
