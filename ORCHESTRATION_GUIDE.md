# Claude Code Orchestration Guide

A practical, baseline setup for orchestrating work across multiple Claude Code
agents. This guide documents the configuration in this workspace
and shows how to replicate it for your own projects.

> **This is a simple baseline.** It demonstrates the core pattern — automatic
> delegation to a planning agent and an implementation agent, with a review
> loop — using a single calculator example. Treat it as a starting point you can
> extend, not a finished framework.

---

## 1. What "Orchestration" Means in Claude Code

Orchestration here means: **the main Claude Code thread does not do the work
itself. It routes every task to a specialized subagent automatically.**

The user never types `@master` or `@worker`. The routing happens behind the
scenes, driven by rules in `CLAUDE.md`. The result is a division of labor:

- A high-capability reasoning agent (**master**) plans, reviews, and debugs.
- A faster implementation agent (**worker**) writes and edits code.
- The main thread is just a dispatcher that picks the right agent and passes
  full context.

This buys two things:

1. **Better outcomes** — planning and review are done by a stronger model; the
   implementer never approves its own work.
2. **Cost control** — the expensive model is used only where reasoning matters;
   routine edits go to a cheaper, faster model.

### The agents in this workspace

| Agent  | Model               | Effort | Role                                   | Tools |
|--------|---------------------|--------|----------------------------------------|-------|
| master | `claude-opus-4-8`   | high   | Plan, review, debug, decide. No code.  | Read, Glob, Grep, Bash |
| worker | `claude-sonnet-5` | medium | Implement, edit, fix, test. No verdicts.| Read, Glob, Grep, Edit, MultiEdit, Write, Bash |
| commit | `claude-sonnet-5` | low    | Owns all git mutations + gh ops. Human-gated on push/force-push/reset/discard/PR create+merge. | Bash, Read |
| sonar  | `claude-sonnet-5` | low    | Read-only SonarQube scan; reports quality gate + issues as evidence. Never edits, never verdicts. | Bash, Read |

Defined in:
- `.claude/agents/master.md`
- `.claude/agents/worker.md`
- `.claude/agents/commit.md`
- `.claude/agents/sonar.md`

Note the **tool asymmetry**: master has no `Edit`/`Write` tools — it physically
cannot modify files. Worker has them. This enforces the "master never writes
code" rule at the tool level, not just by instruction.

---

## 2. The Master / Worker Pattern

The lifecycle of a non-trivial change:

```
        ┌──────────┐   plan    ┌──────────┐  implement  ┌──────────┐
 user → │   main   │ ────────→ │  master  │ ──────────→ │  worker  │
        │ (router) │           │ (plans)  │             │ (codes)  │
        └──────────┘           └──────────┘             └────┬─────┘
              ↑                      ↑                       │
              │                      │   review              │ reports DONE
              │                      └───────────────────────┘
              │                      │
              │            APPROVED  │  NEEDS FIXES
              │           ───────────┴───────────→ back to worker
              └── final result ←─────────────────────────────
```

### Phases

1. **Plan (master).** For any multi-step request, master breaks it into ordered
   steps, lists risks, and surfaces decision points. Master never writes code.
   Output format:

   ```
   ## Plan
   1. <step>
   2. <step>

   ## Risks
   <what could go wrong>

   ## Decision Points
   <anything needing human approval>
   ```

2. **Implement (worker).** The approved plan is handed to worker with full
   context (files, paths, errors). Worker writes/edits code, runs safe local
   tests, and reports what changed. Output format:

   ```
   ## Task
   ## Changes
   ## Validation
   ## Next Step   → DONE | NEEDS CLARIFICATION | BLOCKED
   ```

3. **Review (master).** After worker finishes, the change goes back to master
   for final review. Master runs `/dw review <target>` (read-only) before
   issuing a verdict. Output format:

   ```
   ## Findings
   - path:line: <severity>: <problem>. <fix>.

   ## Verdict
   APPROVED | NEEDS FIXES | BLOCKED
   ```

4. **The fix loop.** If master returns **NEEDS FIXES**, the specific issues
   (severity, location, fix strategy) go straight back to worker — *without*
   asking the human about technical fixes. Worker fixes, reports, then master
   re-reviews. Repeat until **APPROVED**.

```
   master review ──NEEDS FIXES──→ worker fix ──→ master re-review ──┐
        ↑                                                           │
        └───────────────────────────────────────────────────────────┘
                          loop until APPROVED
```

---

## 3. When to Use Each Agent

Pulled from `CLAUDE.md`. The main thread applies these automatically.

