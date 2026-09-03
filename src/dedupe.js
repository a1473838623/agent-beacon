// Single-fire guarantee for hooks.
//
// Beacon can legitimately be registered in more than one place at once — as a plugin
// (`hooks/hooks.json`), in `~/.claude/settings.json`, and in a project's
// `.claude/settings.json`. Claude Code runs EVERY matching registration, so the same edit
// would otherwise be reported two or three times: duplicate rows on the dashboard,
// duplicate warnings in the agent's context, duplicate log lines.
//
// Rather than trying to keep the registrations mutually exclusive (which can't be enforced
// — a user can always hand-edit settings.json, or load a plugin with --plugin-dir), we
// dedupe at the point it actually matters: exactly one hook PROCESS acts on a given event.
//
// How: every hook fingerprints the event payload it received on stdin and atomically
// creates a claim file named after that fingerprint. `fs` create-if-absent is atomic, so
// the first process to get there wins and does the work; its siblings see EEXIST and exit
// silently. Sibling registrations receive byte-identical stdin for one event, so they
// always agree on the fingerprint.
//
// SAFETY: fails OPEN in the direction that matters. Any filesystem problem means we cannot
// prove this is a duplicate, so we let the caller proceed — a duplicate report is a
// cosmetic bug, a missed report is a missed collision warning.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BEACON_HOME } from './store.js';

const DIR = path.join(BEACON_HOME, 'claims');

// How long a claim suppresses identical events. Sibling registrations fire within a few
// milliseconds of each other, so this only needs to cover process startup. Kept small so a
// genuine repeat of the same action (same file, same content, same session) isn't swallowed.
const CLAIM_TTL_MS = Number(process.env.BEACON_CLAIM_TTL_MS) || 3000;
const SWEEP_AFTER_MS = 60000;

function fingerprint(input, event) {
  const parts = [
    event,
    input.session_id || '',
    input.prompt_id || '',
    input.tool_name || '',
    JSON.stringify(input.tool_input || {}),
    input.cwd || '',
  ];
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

// Delete claims old enough that they can no longer suppress anything. Cheap, and only run
// on a fraction of calls — the directory never holds more than a handful of files.
function sweep() {
  if (Math.random() > 0.05) return;
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f);
      try { if (now - fs.statSync(p).mtimeMs > SWEEP_AFTER_MS) fs.rmSync(p, { force: true }); } catch { /* */ }
    }
  } catch { /* best-effort */ }
}

// Returns true if THIS process should handle the event, false if a sibling already claimed it.
export function claimEvent(input, event) {
  try {
    const file = path.join(DIR, fingerprint(input, event) + '.claim');
    fs.mkdirSync(DIR, { recursive: true });
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' }); // atomic create-if-absent
      sweep();
      return true;
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        // An identical event older than the TTL is a genuine repeat, not a sibling — take it over.
        try {
          if (Date.now() - fs.statSync(file).mtimeMs > CLAIM_TTL_MS) {
            fs.writeFileSync(file, String(process.pid));
            return true;
          }
        } catch { return true; } // claim vanished mid-check — proceed rather than drop the event
        return false;
      }
      return true; // unexpected fs error: can't prove it's a duplicate, so proceed
    }
  } catch {
    return true;
  }
}
