# Privacy

Beacon runs entirely on your machine. There is no Beacon server, no account, no telemetry,
and no analytics. Nothing you do is sent to us, because there is no "us" to send it to.

This document describes exactly what Beacon records, where it puts it, and the one case in
which it talks to the network.

## What Beacon records

To answer "is another agent already touching this?", Beacon records an activity for each
reported action:

- the **absolute path** of the file being edited
- the **working directory** of the session
- for classified shell commands (destructive `git`, `docker`, builds), the **first 120
  characters of the command**
- the **session id** your coding tool assigns (a random identifier) and a short label
  derived from it
- **timestamps** and a time-to-live

Optionally, and **off by default**:

- the **first line of your prompt**, truncated to 72 characters, used as a title so the
  dashboard can group a session's edits by conversation turn. This is stored only when the
  `grouping` setting is set to something other than `off`. It is off by default precisely
  because prompt text is more sensitive than file paths.

Beacon does not read file contents. It records that a file is being edited, never what is
in it or what changed.

## Where it is stored

Everything lives under `~/.beacon` (`%USERPROFILE%\.beacon` on Windows), or wherever you
point `BEACON_HOME`:

| Path | Contents |
| --- | --- |
| `~/.beacon/activity.jsonl` | the activity records above |
| `~/.beacon/logs/beacon-YYYY-MM-DD.log` | one local log file per day |
| `~/.beacon/settings.json` | your Beacon settings |
| `~/.beacon/claims/` | short-lived files used to suppress duplicate hook events |

These are plain text files. Read them, edit them, delete them.

## What leaves your machine

**By default: nothing.**

The daemon binds to `127.0.0.1` only, so it is not reachable from another machine on your
network. The dashboard is served from that same local address.

There is exactly one outbound request in the entire codebase, and it is **disabled by
default** (`autoCheckUpdates: false`): if you turn on update checks, Beacon makes an
unauthenticated `GET` to the GitHub Releases API to compare version numbers. It sends no
Beacon data — GitHub sees the request the way it sees any anonymous API call, including
your IP address. Leave the setting off and Beacon never opens a non-local connection.

## Deleting your data

- `beacon logs --clear` removes the log files
- the dashboard's **Clear** button drops all recorded activity
- deleting `~/.beacon` removes everything Beacon has ever stored

Uninstalling Beacon does not delete `~/.beacon`; remove the directory yourself if you want
it gone.

## Questions

Open an issue at https://github.com/a1473838623/agent-beacon/issues.
