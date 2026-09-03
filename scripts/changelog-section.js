#!/usr/bin/env node
// Print one version's section of CHANGELOG.md, for use as GitHub release notes.
//
//   node scripts/changelog-section.js 0.10.1
//
// Release notes that are written by hand a second time drift from the changelog, so the
// release workflow reads them from the one place they already live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = String(process.argv[2] || '').replace(/^v/, '');
if (!version) {
  console.error('usage: changelog-section.js <version>');
  process.exit(1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n');

const start = lines.findIndex((l) => l.trim() === `## ${version}`);
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => /^## /.test(l));

console.log((end === -1 ? rest : rest.slice(0, end)).join('\n').trim());
