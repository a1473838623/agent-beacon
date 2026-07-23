#!/usr/bin/env node
// Beacon CLI: start/stop/status the daemon, report activity, watch a dir, and init Claude Code hooks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOGDIR, listLogDays, readLogDay, deleteLogDay } from '../src/log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BEACON_PORT) || 4517;
const BASE = `http://127.0.0.1:${PORT}`;
const BEACON_HOME = process.env.BEACON_HOME || path.join(os.homedir(), '.beacon');
const DAEMON = path.join(ROOT, 'src', 'daemon.js');
const HOOK = path.join(ROOT, 'hooks', 'pretooluse.js');
const STOP = path.join(ROOT, 'hooks', 'stop.js');
const MCP = path.join(ROOT, 'mcp', 'server.js');

async function fetchJson(pathn, opts, timeoutMs = 1500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + pathn, { ...opts, signal: ac.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function isUp() {
  try { const h = await fetchJson('/health', {}, 500); return !!h.ok; } catch { return false; }
}

function startDetached() {
  const child = spawn(process.execPath, [DAEMON], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function ensureDaemon() {
  if (await isUp()) return true;
  startDetached();
  for (let i = 0; i < 20; i++) { // wait up to ~2s for it to come up
    await new Promise((r) => setTimeout(r, 100));
    if (await isUp()) return true;
  }
  return false;
}

// ---- commands ----

async function cmdStart(args) {
  if (args.includes('--detach') || args.includes('-d')) {
    if (await isUp()) { console.log('beacon already running on ' + BASE); return; }
    startDetached();
    console.log('beacon started (detached) → ' + BASE);
    return;
  }
  await import(DAEMON); // foreground
}

function cmdStop() {
  const pidfile = path.join(BEACON_HOME, 'daemon.pid');
  try {
    const pid = Number(fs.readFileSync(pidfile, 'utf8'));
    process.kill(pid);
    fs.unlinkSync(pidfile);
    console.log('beacon stopped (pid ' + pid + ')');
  } catch { console.log('beacon does not appear to be running'); }
}

async function cmdRestart() {
  if (await isUp()) {
    try { await fetchJson('/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { /* */ }
    console.log('beacon restart requested');
  } else {
    startDetached();
    console.log('beacon started (was not running)');
  }
}

async function cmdStatus() {
  if (!(await isUp())) { console.log('beacon: not running. Start it with `beacon start -d`.'); return; }
  const h = await fetchJson('/health');
  const { activities } = await fetchJson('/activity');
  console.log(`beacon v${h.version} · ${BASE} · ${activities.length} active`);
  for (const a of activities) {
    console.log(`  • [${a.action}] ${a.target || '(working tree)'}  — ${a.actorLabel || a.actor}`);
  }
  console.log(`\nlogs: ${LOGDIR}   (view with: beacon logs)`);
}

function cmdLogs(args) {
  const o = parseFlags(args);
  if ('path' in o) return console.log(LOGDIR);
  if ('clear' in o) { const n = deleteLogDay('all'); return console.log(`deleted ${n} log file(s) in ${LOGDIR}`); }
  const days = listLogDays();
  if (!days.length) return console.log(`(no logs yet in ${LOGDIR})`);
  const date = o.date || days[0].date;
  const n = Number(o.tail || o.n) || 200;
  console.log(`# ${date}  (last ${n} lines)  ·  available days: ${days.map((d) => d.date).join(', ')}\n`);
  console.log(readLogDay(date, n) || '(empty)');
  console.log(`\n# Reporting a bug? Attach the above (review it first) at:`);
  console.log(`#   https://github.com/a1473838623/agent-beacon/issues/new`);
}

async function cmdReport(args) {
  const o = parseFlags(args);
  const body = {
    actor: o.actor || `cli:${process.pid}`,
    actorLabel: o['actor-label'] || o.actor,
    action: o.action || 'working',
    target: o.target || process.cwd(),
    detail: o.detail || '',
    cwd: o.cwd || process.cwd(),
    exclusive: 'exclusive' in o,
    state: 'done' in o ? 'done' : 'active',
  };
  if (!(await ensureDaemon())) return; // fail-open
  try {
    const res = await fetchJson('/report', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.conflicts && res.conflicts.length && !('quiet' in o)) {
      for (const c of res.conflicts) {
        console.error(`⚠ overlap: ${c.actorLabel || c.actor} is also on ${c.target || 'this tree'} (${c.action})`);
      }
    }
  } catch { /* fail-open */ }
}

async function cmdWatch(args) {
  const dir = path.resolve(args.find((a) => !a.startsWith('-')) || process.cwd());
  const o = parseFlags(args);
  const actor = o.actor || `watch:${path.basename(dir)}`;
  await ensureDaemon();
  console.log(`beacon watching ${dir} (actor=${actor}) — Ctrl+C to stop`);
  const IGNORE = /(^|[\\/])(\.git|node_modules|\.beacon|dist|build|target|\.next|\.umi)([\\/]|$)/;
  const timers = new Map();
  fs.watch(dir, { recursive: true }, (_evt, filename) => {
    if (!filename) return;
    const rel = String(filename);
    if (IGNORE.test(rel)) return;
    const target = path.join(dir, rel);
    clearTimeout(timers.get(target));
    timers.set(target, setTimeout(() => {
      fetchJson('/report', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor, actorLabel: actor, action: 'editing', target, cwd: dir, detail: 'external edit', ttlMs: 90000 }),
      }).catch(() => {});
    }, 250));
  });
}

function claudeFile(level) {
  const dir = level === 'project' ? path.join(process.cwd(), '.claude') : path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

function installClaudeHook(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let settings = {};
  if (fs.existsSync(file)) { try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { settings = {}; } }
  settings.hooks = settings.hooks || {};
  const s = JSON.stringify(settings.hooks);
  const hasPre = s.includes('pretooluse.js');
  const hasStop = s.includes('stop.js');
  if (hasPre && hasStop) return 'present';
  if (!hasPre) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
    settings.hooks.PreToolUse.push({ matcher: 'Edit|Write|MultiEdit|Bash', hooks: [{ type: 'command', command: `node "${HOOK}"` }] });
  }
  if (!hasStop) { // added in a later version — upgrade older installs too
    settings.hooks.Stop = settings.hooks.Stop || [];
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: `node "${STOP}"` }] });
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return hasPre ? 'upgraded' : 'added';
}

