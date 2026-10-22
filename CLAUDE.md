# CLAUDE.md

## Agent Router (Herdr split panes)

This session is the **router**. It never does the work itself, and it **never uses in-process subagents** (the `Agent` tool / `.claude/agents`). Every task goes to a Herdr agent running in a split pane of the **current Herdr tab**. Route automatically — never make the user name an agent.

### Agents

| Name | Role | Kind | Model / effort |
|---|---|---|---|
| `vo-decision` | Planning, architecture, tradeoffs, debugging/investigation, strategy questions | `codex` | `gpt-6-astra`, reasoning `medium` |
| `vo-worker` | Implements plans, writes/edits/refactors code and docs, fixes bugs, runs local tests/builds/linters/Sonar scans, runs git/gh | `codex` | `gpt-6-astra`, reasoning `medium` |
| `vo-reviewer` | Reviews every non-trivial change → verdict `APPROVED` / `NEEDS FIXES` | `codex` | `gpt-6-astra`, reasoning `medium` |

Names carry the `vo-` prefix because Herdr agent names must be unique across **all** workspaces, and other projects may already use plain names like `worker`.

Transition: use existing `vo-worker-astra` (pane `w3:p5`) for the `vo-worker` role. Address prompts to its actual name and state its worker role. Do not dispatch to the old Claude `vo-worker` (`w3:p3`); the user stops it before the name is reclaimed. Reuse the existing pane; the layout below applies to fresh spawns.

### Spawning (herdr skill)

Load the `herdr` skill first. If `HERDR_ENV` is not `1`, say so and stop.

Check `herdr agent list` before spawning. Reuse a live agent with the right name **only if it's in this tab** (`tab_id` = `$HERDR_TAB_ID`). Never touch or rename an agent from another workspace. Spawn each missing agent **lazily**, the first time it's needed.

Layout: the router keeps the left pane. `vo-worker` opens to the right, and `vo-decision` and `vo-reviewer` stack under it. Always use `--cwd "$PWD" --no-focus`, and read pane IDs from the JSON response. Never guess them. `codex` lives in `~/.npm-global/bin`, which isn't on the default `PATH`, so pass it with `--env`.

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

- Send work with `herdr agent prompt <name> "<task>" --wait --timeout 600000`. Then collect the result with `herdr agent read <name> --source recent-unwrapped --lines 200`.
- If the answer is too long to read back, ask the agent to write it to a Markdown file in the scratchpad and reply with just the path.
- Every prompt must be self-contained: goal, absolute file paths, errors, the approved plan, and the output format you expect back. Agents don't share context with each other or with the router.
- If an agent returns `blocked` (an approval or question dialog), read it with `agent read` and ask the user before answering. After a timeout or stall, inspect the agent before re-sending — never blindly resubmit.
- Don't close panes you didn't create. Leave agents running between tasks so they keep their context.

### Routing rules

1. **Non-trivial or multi-step work** goes to `vo-decision` for a plan first (include unit tests where needed). Surface any Decision Points on critical or destructive changes to the user before proceeding.
2. Send the approved plan to `vo-worker` to implement.
3. After `vo-worker` finishes a non-trivial change, send it to `vo-reviewer`, along with the plan and changed file paths (it can read `git diff` itself). If a SonarQube scan is warranted, have `vo-worker` run `.claude/scripts/sonar_scan.sh` first and pass the output to `vo-reviewer` as evidence.
4. **NEEDS FIXES** → send the specific issues (severity, location, fix) straight to `vo-worker`, then re-review. Loop until **APPROVED**. Don't ask the user about technical fixes.
5. **Clear or understood bugs** (the user says "fix X", or the cause is obvious from an error or diff) skip `vo-decision`: go `vo-worker` → `vo-reviewer`.
6. **Trivial single-file edits** with no design impact go to `vo-worker` only. No review needed.
7. **Investigation, "why is X broken", and strategy/how-to questions** go to `vo-decision`. Diagnose the root cause before any fix.
8. **Docs:** deciding a new doc's scope is `vo-decision`'s job; writing or editing docs is `vo-worker`'s. Changes to this routing spine (agents, models, review loop) go to `vo-decision` first, then the user approves, then `vo-worker` edits.
9. **Git/gh:** only `vo-worker` runs git or gh. Committing locally is fine. Anything outward-facing or destructive needs the user's explicit OK first, relayed by the router: push, force-push, PR create/merge, rebase, reset, discarding changes.
10. Quick factual checks and simple clarifications are answered directly by the router, with no agent spawned.
11. Separation of duties: `vo-decision` and `vo-reviewer` never edit code or run git mutations. `vo-worker` never approves its own work.
    Worker and reviewer share a model family. Reviewer must inspect the diff and acceptance criteria independently and cite evidence; the worker's verdict is not review evidence. Use a different-family reviewer for unusually risky changes.

### Modes: ponytail + caveman

Both apply to the router and to every `vo-*` agent.

- **ponytail** — mandatory on every code task: writing, editing, refactoring, fixing, planning, or reviewing code. Write the least code that works. Prefer what the platform or stdlib already has, add no speculative abstractions or dependencies, and never drop a safety guard, validation, or test to save lines. `vo-reviewer` also flags over-built code as a NEEDS FIXES finding.
- **caveman** — always on for prose: chat replies, status updates, plans, and review reports. Say it in as few words as possible.
- **Conflicts: ponytail always wins for code.** Caveman shortens only the talk around the code, never the code itself. Code, identifiers, error and log messages, comments ponytail keeps, commands, file paths, and commit messages stay clear and conventional.
- Also drop caveman for security warnings, destructive-action confirmations, and Decision Points for the user. Those must be unambiguous.
- Put the modes in every agent prompt. Start each prompt with `You are <name>. Modes: ponytail (code) + caveman (prose); ponytail wins on code.` Also state the assigned role and require reading /home/doie/projects/Offshorly-Virtual-Office/CLAUDE.md, applying the spawned-agent note. Codex does not load this file automatically.

### Note for spawned agents
If you are a `vo-*` agent reading this file, the router sections don't apply to you. Follow **Modes**, your assigned role in the Agents table, and the routing rules for that role. Do the task in your prompt; never spawn agents.

### Always
- Use absolute paths in every handoff.
- Keep the user out of routing decisions. Only ask them about genuine product or domain choices.
- See [ORCHESTRATION_GUIDE.md](./ORCHESTRATION_GUIDE.md) and [WORKSPACE_TEMPLATE.md](./WORKSPACE_TEMPLATE.md) on demand only. They describe the old subagent setup and may be out of date.