### Route to `master` (opus, high reasoning) for:
- Planning multi-step work and breaking down features (incl. unit tests).
- Architecture and design decisions; weighing tradeoffs.
- Final review of any non-trivial code change before it's "done".
- Debugging issues that span files, are intermittent, or lack an obvious cause.
- Troubleshooting / investigation ("it's not working", "why does X fail").
- Resolving ambiguity or conflicting requirements.
- Strategy and how-to questions ("best approach for Y?").

### Route to `worker` (sonnet, medium) for:
- Implementing an approved plan or a clear, scoped change.
- Writing, editing, and refactoring code.
- Fixing well-understood bugs.
- Running safe local tests, builds, linters.
- Summarizing diffs and reporting what changed.
- Reviewing code with diffwarden.

### Route to `commit` (sonnet, low reasoning) for:
- All git mutations: stage, commit, branch create/switch, log, diff, status.
- All gh CLI ops: view/create PRs, issues, checks (create/merge human-gated).
- Proposing and executing commit messages.
- PR *plumbing* (create, push) — not PR *content review* (stays with worker/master).

### Route to `sonar` (sonnet, low reasoning) for:
- Running SonarQube (Community) static-analysis scans.
- Reporting quality gate + open issues (severity, file:line, message) as evidence.
- Read-only reporting only — never edits, never issues a verdict (master decides).

---

## 4. Routing Rules (from `CLAUDE.md`)

The complete rule set the main thread follows. These **override default
behavior**.

1. For any non-trivial request, delegate to `master` first for a plan; don't let
   `worker` start unplanned multi-step work.
2. Hand the approved plan to `worker` for implementation.
3. After `worker` finishes a non-trivial change, send it to `master` for review.
4. **NEEDS FIXES → worker.** Pass specific issues to `worker`; don't ask the
   human about technical fixes. Loop worker → master until APPROVED.
5. **Clear/understood bug fix → straight to `worker`.** Skip master planning
   when the user says "fix X", "the bug is Y", or it's self-evident. Review
   afterward if non-trivial.
6. Trivial one-line / single-file edits with no design impact → `worker`.
7. All git mutations + gh ops → `commit`. Master/worker may still read git
   state (diff/log/status) for context, but never execute git mutations.
8. `commit` owns its own human gate (push/rebase/reset-hard/discard/PR
   create+merge) — no duplicate gate logic elsewhere.
9. When unsure which agent fits → default to `master`.
10. `master` plans/reviews/debugs, never writes. `worker` writes, never approves
    its own work.
11. Surface master's **Decision Points** to the human before critical/destructive
    changes.
12. Strategy/advisory/how-to → `master` first; main thread doesn't answer
    directly.
13. Simple design decisions with an objectively correct answer → `master`,
    accept its recommendation. Only prompt the human when there's no correct
    answer or it needs domain knowledge only they have.
14. "Investigate" requests → `master`; diagnose root cause before fixing.
15. **Docs/plans/CLAUDE.md — decide vs write.** Writing/editing docs, guides,
    READMEs, plans, or CLAUDE.md is execution → `worker` (even non-trivial
    size). Deciding a *new* doc's scope/structure/content when still open →
    `master` decides first, then `worker` writes. Human already picked an
    option → straight to `worker`. Review with `master` only if the doc
    encodes design intent others rely on.
16. **Spine/architecture/policy changes → `master` first.** Anything altering
    the orchestration spine itself (delegation rules, master/worker split,
    agent models/effort, the review loop) is a decision, not a doc edit —
    route to `master` to reason/plan first, surface Decision Points to the
    human, then `worker` executes the approved wording. Exception to rule 13.
17. **SonarQube scan → `sonar`, then feed `master`.** After worker finishes a
    non-trivial change, route to `sonar` to scan + report quality gate/issues.
    `sonar` never decides — hands findings to `master`, who folds them into
    the APPROVED/NEEDS FIXES verdict alongside `/dw review`. `sonar` is
    read-only, never edits/commits. Community-edition caveat: scans cover
    main branch only, not worker's isolated diff — `sonar` states this when a
    per-diff check is implied.

**Always:** pass full context (files, paths, errors, plan); prefer absolute
paths; keep the user out of routing decisions.

---

## 5. Skills: `caveman` and `diffwarden`

Both agents declare two skills in their frontmatter:

```yaml
skills:
  - caveman:full
  - diffwarden
```

### `caveman:full` — output compression

Both master and worker **always respond in caveman full mode**: terse, drop
articles/filler/pleasantries, but keep code, paths, and errors *exact*.

Why it matters for orchestration: a subagent's output is injected verbatim into
the main thread's context. Compressed output (~60–75% smaller) means the main
context lasts far longer across a long session. The same finding that costs 2k
tokens in prose costs ~700 tokens in caveman.

The related `cavecrew` skill (decision guide) tells the main thread when to spawn
compressed-output subagents (`cavecrew-investigator`, `-builder`, `-reviewer`)
vs. vanilla agents — pick caveman/cavecrew when you'd want the output in 1/3 the
tokens, vanilla when you want prose.

