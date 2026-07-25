#!/usr/bin/env node
// Claude Code UserPromptSubmit hook — captures a short, sanitized title for this turn so the
// dashboard can group a session's edits by conversation turn. OPT-IN: only runs if the
// `groupByPrompt` setting is on. Stores the (truncated) prompt text — never sent anywhere but
// the local daemon. Fails open and silent.
import { getSettings } from '../src/settings.js';
import { log } from '../src/log.js';

const PORT = Number(process.env.BEACON_PORT) || 4517;
const BASE = `http://127.0.0.1:${PORT}`;

// Turn a raw prompt into a one-line title. Handles images/attachments/huge blobs gracefully.
function titleFromPrompt(raw) {
  let s = String(raw || '').replace(/data:[^\s]+;base64,[A-Za-z0-9+/=]+/g, '[image]');
  s = (s.split('\n').map((l) => l.trim()).find(Boolean) || '').replace(/\s+/g, ' ').trim();
  if (!s) return '(image / attachment)';
  if (s.length > 200 && !s.includes(' ')) return '(attachment)'; // base64 / giant paste
  return s.length > 72 ? s.slice(0, 72) + '…' : s;
}

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
  if (getSettings().grouping === 'off') return; // opt-in — do nothing (don't even read the prompt) when off
  let input;
  try { input = JSON.parse(await readStdin()); } catch { return; }
  const sessionId = input.session_id;
  if (!sessionId) return;
  const title = titleFromPrompt(input.user_prompt);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 350);
  try {
    await fetch(BASE + '/title', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, promptId: input.prompt_id || '', title }), signal: ac.signal,
    });
  } catch (e) {
    log('warn', 'prompt-hook', 'could not record turn title (fail-open): ' + ((e && e.message) || e));
  } finally { clearTimeout(t); }
}

main().catch(() => {}).finally(() => process.exit(0));