// Remove Beacon's hooks (PreToolUse + Stop) from a settings file, preserving everything else.
function removeClaudeHook(file) {
  if (!fs.existsSync(file)) return false;
  let s; try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  if (!s.hooks) return false;
  let changed = false;
  for (const key of ['PreToolUse', 'Stop']) {
    if (!Array.isArray(s.hooks[key])) continue;
    const before = s.hooks[key].length;
    s.hooks[key] = s.hooks[key].filter((e) => !(e.hooks || []).some((h) => typeof h.command === 'string' && /pretooluse\.js|stop\.js/.test(h.command)));
    if (s.hooks[key].length !== before) changed = true;
    if (s.hooks[key].length === 0) delete s.hooks[key];
  }
  if (!changed) return false;
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  return true;
}

function cmdInit(args) {
  if (args.includes('--codex')) return cmdInitCodex(args);
  const level = args.includes('--project') ? 'project' : 'global'; // default: global
  const other = level === 'project' ? 'global' : 'project';
  const targetFile = claudeFile(level);
  const otherFile = claudeFile(other);

  const state = installClaudeHook(targetFile);
  const removed = otherFile !== targetFile && removeClaudeHook(otherFile);

  console.log(
    state === 'added' ? `✓ Beacon hook installed [${level}]: ${targetFile}`
    : state === 'upgraded' ? `✓ Beacon hook upgraded (added Stop hook) [${level}]: ${targetFile}`
    : `✓ Beacon hook already present [${level}]: ${targetFile}`);
  if (removed) console.log(`✓ Disabled the ${other}-level hook to avoid double-firing: ${otherFile}`);

  console.log('\nNext:');
  console.log('  beacon start -d      # start the local daemon');
  console.log(`  open ${BASE}   # live dashboard`);
  console.log(level === 'global'
    ? '\nGlobal (default): every new Claude Code session on this machine now reports activity automatically.'
    : '\nProject: new Claude Code sessions in THIS project now report activity automatically.');
}

