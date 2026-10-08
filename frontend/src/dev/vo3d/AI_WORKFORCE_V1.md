# AI Workforce V1 — status, known issues, deferred work

Closed out in Phase 7 (2026-10-02). For the execution seam see `AGENT_HARNESS_SEAM.md`.

## What V1 is

- The treehouse AI Lab (V2) is the only Lab. The AI Workforce is always on, labelled **Preview — scripted sample,
  not real AI work** everywhere a user could mistake it for real execution (status card, task chat header and
  footer, result viewer, and every guarded-action approval card).
- Execution is the scripted mock (`world/agentOrchestrationMock.ts`), selected in exactly one place
  (`world/orchestrationSource.ts`). The Agent Harness adapter replaces it there; nothing downstream changes.
- Job truth (`world/agentJob.ts` → `world/jobStore.ts`) is authoritative. The physical Lab (`app/labWorkforce.ts`)
  only decides how it looks: live choreography while the employee is present (Floor 1, visible tab, not in the
  elevator or the Cave); adopt-the-truth with no replay while away. Watch in Lab moves the camera only.
- Dev tooling (Reset, Re-enter, example feedback) only with `?aidemo=1`. `?ailab=v1` and `?aiworkforce=0` were
  retired in Phase 6B.8 and are ignored.

## Real-stack sanity check — PASSED (2026-10-02)

Signed in through Atlas (`http://localhost:3000/login`, then `/virtual-office`, which Atlas's Next app proxies to
the VO dev server on :5173). VO loaded normally, the treehouse Lab loaded, the agents came out of home/rest when the
orchestration began, the workflow ran, a hidden tab kept progressing, and returning showed the completed state.
(Opening :5173 directly with the auth gate on bounces to `/login` by design: VO has no login page of its own.)

## Known issues (deliberately not fixed here)

### V2 Lab "sinking" — drawn surfaces above the ground model

Found when `exteriorGround.test.ts` first raycast the V2 build (6B.8). The V2 Lab draws its stone, deck and soil
higher than the exterior ground model, which still uses the V1-era Lab constants (`world/ailab.ts`):

| Point | Drawn − model |
|---|---|
| PATH_LINK causeway | +0.35 |
| PATH_W causeway | +0.35 |
| Lab terrace, west (plinth) | +0.50 |
| Lakeside terrace | +0.41 |
| Lab hall | +0.31 |

A walker stands 0.3–0.5 units into the surface (about 1% of body height). Pinned in the test as
`KNOWN_DRAWN_OFFSET`, so it cannot grow unnoticed. Not fixed: the causeway and plinth heights are shared with
walking, scooter traversal (step-up/drop limits) and the ground model, so a correction is a ground-model change of
its own. Two options when it is picked up: raise the model's Lab-surface heights to the drawn ones and re-check
ride/walk step limits, or lower the V2 builder's stone to the model.

### Toucan forearm perch — infeasible on current employee rigs (deferred to HumanBase_V1)

Studied 2026-10-02 against all ten roster rigs (node-decoded GLBs). All share one 24-bone skeleton, so a
skeleton-relative socket and the rider-style two-bone arm solve (`avatar/riderPose.ts`) would carry over unchanged.
The blocker is proportion, not deformation:

- body 36 tall; shoulder ≈ (4, 16, 0); arm reach (upper + forearm) 6.0–8.0; forearm 2.5–4 thick;
- the head starts at shoulder height (y ≈ 14–16) and is ≈ 17–20 wide, 20 tall, 17–19 deep;
- the Toucan is 17 × 10.7 × 12.6, feet 5.35 below its centre.

At a natural raised forearm the bird overlapped 5,000–10,600 sampled head/torso vertices on every rig; the best
reachable spot anywhere still overlapped 500–2,700 (arm almost straight, at hip height). A clean perch would need
the bird at 0.25–0.40× its size (none for Bon or Angelo).

**HumanBase_V1 requirement:** in the raised-forearm pose the forearm must clear the head silhouette by at least half
the bird's width plus a margin (≈ 7 units outside the head at shoulder height; today's total reach is ≈ 7).

### Other

- While present, the task chat trails the job's truth by up to ≈ 2 minutes (the approved physical pacing; the
  mock finishes in ≈ 55 s). A catch-up cap would be a product decision.
- The mock keeps jobs in memory: a reload forgets them. Persistent history arrives with the backend/Harness.
- `world/ailab.ts` still exports the original Lab's stand test (unused at runtime); its constants are shared with
  scooters, construction, the Lab shell and the ground model, so the module stays.
