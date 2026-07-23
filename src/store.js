// In-memory activity store with JSONL persistence, TTL reaping, and conflict detection.
// One activity = "actor is doing action on target". This is the whole data model.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const BEACON_HOME = process.env.BEACON_HOME || path.join(os.homedir(), '.beacon');
const LOG = path.join(BEACON_HOME, 'activity.jsonl');
const DEFAULT_TTL = Number(process.env.BEACON_TTL_MS) || 15 * 60 * 1000;

function naturalId(a) {
  return crypto.createHash('sha1').update(`${a.actor}|${a.action}|${a.target}`).digest('hex').slice(0, 12);
}

// Normalize a path/target for comparison: forward slashes, lowercase (Windows-friendly).
function norm(t) {
  return String(t || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class Store {
  constructor() {
    this.activities = new Map(); // id -> activity
    this.listeners = new Set();  // change listeners (SSE)
    fs.mkdirSync(BEACON_HOME, { recursive: true });
    this._replay();
  }

  _replay() {
    if (!fs.existsSync(LOG)) return;
    for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.state === 'done') this.activities.delete(ev.id);
        else this.activities.set(ev.id, ev);
      } catch { /* skip corrupt line */ }
    }
    this._reap();
  }

  _append(ev) {
    try { fs.appendFileSync(LOG, JSON.stringify(ev) + '\n'); } catch { /* history is best-effort */ }
  }

  // Drop activities whose lease has expired (crashed/forgotten sessions self-clear).
  _reap() {
    const now = Date.now();
    for (const [id, a] of this.activities) {
      if ((a.heartbeat || a.startedAt) + (a.ttlMs || DEFAULT_TTL) < now) this.activities.delete(id);
    }
  }

  // Upsert an activity (or clear it when state=done). Returns { id, conflicts }.
  report(input) {
    this._reap();
    const now = Date.now();
    const id = input.id || naturalId(input);

    if (input.state === 'done') {
      const ev = { ...(this.activities.get(id) || input), id, state: 'done', endedAt: now };
      this.activities.delete(id);
      this._append(ev);
      this._emit();
      return { id, conflicts: [] };
    }

    const existing = this.activities.get(id);
    const activity = {
      id,
      actor: input.actor,
      actorLabel: input.actorLabel || input.actor,
      action: input.action || 'working',
      target: input.target || '',
      detail: input.detail || '',
      exclusive: !!input.exclusive,
      cwd: input.cwd || '',
      state: 'active',
      startedAt: existing ? existing.startedAt : now,
      heartbeat: now,
      ttlMs: input.ttlMs || DEFAULT_TTL,
    };
    this.activities.set(id, activity);
    this._append(activity);
    this._emit();
    return { id, conflicts: this.conflictsFor(activity) };
  }

  // Who else is active and would collide with `a`?
  // - editing / generic: another actor on the same target.
  // - destructive git op (action "git:*"): anyone editing files inside the same working tree.
  conflictsFor(a) {
    const out = [];
    const isGit = (a.action || '').startsWith('git:');
    for (const other of this.activities.values()) {
      if (other.id === a.id || other.actor === a.actor) continue;
      if (isGit) {
        if ((other.action || '').startsWith('editing') && a.cwd && norm(other.target).startsWith(norm(a.cwd))) {
          out.push(other);
        }
      } else if (a.target && norm(other.target) === norm(a.target)) {
        out.push(other);
      }
    }
    return out;
  }

  // Clear activities. With an actor, clears just that actor's (e.g. a session that ended);
  // with no actor, clears everything (the dashboard "Clear" button). Returns how many.
  clearActor(actor) {
    let n = 0;
    for (const [id, a] of this.activities) {
      if (!actor || a.actor === actor) {
        this.activities.delete(id);
        this._append({ ...a, state: 'done', endedAt: Date.now() });
        n++;
      }
    }
    if (n) this._emit();
    return n;
  }

  list(exclude) {
    this._reap();
    return [...this.activities.values()].filter(a => !exclude || a.actor !== exclude);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { const snap = this.list(); for (const fn of this.listeners) { try { fn(snap); } catch { /* */ } } }
}
