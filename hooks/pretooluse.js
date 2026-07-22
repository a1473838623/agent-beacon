#!/usr/bin/env node
// Claude Code PreToolUse hook.
// Reports the current edit / dangerous git op to the Beacon daemon, and — only if another
// agent is actively touching the same thing — injects a one-line warning back into context.
//
// SAFETY: this hook NEVER blocks by default and ALWAYS fails open. Any error, timeout, or
// daemon-down condition results in zero output and exit 0, so a Claude Code session behaves
// exactly as if Beacon were not installed.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../src/log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BEACON_PORT) || 4517;
const BASE = `http://127.0.0.1:${PORT}`;
const GUARD = process.env.BEACON_GUARD || 'warn'; // warn | ask | off

// Destructive git verbs that silently rewrite the shared working tree / can lose uncommitted work.
const DANGEROUS = /\bgit\s+(?:-C\s+\S+\s+)?(checkout|switch|reset\s+--hard|reset\s+--merge|stash|rebase|merge|clean|restore)\b/;

function allow() { process.exit(0); }               // no output = allow, no context added
function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

function readStdin() {
  return new Promise((resolve) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => resolve(d));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(d), 500); // never hang on stdin
  });
}

async function report(body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 350);
  try {
    const r = await fetch(BASE + '/report', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ac.signal,
    });
    const j = await r.json();
    return j.conflicts || [];
  } catch (e) {
    // Daemon likely down: lazy-start it for next time, but fail open now.
    log('warn', 'hook', 'daemon unreachable, failing open (will lazy-start): ' + (e && e.message || e));
    try { spawn(process.execPath, [path.join(__dirname, '..', 'src', 'daemon.js')], { detached: true, stdio: 'ignore' }).unref(); } catch (e2) { log('error', 'hook', 'lazy-start failed: ' + (e2 && e2.message || e2)); }
    return null;
  } finally { clearTimeout(t); }
}

function shortTarget(t) {
  return String(t || '').replace(/\\/g, '/').split('/').slice(-3).join('/');
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch { return allow(); }
  if (GUARD === 'off') return allow();

  const tool = input.tool_name;
  const ti = input.tool_input || {};
  const actor = input.session_id || 'unknown';
  const actorLabel = (input.session_id || 'session').slice(0, 8);
  const cwd = input.cwd || process.cwd();

  let action, target, dangerous = false;
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    if (!ti.file_path) return allow();
    action = 'editing';
    target = ti.file_path;
  } else if (tool === 'Bash') {
    const m = String(ti.command || '').match(DANGEROUS);
    if (!m) return allow();
    dangerous = true;
    action = 'git:' + m[1].split(/\s+/)[0];
    target = cwd;
  } else {
    return allow();
  }

  const conflicts = await report({
    actor, actorLabel, action, target, cwd,
    detail: tool === 'Bash' ? String(ti.command || '').slice(0, 120) : '',
    ttlMs: dangerous ? 30000 : undefined,
  });

  if (!conflicts || conflicts.length === 0) return allow();

  const who = conflicts.map((c) => `${c.actorLabel || c.actor} (${c.action} ${shortTarget(c.target)})`).join('; ');
  const msg = dangerous
    ? `⚠️ Beacon: another agent is active in this working tree — ${who}. This "${action.replace('git:', 'git ')}" may discard or overwrite their uncommitted work. Confirm with the user before proceeding.`
    : `⚠️ Beacon: ${who} is editing this same file right now. Coordinate so you don't clobber each other's changes.`;

  if (GUARD === 'ask' && dangerous) {
    return emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: msg } });
  }
  return emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } });
}

main().catch((e) => { log('error', 'hook', 'unexpected error, failing open: ' + (e && e.stack || e)); allow(); });
