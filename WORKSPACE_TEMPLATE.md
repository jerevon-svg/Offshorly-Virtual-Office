# Workspace Template — Replicate the Orchestration Pattern

Files to copy into a new repo to get the complete orchestration baseline running:
master plans and reviews, worker implements, commit owns Git/GitHub operations,
and sonar supplies static-analysis evidence.
See [ORCHESTRATION_GUIDE.md](./ORCHESTRATION_GUIDE.md) for conceptual depth.

---

## Quick Copy Checklist

### Required (core orchestration)

```
CLAUDE.md                          ← routing rules; customize for your project
.claude/agents/master.md           ← master agent definition
.claude/agents/worker.md           ← worker agent definition
.claude/agents/commit.md           ← Git and GitHub operations
.claude/agents/sonar.md            ← SonarQube scan and evidence reporting
.claude/settings.json              ← agent-teams flag and hook registration
.claude/hooks/bootstrap.sh         ← verifies/installs required dependencies
.claude/hooks/session_start.sh     ← runs parse_usage.py --reconcile on session open
.claude/hooks/session_end.sh       ← runs parse_usage.py --transcript on session close
.claude/scripts/parse_usage.py     ← JSONL → usage.csv parser
.claude/scripts/sonar_scan.sh      ← runs scan and reports gate/issues
tools/sonarqube/docker-compose.yml ← local SonarQube + PostgreSQL stack
tools/sonarqube/INSTALL.md         ← one-time SonarQube and token setup
.gitignore                         ← merge orchestration entries; do not replace
.claude/.gitignore                 ← merge bootstrap-marker entry; do not replace
.gitattributes                     ← preserves LF endings for scripts
```

Merge the supplied `.gitignore` and `.claude/.gitignore` entries into any
existing files. Preserve all project-specific ignore rules and avoid duplicate
entries.

After copying, create `.claude/sonar.env` locally by following
`tools/sonarqube/INSTALL.md`. It contains the scanner token and must never be committed.
Docker with Compose is required because Sonar is part of the core baseline.

### Optional (reference only)

```
.claude/TOKEN_TRACKING_PLAN.md     ← design doc; informational only
```

### Skip (local session data / compiled artifacts)

```
.claude/usage.csv                  ← generated; do not copy
.claude/.parsed_sessions.json      ← generated sidecar; do not copy
.claude/scripts/__pycache__/       ← compiled Python; do not copy
.claude/settings.local.json        ← machine-local overrides; do not copy
.claude/.bootstrap_done            ← generated prerequisite marker
.claude/backups/                   ← generated installer backups
```

---

## File-by-File Reference

### `CLAUDE.md` — KEEP, MODIFY

The routing brain. The main Claude Code thread reads this on every message and
routes automatically. Contains:

- Which tasks go to `master` vs `worker`.
- Which operations go to `commit` and `sonar`.
- The plan → implement → review → fix loop rules.
- The "always" rules (full context, absolute paths, no human routing decisions).

**Modify:** Keep the Agent Delegation section structure intact. Add or reword
routing rules for your domain (e.g. "database migration tasks → master"). Remove
examples irrelevant to your project.

---

### `.claude/agents/master.md` — KEEP, MODIFY LIGHTLY

Defines the `master` subagent (opus, high effort, no Edit/Write tools).

Key frontmatter:

```yaml
---
name: master
model: claude-opus-4-8
effort: high
tools: Read, Glob, Grep, Bash     # no Edit/Write — enforces "master never codes"
skills:
  - caveman:full
  - diffwarden
---
```

**Modify:** Adjust the system prompt body if your master role differs. Do not
add `Edit` or `Write` to tools — that guardrail is intentional.

---

### `.claude/agents/worker.md` — KEEP, MODIFY LIGHTLY

Defines the `worker` subagent (sonnet, medium effort, full edit tools).

Key frontmatter:

```yaml
---
name: worker
model: claude-sonnet-5
effort: medium
tools: Read, Glob, Grep, Edit, MultiEdit, Write, Bash
skills:
  - caveman:full
  - diffwarden
---
```

