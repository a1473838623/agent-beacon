<div align="center">

# 🛰️ Beacon

### Real-time presence & collision-avoidance for parallel AI coding agents

Run two, five, ten Claude Code sessions on the same repo at once — and **never let them clobber each other's work again.**

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

[![npm](https://img.shields.io/npm/v/beacon-agents?color=cb3837&label=npm)](https://www.npmjs.com/package/beacon-agents)
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
- 🔪 **Guards risky shared-tree ops** — `checkout` / `reset --hard` / `stash` / `rebase` / `clean`, *and* `git add -A` / `commit -a` (which sweep up another agent's uncommitted work), while another session is editing the tree → the agent is warned (or asked to confirm).
- 🔁 **Flags redundant builds/deploys** — if a build or deploy is already running in a directory, a second agent kicking off another one is warned that it's just burning CPU/Docker. Parallel is fine; *redundant* is wasteful.
- 📊 **Live dashboard** — every active agent in real time, **color-coded per session**, with per-row **details**, a **light/dark** toggle, optional **grouping of edits by session or conversation turn**, and a **Settings** panel (update checks, start-on-login, per-day log viewer).
- 🪶 **Weightless & invisible** — zero dependencies, 100% local, and it **never blocks your work**. No conflict? You never notice it's there.

> **Safe by design:** Beacon is advisory. It *fails open* — if the daemon is down or anything errors, your session behaves exactly as if Beacon weren't installed. It never denies an edit by default, and in the common (no-overlap) case it adds **zero tokens** to your agent's context. Nothing leaves your machine — see [PRIVACY.md](PRIVACY.md).

---

## Quick start

Pick the install that matches how you use Beacon. Both talk to the same local daemon, and
**both can be installed at once** — Beacon suppresses duplicate reports at runtime.

### Claude Code — install the plugin (recommended)

```bash
/plugin marketplace add a1473838623/agent-beacon
/plugin install beacon@agent-beacon
```

That is the whole setup. The plugin brings the hooks *and* the MCP server, and the daemon
lazy-starts itself on the first edit — nothing else to run. Beacon shows up under `/plugin`
and `/mcp`, and you can disable it from there without editing any config file.

### Claude desktop app — upload the plugin

The desktop app has no `/plugin` terminal panel. Add the marketplace from its plugin
browser, or upload a plugin archive directly under **Settings → Plugins → Add → Upload
local plugin**. Build the archive with:

```bash
npm run pack:plugin      # → beacon-plugin.zip
```

It uses `git archive`, so the plugin files sit at the archive root (`.claude-plugin/
plugin.json` directly inside, not nested in a folder), which is what the dialog expects.

> Uploading a build whose plugin name matches one you already installed **replaces that
> install in place** — the app reuses the existing version directory rather than creating
> a new one, so the recorded install path can still name the old version while the
> contents are new. Harmless, but prefer the marketplace when you have one: a later
> marketplace update will otherwise overwrite your upload.

### Codex — install the plugin

```bash
codex plugin marketplace add a1473838623/agent-beacon
```

Then install `beacon` from `codex /plugins`, and run `/hooks` to trust its hooks.
Same hooks, same MCP server, same daemon as the Claude Code plugin.

### CLI — for the `beacon` command, the dashboard, and non-Claude-Code agents

One command, any platform:

```bash
npm i -g beacon-agents
```

Then:

```bash
beacon init         # GLOBAL by default — every project on this machine is covered
beacon start -d     # start the local daemon (background)
open http://127.0.0.1:4517
```

**Windows:** `npm i -g` writes into Node's global prefix, which sits under
`C:\Program Files` for installer- and nvm-based setups — so it fails with `EPERM`
unless you run as Administrator. If that happens, use the installer instead. It needs no
elevation: it installs under `%LOCALAPPDATA%` and puts a shim on your user PATH.

```powershell
irm https://raw.githubusercontent.com/a1473838623/agent-beacon/main/install.ps1 | iex
```

Working on Beacon itself? Clone and `npm link` instead:

```bash
git clone https://github.com/a1473838623/agent-beacon.git && cd agent-beacon && npm link
```

> **The npm package is [`beacon-agents`](https://www.npmjs.com/package/beacon-agents), not
> `agent-beacon`.** npm normalizes package names by stripping punctuation, which collides with
> an unrelated, actively maintained package called `agentbeacon`. The repository, the Claude
> Code plugin, the marketplace and the `beacon` command are all unaffected — only
> `npm install` takes the different name.

**Every new Claude Code session on this machine now reports activity automatically** — no
per-project steps, no per-session steps, no prompts to remember.

Open a second session, have both edit the same file, and watch the overlap light up on the
dashboard while the second agent gets a warning in its context.

### Running both installs at once

Nothing breaks. Claude Code runs every matching hook registration, so having the plugin
*and* `beacon init` means each hook script is spawned two or three times per edit — but each
event is handled exactly once. Every hook fingerprints the event it received and atomically
claims it; whichever process gets there first does the work, and its siblings exit silently
(`src/dedupe.js`). No duplicate rows, no duplicate warnings, no double-counted conflicts.

It is still wasted work, so Beacon tells you about it:

```bash
beacon doctor       # lists every place Beacon is registered, flags redundant ones
beacon uninit       # removes the settings.json hooks (use when moving to the plugin)
```

`beacon init` also detects an existing plugin install and stops rather than stacking on top
of it (override with `--force`).

### Global vs project scope

`beacon init` installs **globally by default** (`~/.claude/settings.json`), so every project is covered with one command. Prefer to scope it to a single repo? Use `--project`:

```bash
beacon init             # global — all projects (recommended default)
beacon init --project   # this repo only (.claude/settings.json)
```

**The two levels are mutually exclusive — switching auto-disables the other.** Running `beacon init --project` removes the global hook; running `beacon init` again removes the project hook. This guarantees the hook never fires twice for one edit. (It cleans the global level and the *current* project; if you'd enabled several projects individually, re-run `--project` in each to switch them off.) Global monitoring is safe: conflict detection is scoped by file path and working tree, so unrelated projects never raise false overlaps — global just means "always on, everywhere."

The daemon and dashboard are already machine-wide, so with global scope the dashboard becomes a single live view of everything you're doing across every repo.

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
| **Claude Code** | plugin install (or `beacon init`) — automatic, zero-config | ✅ yes, injected before the edit |
| **Codex** | plugin install (hooks + MCP), or `beacon init --codex` for MCP only | ✅ yes with the plugin, injected before the edit |
| **Any MCP agent** *(Cursor, Cline, Windsurf, Zed, Claude Agent SDK)* | point its MCP config at `beacon mcp` — `report_activity` / `get_activity` tools | ➖ can query & report |
| **git / docker / CI scripts** | `with_report <action> <target> -- <cmd>` | — |
| **Any editor or human** | `beacon watch <dir>` (file-system watcher) | — |
| **Anything that speaks HTTP** | `POST /report` | — |

Claude Code gets the richest experience because its hooks let Beacon both auto-report *and* inject the warning back into the agent mid-task. Every other tool still shows up on the dashboard and in everyone else's warnings.

### Codex & other MCP clients

Beacon ships a zero-dependency **MCP server**, so any MCP-capable agent can report and query activity on the same bus your Claude Code sessions use.

**Codex — install the plugin (recommended):**

```bash
codex plugin marketplace add a1473838623/agent-beacon
```

Then install `beacon` from the plugin browser (`codex /plugins`). The plugin brings the
hooks *and* the MCP server, exactly like the Claude Code one — same repo, same daemon.

> **Codex does not trust plugin hooks automatically.** After installing, open the Hooks
> page (or run `/hooks`), review Beacon's three definitions and trust them — until you do,
> the hooks are inert and only the MCP tools work. Codex tracks trust by hash, so a Beacon
> release that changes the hook definitions needs trusting again.

**Or wire just the MCP server**, with no install at all:

```toml
# ~/.codex/config.toml
[mcp_servers.beacon]
command = "npx"
args = ["-y", "beacon-agents", "mcp"]
```

**Or from the CLI**, if you have `beacon` on your PATH:

```bash
beacon init --codex      # adds [mcp_servers.beacon] to ~/.codex/config.toml (global)
```

(Global by default; `beacon init --codex --project` scopes it to `.codex/config.toml`, and switching levels disables the other — same as the Claude hook.)

Either way, Codex reports to the same local daemon your Claude Code sessions use, so the
two see each other. Installing Beacon as a plugin does not make it Claude-Code-only: the
daemon is the bus, and the plugin just changes how the Claude Code side is wired to it.

Optionally add one line to your `AGENTS.md` so Codex uses it proactively:

> Before editing a file or running a risky command, call the `beacon` `get_activity` / `report_activity` tools to avoid colliding with other agents.

**Cursor / Cline / Windsurf / Zed / Claude Agent SDK:** point the client's MCP config at the server. Zero-install: `command: npx`, `args: ["-y", "beacon-agents", "mcp"]`. If `beacon` is already on your PATH, `beacon mcp` works too.

**What Codex gets with the plugin:**

- ✅ **Warned before the edit, automatically.** Codex's `PreToolUse` fires on file edits, not
  just shell commands, and it accepts the same `additionalContext` output Claude Code does.
  Beacon injects the same one-line overlap warning into Codex's own context.
- ✅ **Same guards on destructive git**, `git add -A` / `commit -a`, and redundant builds.
- ✅ **Clears its presence when a turn ends**, via the `Stop` hook — no stale rows.
- ✅ **Visible to every other agent**, on the dashboard and in everyone else's warnings.

Two implementation notes:

- Codex delivers a file edit as `apply_patch` with the whole patch in `tool_input.command`,
  not a path — and one call can touch several files. Beacon parses the patch envelope and
  reports each file, so a patch that collides on any one of them is caught (`src/patch.js`).
- Codex ignores a `"hooks": "./hooks/hooks.json"` string path in the manifest, even though
  the docs describe that form. The hooks are inlined into `.codex-plugin/plugin.json`
  instead, the only shape OpenAI's own bundled plugins use. That means the same three hooks
  are declared twice, once per harness, so a test asserts the two copies stay in step.

**Without the plugin** — MCP-only — Codex is still visible to everyone and can call
`get_activity` / `report_activity`, but nothing is injected automatically; the model has to
choose to ask.

> This section used to say Codex could not be warned before an edit. That was true of an
> earlier Codex, whose hooks fired only on Bash and could not add context. It is no longer
> the case.

---

## Configuration

All optional — sensible defaults out of the box. Set as environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `BEACON_PORT` | `4517` | Daemon port (localhost only) |
| `BEACON_GUARD` | `warn` | `warn` = advisory context · `ask` = require confirm on destructive git ops · `off` = report only, never warn |
| `BEACON_TTL_MS` | `900000` | How long an activity lives without a heartbeat (15 min) — crashed sessions self-clear |
| `BEACON_LOG_LEVEL` | `info` | `error` · `warn` · `info` · `debug`. Errors/warnings are always recorded; `debug` traces every report. |
| `BEACON_HOME` | `~/.beacon` | Where the daemon stores its pidfile, `settings.json`, and daily logs (`logs/beacon-YYYY-MM-DD.log`) |

---

## Troubleshooting & reporting bugs

Beacon fails open silently by design — so if something's off, the trail is in the **local log**, not your terminal.

```bash
beacon logs                 # last 200 lines + the log path
beacon logs --tail 50       # fewer lines
beacon logs --path          # just print the file path (~/.beacon/beacon.log)
beacon logs --clear         # wipe it
```

Errors and warnings (including every time the hook *fails open* because the daemon was unreachable) are always logged. For a full trace while reproducing a problem, restart with more detail:

```bash
BEACON_LOG_LEVEL=debug beacon start   # logs every report and tool call
```

Found a bug? Please [open an issue](https://github.com/a1473838623/agent-beacon/issues/new?template=bug_report.yml) and paste `beacon logs` output (**review it first** — it can contain file paths from your project). The log is 100% local; nothing is ever sent anywhere unless you attach it yourself.

---

## FAQ

**Will this slow my agents down or blow up my token usage?**
No. Reporting happens out-of-band (in the hook, not the model), so it costs zero model tokens. The only thing ever added to an agent's context is a single warning line, and only when there's a genuine overlap. No conflict → nothing added.

**Can it break my workflow / block an edit?**
Not by default. It's advisory and fails open — daemon down, timeout, bad input, all result in "do nothing, allow." Set `BEACON_GUARD=ask` only if you *want* destructive git ops to pause for confirmation on a real conflict.

**Does it send my code anywhere?**
No code, ever. Everything runs on `127.0.0.1` with settings and daily logs under `~/.beacon`. The **only** network call Beacon can make is an update check against GitHub's public releases API — and only when you click **Check for updates** or opt into auto-check in Settings (both **off by default**). No telemetry, no accounts; your code and activity never leave your machine.

**Does it replace git / locks / worktrees?**
No — it's the awareness layer *underneath* them. It doesn't take locks or move files; it makes agents *see* each other so they (or you) can coordinate. Pairs perfectly with git worktrees if you use them.

**An activity is still showing after I stopped editing?**
It clears when your session's turn ends (a Stop hook) and otherwise fades a few minutes after the last edit. You can also hit **Clear** on the dashboard (with confirmation) to dismiss the board instantly — plus **Restart** / **Quit** the daemon right from the header (or `beacon restart` / `beacon stop`). Upgrading from an older version? Re-run `beacon init` to add the Stop hook, then `beacon restart`.

**Is Clear destructive?** No durable data is lost — Beacon never touches files, and the history log keeps every event. But it's *global*: it dismisses live presence for **all** sessions at once (active ones reappear on their next edit), so it's confirmed before it runs. Use it to wipe a board cluttered with stale entries.

---

## Roadmap

- [x] Native **MCP server** (`report_activity` / `get_activity`) — works with Codex, Cursor, Cline, Windsurf, Zed, and the Claude Agent SDK
- [x] **Codex plugin** — hooks + MCP server, warned before every edit, same as Claude Code (0.10.0)
- [ ] `SessionStart` hook: greet each new session with a summary of what peers are doing
- [ ] Optional hard **leases** for resources that truly need serialization (e.g. one build at a time)
- [ ] Slack / desktop notification on overlap
- [x] `npx beacon-agents` zero-install runner — done in 0.9.0

Ideas and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Contributing

Beacon is intentionally tiny (a few hundred lines, no dependencies). That makes it easy to read, easy to hack on, and easy to trust. Run the tests with `npm test`. Issues and pull requests are very welcome.

## License

[MIT](LICENSE) © Beacon contributors
