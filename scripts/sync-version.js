#!/usr/bin/env node
// Keep the plugin manifests' version in step with package.json — Claude Code and Codex both.
//
// Claude Code only offers a plugin update when the manifest version changes, so a release
// that bumped package.json alone would never reach plugin users. Wired into the npm
// `version` lifecycle script, so `npm version patch|minor|major` updates all three files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const targets = [
  { file: '.claude-plugin/plugin.json', set: (j) => { j.version = version; } },
  { file: '.claude-plugin/marketplace.json', set: (j) => { j.metadata.version = version; j.plugins[0].version = version; } },
  { file: '.codex-plugin/plugin.json', set: (j) => { j.version = version; } },
];

for (const t of targets) {
  const p = path.join(ROOT, t.file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  t.set(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log(`✓ ${t.file} → ${version}`);
}