**Modify:** Add project-specific constraints (e.g. "never edit migrations
without approval"). Keep the `## Output Format` block — master's review loop
depends on reading `DONE | NEEDS CLARIFICATION | BLOCKED` from worker output.

---

### `.claude/agents/commit.md` — KEEP, MODIFY LIGHTLY

Defines the `commit` subagent (sonnet, low effort, Bash/Read only). All Git
mutations and `gh` operations route here. Its human gate must remain intact for
push, rebase, reset/discard, and PR creation or merge.

**Modify:** Adjust commit-message conventions or project-specific branch rules.
Do not remove the human gate for destructive or remote operations.

---

### `.claude/agents/sonar.md` — KEEP, MODIFY LIGHTLY

Defines the `sonar` subagent (sonnet, low effort, Bash/Read only). It runs
`.claude/scripts/sonar_scan.sh` and reports the quality gate and open issues to
master. It never edits code and never issues the final verdict.

**Modify:** Adjust the default project key or source paths if needed. Keep the
evidence-only boundary: master owns APPROVED / NEEDS FIXES.

---

### `.claude/settings.json` — KEEP WITH THE REQUIRED HOOK FILES

Registers hooks with Claude Code. Template:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PROJECT_DIR}/.claude/hooks/session_start.sh\""
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PROJECT_DIR}/.claude/hooks/session_end.sh\""
          }
        ]
      }
    ]
  }
}
```

`${CLAUDE_PROJECT_DIR}` expands to the project root at runtime. No path edits
needed if you copy the file verbatim and keep the hooks in `.claude/hooks/`.

The `SessionStart` and `SessionEnd` blocks are part of this baseline, so copy
their hook scripts and parser with the settings file. Add local status-line or
debug-hook configuration separately if your project needs it.

---

### `.claude/hooks/bootstrap.sh` — KEEP, NO EDITS NEEDED

Runs from `session_start.sh` before usage reconciliation. It checks Node/npm and
Python, then ensures `jq`, caveman, and diffwarden are available. It creates
`.claude/.bootstrap_done` only when every prerequisite is satisfied.

---

### `.claude/hooks/session_start.sh` — KEEP, NO EDITS NEEDED

Runs `parse_usage.py --reconcile` on session open. Catches transcripts that
were missed if a previous session's `SessionEnd` hook failed.

Non-fatal by design — errors are logged to stderr, hook exits 0 so Claude Code
session continues.

---

### `.claude/hooks/session_end.sh` — KEEP, NO EDITS NEEDED

Receives transcript path from Claude Code via stdin JSON, calls
`parse_usage.py --transcript <path>`. Requires `jq` on PATH.

⚠️ Note: Unlike session_start, session_end.sh fails non-zero if jq/parser
missing or parse fails. Claude Code logs the error but does not block the
session.

---

### `.claude/scripts/parse_usage.py` — KEEP, NO PATH EDITS NEEDED

Parses JSONL transcripts → `.claude/usage.csv`. Requires Python 3.10+.

The transcript directory is resolved automatically by `resolve_transcripts_glob()`,
which encodes the project root path into the Claude transcript directory convention
(`~/.claude/projects/<encoded-path>/`). No hardcoded glob to update.

If you need to override the transcript directory (e.g. in CI or when the
auto-derived path is wrong), pass `--project-dir` to the parser:

```bash
python3 .claude/scripts/parse_usage.py --reconcile --project-dir ~/.claude/projects/<your-slug>
```

The project slug is the filesystem-escaped path to your project root. Find it by running:

```bash
ls ~/.claude/projects/
```

After your first session in the new workspace, a directory with the slug will
appear there.

Modes:
- `--transcript <path>` — parse single file (called by session_end.sh)
- `--reconcile` — parse transcripts not yet recorded in the sidecar ledger (.parsed_sessions.json), independent of CSV mtime (called by session_start.sh)
- `--rebuild` — wipe CSV and reparse everything from scratch

---

### `.claude/scripts/sonar_scan.sh` — KEEP, CONFIGURE LOCALLY

Runs the Dockerized Sonar scanner, waits for analysis, and prints the quality
gate and open issues. It reads `.claude/sonar.env`; create that untracked file
using `tools/sonarqube/INSTALL.md`.

Use one stable project key per project so SonarQube retains analysis history:

```bash
bash .claude/scripts/sonar_scan.sh "$(pwd)" <project-key> .
```

---

### `tools/sonarqube/` — KEEP, COMPLETE ONE-TIME SETUP

`tools/sonarqube/docker-compose.yml` runs SonarQube Community and PostgreSQL locally.
Follow `tools/sonarqube/INSTALL.md` to start the stack, change the default password,
generate a scanner token, and create `.claude/sonar.env`.

SonarQube Community analyzes the main branch rather than an isolated PR diff.
The sonar agent reports that evidence; master combines it with diffwarden's
diff review before issuing a verdict.

---

### `.claude/TOKEN_TRACKING_PLAN.md` — SKIP or KEEP as reference

Design notes for the token parser. No runtime effect. Informational only.

---

## How to Customize

### Swap models

Edit frontmatter in the agent `.md` files:

```yaml
model: claude-sonnet-5   # or another model available in your Claude Code version
effort: low | medium | high
```

### Add another agent (e.g. a security reviewer)

Create `.claude/agents/security.md` with frontmatter. Add a routing rule to
`CLAUDE.md`:

```
### Route to `security` for:
- Auth/authz changes
- Dependency updates with CVEs
```

### Tighten the review gate

In worker's system prompt, change the pre-DONE step:

```
Before DONE: run `/dw loop --max 5 --security` instead of `/dw loop`
```

For PRs: master runs `/dw review #<num>` instead of `/dw review workspace`.

