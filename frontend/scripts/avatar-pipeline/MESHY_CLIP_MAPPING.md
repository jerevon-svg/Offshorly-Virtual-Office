# Meshy Clip Mapping — Phase 0.1 research (no API calls made)

Source doc scraped for this research: https://docs.meshy.ai/en/api/animation-library
("Animation Library Reference | Meshy Docs" — table of all Meshy Auto-Rigging &
Animation API animations, each row = `action_id`, animation `Name`, `Category`,
`SubCategory`). This is the same page the existing
`meshy-generate-pose-animations.mjs` header comment cites for its known
mappings (`Idle=0`, `Chair_Sit_Idle_M=33`, `Confused_Scratch=36`, `Shrug=317`).

`POST /openapi/v1/animations` takes a **numeric** `action_id` in the request
body (`{ rig_task_id, action_id }`) — not a text preset string. The library
names below ("Agree_Gesture" etc.) only exist as human-readable labels in the
docs table; the API itself is called with the resolved integer.

## Mapping table

| Spec clip name        | Resolved Meshy name (table) | action_id | Source | Confidence |
|---|---|---|---|---|
| `idle-9`               | `Idle_9`                          | 249 | docs.meshy.ai/en/api/animation-library table row, exact name match | **Confirmed** — exact string match against library name |
| `walking`               | `Walking_Woman`                   | 1   | docs.meshy.ai/en/api/animation-library, Category=WalkAndRun, SubCategory=Walking | **Best-guess** — no action is literally named "Walking"; `Walking_Woman` (id 1) is the base walk-cycle entry in the WalkAndRun→Walking subcategory. Note: existing script's own usage example passes `idle:1`, which conflicts with this table (table says `Idle`=0, `Walking_Woman`=1) — flagging that discrepancy, not fixing it |
| `agree-gesture`         | `Agree_Gesture`                   | 25  | docs.meshy.ai/en/api/animation-library, Category=DailyActions, SubCategory=Interacting | **Confirmed** — exact string match |
| `listening-gesture`     | `Listening_Gesture`               | 47  | docs.meshy.ai/en/api/animation-library, Category=DailyActions, SubCategory=Interacting | **Confirmed** — exact string match |
| `sit-on-chair-arms`     | `Sit_on_Chair_Arms_Crossed`       | 364 | docs.meshy.ai/en/api/animation-library, Category=DailyActions, SubCategory=Transitioning | **Best-guess** — no action literally named "Sit_on_Chair_Arms" (no suffix); the only library entry containing that exact substring is `Sit_on_Chair_Arms_Crossed`. Spec name may be a shortened/typo'd version of this, or may intend a different sit pose (e.g. `Chair_Sit_Idle_M`=33, already used for the existing `sit` pose in bon's set) — needs human confirmation before spending credits |
| `sitting-answering`     | `Sitting_Answering_Questions`     | 307 | docs.meshy.ai/en/api/animation-library, Category=DailyActions, SubCategory=Interacting | **Best-guess** — no action literally named "Sitting_Answering" (no suffix); only library entry containing that exact substring is `Sitting_Answering_Questions`. Same caveat as above — likely just a shortened spec name, but not 100% confirmed as the intended entry |

## Flagged uncertainties (do not treat as fact)

- **`sit-on-chair-arms`** → best candidate `Sit_on_Chair_Arms_Crossed` (id 364).
  Uncertain because the spec name has no `_Crossed` suffix and the library has
  no bare `Sit_on_Chair_Arms` entry. Also worth checking against
  `Chair_Sit_Idle_M`/`Chair_Sit_Idle_F` (ids 33/32) — those are the "sit idle"
  poses already in use for bon's existing `sit` clip, and may be closer to
  what "sitting idle" state actually needs versus a crossed-arms variant.
- **`sitting-answering`** → best candidate `Sitting_Answering_Questions` (id
  307). Uncertain for the same reason — spec name is a truncated substring
  match, not an exact one.
- **`walking`** → resolved to `Walking_Woman` (id 1) since no plain `Walking`
  action exists, but flagging the id/name conflict already present in the
  existing script's own usage example (`idle:1` — which per the table would
  actually resolve to `Walking_Woman`, not `Idle`). Whoever originally wrote
  that example may have mis-copied ids; this doc does not change the existing
  script, just notes the discrepancy for Phase 0.1 planning.

