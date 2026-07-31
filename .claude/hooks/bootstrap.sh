#!/usr/bin/env bash
set +e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$(cd "$HOOK_DIR/.." && pwd)"
MARKER="$CLAUDE_DIR/.bootstrap_done"

trap 'exit 0' EXIT

[ "${ORCH_BOOTSTRAP:-1}" = "0" ] && exit 0

if [ -f "$MARKER" ]; then exit 0; fi

have() { command -v "$1" >/dev/null 2>&1; }
warn() { echo "[bootstrap] $*" >&2; }
npm_has() { npm ls -g --depth=0 "$1" >/dev/null 2>&1; }

detect_pm() {
    for pm in brew apt-get dnf yum pacman zypper winget scoop choco; do
        if have "$pm"; then
            echo "$pm"
            return 0
        fi
    done
    return 1
}

sudo_prefix() {
    if [ "$(id -u)" = "0" ]; then
        echo ""
    elif have sudo && sudo -n true 2>/dev/null; then
        echo "sudo "
    else
        return 1
    fi
}

run_install() {
    if have timeout; then
        timeout 120 bash -c "$*" >/dev/null 2>&1
    else
        bash -c "$*" >/dev/null 2>&1
    fi
}

# 1) node/npm — verify only, never install
NPM_OK=0
if have node && have npm; then
    NPM_OK=1
else
    warn "node/npm not found — install Node.js LTS from nodejs.org / nvm / 'winget install OpenJS.NodeJS.LTS'"
fi

# 2) Python 3.10+ — verify only, never install
PYTHON_OK=0
if have python3 && python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PYTHON_OK=1
elif have python3; then
    warn "Python 3.10+ required — current python3 is too old or unavailable"
elif have python && python -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    warn "python3 alias missing but python reports 3.10+ — alias python3 so hooks can run it"
else
    warn "Python 3.10+ missing — token tracking disabled until installed"
fi

# 3) jq — install if possible
JQ_OK=0
if have jq; then
    JQ_OK=1
else
    PM=$(detect_pm) || {
        warn "jq missing and no known package manager found (expected: brew apt-get dnf yum pacman zypper winget scoop choco)"
        PM=""
    }
    if [ -n "$PM" ]; then
        case "$PM" in
            brew)
                run_install "brew install jq"
                ;;
            apt-get)
                SUDO=$(sudo_prefix) || {
                    warn "jq missing — no passwordless sudo; run manually: sudo apt-get install -y jq"
                    SUDO=""
                }
                [ -n "$SUDO" ] || { PM=""; }
                [ -n "$PM" ] && run_install "${SUDO}apt-get install -y jq"
                ;;
            dnf)
                SUDO=$(sudo_prefix) || {
                    warn "jq missing — no passwordless sudo; run manually: sudo dnf install -y jq"
                    SUDO=""
                }
                [ -n "$SUDO" ] || { PM=""; }
                [ -n "$PM" ] && run_install "${SUDO}dnf install -y jq"
                ;;
            yum)
                SUDO=$(sudo_prefix) || {
                    warn "jq missing — no passwordless sudo; run manually: sudo yum install -y jq"
                    SUDO=""
                }
                [ -n "$SUDO" ] || { PM=""; }
                [ -n "$PM" ] && run_install "${SUDO}yum install -y jq"
                ;;
            pacman)
                SUDO=$(sudo_prefix) || {
                    warn "jq missing — no passwordless sudo; run manually: sudo pacman -S --noconfirm jq"
                    SUDO=""
                }
                [ -n "$SUDO" ] || { PM=""; }
                [ -n "$PM" ] && run_install "${SUDO}pacman -S --noconfirm jq"
                ;;
            zypper)
                SUDO=$(sudo_prefix) || {
                    warn "jq missing — no passwordless sudo; run manually: sudo zypper --non-interactive install jq"
                    SUDO=""
                }
                [ -n "$SUDO" ] || { PM=""; }
                [ -n "$PM" ] && run_install "${SUDO}zypper --non-interactive install jq"
                ;;
            winget)
                run_install "winget install --id jqlang.jq -e --silent --accept-package-agreements --accept-source-agreements"
                ;;
            scoop)
                run_install "scoop install jq"
                ;;
            choco)
                run_install "choco install jq -y"
                ;;
        esac
        if have jq; then
            JQ_OK=1
        else
            warn "jq install attempted but still missing"
        fi
    fi
fi

# 4) caveman
CAVEMAN_OK=0
if [ "$NPM_OK" != "1" ]; then
    warn "caveman-code skipped — npm not available"
elif npm_has "@juliusbrussee/caveman-code"; then
    CAVEMAN_OK=1
else
    run_install "npm install -g @juliusbrussee/caveman-code"
    if npm_has "@juliusbrussee/caveman-code"; then
        CAVEMAN_OK=1
    else
        warn "caveman-code install failed — run manually: npm install -g @juliusbrussee/caveman-code"
    fi
fi

# 5) diffwarden
DIFFWARDEN_OK=0
if [ "$NPM_OK" != "1" ]; then
    warn "diffwarden skipped — npm not available"
elif npm_has "diffwarden"; then
    DIFFWARDEN_OK=1
else
    run_install "npm install -g diffwarden"
    if npm_has "diffwarden"; then
        DIFFWARDEN_OK=1
    else
        warn "diffwarden install failed — run manually: npm install -g diffwarden"
    fi
fi

# Write marker only when every REQUIRED prerequisite is satisfied, so a machine
# missing node/npm or python3 keeps re-running bootstrap (and re-warning) instead
# of being marked done after warnings. Required: jq, python3, node/npm, and the
# two npm skills (which depend on npm being present).
if [ "$JQ_OK" = "1" ] \
    && [ "$PYTHON_OK" = "1" ] \
    && [ "$NPM_OK" = "1" ] \
    && [ "$CAVEMAN_OK" = "1" ] \
    && [ "$DIFFWARDEN_OK" = "1" ]; then
    : > "$MARKER"
else
    warn "prerequisites incomplete — not marking bootstrap done; will retry next session"
fi