Safety carve-out: security warnings, irreversible actions, and commit/PR text
stay in normal prose even in caveman mode.

### `diffwarden` — review & fix loop

Diffwarden is an agent-neutral reviewer/fixer. Core loop:

```
preflight → detect mode → collect evidence → classify → fix safe issues
→ verify → rescore → repeat
```

The two agents use it differently:

- **master** runs `/dw review <target>` — **read-only, no loop**. It collects
  evidence, classifies findings (P0–P3), and scores merge-readiness, then folds
  those findings into its APPROVED / NEEDS FIXES verdict. Master never edits.
- **worker** runs `/dw loop` (or `/dw loop workspace` for non-git folders)
  before reporting DONE — this review-fixes-verifies safe issues automatically.

Key diffwarden modes:

| Target              | Mode      | Notes                              |
|---------------------|-----------|------------------------------------|
| `workspace`         | workspace | files, git not required            |
| `local` / `staged`  | git-local | uncommitted changes, git required  |
| `#123` / URL        | PR        | GitHub PR, needs git + gh          |
| `path/to/file.md`   | document  | reviews prose/plans/guides         |

Output is **lean** by default (one-line `cN/5` loop progress); `--verbose` gives
the full report. Diffwarden is conservative: it never auto-merges, force-pushes,
or weakens CI/tests/auth.

---

## 6. Worked Example: A Simple Calculator

This shows the full orchestration workflow end-to-end. The output samples are in
caveman mode, matching how the real agents respond.

### 6.1 User request

> "Add a calculator module with add, subtract, multiply, divide. Include tests."

This is multi-step → main thread routes to **master** first (rule 1).

### 6.2 Master plans

```
Master agent: claude-opus-4-8 - high

## Plan
1. calculator.py: add(a,b), subtract(a,b), multiply(a,b), divide(a,b).
2. divide: raise ValueError on b==0. No silent inf/NaN.
3. Type-annotate; accept int|float, return float.
4. test_calculator.py: pytest. Cover each op + divide-by-zero raises.
5. Edge cases: negatives, floats, zero operands.

## Risks
- divide-by-zero handling must be explicit, not crash.
- float precision in assertions → use pytest.approx.

## Decision Points
- None. Scope clear. Proceed to worker.
```

No decision points need human sign-off → main thread hands plan to **worker**
(rule 2).

### 6.3 Worker implements

Worker writes `calculator.py` and `test_calculator.py`, then runs `/dw loop
workspace` (non-git folder) before reporting.

```
Worker agent: claude-sonnet-5 - medium

## Task
Calculator module + pytest suite per master plan.

## Changes
- calculator.py — add/subtract/multiply/divide, ValueError on /0.
- test_calculator.py — 8 cases incl. divide-by-zero, negatives, floats.

## Validation
- pytest -q → 8 passed.
- /dw loop workspace → c5/5 clean.

## Next Step
DONE
```

Example of what worker produced:

```python
# calculator.py
def add(a: float, b: float) -> float:
    return a + b

def subtract(a: float, b: float) -> float:
    return a - b

def multiply(a: float, b: float) -> float:
    return a * b

def divide(a: float, b: float) -> float:
    if b == 0:
        raise ValueError("division by zero")
    return a / b
```

```python
# test_calculator.py
import pytest
from calculator import add, subtract, multiply, divide

def test_add():       assert add(2, 3) == 5
def test_subtract():  assert subtract(5, 3) == 2
def test_multiply():  assert multiply(4, 3) == 12
def test_divide():    assert divide(10, 2) == 5
def test_divide_floats(): assert divide(1, 3) == pytest.approx(0.3333, abs=1e-4)
def test_negatives(): assert add(-2, -3) == -5
def test_divide_by_zero():
    with pytest.raises(ValueError):
        divide(1, 0)
```

### 6.4 Master reviews

Non-trivial change → back to master (rule 3). Master runs `/dw review workspace`
first, then issues a verdict.

```
Master agent: claude-opus-4-8 - high

## Findings
- calculator.py: P3: ops accept int but annotated float. Cosmetic, acceptable.
- test_calculator.py: all 4 ops + /0 + negatives + float covered. Good.
- /dw review workspace → c5/5, no P0/P1/P2.

## Verdict
APPROVED
```

If instead master had found a real gap, the loop kicks in:

```
## Findings
- calculator.py:divide: P1: returns inf on b==0 instead of raising. Add
  `if b == 0: raise ValueError`.

## Verdict
NEEDS FIXES
```

→ Main thread passes that exact finding to **worker** (rule 4), worker fixes and
reports, master re-reviews. Repeat until APPROVED. The human is not consulted for
this technical fix.

