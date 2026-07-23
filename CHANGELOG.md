# Changelog

All notable changes to Beacon are documented here. Format follows [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

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
