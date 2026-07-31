#!/usr/bin/env bash
# sonar_scan.sh — run a SonarQube analysis on a project dir, wait for it to
# finish, then print the quality gate + open issues in a compact form.
#
# Usage:
#   sonar_scan.sh <project_dir> <project_key> [sources]
#
# Example:
#   sonar_scan.sh /path/to/project my-project .
#
# Reads config from .claude/sonar.env (SONAR_TOKEN, SONAR_HOST_URL,
# SONAR_DOCKER_NETWORK, SONAR_INTERNAL_URL). Uses the dockerized scanner CLI so
# nothing needs to be installed locally.
#
# NOTE (Community edition): analysis targets the project's MAIN branch only.
# There is no per-branch / per-PR analysis. Re-running re-analyzes the whole
# project; the quality gate reflects the full codebase (or the "new code"
# definition configured on the server), not just the latest diff.

set -euo pipefail

PROJECT_DIR="${1:?usage: sonar_scan.sh <project_dir> <project_key> [sources]}"
PROJECT_KEY="${2:?usage: sonar_scan.sh <project_dir> <project_key> [sources]}"
SOURCES="${3:-.}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../sonar.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: config not found: $ENV_FILE" >&2
    exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

: "${SONAR_TOKEN:?SONAR_TOKEN not set in sonar.env}"
: "${SONAR_HOST_URL:=http://localhost:9000}"
: "${SONAR_DOCKER_NETWORK:=sonarqube_default}"
: "${SONAR_INTERNAL_URL:=http://sonarqube:9000}"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "ERROR: project dir not found: $PROJECT_DIR" >&2
    exit 1
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

echo "== scanning $PROJECT_KEY ($PROJECT_DIR, sources=$SOURCES) =="

# Run the dockerized scanner. Joins the SonarQube compose network so it can
# reach the server by its service alias. Excludes common vendor dirs.
# tee stdout so we can recover the async task id from it (report-task.txt does
# not reliably persist to the mounted volume across scanner-container uids).
SCAN_LOG="$(mktemp)"
trap 'rm -f "$SCAN_LOG"' EXIT
docker run --rm \
    --network "$SONAR_DOCKER_NETWORK" \
    -e SONAR_HOST_URL="$SONAR_INTERNAL_URL" \
    -e SONAR_TOKEN="$SONAR_TOKEN" \
    -v "$PROJECT_DIR:/usr/src" \
    sonarsource/sonar-scanner-cli \
    -Dsonar.projectKey="$PROJECT_KEY" \
    -Dsonar.sources="$SOURCES" \
    -Dsonar.exclusions="**/node_modules/**,**/__pycache__/**,**/.venv/**,**/venv/**,**/dist/**,**/build/**,**/.scannerwork/**" \
    -Dsonar.scm.disabled=true 2>&1 | tee "$SCAN_LOG"

# Recover the compute-engine task id from the scanner's own output line:
#   ...api/ce/task?id=<UUID>
CE_TASK_ID="$(grep -oE 'api/ce/task\?id=[A-Za-z0-9_-]+' "$SCAN_LOG" | head -1 | cut -d= -f2 || true)"
if [ -z "$CE_TASK_ID" ]; then
    echo "ERROR: could not determine CE task id; scan likely failed" >&2
    exit 1
fi

# Poll the compute-engine task from the host (localhost URL) until it settles.
echo "== waiting for analysis (task $CE_TASK_ID) =="
STATUS=""
for _ in $(seq 1 60); do
    RESP="$(curl -s -u "$SONAR_TOKEN:" "$SONAR_HOST_URL/api/ce/task?id=$CE_TASK_ID")"
    STATUS="$(printf '%s' "$RESP" | jq -r '.task.status')"
    case "$STATUS" in
        SUCCESS|FAILED|CANCELED) break ;;
    esac
    sleep 3
done

if [ "$STATUS" != "SUCCESS" ]; then
    echo "ERROR: analysis status=$STATUS" >&2
    exit 1
fi

# Quality gate.
echo ""
echo "== QUALITY GATE =="
GATE="$(curl -s -u "$SONAR_TOKEN:" "$SONAR_HOST_URL/api/qualitygates/project_status?projectKey=$PROJECT_KEY")"
printf '%s' "$GATE" | jq -r '
  "status: " + .projectStatus.status,
  (.projectStatus.conditions[]?
    | "  " + (.status) + "  " + (.metricKey) + " " + (.comparator) + " " + (.errorThreshold // "-") + " (actual " + (.actualValue // "-") + ")")'

# Open issues, compact.
echo ""
echo "== OPEN ISSUES (top 100 by severity) =="
ISSUES="$(curl -s -u "$SONAR_TOKEN:" "$SONAR_HOST_URL/api/issues/search?componentKeys=$PROJECT_KEY&resolved=false&ps=100&s=SEVERITY&asc=false")"
printf '%s' "$ISSUES" | jq -r '
  "total: " + (.total|tostring),
  (.issues[]?
    | "  [" + .severity + "] " + (.component|sub(".*:";"")) + ":" + ((.line // 0)|tostring) + "  " + .message)'

echo ""
echo "== web: $SONAR_HOST_URL/dashboard?id=$PROJECT_KEY =="
