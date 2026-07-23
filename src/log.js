// Tiny local logger. Best-effort: logging never throws and never blocks the fail-open path.
// Errors/warnings are always recorded so a user can attach the log to a bug report;
// info is light (daemon lifecycle, overlaps); per-report noise is debug-only.
//
// Level:  BEACON_LOG_LEVEL=error|warn|info|debug   (default: info; BEACON_DEBUG=1 → debug)
// Files:  $BEACON_HOME/logs/beacon-YYYY-MM-DD.log   (one file per day)
import fs from 'node:fs';
import path from 'node:path';
import { BEACON_HOME } from './store.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const THRESHOLD = LEVELS[process.env.BEACON_LOG_LEVEL] ?? (process.env.BEACON_DEBUG ? LEVELS.debug : LEVELS.info);
export const LOGDIR = path.join(BEACON_HOME, 'logs');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const dayFile = (date) => path.join(LOGDIR, `beacon-${date}.log`);

export function log(level, component, message, extra) {
  try {
    if ((LEVELS[level] ?? LEVELS.info) > THRESHOLD) return;
    const tail = extra ? ' ' + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    const line = `${new Date().toISOString()} [${level}] ${component}: ${message}${tail}\n`;
    fs.mkdirSync(LOGDIR, { recursive: true });
    fs.appendFileSync(dayFile(today()), line);
  } catch { /* logging is best-effort — never throw */ }
}

// [{ date, size }] newest first
export function listLogDays() {
  try {
    return fs.readdirSync(LOGDIR)
      .filter((f) => /^beacon-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map((f) => ({ date: f.slice(7, 17), size: fs.statSync(path.join(LOGDIR, f)).size }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

export function readLogDay(date, tailLines) {
  if (!DAY_RE.test(date)) return '';
  const f = dayFile(date);
  if (!fs.existsSync(f)) return '';
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  return (tailLines ? lines.slice(-tailLines) : lines).join('\n');
}

// date = 'YYYY-MM-DD' deletes one day; date = 'all' deletes every log. Returns count deleted.
export function deleteLogDay(date) {
  if (date === 'all') {
    let n = 0;
    for (const d of listLogDays()) { try { fs.rmSync(dayFile(d.date), { force: true }); n++; } catch { /* */ } }
    return n;
  }
  if (!DAY_RE.test(date)) return 0;
  const f = dayFile(date);
  if (fs.existsSync(f)) { try { fs.rmSync(f, { force: true }); return 1; } catch { return 0; } }
  return 0;
}
