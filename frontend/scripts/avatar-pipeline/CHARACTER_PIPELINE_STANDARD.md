# Employee character pipeline standard

Every future T-pose employee goes through exactly these steps. Nothing here is
character-specific: no Bon/Alex constants, no per-employee scale values.

## 1. Generation (paid — 55 credits)

| Stage | Endpoint | Credits | Settings |
|---|---|---|---|
| Image-to-3D | `POST /v1/image-to-3d` | 30 | `ai_model: latest`, `pose_mode: t-pose`, 2K texture, GLB, multi-view thumbnails, `should_remesh: false` |
| Remesh | `POST /v2/remesh` | 5 | `target_polycount: 280000` (under Meshy's 300k rigging cap) |
| Rig | `POST /v1/rigging` | 5 | defaults; the bundled **walking AND running** are both kept — see section 7 |
| Animations | `POST /v1/animations` | 5×3 | idle per the character's **idle profile** (below), `agree-gesture`=25, `listening-gesture`=47, `sit-on-chair-arms`=33, `sitting-answering`=307 |

Run via `meshy-generate-employee-3d.mjs <id> <png> --pose-mode=t-pose` then
`meshy-generate-pose-animations.mjs`. Each stage is gated — stop before the
next paid call if a gate fails, and never resubmit without approval.

### 1a. Idle profile (decide before spending)

Meshy has two standing idles and they are not interchangeable. Declare which
one a character gets — masculine or feminine — as part of the plan, not after
the fact; the resolved ids live in `lod-policy.mjs`'s `IDLE_PROFILES`, and the
declaration is carried per character by `live3dCharacters.ts`'s `idleProfile`.

| Profile | Meshy clip | `action_id` | Correction it needs (section 3) |
|---|---|---|---|
| `masculine` | `Idle_9` | 249 | wrist only — the arms already hang along the body |
| `feminine` | `Idle_12` | 252 | whole arm chain |

Until 2026-08-31 this table did not exist and the standard named `Idle_12`
unconditionally, so every character shipped the feminine idle regardless and the
only trace of the choice was prose in each registry comment. Both profiles are
baked to the same runtime clip name, `idle-9` (section 7) — the app has one idle
slot and does not know which library clip filled it, so the registry
declaration is the only machine-readable record.

## 2. Gates

- **Raw**: identity matches the reference; face/glasses/hair/beard and any
  clothing graphic intact; true horizontal T-pose; limbs separated; sane bounds.
- **Remesh**: ≤300k tris; bounds unchanged; 2048 base colour and valid UVs.
- **Rig**: one skinned mesh/skin; 24 joints in the expected order; IBMs,
  `JOINTS_0`, normalized `WEIGHTS_0`, no zero-weight verts; head/face/glasses
  owned by `Head`; bundled walking lowers and swings both arms.

## 3. Corrected natural idle (zero credits)

Both idles need correcting, but not the same correction, and the flare is
re-measured per character either way — `qa/idle-flare-metrics.mjs` reports hand
distance outboard of the hip and elbow bend across the clip. Judge against the
shipped band (hands ~15–20 outboard, elbows ~8–15); bon's approved masculine
idle sits at 20.4/27.2, the widest accepted to date.

**Feminine (`Idle_12`)** splays the whole arm chain. **Masculine (`Idle_9`)**
brings the arms down correctly but drives both wrists with a large asymmetric
rotation — so on a rig whose measured hands still sit far outboard (alex
25.1/28.9, angelo 32.4/37.6) it gets the same whole-chain treatment, and on one
where only the wrists are wrong (bon 19.6°/53.3° off bind) the wrist-only
re-centre onto the bind orientation is enough. Which one applies is decided from
that character's measurements, never inherited.

Whole-chain method: re-solve it per character with world-space FK on one
neutral frame and bake **constant parent-space offsets** onto every key of the
six arm-chain tracks (`{Left,Right}{Arm,ForeArm,Hand}`):

```
delta_B = world_parent^-1 (x) R_w (x) world_parent
local'(t) = delta_B (x) local(t)
```

Targets: upper arm ~17° out, forearm ~12°, hand ~8°, palm ~20° inward. Solve
from **that character's own** bind-mesh axes — never reuse another character's
quaternions. Duration, key times and loop closure must be preserved, and only
those six channels may change. Embed the result under the runtime clip name
`idle-9` — whichever profile it came from.

Review it before integrating: `qa/idle-profile-sheet.mjs <chain> <label>=<clip>
<label>=<clip>` renders front / three-quarter / back views of two idle clips with
the hand and forearm vertices tinted, which is what a masculine-vs-feminine
choice is actually judged on.

## 4. Quality-first LODs

Build with `build-character-lods.mjs <id> --profile=hq --clip-source=idle-9=<corrected>`
(`--out-dir=` a NEW folder when rebuilding a shipped character, so the set
currently in production stays on disk as the rollback — section 8).

| Tier | Geometry | Texture | Used for |
|---|---|---|---|
| `source` | full rigged, no Draco, PNG | 2048 | diagnostic baseline only (gitignored) |
| LOD0 | **no simplification** | 2048 near-lossless WebP | self / near / focused / zoomed-in |
| LOD1 | ~80k tris | 1024 | mid distance |
| LOD2 | ~30–40k tris | 512 | far / zoomed out |

**Why LOD0 is not simplified.** Simplification collapses vertices across UV
chart boundaries, leaving triangles whose UV footprint sweeps unrelated parts
of the atlas — they render as wrong-colour speckles. Measured share of
chart-spanning triangles (UV extent >40px at 2048): **0.06% at 280k, 0.8% at
80k, 6–7% at 40k**. UV quantization, texture encoding, atlas padding and
mipmaps were each ruled out by rendering them in isolation.

Before integrating a new character, render its **source baseline vs its
optimized LOD0** with `qa/render-character.mjs` (the app's exact camera and
unlit material) and confirm they are visually equivalent at normal app size.

## 5. Canonical visible height

Registry entries carry only `renderWidth`/`renderHeight` (the manifest aspect).
Visible standing height is normalized at runtime by `characterSize.ts` from the
character's **standing** silhouette and its manifest layer height — never from
the T-pose arm span, which is what previously made visible height depend on how
wide a character's arms were drawn. A new character inherits equal height with
no new constant.

## 6. Adaptive LOD

`adaptiveLod.ts` picks the tier from self/focus/proximity (and zoom where
observable), with hysteresis and a 400 ms debounce. It never changes whether a
character is *eligible* for 3D — the device-tier and crowd-budget gating in
OfficeStage remains the safety ceiling.

## 7. Runtime contract

All **seven** clips must be named exactly: `idle-9`, `walking`, **`running`**,
`agree-gesture`, `listening-gesture`, `sit-on-chair-arms`, `sitting-answering`
— `scripts/avatar-pipeline/lod-policy.mjs`'s `REQUIRED_CLIP_NAMES` is the one
authoritative list and everything else imports it. 24 bones, one skinned mesh,
one shared base-colour image, unlit material, no normal/metallic maps.

### `running` is mandatory, and a fast walk is not a run

The run comes free with the rig step, in the same `basic_animations` bundle as
the walk (`<id>-rigged-running.glb`), so there is no extra generation and no
extra credit — it only has to be kept and packed. It was added to the required
list on 2026-09-13, after bon-v3; the four packages built before that shipped
without it, and the gap was invisible because the runtime fell back to a faster
walk. Three checks now make that impossible to repeat:

| Check | Where | Catches |
|---|---|---|
| source map | `build-character-lods.mjs` `CLIP_SOURCES` drift check | a required clip with no source file |
| per-tier output | `build-character-lods.mjs`, after each tier is built | a clip lost *during* LOD generation |
| shipped packages | `src/render3d/shippedClips.realAssets.test.ts` | any registered character whose LOD0/1/2 on disk is missing a clip, or whose `running` is the same length as its `walking` (a re-timed walk) |

**Never substitute an accelerated walk for a packaged run clip.** The runtime
keeps a walk fallback (`src/dev/vo3d/avatar/gait.ts`, which plays the walk cycle
at the ground speed the body is actually covering) and that is deliberate — it
is for LEGACY packages and for a character mid-pipeline, not a licence to ship
one. A character whose raw bundle genuinely has no run animation must have it
generated, not faked.

**Adding `running` to an already-shipped package** — use
`repack-running-clip.mjs <id> <shipped-dir>`, not a full rebuild. It retargets
the existing raw run clip into the LOD GLBs already on disk and touches nothing
else: no simplify, no texture re-encode, no idle re-solve, so appearance cannot
move. A full `build-character-lods.mjs` re-run is the right tool for a NEW
character, and the wrong risk for one in production whose exact original
`--clip-source` flags are not recorded anywhere.

## 8. Integration

Add the entry to `LIVE_3D_CHARACTERS` — including its `idleProfile`, which the
type requires — keep the previous asset folder on disk as the rollback, and
validate all three GLBs through GLTFLoader + the vendored Draco decoder
(`clip-validate.mjs`) before shipping: 24 joints, one skinned mesh, every
`REQUIRED_CLIP_NAMES` clip present at every LOD. The validator imports that list
rather than restating it — its own stale copy is exactly how four packages
passed while missing `running`.

A rebuild that only swaps a clip still needs its silhouette re-checked against
the character's frame, since the layer geometry was calibrated against the old
poses. The 2026-08-31 idle swap measured the new idle over 8 headings x 7 phases at
|ndc.x| ≤ 0.90 and ndc.y ≤ 0.93 for all three characters (against per-character
`widthCapacity` ceilings of 1.22–1.65, and 1.0 vertically), so no layer,
`widthCapacity` or `headTopAboveCenter` value changed.