### 6.5 Where the skills show up

- **caveman** — every block above is terse, no filler, but paths/code/`cN/5`
  scores are exact. Compressed output keeps main-thread context small.
- **diffwarden** — worker's `/dw loop workspace` auto-fixed safe issues and
  reported `c5/5`; master's `/dw review workspace` grounded the APPROVED verdict
  in real evidence rather than a guess.

---

## 7. The Supporting Infrastructure

Beyond agents and skills, this workspace adds **token tracking** so you can see
the cost of each session and model.

### Hooks (`/.claude/settings.json`)

```
SessionStart  → runs parse_usage.py --reconcile (catch-up parse)
SessionEnd    → runs session_end.sh → parse_usage.py --transcript <path>
```

### Token parser (`/.claude/scripts/parse_usage.py`)

Parses Claude Code JSONL transcripts into `/.claude/usage.csv`. Design highlights
(from `TOKEN_TRACKING_PLAN.md`):

- **Authoritative source = JSONL transcripts** (immutable); CSV is a rebuildable
  projection.
- **Dedup on `message.id`** — mandatory; streaming snapshots otherwise inflate
  tokens 2–3×.
- **Upsert keyed on `(Session_ID, Model)`** — one row per session+model.
- **Atomic writes** via `os.replace()` to survive concurrent hook runs.
- Three modes: `--transcript <path>`, `--reconcile`, `--rebuild`.

CSV schema:

```
Session_ID, Session_Name, Model, Effort, Billable_Tokens, Cache_Tokens,
Total_Tokens, Run_ID, Last_Parsed
```

This is optional to the orchestration pattern itself, but it's how you measure
whether the master/worker split is actually saving you money.

---

## 8. Extending This Setup for Your Own Project

This is a **baseline**. Common extensions:

### Add a new agent
Create `.claude/agents/<name>.md` with frontmatter:

```yaml
---
name: tester
description: When to use this agent (the router reads this to decide).
model: claude-sonnet-5
effort: medium
tools: Read, Glob, Grep, Bash   # grant only what the role needs
skills:
  - caveman:full
  - diffwarden
color: blue
---
You are the Tester Agent. ...
```

- The `description` is load-bearing — the main thread routes on it.
- **Tool scoping is a guardrail.** Omit `Edit`/`Write` for a review-only agent;
  omit `Bash` for an agent that shouldn't run commands.

### Tune the routing rules
Edit the **Routing rules** in `CLAUDE.md`. Add a rule mapping your new task types
to the right agent. Keep the "plan → implement → review" spine intact.

### Adjust the review gate
Master runs `/dw review` before APPROVED. To make the gate stricter, switch the
worker step to `/dw loop --max 5` or add `--security` for sensitive code. For
GitHub PRs, use `/dw review #<num>` or `/dw comment #<num>`.

### Add project-specific verification
Diffwarden discovers test/lint commands from `package.json`, `pyproject.toml`,
`Makefile`, `.github/workflows/*`, `CLAUDE.md`, etc. Put your real commands there
so worker's `/dw loop` and master's review run grounded checks instead of
guessing.

### Replicate in a new repo (checklist)
1. Copy `.claude/agents/master.md` and `worker.md`.
2. Copy/author a `CLAUDE.md` with the Agent Delegation section.
3. Install the `caveman` and `diffwarden` skills/plugins.
4. (Optional) Copy `.claude/hooks/`, `.claude/scripts/parse_usage.py`, and the
   `settings.json` hook block for token tracking. The transcript directory is
   resolved automatically via `resolve_transcripts_glob()`; pass `--project-dir`
   to the parser if you need to override it.
5. Verify: ask for a small multi-step change and confirm the
   plan → implement → review → loop flow fires automatically.

---

## 9. Quick Reference

| You want…                          | Routes to | Why |
|------------------------------------|-----------|-----|
| A feature broken into steps        | master    | planning |
| Code written from an approved plan | worker    | implementation |
| Final sign-off on a change         | master    | review (+ `/dw review`) |
| A clearly-stated bug fixed         | worker    | scoped, understood |
| "Why is this failing?"             | master    | root-cause debug |
| "Best approach for X?"             | master    | strategy |
| A one-line edit                    | worker    | trivial |
| Auto-fix lint/review issues        | worker    | `/dw loop` |
| Git commit/PR/branch ops           | commit    | mutations + gh, human-gated on destructive |
| Run SonarQube scan                 | sonar     | read-only quality-gate evidence for master |

**Core invariant:** master decides, worker builds, master reviews, loop until
APPROVED — and the human only weighs in on genuine decision points, never on
routing or routine technical fixes.

---

*Baseline setup. Start here, then extend agents, rules, and verification to fit
your project.*