### Hook into CI instead of Claude Code hooks

If you run in headless/CI environments where `SessionEnd` doesn't fire, call
the parser directly from your CI script:

```bash
python3 .claude/scripts/parse_usage.py --reconcile
```

Or rebuild from scratch:

```bash
python3 .claude/scripts/parse_usage.py --rebuild
```

---

## Gotchas

**Keep shell scripts executable.**
The settings invoke hooks through `bash`, but executable bits are still useful
for direct and CI use. After copying or unzipping, run:

```bash
chmod +x .claude/hooks/*.sh .claude/scripts/*.sh
```

**Relative paths in settings.json won't work.**
Use `${CLAUDE_PROJECT_DIR}` (Claude Code env var) or absolute paths in hook
commands. Relative paths resolve against the shell's cwd at hook time, which
varies.

**Transcript directory must match your actual project slug.**
Claude Code names the transcript directory after the escaped absolute path of
your workspace. `resolve_transcripts_glob()` derives this automatically. If you
move or rename the workspace, the auto-derived path updates too — but if it
ever mismatches, pass `--project-dir <path>` explicitly, or run `--rebuild` to
re-scan from a corrected glob.

**Python version for parse_usage.py.**
Requires Python 3.10+ because the parser uses modern union type annotations
(`str | None`). Check with `python3 --version`.

**`__pycache__` from parse_usage.py is local.**
Do not commit it. Add `.claude/scripts/__pycache__/` to `.gitignore`.

**usage.csv and .parsed_sessions.json are derived, not source.**
Commit them if you want to persist history across machines. Otherwise add to
`.gitignore` and treat them as ephemeral — `--rebuild` regenerates from
transcripts.

**settings.local.json is machine-local.**
Contains per-machine overrides. Do not commit. Add to `.gitignore`.

**The `caveman` and `diffwarden` skills are required.**
Agent `.md` files declare them in frontmatter (`skills: [caveman:full,
diffwarden]`) but Claude Code only loads installed skills. `bootstrap.sh`
installs them through npm on the first session. If bootstrap cannot complete,
install them manually before testing the orchestration:

- `diffwarden`: follow install instructions at https://github.com/jperocho/diffwarden
- `caveman`: install per your team's skill distribution

If you don't have the caveman skill/plugin installed, you can remove
`caveman:full` from agent frontmatter in `master.md` and `worker.md` — agents
work without it, output just won't be compressed.

**Tool list in agent frontmatter is a hard guardrail.**
Master lacks `Edit`/`Write` by design. Do not add them "just in case" — that
removes the structural enforcement of "master never writes code."

---

## Verify: Test Orchestration Works

After copying files, send one small multi-step request and confirm this sequence
fires automatically (no `@master` or `@worker` typed):

1. Main thread routes to **master** for a plan.
2. Master outputs `## Plan` + `## Risks` + `## Decision Points` in caveman mode.
3. Main thread hands plan to **worker** for implementation.
4. Worker outputs `## Task` / `## Changes` / `## Validation` / `## Next Step DONE`.
5. Main thread sends the completed change to **sonar** for static-analysis evidence.
6. Main thread sends worker output and Sonar evidence to **master** for review.
7. Master outputs `## Findings` + `## Verdict APPROVED`.

Minimal test prompt:

```
Add a hello() function to a new file hello.py that prints "hello world". Include a test.
```

Expected flow: master plans small task with no blocking decision points → worker
writes files + runs test + `/dw loop workspace` → sonar reports the project
quality gate → master reviews all evidence + APPROVED.

If routing doesn't fire (main thread answers directly instead of delegating),
check that `CLAUDE.md` is in the project root and the Agent Delegation section
is syntactically intact.

Finally, ask to inspect Git status and propose a commit. Confirm that the main
thread routes the request to **commit** and that no push or PR operation runs
without the documented human gate.
