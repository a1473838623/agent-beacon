# Changelog

All notable changes to Beacon are documented here. Format follows [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## 0.10.6

- **Retracts 0.10.5. Beacon's hooks do fire in Codex.** 0.10.5 concluded they did not, on
  the strength of an empty daemon log and the absence of any `type: "command"` hook in
  OpenAI's bundled plugins. Both observations were real; the conclusion drawn from them was
  wrong.

  The activity log settles it. A live Codex session produced the matching pair:

  ```
  active | editing | ...\Codex6-09-03\co\work\codex-cli-hook-trigger.txt | 01a06616
  done   | editing | (same file)                                                | 01a06616
  ```

  `PreToolUse` reported the file the `apply_patch` was about to create, and `Stop` cleared
  it when the turn ended. `${PLUGIN_ROOT}` does expand in a hook command, and the payload is
  exactly the patch envelope `src/patch.js` parses.

- **Documents the two things that make working hooks look broken**, because both fooled this
  project into shipping a wrong conclusion:

  - **A running Codex session does not pick up newly installed hooks.** Every earlier test
    edited in a session started before the install, which looks identical to hooks not
    working. Restart Codex after installing.
  - **The Hooks settings page does not list plugin hooks.** It reports "no hooks found"
    while they are installed and firing — the hooks OpenAI's own bundled plugins declare
    don't appear there either. `beacon status` is the honest check.

## 0.10.5

- **Corrected the README: Beacon's hooks do not fire in Codex.** 0.10.0 claimed parity with
  Claude Code — warned before every edit — on the strength of the documented hook API. The
  runtime disagrees. A real Codex edit produced no report to the daemon, and Codex's log
  contains no hook evaluation whatsoever: no `PreToolUse`, no `apply_patch`, no
  `hooks.json`, not even a rejection.

  Nor is there a working example to copy. Of the six plugins OpenAI bundles, every hook is
  `type: "mcp_tool"` on `Stop`; none uses `type: "command"`, none declares `PreToolUse`, and
  none ships a `hooks/` directory — the three things the docs describe and this plugin used.
  The likely reading is that command hooks from a plugin do not run in this build.

  Codex is therefore MCP-only for now, and the README says so. The MCP server does work
  (fixed in 0.10.2) and is verified running in a live session, so Codex stays visible to
  every other agent and can query for collisions; it just is not warned automatically.

  The docs have now been wrong three times on adjacent details — `ON_FIRST_USE`,
  `${CLAUDE_PLUGIN_ROOT}`, and command hooks — so the Codex integration is documented from
  measurement from here on.

## 0.10.4

- **Fixed: `install.ps1` could add a PATH entry that Windows silently discards.** cmd.exe
  truncates the combined machine+user PATH at ~2047 characters, and the user PATH comes
  last, so on a machine already at the limit the newly appended entry is cut off. `beacon`
  then reports "is not internal or external command" while the shim exists and the registry
  entry is right there — a genuinely baffling failure. The installer now measures the
  combined length first. If adding an entry would cross the limit it puts the shim in a bin
  directory already on PATH (`~/.local/bin` or `~/bin`), which costs no length and sits
  earlier so it survives truncation; with no such directory it says so plainly and prints
  the full path to run instead of pretending the install succeeded.

## 0.10.3

- **npm publishes from the release too.** A tag now produces the GitHub release and the npm
  version together, so the two can't disagree about what a version contains. The job runs
  after the release job — a published npm version can never be replaced, a GitHub release
  can — and it skips silently if the `NPM_TOKEN` secret isn't set, or if that version is
  already on npm, so re-running a release is safe.

## 0.10.2

- **Fixed: the Codex MCP server never started.** Codex does not expand
  `${CLAUDE_PLUGIN_ROOT}`, despite the docs listing it as a compatibility alias. It passed
  the literal string through as a directory name, and Codex's own log said so plainly:

  ```
  Error: Cannot find module 'C:\...\${CLAUDE_PLUGIN_ROOT}\mcp\server.js'
  MCP server tools unavailable ... server_name=beacon
  ```

  The plugin listed `beacon` under "from plugins" in the UI the whole time, which is why
  this looked like it worked. The Codex manifest now declares the server inline with a
  relative path and `"cwd": "."` — no variable substitution at all, matching the only form
  OpenAI's own bundled plugins use. `.mcp.json` keeps `${CLAUDE_PLUGIN_ROOT}` for Claude
  Code, which does expand it.
- **Releases are built by CI.** Pushing a `v*` tag now runs the tests, checks the tag
  matches `package.json`, builds `beacon-plugin.zip` with `git archive`, takes the release
  notes from that version's CHANGELOG section, and publishes a GitHub release with the
  archive attached. The asset name carries no version so
  `releases/latest/download/beacon-plugin.zip` stays valid across releases.
- README documents installing from a release, both by uploading the archive to the Claude
  desktop app and with `claude --plugin-url`.

## 0.10.1

- **Fixed: Codex never registered Beacon's hooks.** The Codex manifest declared
  `"hooks": "./hooks/hooks.json"`, the string-path form the docs describe. Codex silently
  ignores it — the Hooks page showed "no hooks found" while the MCP server worked fine, so
  the plugin looked installed but only half of it was. The hooks are now inlined into
  `.codex-plugin/plugin.json` as an object, the only form OpenAI's own bundled plugins use.
- The inline copy uses Codex's native `${PLUGIN_ROOT}`; `hooks/hooks.json` keeps
  `${CLAUDE_PLUGIN_ROOT}` for Claude Code. Two copies of the same three hooks now exist, so
  a test asserts they declare the same events, matchers and scripts — a hook added to one
  and forgotten in the other would otherwise fail silently.
- `npm run pack:plugin` builds a `.zip` of the plugin for the Claude desktop app's
  **Upload local plugin** dialog, via `git archive` (no dependencies, contents at the
  archive root).

## 0.10.0

**Beacon is now a Codex plugin too**, at parity with the Claude Code one:

```
codex plugin marketplace add a1473838623/agent-beacon
```

Codex's hook system has caught up since this project's earlier notes were written. Its
`PreToolUse` now fires on file edits — not just shell commands — and accepts the same
`additionalContext` and `permissionDecision` output Claude Code does. So Codex gets the
real thing: the overlap warning injected into its own context *before* the edit, the same
guards on destructive git and redundant builds, and presence cleared on `Stop`.

- **`.codex-plugin/plugin.json`** and **`.agents/plugins/marketplace.json`** — the repo is
  now its own marketplace for Codex as well as for Claude Code.
- **One set of hooks serves both.** Codex accepts `${CLAUDE_PLUGIN_ROOT}` for compatibility
  and aliases the `Edit`/`Write` matchers onto `apply_patch`, so `hooks/hooks.json` is
  shared rather than duplicated.
- **`apply_patch` support** (`src/patch.js`). Codex hands the hook a whole patch envelope in
  `tool_input.command` rather than a file path, and one call can touch several files. The
  patch is parsed for `Update File` / `Add File` / `Delete File` / `Move to` entries, each
  file is reported, and conflicts are merged and de-duplicated across them. Paths inside a
  patch are repo-relative, so they are resolved against `cwd` to compare equal with what
  every other client reports.
- **Fixed the README.** It stated that Codex could not be warned before an edit, "a Codex
  platform limitation, not a Beacon one". That was true once and is not any more.
- `npm version` now syncs the Codex manifest too.

Note: Codex does not trust plugin hooks automatically. After installing, run `/hooks` and
trust Beacon's definitions, or the hooks stay inert — the MCP tools work either way.

## 0.9.1

- **Fixed: `beacon mcp` and foreground `beacon start` crashed on Windows.** Both dynamically
  imported an absolute path, and Node's ESM loader rejects a bare Windows path
  (`ERR_UNSUPPORTED_ESM_URL_SCHEME` — "Received protocol 'c:'"). They now go through
  `pathToFileURL()`. This broke the documented integration for every MCP client on Windows —
  Codex, Cursor, Cline, Windsurf, Zed — since all of them are told to run `beacon mcp`.
  `beacon start -d` was unaffected, because it spawns a child process rather than importing.
- MCP clients can now use the published package with no install at all:
  `command: npx`, `args: ["-y", "beacon-agents", "mcp"]`.

## 0.9.0

**Beacon is now a Claude Code plugin.** Install it with
`/plugin marketplace add a1473838623/agent-beacon` — the plugin ships the hooks and the MCP
server together, shows up under `/plugin` and `/mcp`, and needs no `beacon init`.

- **Plugin support.** Added `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
  (the repo is its own marketplace), `hooks/hooks.json` and `.mcp.json`. The MCP server is
  now registered for Claude Code, not just Codex.
- **Exactly-once reporting, whatever is installed.** Claude Code runs every matching hook
  registration, so a plugin install layered on a `beacon init` install used to report each
  edit twice. Hooks now fingerprint the event they received and atomically claim it, so one
  process handles it and the rest exit silently (`src/dedupe.js`). Fails open: if the claim
  can't be taken, the event is reported rather than dropped.
- **`beacon doctor`** — lists every place Beacon is registered (plugin, global settings,
  project settings, Codex) and flags redundant installs.
- **`beacon uninit`** — removes the `settings.json` hooks; the migration path to the plugin.
- **`beacon init` no longer stacks on a plugin install** — it detects one and stops, unless
  you pass `--force`.
- **`install.ps1`** — one-command Windows install that doesn't need Administrator rights.
  `npm i -g` writes into Node's global prefix, which is under `C:\Program Files` for
  installer- and nvm-based setups; this installs under `%LOCALAPPDATA%` and puts a shim on
  the user PATH.
- **Fixed: `mcp/` was missing from the published npm package**, so `beacon mcp` was broken
  for anyone who installed from npm rather than a git clone.
- `npm version` now syncs the plugin manifests via `scripts/sync-version.js`, so plugin
  users actually receive updates.
- **The npm package is published as `beacon-agents`.** npm normalizes names by stripping
  punctuation, so `agent-beacon` collides with an unrelated, actively maintained package
  called `agentbeacon` and is refused. The repository, the plugin, the marketplace and the
  `beacon` command keep their names; only `npm install` differs.


## [0.8.7] — 2026-07-25

### Added
- **Conflict notifications** (Settings -> "Notify me on conflicts", off by default). When two agents edit the same file, the **daemon** fires a native OS notification — so it reaches you even when the dashboard tab is closed or backgrounded (as long as the daemon is running; pairs with start-on-login). Deduped per file with a 2-minute cooldown. Zero-dependency: Windows toast via PowerShell, macOS `osascript`, Linux `notify-send`.

## [0.8.6] — 2026-07-25

### Changed
- **The dashboard leads with conflict status, not a session count.** Beacon is a conflict detector (reads arent even tracked), so the empty state no longer says the misleading "No agents active." Instead: idle shows a large centered **"No conflicts"**; agents editing without overlap show a subtle **"No conflicts · N agents editing"** line at the bottom; a real overlap shows a prominent **"Conflict"** banner above the highlighted rows.

## [0.8.5] — 2026-07-25

### Fixed
- **The Update button now works.** "Update (git pull)" used to pull and then just tell you to restart manually — which for an already-current checkout looked like it did nothing. It now pulls **and auto-restarts** the daemon to load the new code, so the version updates in one click.
- **No more flashing black console window on Windows** when updating, installing hooks, or restarting — `git` / `node` spawns now run with `windowsHide`.

## [0.8.4] — 2026-07-25

### Fixed
- The "Group edits" row no longer shows a pointer cursor on its hint text — it reused the checkbox-label style (`cursor: pointer`), which made the plain description look clickable. It is not clickable; now it renders as normal text.

## [0.8.3] — 2026-07-23

### Changed
- The installed-hook note in Settings now says titles only capture on **newly-started** sessions (restart a running one to include it) — so nobody expects titles to appear in an already-running session.

## [0.8.2] — 2026-07-23

### Changed
- Moved the "prompt hook not installed" notice out of the dashboard body into **Settings**, next to the grouping selector — no more banner floating over the empty state.
- Added a one-click **Install hook** button in Settings (runs `beacon init` for you, with your click as the consent) plus a live installed / not-installed status. Beacon still never edits your `~/.claude` without an explicit action — no silent auto-init.

## [0.8.1] — 2026-07-23

### Fixed
- **Switching the grouping mode is now instant.** Changing *Group edits* (Off / By session / By turn) re-renders the dashboard immediately — the daemon broadcasts on a settings change and the dropdown also re-fetches — instead of waiting for the next activity or the 5s poll.
- When grouping is on but no titles have been captured yet, the dashboard shows a hint to run `beacon init` and start a new session (titles require the `UserPromptSubmit` hook).

## [0.8.0] — 2026-07-23

### Added
- **Group edits by session or conversation turn** (Settings → *Group edits*: Off / By session / By turn). A new `UserPromptSubmit` hook captures the first line of your prompt as a group title, and the dashboard groups a session's edits either all together (**session**) or per turn (**turn**). Beacon correctly ties multiple turns to one session via `session_id` + `prompt_id`.
  - **Opt-in, off by default** — it stores prompt text (more sensitive than paths), though everything stays 100% local. Images/attachments/huge pastes fall back to a generic label (`(image / attachment)`), and titles are truncated to ~72 chars.
  - `beacon init` now installs the `UserPromptSubmit` hook too, and upgrades older installs in place.
- Activities now carry `promptId`; `/activity` and the SSE stream include `titles` and the current `grouping` mode; new `POST /title` endpoint (setting-gated).

## [0.7.3] — 2026-07-23

### Fixed
- **Status dot is now genuinely dynamic** — it pulses green while the daemon is healthy and turns solid red when the daemon is unreachable, backed by an active 3-second health poll (not just passive SSE events). Removed a CSS `background` transition that, under a busy event stream, left the dot stuck on its neutral gray color.

## [0.7.2] — 2026-07-23

### Changed
- Per-session identity is now a soft colored **chip** around the session id (light tint background + colored border, readable neutral text) instead of a left-accent border — cleaner, and ties the color directly to the session name.

## [0.7.1] — 2026-07-23

### Changed
- **Cleaner activity rows.** The "overlap" state is now a subtle background tint instead of a full yellow border, so it no longer clashes with the per-session left-accent color. Dropped the redundant color dot — each row's session color is the left-accent border.

## [0.7.0] — 2026-07-23

### Added
- **Settings panel** (⚙ in the dashboard) — auto-check-for-updates and start-on-login toggles (both **off by default**), an update checker, and a per-day log viewer.
- **Check for updates** — compares your version against the latest GitHub release (manual button, or opt-in auto-check on load). If Beacon is a git checkout, an "Update (git pull)" button appears. This is the *only* network call Beacon makes, and only when you ask.
- **Start on login** — cross-platform: Windows (hidden-launch `.vbs` in Startup), Linux (XDG `.desktop`), macOS (LaunchAgent). Off by default, toggled from Settings.
- **Per-day logs** — logging now writes `logs/beacon-YYYY-MM-DD.log`; view or delete logs (per day or all) from Settings or `beacon logs [--date YYYY-MM-DD]`.

### Changed
- **Status dot is green (healthy) / red (disconnected) only** — dropped the transient yellow state.
- **Dashboard polish** — sticky footer pinned to the bottom; per-session color moved from a floating bar to a cleaner left-accent border on each card.

## [0.6.0] — 2026-07-22

### Added
- **Dashboard: per-session colors** — each actor gets a stable color (bar + dot) from a fixed palette, so overlapping sessions are easy to tell apart at a glance.
- **Dashboard: per-row details** — a `details` button opens a modal with the full session UUID, action, target, working dir, detail, start/last-seen times, TTL/expiry, and exclusivity.
- **Dashboard: light / dark toggle** — remembers your choice (localStorage) and defaults to your OS preference.
- **Entangling-git guard** — `git add -A` / `git add .` and `git commit -a` / `--all` now warn when another agent has uncommitted edits in the tree, since they'd sweep that agent's work into your commit. Suggests staging specific files instead.
- **Build/deploy placeholders** — the Bash hook now recognizes `mvn`/`gradle`/`make`/`cargo build`/`go build`/`npm|yarn|pnpm build` and `docker`/`docker compose up|build`/`kubectl apply`, reports them as `building`/`deploying` on a `job://<dir>` target, and warns a second agent that a build/deploy is already running there (parallel is fine; redundant wastes CPU/Docker).

## [0.5.2] — 2026-07-22

### Changed
- **Clear now asks for confirmation** and its tooltip/label spell out the scope: it dismisses live activity for *all* sessions at once (they reappear as they keep working) and never touches files, work, or the history log. Previously it fired instantly with no guard. Docs (FAQ, both languages) clarify that Clear loses no durable data but is a global action.

## [0.5.1] — 2026-07-22

### Fixed
- Dashboard **Clear / Restart / Quit** buttons now show a toast on success or failure instead of failing silently. Clicking one against an out-of-date daemon (e.g. a pre-0.5.0 daemon that lacks the `/clear` endpoint) previously looked like it did nothing; now it tells you to run `beacon restart`.

## [0.5.0] — 2026-07-22

### Fixed
- **Activities no longer linger after editing stops.** Added a Claude Code **Stop hook** (`hooks/stop.js`) that clears a session's activity the moment its turn ends, and shortened the edit-presence TTL from 15 min to 3 min as a crash backstop. Previously a one-second edit showed as "editing" for 15 minutes.
- `beacon init` now **upgrades older installs in place** — if the PreToolUse hook is already present but the Stop hook isn't, it adds the Stop hook (without duplicating anything). Re-run `beacon init` after upgrading.

### Added
- **Dashboard controls** — Clear / Restart / Quit buttons in the header.
- **Daemon control endpoints** — `POST /clear` (clear one actor or everything), `POST /restart` (hot restart with port hand-off), `POST /shutdown`. Guarded against cross-origin browser requests.
- **`beacon restart`** command; `beacon logs`/`status` unchanged.

## [0.4.0] — 2026-07-22

### Changed
- **`beacon init` now installs globally by default** (`~/.claude/settings.json`), covering every project on the machine with one command. Use `--project` to scope to a single repo. (Previously defaulted to project-level.)

### Added
- **Mutually-exclusive scopes** — installing at one level automatically removes the Beacon hook from the other, so it can never double-fire for a single edit. Applies to both the Claude Code hook (`beacon init` ↔ `beacon init --project`) and Codex (`beacon init --codex` ↔ `--codex --project`). Removal preserves all other settings/config; the Codex TOML remover strips only the `[mcp_servers.beacon]` table.
- Docs: "Global vs project scope" section in both READMEs, with the safety rationale (conflict detection is path/tree-scoped, so global raises no cross-project false alarms).

## [0.3.0] — 2026-07-22

### Added
- **Local logging** (`src/log.js`) — best-effort, never throws, never blocks the fail-open path. Errors/warnings are always recorded (including every time the hook fails open because the daemon was unreachable); `info` covers daemon lifecycle and overlaps; `debug` traces every report. Written to `$BEACON_HOME/beacon.log`, rotated at ~1 MB. Level via `BEACON_LOG_LEVEL` / `BEACON_DEBUG`.
- **`beacon logs`** — view the log (`--tail N`, `--path`, `--clear`); `beacon status` now prints the log path.
- Logging wired into daemon (lifecycle, errors, overlaps, uncaught exceptions), the Claude Code hook (why it failed open), and the MCP server (tool failures).
- **Bug-report issue template** (`.github/ISSUE_TEMPLATE/bug_report.yml`) that asks for `beacon logs`, version, client, and OS.
- Docs: "Troubleshooting & reporting bugs" section in both READMEs.

### Note
- The log is 100% local; nothing is ever transmitted. Review before attaching to an issue — it can contain project file paths.

## [0.2.0] — 2026-07-22

### Added
- **MCP server** (`mcp/server.js`) — zero-dependency stdio JSON-RPC 2.0 server exposing `report_activity` and `get_activity` tools to any MCP client (**Codex**, Cursor, Cline, Windsurf, Zed, Claude Agent SDK). Bridges to the same local daemon, lazy-starts it, and fails soft.
- **`beacon mcp`** — run the stdio MCP server (the command MCP clients spawn).
- **`beacon init --codex`** — register the Beacon MCP server in `~/.codex/config.toml` (append-if-absent, idempotent, never clobbers existing config). `--project` scopes it to `.codex/config.toml`.
- Docs: "Codex & other MCP clients" section in both READMEs, capability matrix updated, roadmap checked off.

### Notes
- Cross-tool interop verified: a Codex session (MCP) and a Claude Code session (hook) report to the same bus and see each other's activity.

## [0.1.0] — 2026-07-21

First public release. 🛰️

### Added
- **Activity bus core** (`src/store.js`) — `{ actor, action, target }` activity model with JSONL persistence, TTL heartbeat reaping, and overlap/conflict detection. Zero dependencies.
- **Local daemon** (`src/daemon.js`) — tiny HTTP server: `POST /report`, `GET /activity`, `GET /health`, `GET /events` (SSE). Single-instance via port bind; fails open on port conflict.
- **Live dashboard** (`src/dashboard.html`) — single-file, real-time view of every active agent, with overlap highlighting.
- **Claude Code hook** (`hooks/pretooluse.js`) — auto-reports edits and dangerous git ops; injects a one-line warning into agent context only on a real overlap. Never blocks; always fails open.
- **Destructive-git guard** — warns (or asks, with `BEACON_GUARD=ask`) on `checkout` / `reset --hard` / `stash` / `rebase` / `merge` / `clean` / `restore` when another session has active edits in the tree.
- **CLI** (`bin/beacon.js`) — `init`, `start`, `stop`, `status`, `report`, `watch`.
- **Universal reporters** — `beacon watch <dir>` (file-system watcher for any editor/human) and `scripts/with_report.sh` (wrap any git/docker/CI command).
- MIT license, CI on Linux + Windows across Node 18/20/22, smoke tests.
