// Persisted daemon settings — $BEACON_HOME/settings.json. All optional, safe defaults.
import fs from 'node:fs';
import path from 'node:path';
import { BEACON_HOME } from './store.js';

const FILE = path.join(BEACON_HOME, 'settings.json');

// Update checks and auto-start are OFF by default — Beacon stays 100% local unless you opt in.
const DEFAULTS = { autoCheckUpdates: false, startOnBoot: false };

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  fs.mkdirSync(BEACON_HOME, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2));
  return merged;
}