function codexFile(level) {
  const dir = level === 'project' ? path.join(process.cwd(), '.codex') : path.join(os.homedir(), '.codex');
  return path.join(dir, 'config.toml');
}

// Remove the [mcp_servers.beacon] table (header → next table header or EOF), preserving the rest.
function removeCodexBeacon(file) {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let skipping = false;
  let removed = false;
  for (const line of lines) {
    if (skipping) {
      if (/^\s*\[/.test(line)) skipping = false; // next table begins — keep this line
      else continue;
    }
    if (/^\s*\[mcp_servers\.beacon\]\s*$/.test(line)) { skipping = true; removed = true; continue; }
    out.push(line);
  }
  if (!removed) return false;
  fs.writeFileSync(file, out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n'));
  return true;
}

// Register the Beacon MCP server for Codex (and any MCP client that reads Codex-style TOML).
function cmdInitCodex(args) {
  const level = args.includes('--project') ? 'project' : 'global'; // default: global
  const other = level === 'project' ? 'global' : 'project';
  const targetFile = codexFile(level);
  const otherFile = codexFile(other);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const existing = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
  let state;
  if (existing.includes('[mcp_servers.beacon]')) {
    state = 'present';
  } else {
    const argsToml = `["${MCP.replace(/\\/g, '\\\\')}"]`;
    const block = `${existing && !existing.endsWith('\n') ? '\n' : ''}\n[mcp_servers.beacon]\ncommand = "node"\nargs = ${argsToml}\n`;
    fs.appendFileSync(targetFile, block);
    state = 'added';
  }
  const removed = otherFile !== targetFile && removeCodexBeacon(otherFile);

  console.log(state === 'added'
    ? `✓ Beacon MCP server registered [${level}]: ${targetFile}`
    : `✓ Beacon MCP server already registered [${level}]: ${targetFile}`);
  if (removed) console.log(`✓ Disabled the ${other}-level Codex registration to avoid double-registration: ${otherFile}`);

  console.log('\nNext:');
  console.log('  beacon start -d      # start the local daemon');
  console.log('\nOptional — add one line to your AGENTS.md so Codex uses it automatically:');
  console.log('  "Before editing a file or running a risky command, call the beacon');
  console.log('   get_activity / report_activity tools to avoid colliding with other agents."');
  console.log('\nCodex sessions can now see and report activity via the beacon MCP tools.');
}

function parseFlags(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) o[key] = true;
      else { o[key] = next; i++; }
    }
  }
  return o;
}

function help() {
  console.log(`beacon — real-time presence for parallel AI coding agents

Usage:
  beacon init [--project]    Install the Claude Code hook (default: global; --project = this repo only)
  beacon init --codex [--project]  Register the MCP server for Codex (default: global)
  beacon mcp                 Run the stdio MCP server (spawned by Codex/Cursor/etc.)
  beacon start [-d]          Start the daemon (-d = detached/background)
  beacon stop                Stop the daemon
  beacon restart             Restart the daemon
  beacon status              Show active agents (and the log path)
  beacon logs [--tail N]     Show the local log (--clear to wipe, --path to print path)
  beacon watch <dir>         Report file edits from ANY editor/agent in <dir>
  beacon report --actor X --action editing --target <path> [--done]
  beacon dashboard           Print the dashboard URL

Dashboard: ${BASE}`);
}

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  switch (cmd) {
    case 'start': return cmdStart(args);
    case 'stop': return cmdStop();
    case 'restart': return cmdRestart();
    case 'status': return cmdStatus();
    case 'report': return cmdReport(args);
    case 'watch': return cmdWatch(args);
    case 'init': return cmdInit(args);
    case 'mcp': return void import(MCP); // stdio MCP server (spawned by Codex/Cursor/etc.)
    case 'logs': return cmdLogs(args);
    case 'dashboard': return console.log(BASE);
    case undefined:
    case '-h':
    case '--help':
    case 'help': return help();
    default: console.error('unknown command: ' + cmd); help(); process.exit(1);
  }
})();
