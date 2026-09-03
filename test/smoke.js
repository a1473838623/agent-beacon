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

console.log('✓ all smoke tests passed');
