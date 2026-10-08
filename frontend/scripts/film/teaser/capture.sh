#!/usr/bin/env bash
# FILM RIG ONLY — start the headless director at the LOCKED teaser capture standard (Pass 0):
#   Custom graphics at render scale 0.85 (Full-quality AO / shadows 2048 / effects / weather / foliage), 1920×1080 at
#   device-pixel-ratio 1, JPEG 95, raw frames only (the edit builds 30 fps from their real timestamps; no interpolation).
# Needs the film rig up first (backend/run-film-backend.sh on :8003, the :5175 film vite server) and FILM_FFMPEG.
#   FILM_FFMPEG=/path/to/ffmpeg scripts/film/teaser/capture.sh [takes-dir]   (default: scripts/film/out/pass2/clips)
set -euo pipefail
cd "$(dirname "$0")/../../.."
if [ -z "${FILM_FFMPEG:-}" ] || [ ! -x "$FILM_FFMPEG" ]; then
  echo "FILM_FFMPEG must point at an ffmpeg binary, e.g. (cd <scratch> && npm i ffmpeg-static) and export FILM_FFMPEG=<scratch>/node_modules/ffmpeg-static/ffmpeg" >&2; exit 1
fi
TAKES="${1:-scripts/film/out/pass2/clips}"
LOG=scripts/film/out/director.log
pkill -f "director.mjs serve" || true; sleep 3
FILM_GRAPHICS=custom FILM_GRAPHICS_CUSTOM='{"renderScale":0.85}' FILM_DPR=1 FILM_JPEG=95 FILM_ENCODE=0 FILM_CLIPS="$TAKES" \
  nohup node scripts/film/director.mjs serve --headless > "$LOG" 2>&1 &
for i in $(seq 1 90); do grep -q listening "$LOG" 2>/dev/null && break; sleep 2; done
grep "hero ready\|listening\|Error" "$LOG"
