# Changelog

All notable changes to Beacon are documented here. Format follows [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

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
