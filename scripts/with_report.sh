#!/usr/bin/env bash
# with_report — wrap ANY command as a Beacon activity (start → run → done).
# Usage:  with_report <action> <target> -- <command...>
# Example: with_report building "svc://mall-quanyu" -- docker compose up -d --build mall-quanyu
#
# Requires the `beacon` CLI on PATH (npm i -g agent-beacon), or set BEACON=/path/to/bin/beacon.js
set -uo pipefail

action="${1:?usage: with_report <action> <target> -- <cmd...>}"
target="${2:?usage: with_report <action> <target> -- <cmd...>}"
shift 2
[ "${1:-}" = "--" ] && shift

BEACON_BIN="${BEACON:-beacon}"
actor="script:$$"

report() { "$BEACON_BIN" report --actor "$actor" --action "$action" --target "$target" --cwd "$PWD" "$@" >/dev/null 2>&1 || true; }

report
"$@"; rc=$?
report --done
exit $rc
