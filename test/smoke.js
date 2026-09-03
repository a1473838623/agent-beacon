// Minimal smoke test for the store — no framework, no deps. Run: npm test
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate storage so the test never touches a real ~/.beacon
process.env.BEACON_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
const { Store } = await import('../src/store.js');

const s = new Store();

// 1. report returns an id and no conflict for a lone actor
let r = s.report({ actor: 'A', action: 'editing', target: '/repo/file.js' });
assert.ok(r.id, 'report should return an id');
assert.equal(r.conflicts.length, 0, 'no conflict for a single actor');

// 2. a different actor on the same file → conflict
r = s.report({ actor: 'B', action: 'editing', target: '/repo/file.js' });
assert.equal(r.conflicts.length, 1, 'second actor on same file should conflict');
assert.equal(r.conflicts[0].actor, 'A');

// 3. same actor re-reporting (heartbeat) is not a self-conflict
r = s.report({ actor: 'A', action: 'editing', target: '/repo/file.js' });
assert.equal(r.conflicts.length, 1, 'A still conflicts with B, not itself');

// 4. path normalization: backslashes / case / trailing slash
r = s.report({ actor: 'C', action: 'editing', target: '\\REPO\\FILE.js' });
assert.equal(r.conflicts.length, 2, 'normalized path should match /repo/file.js');

// 5. dangerous git op conflicts with anyone editing in the same tree
r = s.report({ actor: 'D', action: 'git:checkout', target: '/repo', cwd: '/repo' });
assert.ok(r.conflicts.length >= 1, 'git op should see editors in the same working tree');

// 6. done clears the activity
s.report({ actor: 'A', action: 'editing', target: '/repo/file.js', state: 'done' });
assert.ok(!s.list().some((a) => a.actor === 'A' && a.target === '/repo/file.js'), 'done removes activity');

// 7. TTL reaping
s.report({ actor: 'E', action: 'editing', target: '/repo/old.js', ttlMs: 1 });
await new Promise((r) => setTimeout(r, 5));
assert.ok(!s.list().some((a) => a.actor === 'E'), 'expired activity should be reaped');


// ---- dedupe: exactly one hook process acts on an event, however many are registered ----
const { claimEvent } = await import('../src/dedupe.js');

const evt = { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: '/repo/a.js' }, cwd: '/repo' };

// 8. the first registration to reach the event handles it
assert.equal(claimEvent(evt, 'PreToolUse'), true, 'first claim wins');

// 9. sibling registrations firing on the SAME event are suppressed
assert.equal(claimEvent(evt, 'PreToolUse'), false, 'second registration must not re-report');
assert.equal(claimEvent(evt, 'PreToolUse'), false, 'third registration must not re-report');

// 10. a different event in the same session is unaffected
const other = { ...evt, tool_input: { file_path: '/repo/b.js' } };
assert.equal(claimEvent(other, 'PreToolUse'), true, 'a different file is a different event');

// 11. the same payload under a different hook event is unaffected
assert.equal(claimEvent(evt, 'Stop'), true, 'Stop is a different event from PreToolUse');

// 12. a genuine repeat, once the claim has aged out, is reported again
process.env.BEACON_CLAIM_TTL_MS = '1';
const { claimEvent: claimShortTtl } = await import('../src/dedupe.js?ttl=short');
const repeat = { ...evt, session_id: 's2' };
assert.equal(claimShortTtl(repeat, 'PreToolUse'), true, 'first of the repeated pair');
await new Promise((r) => setTimeout(r, 20));
assert.equal(claimShortTtl(repeat, 'PreToolUse'), true, 'same action later is a real event, not a duplicate');


// ---- Codex apply_patch: the hook gets a patch envelope, not a file path ----
const { filesFromPatch } = await import('../src/patch.js');

const patch = [
  '*** Begin Patch',
  '*** Update File: src/app.js',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  '*** Add File: src/new.ts',
  '+hello',
  '*** Delete File: src/old.ts',
  '*** End Patch',
].join('\n');

// 13. every file the patch touches is extracted, resolved against cwd
let files = filesFromPatch(patch, '/repo');
assert.equal(files.length, 3, 'update + add + delete should all be reported');
assert.ok(files.every((f) => path.isAbsolute(f)), 'patch paths are repo-relative and must be resolved');
assert.ok(files.some((f) => f.replace(/\\/g, '/').endsWith('/repo/src/app.js')));

// 14. a file named twice in one patch is reported once
files = filesFromPatch('*** Update File: a.js\n*** Move to: a.js\n', '/repo');
assert.equal(files.length, 1, 'duplicate paths collapse');

// 15. an absolute path inside a patch is left alone
files = filesFromPatch('*** Update File: /abs/x.js\n', '/repo');
assert.equal(files[0].replace(/\\/g, '/'), '/abs/x.js');

// 16. non-patch input yields nothing, so the hook falls through to allow()
assert.equal(filesFromPatch('just a shell command', '/repo').length, 0);
assert.equal(filesFromPatch('', '/repo').length, 0);

// ---- the two hook manifests must not drift apart ----
// Claude Code reads hooks/hooks.json. Codex ignores a string path there and only picks up
// hooks inlined into its own manifest, so the same three hooks are declared twice. Assert
// they stay in step: a hook added to one and forgotten in the other fails silently at
// runtime, which is the worst way for this to break.
const claudeHooks = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8')).hooks;
const codexHooks = JSON.parse(fs.readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8')).hooks.hooks;

// Reduce an entry list to what must match, ignoring the plugin-root variable name:
// Claude Code only knows ${CLAUDE_PLUGIN_ROOT}, Codex prefers its native ${PLUGIN_ROOT}.
const shape = (entries) => entries.map((e) => ({
  matcher: e.matcher || '',
  scripts: (e.hooks || []).map((h) => String(h.command).replace(/\$\{[A-Z_]*PLUGIN_ROOT\}/, '<root>')),
}));

// 17. both manifests declare the same hook events
assert.deepEqual(Object.keys(codexHooks).sort(), Object.keys(claudeHooks).sort(),
  'Claude and Codex manifests must declare the same hook events');

// 18. and the same matcher + script for each
for (const event of Object.keys(claudeHooks)) {
  assert.deepEqual(shape(codexHooks[event]), shape(claudeHooks[event]),
    `hook "${event}" differs between the Claude and Codex manifests`);
}

// ---- shipped text must not contain stray control characters ----
// A release's notes are cut from CHANGELOG.md by CI, so a control byte that sneaks into the
// file is published as mojibake and cannot be edited out of the release afterwards. They
// arrive from escaping accidents while editing (a literal \2026 in a path becoming \x82),
// are invisible in most editors, and survive review — so check for them instead.
const TEXT_FILES = ['CHANGELOG.md', 'README.md', 'README.zh-CN.md', 'PRIVACY.md'];

// 19. no C0 control characters other than tab and newline
for (const name of TEXT_FILES) {
  const text = fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
  const bad = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // C0 (minus tab/newline/CR), DEL, the C1 block, and the replacement character.
    // The bug that prompted this was U+0082, a C1 control — outside C0, and invisible.
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)
        || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0xfffd) {
      bad.push(`${name}:${text.slice(0, i).split('\n').length} U+${c.toString(16).padStart(4, '0')}`);
    }
  }
  assert.deepEqual(bad, [], `control characters in shipped text: ${bad.join(', ')}`);
}

console.log('✓ all smoke tests passed');
