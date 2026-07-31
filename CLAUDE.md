# CLAUDE.md

## Agent Delegation (Automatic)

Route every task to a subagent. Never wait to be asked. Never make the user type `@master` or `@worker`.

### Use `master` (opus, high reasoning) for:
- Planning multi-step work and breaking down features (include unit tests in plan where necessary)
- Architecture and design decisions; weighing tradeoffs
- Final review of any non-trivial code change before it is considered done
- Debugging issues that span files, are intermittent, or lack an obvious cause
- Troubleshooting and investigation ("it's not working", "can you investigate why", "what's wrong with") — diagnose root cause first
- Resolving ambiguity or conflicting requirements
- Strategy and how-to questions ("how would I achieve X?", "best approach for Y?", "skills vs tools vs plugins?") — reason it through before answering

### Use `worker` (sonnet, medium) for:
- Implementing an approved plan or a clear, scoped change
- Writing, editing, and refactoring code
- Fixing well-understood bugs
- Running safe local tests, builds, and linters
- Summarizing diffs and reporting what changed
- Reviewing code (diffwarden)

### Use `commit` (sonnet, low) for:
- All git mutations: stage, commit, branch create/switch, log, diff, status
- All gh CLI ops: view/create PRs, issues, checks (create/merge are human-gated)
- Proposing and executing commit messages
- PR *plumbing* (create, push) — not PR *content review* (that's worker/master)

### Use `sonar` (sonnet, low) for:
- Running SonarQube (Community) static-analysis scans on a project
- Reporting the quality gate + open issues (severity, file:line, message) as evidence
- Read-only reporter — never edits code, never issues a verdict (that stays with `master`)

### Routing rules
1. For any non-trivial request, delegate to `master` first to produce a plan; do not let `worker` start unplanned multi-step work.
2. Hand the approved plan to `worker` for implementation.
3. After `worker` finishes a non-trivial change, send it to `master` for final review.
4. **If `master` returns NEEDS FIXES:** Pass the specific issues (severity, location, fix strategy) directly to `worker`. Do not ask the human for input on technical fixes. `worker` implements, reports changes, then loop back to `master` for re-review. Repeat until APPROVED.
5. **Fix code with clear/understood issue → go straight to `worker`.** User says "fix X", "the bug is Y", or issue is self-evident from error/diff — skip `master` planning step. `worker` fixes and reports; then send to `master` for review if non-trivial.
6. Trivial one-line or single-file edits with no design impact go straight to `worker`.
7. All git mutations + gh ops route to `commit` agent. `master`/`worker` may still read git state (diff/log/status) for review context — they must not execute git mutations.
8. `commit` agent owns its human gate (push/rebase/reset-hard/discard/PR create+merge). Do not duplicate gate logic here.
9. When unsure which agent fits, default to `master` to decide.
10. `master` plans, reviews, and debugs — it never writes code. `worker` writes code — it never approves its own work.
11. Surface `master`'s Decision Points to the human before proceeding on critical or destructive changes.
12. For strategy/advisory/how-to questions, route to `master` for reasoning first; the main thread does not answer directly.
13. For simple clarification or design decisions that don't require user input (tradeoffs, best practices, technical recommendations), route to `master` and accept the recommendation directly. Only prompt the human for decisions that have no objectively correct answer or require domain knowledge only the user has.
14. "Investigate" requests → route to `master`. Diagnose root cause before suggesting fixes or implementation.
15. **Docs/plans/CLAUDE.md — split decide vs write.**
    - **Writing/editing** documentation, guides, READMEs, plans, comments, or CLAUDE.md is execution → `worker`. Covers wording, restructuring, adding examples, fixing stale references, and applying a decision already made. Route to `worker` even when non-trivial in size (overrides rule 1's default-to-`master` pull for mechanical prose/doc work).
    - **Deciding** what a *new* doc should be — its scope, structure, or content — when that is still open → `master` decides first, then `worker` writes. A "create a guide/doc for X" with no option chosen and no scope given is a decision, not yet execution.
    - When the human already chose (e.g. "proceed with option 2"), the decision is made → straight to `worker`.
    - Send back to `master` for review only if the doc encodes design intent others rely on.
16. **Spine/architecture/policy changes → `master` first.** If the change *decides* something rather than *records* it — wider architectural direction, a policy or routing-rule change, anything altering the orchestration spine itself (these delegation rules, the master/worker split, agent models/reasoning levels, the review loop) — route to `master` to reason and plan before any edit, even when the change lands in a doc or CLAUDE.md (this is the exception to rule 13). Surface Decision Points (rule 9) to the human before applying. `worker` then executes the approved wording.
17. **SonarQube scan → `sonar`, then feed `master`.** After `worker` finishes a non-trivial change, route to `sonar` to scan and report the quality gate + issues. `sonar` never decides — it hands the findings to `master`, who folds them into the APPROVED / NEEDS FIXES verdict alongside `/dw review` (same evidence-not-verdict role diffwarden plays). `sonar` runs read-only; it never edits or commits. Community-edition caveat: scans cover the main branch only, not worker's isolated diff — `sonar` states this when a per-diff check is implied.

### Always
@ORCHESTRATION_GUIDE.md
@WORKSPACE_TEMPLATE.md
- Pass full context (files, paths, errors, plan) to the chosen agent.
- Prefer absolute paths in all handoffs.
- Keep the user out of routing decisions; just delegate.