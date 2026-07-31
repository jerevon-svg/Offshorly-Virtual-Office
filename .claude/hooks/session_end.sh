#!/usr/bin/env bash
# SessionEnd hook — extract transcript_path from stdin JSON and invoke parser.
# Claude Code passes hook JSON on stdin.

set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')

if [ -z "$TRANSCRIPT" ]; then
    echo "[session_end] no transcript_path in hook payload" >&2
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="$SCRIPT_DIR/../scripts/parse_usage.py"

if [ ! -f "$PARSER" ]; then
    echo "[session_end] parser not found: $PARSER" >&2
    exit 1
fi

python3 "$PARSER" --transcript "$TRANSCRIPT" --project-dir "$(dirname "$TRANSCRIPT")"
