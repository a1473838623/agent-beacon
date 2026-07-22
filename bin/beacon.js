#!/usr/bin/env node
// Beacon CLI: start/stop/status the daemon, report activity, watch a dir, and init Claude Code hooks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOGFILE } from '../src/log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BEACON_PORT) || 4517;
const BASE = `http://127.0.0.1:${PORT}`;
const BEACON_HOME = process.env.BEACON_HOME || path.join(os.homedir(), '.beacon');
const DAEMON = path.join(ROOT, 'src', 'daemon.js');
const HOOK = path.join(ROOT, 'hooks', 'pretooluse.js');
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

async function cmdStatus() {
  if (!(await isUp())) { console.log('beacon: not running. Start it with `beacon start -d`.'); return; }
  const h = await fetchJson('/health');
  const { activities } = await fetchJson('/activity');
  console.log(`beacon v${h.version} · ${BASE} · ${activities.length} active`);
  for (const a of activities) {
    console.log(`  • [${a.action}] ${a.target || '(working tree)'}  — ${a.actorLabel || a.actor}`);
  }
  console.log(`\nlog: ${LOGFILE}   (view with: beacon logs)`);
}

function cmdLogs(args) {
  const o = parseFlags(args);
  if ('path' in o) return console.log(LOGFILE);
  if ('clear' in o) {
    try { fs.rmSync(LOGFILE, { force: true }); fs.rmSync(LOGFILE + '.1', { force: true }); } catch { /* */ }
    return console.log('log cleared: ' + LOGFILE);
  }
  const n = Number(o.tail || o.n) || 200;
  if (!fs.existsSync(LOGFILE)) return console.log(`(no log yet at ${LOGFILE})`);
  const lines = fs.readFileSync(LOGFILE, 'utf8').split('\n').filter(Boolean);
  console.log(`# ${LOGFILE}  (last ${Math.min(n, lines.length)} of ${lines.length} lines)\n`);
  console.log(lines.slice(-n).join('\n'));
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

function cmdInit(args) {
  if (args.includes('--codex')) return cmdInitCodex(args);
  const global = args.includes('--global');
  const dir = global ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  let settings = {};
  if (fs.existsSync(file)) { try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { settings = {}; } }
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  const command = `node "${HOOK}"`;
  const already = JSON.stringify(settings.hooks.PreToolUse).includes(HOOK.replace(/\\/g, '\\\\'));
  if (!already) {
    settings.hooks.PreToolUse.push({
      matcher: 'Edit|Write|MultiEdit|Bash',
      hooks: [{ type: 'command', command }],
    });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    console.log(`✓ Beacon hook installed in ${file}`);
  } else {
    console.log(`✓ Beacon hook already present in ${file}`);
  }
  console.log('\nNext:');
  console.log('  beacon start -d      # start the local daemon');
  console.log(`  open ${BASE}   # live dashboard`);
  console.log('\nThat\'s it. New Claude Code sessions in this project now report activity automatically.');
}

// Register the Beacon MCP server for Codex (and any MCP client that reads Codex-style TOML).
function cmdInitCodex(args) {
  const project = args.includes('--project');
  const dir = project ? path.join(process.cwd(), '.codex') : path.join(os.homedir(), '.codex');
  const file = path.join(dir, 'config.toml');
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes('[mcp_servers.beacon]')) {
    console.log(`✓ Beacon MCP server already registered in ${file}`);
  } else {
    const argsToml = `["${MCP.replace(/\\/g, '\\\\')}"]`;
    const block = `${existing && !existing.endsWith('\n') ? '\n' : ''}\n[mcp_servers.beacon]\ncommand = "node"\nargs = ${argsToml}\n`;
    fs.appendFileSync(file, block);
    console.log(`✓ Beacon MCP server registered in ${file}`);
  }
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
  beacon init [--global]     Install the Claude Code hook (project or user level)
  beacon init --codex        Register the MCP server for Codex (~/.codex/config.toml)
  beacon mcp                 Run the stdio MCP server (spawned by Codex/Cursor/etc.)
  beacon start [-d]          Start the daemon (-d = detached/background)
  beacon stop                Stop the daemon
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
