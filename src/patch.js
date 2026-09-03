import path from 'node:path';

// Codex reports file edits as `apply_patch`, and hands the hook the whole patch envelope
// rather than a path:
//
//   *** Begin Patch
//   *** Update File: src/app.js
//   ...
//   *** End Patch
//
// One call can touch several files, so this returns a set. Paths inside a patch are
// repo-relative; they're resolved against cwd so they compare equal to the absolute paths
// every other client reports.
export function filesFromPatch(patch, cwd) {
  const out = [];
  const re = /^\*\*\*\s+(?:Update File|Add File|Delete File|Move to):\s*(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(patch))) {
    const raw = m[1].trim();
    if (raw) out.push(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));
  }
  return [...new Set(out)];
}

