#!/usr/bin/env bash
# FILM RIG ONLY — record one cinematic take on the running director, then turn its raw screencast frames
# into a 60 fps mezzanine (real frame durations from list.txt, x264 CRF 14) and delete the frames.
#   FILM_FFMPEG=… FILM_CLIPS=<takes dir> cinematic/take.sh <Shot> [director dir]
set -euo pipefail
SHOT="$1"; DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
: "${FILM_FFMPEG:?}"; : "${FILM_CLIPS:?}"
cd "$DIR"
node director.mjs "$SHOT" go record > "$FILM_CLIPS/$SHOT.json" || { cat "$FILM_CLIPS/$SHOT.json"; exit 1; }
F="$FILM_CLIPS/$SHOT.frames"
"$FILM_FFMPEG" -y -hide_banner -loglevel error -f concat -safe 0 -i "$F/list.txt" \
  -vf "fps=60,scale=${FILM_SCALE:-1920:1080}:flags=lanczos,format=yuv420p" -c:v libx264 -preset medium -crf ${FILM_CRF:-14} -movflags +faststart "$FILM_CLIPS/$SHOT.mp4"
rm -rf "$F"
python3 -c "import json,sys; d=json.load(open('$FILM_CLIPS/$SHOT.json')); c=d.get('clip') or {}; print('$SHOT', 'ready=',d.get('ready'), 'secs=',c.get('seconds'), 'fps=',c.get('captureFps'), 'render=',c.get('renderFps'), 'errors=',len(d.get('pageErrors',[])))"