None of the 6 were fully unresolvable — `idle-9`, `agree-gesture`, and
`listening-gesture` are exact name matches with high confidence; the other
three carry the caveats above and should get a quick human sanity-check
(ideally by opening the doc page's preview GIFs) before committing to
production generation.

## Phase 0.2 generation log (2026-08-20, jerevon rig regenerated from scratch)

Source image replaced: `frontend/scripts/avatar-pipeline/masters/Bon_Master.png` ->
`/Users/lekoffshorly/Downloads/Employee Sprite/Meshy Base/meshy-bon.png`.

Pipeline run via `meshy-generate-employee-3d.mjs jerevon <new image>`:
- Image-to-3D task `01a01dc5-d406-75e1-9795-4110d52d0f09` — consumed_credits=30
- Remesh (v1, target_polycount=300000) task `01a01dc7-be09-79a7-8472-5cf102023c60` — consumed_credits=5
- Rigging task `01a01dc9-fe3c-70b2-8f2e-521c7a634000` — consumed_credits=5
- Free bundled `walking`/`running` animations included with rigging (no extra cost)

**rig_task_id used for all 5 animation calls below: `01a01dc9-fe3c-70b2-8f2e-521c7a634000`**

5 finalized clips generated via `meshy-generate-pose-animations.mjs` against that rig_task_id
(each consumed_credits=3, total spent=15; credit balance before=976, after=961):

| Clip | action_id | animation task_id | consumed_credits |
|---|---|---|---|
| `idle-9` | 249 | `01a01dcc-06b1-7ed6-83e6-8ea41d236bdc` | 3 |
| `agree-gesture` | 25 | `01a01dcc-dacb-716c-a915-56422d88dbe7` | 3 |
| `listening-gesture` | 47 | `01a01dcf-20dc-7b20-83c5-9d53f1c3caf5` | 3 |
| `sit-on-chair-arms` | 33 (`Chair_Sit_Idle_M`, not 364) | `01a01dd0-e0b8-7264-97ca-f46bd2c117e7` | 3 |
| `sitting-answering` | 307 | `01a01dd2-c252-72cd-a3b4-3f8635b5a766` | 3 |

Triangle count sanity check (via one-off GLB parser, indices-count/3 per TRIANGLES
primitive): all 6 GLBs (rigged base + 5 new animations + bundled walking) measure
**301,293 triangles** — identical across all, since remesh/rigging/animation
steps only add skeleton+keyframe data, not new geometry. This is the raw
post-remesh count (target was 300k, close match); LOD0 decimation to the
20k-30k triangle spec range is a separate later step, not done here.
Bounding box (accessor-local, untransformed): min `[-0.4961, 0, -0.373]`,
max `[0.4961, 1.7, 0.373]` — 1.7m tall, plausible full-body chibi proportions.

Total Phase 0.2 spend: 30+5+5+15 = 55 credits.

New GLBs saved to `frontend/public/avatars/jerevon/`: `jerevon-idle-9.glb`,
`jerevon-agree-gesture.glb`, `jerevon-listening-gesture.glb`,
`jerevon-sit-on-chair-arms.glb`, `jerevon-sitting-answering.glb`,
`jerevon-walking.glb` (free bundled clip, reused per spec — not paid for
separately). Old shipped GLBs (`jerevon-basic-idle.glb` etc.) left untouched;
app still runs on those until Phase A rewiring. Raw pipeline outputs (image-to-3d,
remesh, rigged, basic_animations) also live in
`frontend/scripts/avatar-pipeline/output/meshy-employees/jerevon/`.

## Naming convention note

The spec's clip names (`agree-gesture`, `listening-gesture`,
`sit-on-chair-arms`, `sitting-answering`) read like lightly-slugified versions
of names straight out of Meshy's own **Animation Library** catalog
(`Agree_Gesture`, `Listening_Gesture`, `Sit_on_Chair_Arms_Crossed`,
`Sitting_Answering_Questions`) rather than a generic Mixamo naming scheme —
Mixamo's own catalog uses different naming (e.g. "Sitting Talking",
"Standing Greeting") and doesn't have "_Gesture"-suffixed entries in this
exact form. Meshy's docs describe this as their own "Auto-Rigging &
Animation API" library, browsable in full at
https://docs.meshy.ai/en/api/animation-library (a long HTML table with one row
per `action_id`, animation name, category, subcategory, and a preview GIF for
each — that's the catalog to browse/confirm the two uncertain entries above
against their preview GIFs before spending credits).
