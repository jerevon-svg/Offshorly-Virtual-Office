#!/usr/bin/env bash
# SessionStart hook — runs reconcile to catch any transcripts parsed while the
# previous session's SessionEnd hook may have been skipped or incomplete.

set -euo pipefail

# Capture hook JSON from stdin; transcript_path's parent dir is this project's
# transcript folder — used to scope reconcile to the current project only.
INPUT=$(cat 2>/dev/null || true)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
PROJ_DIR=""
[ -n "$TRANSCRIPT" ] && PROJ_DIR="$(dirname "$TRANSCRIPT")"

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BOOTSTRAP="$HOOK_DIR/bootstrap.sh"
if [ -f "$BOOTSTRAP" ]; then
    bash "$BOOTSTRAP" || echo "[session_start] bootstrap non-fatal failure, continuing" >&2
fi

PARSER="$HOOK_DIR/../scripts/parse_usage.py"

if [ ! -f "$PARSER" ]; then
    echo "[session_start] parser not found: $PARSER" >&2
    exit 0
fi

# Wrap in || true so transient parse errors don't crash SessionStart.
# Scope to this project when we know its transcript dir; else fall back to the
# parser's cwd-encoding default.
if [ -n "$PROJ_DIR" ]; then
    RECONCILE_ARGS=(--reconcile --project-dir "$PROJ_DIR")
else
    RECONCILE_ARGS=(--reconcile)
fi

python3 "$PARSER" "${RECONCILE_ARGS[@]}" || {
    echo "[session_start] reconcile failed (non-fatal), continuing" >&2
    true
}
