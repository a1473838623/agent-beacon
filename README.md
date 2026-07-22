<div align="center">

# 🛰️ Beacon

### Real-time presence & collision-avoidance for parallel AI coding agents

Run two, five, ten Claude Code sessions on the same repo at once — and **never let them clobber each other's work again.**

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

[![License: MIT](https://img.shields.io/badge/License-MIT-4c9aff.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3fb950.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-3fb950.svg)](package.json)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-8b5cf6.svg)](https://docs.claude.com/en/docs/claude-code)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ffb547.svg)](CONTRIBUTING.md)

<img src="docs/hero.svg" alt="Beacon live dashboard showing two agents editing the same file with an overlap warning" width="720" />

</div>

---

## The problem

Running multiple AI coding agents in parallel is the new normal — one session refactors the API, another writes tests, a third bumps configs. It's a huge speedup, until two of them edit the same file, or one runs `git checkout` / `git stash` and silently yanks the files out from under the others. You discover the collision only *after* work is lost.

Agents are flying blind. **They can't see each other.**

## What Beacon does

Beacon is a tiny local service that gives every agent a shared, real-time picture of *who is touching what* — and warns them the instant two of them overlap.

- 👀 **Mutual awareness** — every session reports what it's editing; others can see it live.
- ⚡ **Collision warnings, in-context** — when an agent is about to edit a file another agent is already in, Beacon injects a one-line heads-up *into that agent's own context*, before the edit.
- 🔪 **Guards destructive git ops** — `checkout`, `reset --hard`, `stash`, `rebase`, `clean` while another session has unsaved edits in the tree → the agent is warned (or asked to confirm).
- 📊 **Live dashboard** — a single local web page showing every active agent, updated in real time.
- 🪶 **Weightless & invisible** — zero dependencies, 100% local, and it **never blocks your work**. No conflict? You never notice it's there.

> **Safe by design:** Beacon is advisory. It *fails open* — if the daemon is down or anything errors, your session behaves exactly as if Beacon weren't installed. It never denies an edit by default, and in the common (no-overlap) case it adds **zero tokens** to your agent's context.

---

## Quick start

```bash
# 1. Get it (Node ≥ 18)
git clone https://github.com/a1473838623/agent-beacon.git && cd agent-beacon
npm link            # puts the `beacon` command on your PATH  (or: npm i -g agent-beacon)

# 2. In your project, wire up Claude Code + start the daemon
cd /path/to/your/project
beacon init         # installs a PreToolUse hook into .claude/settings.json
beacon start -d     # start the local daemon (background)

# 3. Watch it live
open http://127.0.0.1:4517
```

That's the whole setup. **New Claude Code sessions in that project now report activity automatically** — no per-session steps, no prompts to remember.

Open a second session, have both edit the same file, and watch the overlap light up on the dashboard while the second agent gets a warning in its context.

---

## How it works

```
   Claude Code session ──PreToolUse hook──┐
   Codex / MCP agent   ──MCP tools────────┤
   git / docker / CI   ──with_report──────┼──▶  beacon daemon  ──▶  live dashboard
   any editor / human  ──file watcher─────┘     (local HTTP, JSONL)     + in-context warnings
```

One idea, all the way down: **an activity is `{ actor, action, target }`** — "session A is *editing* `orders.ts`". Everything is a client that reports activities; the daemon detects overlaps and answers *"is anyone else on this?"*. That's it.

- **Report** and **query** are the only two operations. `report` even returns the conflicts in its response, so an agent learns of an overlap in the same call it announces its own work.
- **Reporting is out-of-band** (a hook / a shell wrapper), so your agent spends no tokens announcing itself.
- **Awareness is surfaced only on a real conflict** — a short, relevant line, exactly when it matters.

---

## Integrations

Beacon is **not locked to Claude Code**. The core is a language-agnostic local HTTP bus; each integration is just a way to feed it activities.

| Actor | How it reports | Gets in-context warnings? |
|---|---|---|
| **Claude Code** | `beacon init` (PreToolUse hook) — automatic, zero-config | ✅ yes, injected before the edit |
| **Codex** | `beacon init --codex` (MCP server) + one line in `AGENTS.md` | ➖ can query & report; the model decides how to act |
| **Any MCP agent** *(Cursor, Cline, Windsurf, Zed, Claude Agent SDK)* | point its MCP config at `beacon mcp` — `report_activity` / `get_activity` tools | ➖ can query & report |
| **git / docker / CI scripts** | `with_report <action> <target> -- <cmd>` | — |
| **Any editor or human** | `beacon watch <dir>` (file-system watcher) | — |
| **Anything that speaks HTTP** | `POST /report` | — |

Claude Code gets the richest experience because its hooks let Beacon both auto-report *and* inject the warning back into the agent mid-task. Every other tool still shows up on the dashboard and in everyone else's warnings.

### Codex & other MCP clients

Beacon ships a zero-dependency **MCP server**, so any MCP-capable agent can report and query activity on the same bus your Claude Code sessions use.

**Codex:**

```bash
beacon init --codex      # adds [mcp_servers.beacon] to ~/.codex/config.toml
beacon start -d
```

Optionally add one line to your `AGENTS.md` so Codex uses it proactively:

> Before editing a file or running a risky command, call the `beacon` `get_activity` / `report_activity` tools to avoid colliding with other agents.

**Cursor / Cline / Windsurf / Zed / Claude Agent SDK:** point the client's MCP config at the server (`command: node`, `args: ["<install>/mcp/server.js"]`, or just `beacon mcp` if `beacon` is on PATH).

> **Why Codex is different:** Codex hooks only fire on Bash (not file writes) and can't inject context, so Codex gets **report/query via MCP** (opt-in through that `AGENTS.md` line) rather than Claude Code's fully-automatic, warned-before-every-edit flow. Either way, a Codex session becomes visible to *every other* agent — and with `beacon watch` its file edits show up with zero Codex config at all.

---

## Configuration

All optional — sensible defaults out of the box. Set as environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `BEACON_PORT` | `4517` | Daemon port (localhost only) |
| `BEACON_GUARD` | `warn` | `warn` = advisory context · `ask` = require confirm on destructive git ops · `off` = report only, never warn |
| `BEACON_TTL_MS` | `900000` | How long an activity lives without a heartbeat (15 min) — crashed sessions self-clear |
| `BEACON_HOME` | `~/.beacon` | Where the daemon stores its pidfile and activity log |

---

## FAQ

**Will this slow my agents down or blow up my token usage?**
No. Reporting happens out-of-band (in the hook, not the model), so it costs zero model tokens. The only thing ever added to an agent's context is a single warning line, and only when there's a genuine overlap. No conflict → nothing added.

**Can it break my workflow / block an edit?**
Not by default. It's advisory and fails open — daemon down, timeout, bad input, all result in "do nothing, allow." Set `BEACON_GUARD=ask` only if you *want* destructive git ops to pause for confirmation on a real conflict.

**Does it send my code anywhere?**
No. Everything is local — a daemon on `127.0.0.1`, an append-only log under `~/.beacon`. No network, no telemetry, no accounts.

**Does it replace git / locks / worktrees?**
No — it's the awareness layer *underneath* them. It doesn't take locks or move files; it makes agents *see* each other so they (or you) can coordinate. Pairs perfectly with git worktrees if you use them.

---

## Roadmap

- [x] Native **MCP server** (`report_activity` / `get_activity`) — works with Codex, Cursor, Cline, Windsurf, Zed, and the Claude Agent SDK
- [ ] `beacon init --codex` also installs a Codex Bash hook to hard-block destructive git ops on conflict
- [ ] `SessionStart` hook: greet each new session with a summary of what peers are doing
- [ ] Optional hard **leases** for resources that truly need serialization (e.g. one build at a time)
- [ ] Slack / desktop notification on overlap
- [ ] `npx agent-beacon` zero-install runner

Ideas and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Contributing

Beacon is intentionally tiny (a few hundred lines, no dependencies). That makes it easy to read, easy to hack on, and easy to trust. Run the tests with `npm test`. Issues and pull requests are very welcome.

## License

[MIT](LICENSE) © Beacon contributors
