# Changelog

All notable changes to Beacon are documented here. Format follows [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

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
