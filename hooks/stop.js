#!/usr/bin/env node
// Claude Code Stop hook — clears this session's activity when its turn ends, so the
// dashboard/other agents stop showing "editing" for a session that's no longer working.
// Fails open and silent, exactly like the PreToolUse hook.
import { log } from '../src/log.js';

const PORT = Number(process.env.BEACON_PORT) || 4517;
const BASE = `http://127.0.0.1:${PORT}`;

function readStdin() {
  return new Promise((resolve) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => resolve(d));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(d), 500);
  });
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch { return; }
  const actor = input.session_id;
  if (!actor) return;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 350);
  try {
    await fetch(BASE + '/clear', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor }), signal: ac.signal,
    });
  } catch (e) {
    log('warn', 'stop-hook', 'could not clear session activity (fail-open): ' + (e && e.message || e));
  } finally { clearTimeout(t); }
}

main().catch(() => {}).finally(() => process.exit(0));
