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

// Classify a Bash command we care about. Returns { category, action, ttlMs } or null.
function classifyBash(cmd) {
  // Destructive git — silently rewrites the shared tree / can lose uncommitted work.
  const gd = cmd.match(/\bgit\s+(?:-C\s+\S+\s+)?(checkout|switch|reset\s+--hard|reset\s+--merge|stash|rebase|merge|clean|restore)\b/);
  if (gd) return { category: 'git-destructive', action: 'git:' + gd[1].split(/\s+/)[0], ttlMs: 30000 };
  // Entangling git — stages/commits EVERYTHING, sweeping up other agents' uncommitted work.
  if (/\bgit\s+add\s+(?:-A|--all|\.)(?:\s|$)/.test(cmd)) return { category: 'git-entangle', action: 'git:add-all', ttlMs: 30000 };
  if (/\bgit\s+commit\b[^|;&]*(?:\s-[a-zA-Z]*a[a-zA-Z]*\b|--all\b)/.test(cmd)) return { category: 'git-entangle', action: 'git:commit-all', ttlMs: 30000 };
  // Deploy / build — parallelizable, but running the same one twice at once just wastes CPU/Docker.
  if (/\bdocker(?:-compose)?\b[^|;&]*\b(?:up|build|deploy)\b/.test(cmd) || /\bkubectl\s+apply\b/.test(cmd)) return { category: 'deploy', action: 'deploying', ttlMs: 600000 };
  if (/\b(?:mvn|mvnd|gradle|\.\/gradlew|make|bazel)\b/.test(cmd) || /\b(?:cargo|go)\s+build\b/.test(cmd) || /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?build\b/.test(cmd)) return { category: 'build', action: 'building', ttlMs: 600000 };
  return null;
}

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

  let category = 'edit', action, target, ttlMs = 180000;
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    if (!ti.file_path) return allow();
    action = 'editing';
    target = ti.file_path;
  } else if (tool === 'Bash') {
    const c = classifyBash(String(ti.command || ''));
    if (!c) return allow();
    category = c.category; action = c.action; ttlMs = c.ttlMs;
    // Build/deploy get their own target namespace so they conflict only with other
    // builds/deploys in the same dir — not with git ops (which target the raw cwd).
    target = (c.category === 'build' || c.category === 'deploy') ? `job://${cwd}` : cwd;
  } else {
    return allow();
  }

  // Edit presence is momentary — short TTL so it fades if the session goes idle without a
  // Stop event; the Stop hook clears it promptly. Build/deploy get a longer backstop.
  const conflicts = await report({
    actor, actorLabel, action, target, cwd,
    detail: tool === 'Bash' ? String(ti.command || '').slice(0, 120) : '',
    ttlMs,
  });

  if (!conflicts || conflicts.length === 0) return allow();

  const who = conflicts.map((c) => `${c.actorLabel || c.actor} (${c.action} ${shortTarget(c.target)})`).join('; ');
  let msg;
  if (category === 'git-destructive')
    msg = `⚠️ Beacon: another agent is active in this working tree — ${who}. This "${action.replace('git:', 'git ')}" may discard or overwrite their uncommitted work. Confirm with the user first.`;
  else if (category === 'git-entangle')
    msg = `⚠️ Beacon: another agent has uncommitted edits in this tree — ${who}. "${action.replace('git:', 'git ').replace('-', ' --')}" will sweep their changes into your commit. Stage specific files instead, or coordinate first.`;
  else if (category === 'build' || category === 'deploy')
    msg = `⚠️ Beacon: a build/deploy is already running in this directory — ${who}. Running another in parallel mainly wastes local resources (CPU / Docker); consider waiting for it to finish.`;
  else
    msg = `⚠️ Beacon: ${who} is editing this same file right now. Coordinate so you don't clobber each other's changes.`;

  const riskyGit = category === 'git-destructive' || category === 'git-entangle';
  if (GUARD === 'ask' && riskyGit) {
    return emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: msg } });
  }
  return emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } });
}

main().catch((e) => { log('error', 'hook', 'unexpected error, failing open: ' + (e && e.stack || e)); allow(); });
