# CLAUDE.md

This file is shared by everyone working on the repo, in two environments:

- **Herdr** (`HERDR_ENV=1`): Codex agents in Herdr split panes. See [A. Herdr mode](#a-herdr-mode).
- **Claude Code** (no Herdr): Claude's own subagents in `.claude/agents/`. See [B. Claude Code mode](#b-claude-code-mode).

**Pick the mode first.** If `HERDR_ENV` is `1`, use Herdr mode. Otherwise use Claude Code mode. Never install, invoke or wait on tooling the current environment doesn't have. If something a mode needs is missing, say so and carry on with what is installed.

Everything else below applies in both modes.

## Roles

The session you are talking to is the **router**. It hands work to the role that fits and never makes the user name an agent.

| Role | Does | Herdr agent | Claude Code agent |
|---|---|---|---|
| Decision | Planning, architecture, tradeoffs, debugging and investigation, strategy and how-to questions | `vo-decision` | `master` |
| Implementation | Writes, edits and refactors code and docs, fixes bugs, runs local tests, builds, linters and the Sonar scan | `vo-worker` | `worker` |
| Review | Reviews every non-trivial change and returns `APPROVED` / `NEEDS FIXES` / `BLOCKED` | `vo-reviewer` | `master` |
| Git / gh | Stages, commits, branches, and runs gh | `vo-worker` | `commit` |

## Routing rules

1. **Non-trivial or multi-step work** goes to Decision for a plan first, with unit tests where needed. Show the user any Decision Points on critical or destructive changes before going on.
2. Send the approved plan to Implementation.
3. After a non-trivial change, send it to Review with the plan and the changed file paths. Review reads `git diff` itself. Attach the Sonar output as evidence when a scan was run (see [Optional tools](#optional-tools)).
4. **NEEDS FIXES:** send the specific issues (severity, location, fix) straight to Implementation, then review again. Loop until **APPROVED**. Don't ask the user about technical fixes.
5. **A clear or understood bug** (the user says "fix X", or the cause is obvious from an error or diff) skips Decision: Implementation, then Review.
6. **Trivial single-file edits** with no design impact go to Implementation only. No review needed.
7. **Investigation, "why is X broken", and strategy questions** go to Decision. Diagnose the root cause before any fix.
8. **Docs:** deciding a new doc's scope is Decision's job; writing and editing docs is Implementation's. A change to this routing spine (roles, agents, models, the review loop) goes to Decision first, then the user approves, then Implementation edits.
9. **Quick factual checks and simple clarifications** are answered by the router directly, with no agent. Decision is the most expensive tier: use it when the task needs planning, review or debugging, not by reflex.
10. **Separation of duties:** Decision and Review never edit code or run git mutations. Implementation never approves its own work. Review inspects the diff and the acceptance criteria independently and cites evidence; the implementer's own verdict is not evidence. For unusually risky changes, use a reviewer from a different model family where one is available.
11. **Git and gh are run only by the Git role.** Committing locally is fine. Everything else follows the approval gate below.

## Approval gate

Nobody (router or agent) does any of these without the user's explicit OK, given for that specific action. The router relays the request with the exact command and its target.

- **Git:** `git push` in any form (including `--force` / `--force-with-lease`), opening or merging a PR, `git rebase`, `git reset --hard`, and discarding work (`git checkout --`, `git restore`, `git clean -f`).
- **Deleting** important files, or any other destructive command (`rm -rf` and the like).
- **Database migrations:** any `alembic upgrade` or `downgrade`, or any schema change. Before one is run against a throwaway database for testing, confirm the resolved `DATABASE_URL` is that database and stop if it isn't. A migration command must never fall through to the `.env` default.
- **Deploying** to any environment.
- **Secrets and environment variables:** reading them out, changing them, or committing them.
- **Authentication or authorization** logic.

Ask in plain words, not in caveman. Approval for one action does not carry over to the next.

## Commit hygiene

- Compose the message from `git status` and `git diff --staged`, never from memory. Read `.claude/commit-hints.md` first if it exists.
- Use the repo's own git identity. Never set or override `user.name` / `user.email`.
- Let hooks run. Never use `--no-verify`, `--no-gpg-sign` or `-c commit.gpgsign=false`.
- Use Conventional Commits: `type(scope): subject`, subject in the imperative and kept short, with a body that explains what changed and why in plain words.
- Add the `Co-Authored-By` trailer the session specifies for the current model.
- Stage files by explicit path. Never `git add -A` / `git add .`: the working tree can hold large local files that are deliberately untracked.

## Modes: ponytail + caveman

These apply to the router and every agent, in both environments.

- **ponytail** is required on every code task: writing, editing, refactoring, fixing, planning or reviewing code. Write the least code that works. Prefer what the platform or stdlib already has. Add no speculative abstractions or dependencies, and never drop a safety guard, validation or test to save lines. Review flags over-built code as a NEEDS FIXES finding.
- **caveman** is always on for prose: chat replies, status updates, plans and review reports. Use as few words as possible.
- **On conflicts, ponytail wins for code.** Caveman only shortens the talk around the code, never the code itself. Code, identifiers, error and log messages, comments ponytail keeps, commands, file paths and commit messages stay clear and conventional.
- Drop caveman for security warnings, destructive-action confirmations and Decision Points. Those must be unambiguous.

These are instructions, not plugins: nothing has to be installed for them.

## Optional tools

None of these are required. Use one only when it is present, and say so when it is skipped.

- **SonarQube:** `.claude/scripts/sonar_scan.sh <project_dir> <project_key> [sources]` (run by Implementation). It needs Docker and a local `.claude/sonar.env` (`SONAR_TOKEN`, `SONAR_HOST_URL`, …). If either is missing, skip the scan and note it in the review request. The output is evidence for Review, never a verdict. Community edition scans the main branch only, not an isolated diff, so say that whenever a per-diff check is implied.
- **Review and style plugins** (for example `diffwarden`'s `/dw`, `caveman`): use them if installed. Their absence never blocks work; the rules above stand on their own.

## A. Herdr mode

Applies only when `HERDR_ENV=1`.

**The router never uses in-process subagents** (the `Agent` tool or `.claude/agents`). Every task goes to a Herdr agent in a split pane of the **current Herdr tab**.

| Name | Kind | Model / effort |
|---|---|---|
| `vo-decision` | `codex` | `gpt-6-astra`, reasoning `medium` |
| `vo-worker` | `codex` | `gpt-6-astra`, reasoning `medium` |
| `vo-reviewer` | `codex` | `gpt-6-astra`, reasoning `medium` |

Names carry the `vo-` prefix because Herdr agent names must be unique across **all** workspaces, and other projects may already use plain names like `worker`. Machine-specific notes (an existing agent to reuse, a pane to avoid) belong in your own untracked `CLAUDE.local.md`, not here.

### Spawning (herdr skill)

Load the `herdr` skill first. If `HERDR_ENV` is not `1`, you are not in this mode; use [B. Claude Code mode](#b-claude-code-mode).

Check `herdr agent list` before spawning. Reuse a live agent with the right name **only if it is in this tab** (`tab_id` = `$HERDR_TAB_ID`). Never touch or rename an agent from another workspace. Spawn each missing agent **lazily**, the first time it is needed.

Layout: the router keeps the left pane. `vo-worker` opens to the right, and `vo-decision` and `vo-reviewer` stack under it. Always use `--cwd "$PWD" --no-focus`, and read pane IDs from the JSON response; never guess them. `codex` lives in `~/.npm-global/bin`, which isn't on the default `PATH`, so pass it with `--env`.

```bash
pid() { python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])'; }
NP="PATH=$HOME/.npm-global/bin:$PATH"

# vo-worker — right of router
W=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus --env "$NP" | pid)
herdr agent start vo-worker --kind codex --pane "$W" --timeout 60000 -- -m gpt-6-astra -c model_reasoning_effort="medium"

# vo-decision — below vo-worker
D=$(herdr pane split --pane "$W" --direction down --cwd "$PWD" --no-focus --env "$NP" | pid)
herdr agent start vo-decision --kind codex --pane "$D" --timeout 60000 -- -m gpt-6-astra -c model_reasoning_effort="medium"

# vo-reviewer — below vo-decision
R=$(herdr pane split --pane "$D" --direction down --cwd "$PWD" --no-focus --env "$NP" | pid)
herdr agent start vo-reviewer --kind codex --pane "$R" --timeout 60000 -- -m gpt-6-astra -c model_reasoning_effort="medium"
```

If `vo-worker` isn't running yet when a Codex agent is needed, split `--current --direction right` for that first agent instead.

After a Codex agent starts, check its pane with `herdr agent read <name> --source visible`. It may be showing a startup dialog (folder trust, update notice). Ask the user before answering one; don't pick an option yourself.

### Talking to agents

- Send work with `herdr agent prompt <name> "<task>" --wait --timeout 600000`, then collect the result with `herdr agent read <name> --source recent-unwrapped --lines 200`.
- If the answer is too long to read back, ask the agent to write it to a Markdown file in the scratchpad and reply with just the path.
- Every prompt must be self-contained: goal, absolute file paths, errors, the approved plan, and the output format you expect back. Agents don't share context with each other or with the router.
- If an agent returns `blocked` (an approval or question dialog), read it with `agent read` and ask the user before answering. After a timeout or stall, inspect the agent before re-sending; never blindly resubmit.
- Don't close panes you didn't create. Leave agents running between tasks so they keep their context.
- Start every prompt with `You are <name>. Modes: ponytail (code) + caveman (prose); ponytail wins on code.` State the assigned role, and tell the agent to read this file at `$PWD/CLAUDE.md` (pass the absolute path of the current checkout) and apply the note below. Codex does not load this file automatically.

### Note for spawned agents

If you are a `vo-*` agent reading this file, the router sections don't apply to you. Follow the shared rules (routing for your role, the approval gate, commit hygiene, modes) and do the task in your prompt. Never spawn agents.

## B. Claude Code mode

Applies when `HERDR_ENV` is not `1`.

The router delegates through Claude Code's own subagents (the `Agent` tool), defined in `.claude/agents/`:

| Agent | Model / effort | Role |
|---|---|---|
| `master` | `opus`, high | Decision and Review: plans, debugs, reviews, decides. Never edits code or runs git mutations. |
| `worker` | `sonnet`, medium | Implementation: writes and edits code and docs, runs local tests, builds, linters and the Sonar scan. Never approves its own work. |
| `commit` | `sonnet`, low | Git / gh: stages, commits, branches, runs gh. Owns the approval gate for Git. |

The models are aliases, so they follow the current Claude models without version pins. Pass full context (files, absolute paths, errors, the plan) in every handoff. Subagents don't spawn subagents.

## Always

- Use absolute paths in every handoff.
- Keep the user out of routing decisions. Ask them only about genuine product or domain choices.
- [ORCHESTRATION_GUIDE.md](./ORCHESTRATION_GUIDE.md) and [WORKSPACE_TEMPLATE.md](./WORKSPACE_TEMPLATE.md) are background on demand only. They describe the earlier Claude-only setup and may be out of date. Where they differ, this file wins.
