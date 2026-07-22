# Contributing to Beacon

Thanks for your interest! Beacon is deliberately small and dependency-free — please help keep it that way.

## Ground rules

- **No runtime dependencies.** The core (daemon, store, hook, CLI) must run on a stock Node ≥ 18 with nothing installed. Dev-only tooling is fine.
- **Fail open, always.** Nothing Beacon does may break a coding session. Hooks and clients must swallow their own errors and never block by default.
- **Local only.** No network calls, telemetry, or accounts. Ever.

## Dev setup

```bash
git clone https://github.com/a1473838623/agent-beacon.git
cd agent-beacon
npm link          # `beacon` on your PATH
npm test          # run the smoke tests
node bin/beacon.js start   # run the daemon in the foreground
```

## Making a change

1. Open an issue describing the problem or idea (for anything non-trivial).
2. Keep PRs focused and small. Add or update a smoke test in `test/` when you touch the store.
3. Update the README if you change behavior or config.

## Project layout

```
bin/beacon.js         CLI (init / start / stop / status / report / watch)
src/daemon.js         local HTTP server + SSE
src/store.js          activity model, persistence, conflict detection  ← the core
src/dashboard.html    live dashboard (single file, no build)
hooks/pretooluse.js   Claude Code hook (report + in-context warning, fail-open)
scripts/with_report.sh wrap any command as an activity
test/smoke.js         dependency-free tests
```

Happy hacking. 🛰️
