#!/usr/bin/env node
// Beacon MCP server — stdio JSON-RPC 2.0, a thin bridge to the local Beacon daemon.
// Exposes two tools (report_activity, get_activity) to any MCP client (Codex, Cursor,
// Cline, Windsurf, Zed, Claude Agent SDK…). Zero dependencies. Fails soft: if the daemon
// is unreachable, tools return a note instead of crashing the client.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log } from '../src/log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const PORT = Number(process.env.BEACON_PORT) || 4517;
const BASE = `http://127.0.0.1:${PORT}`;
const DAEMON = path.join(__dirname, '..', 'src', 'daemon.js');

let clientName = 'mcp';
const actorId = `mcp:${crypto.randomBytes(4).toString('hex')}`;

async function fetchJson(pathn, opts, timeoutMs = 1200) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + pathn, { ...opts, signal: ac.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}
const daemonGet = (p) => fetchJson(p, {});
const daemonPost = (p, body) => fetchJson(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function ensureDaemon() {
  try { const h = await fetchJson('/health', {}, 400); if (h.ok) return; } catch { /* start it */ }
  try { spawn(process.execPath, [DAEMON], { detached: true, stdio: 'ignore' }).unref(); } catch { /* */ }
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { const h = await fetchJson('/health', {}, 300); if (h.ok) return; } catch { /* */ }
  }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const ok = (id, res) => send({ jsonrpc: '2.0', id, result: res });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (id, text, isError) => ok(id, { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

const TOOLS = [
  {
    name: 'report_activity',
    description:
      'Announce that you (this agent/session) are about to work on something, so other AI agents working the same repo in parallel can see it and avoid clobbering your changes. The response tells you if any OTHER agent is already on the same target — if so, coordinate. Call before editing a file or running a risky command; call again with done=true when finished.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What you are doing, e.g. "editing", "refactoring", "running tests".' },
        target: { type: 'string', description: 'What you are acting on — absolute file path, module, or resource id.' },
        detail: { type: 'string', description: 'Optional short note.' },
        done: { type: 'boolean', description: 'Set true to clear a previously reported activity when finished.' },
      },
      required: ['action', 'target'],
    },
  },
  {
    name: 'get_activity',
    description:
      'List what every OTHER AI agent/session is currently working on in this repo (files being edited, git ops, builds). Call at the start of a task, or before editing a file, to avoid collisions.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      clientName = params?.clientInfo?.name || 'mcp';
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'beacon', version: pkg.version },
      });
    case 'notifications/initialized':
      return; // notification: no response
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        await ensureDaemon();
        if (name === 'report_activity') {
          const res = await daemonPost('/report', {
            actor: actorId,
            actorLabel: `${clientName}:${actorId.slice(-6)}`,
            action: args.action || 'working',
            target: args.target || '',
            detail: args.detail || '',
            cwd: process.cwd(),
            state: args.done ? 'done' : 'active',
          });
          const c = res.conflicts || [];
          return textResult(id, c.length
            ? `Reported. ⚠ ${c.length} other agent(s) are also on this target: ${c.map((x) => `${x.actorLabel || x.actor} (${x.action})`).join('; ')}. Coordinate before proceeding so you don't clobber each other.`
            : 'Reported. No other agents are on this target right now — clear to proceed.');
        }
        if (name === 'get_activity') {
          const res = await daemonGet('/activity?exclude=' + encodeURIComponent(actorId));
          const list = res.activities || [];
          return textResult(id, list.length
            ? 'Other agents currently active:\n' + list.map((a) => `- ${a.actorLabel || a.actor}: ${a.action} ${a.target || '(working tree)'}`).join('\n')
            : 'No other agents are active right now.');
        }
        return err(id, -32601, 'unknown tool: ' + name);
      } catch (e) {
        // Fail soft — never break the client's turn.
        log('warn', 'mcp', `tool '${name}' failed (fail-open): ` + (e && e.message || e));
        return textResult(id, 'Beacon is unavailable right now (fail-open, no coordination this call).', true);
      }
    }
    default:
      if (id !== undefined && id !== null) return err(id, -32601, 'method not found: ' + method);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try { msg = JSON.parse(s); } catch { return; }
  Promise.resolve(handle(msg)).catch(() => {});
});
