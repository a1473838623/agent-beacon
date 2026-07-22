// Tiny local logger. Best-effort: logging never throws and never blocks the fail-open path.
// Errors/warnings are always recorded so a user can attach the log to a bug report;
// info is light (daemon lifecycle, overlaps); per-report noise is debug-only.
//
// Level:  BEACON_LOG_LEVEL=error|warn|info|debug   (default: info; BEACON_DEBUG=1 → debug)
// File:   $BEACON_HOME/beacon.log   (default ~/.beacon/beacon.log), rotated at ~1MB → .1
import fs from 'node:fs';
import path from 'node:path';
import { BEACON_HOME } from './store.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const THRESHOLD = LEVELS[process.env.BEACON_LOG_LEVEL] ?? (process.env.BEACON_DEBUG ? LEVELS.debug : LEVELS.info);
export const LOGFILE = path.join(BEACON_HOME, 'beacon.log');
const MAX_BYTES = 1_000_000;

export function log(level, component, message, extra) {
  try {
    if ((LEVELS[level] ?? LEVELS.info) > THRESHOLD) return;
    const tail = extra ? ' ' + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    const line = `${new Date().toISOString()} [${level}] ${component}: ${message}${tail}\n`;
    fs.mkdirSync(BEACON_HOME, { recursive: true });
    try { if (fs.statSync(LOGFILE).size > MAX_BYTES) fs.renameSync(LOGFILE, LOGFILE + '.1'); } catch { /* no file yet */ }
    fs.appendFileSync(LOGFILE, line);
  } catch { /* logging is best-effort — never throw */ }
}
