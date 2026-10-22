# HumanBase V3: first technical proof report

2026-10-07. Local, zero-cost and isolated. Nothing was committed, pushed or promoted, and no production file was touched.

- Code: `frontend/scripts/avatar-pipeline/human-base/v3/` (new, untracked).
- Outputs: `frontend/scripts/avatar-pipeline/output/human-base/v3-proof/` (gitignored).
- Start here: `output/human-base/v3-proof/index.html`.

**Verdict: V3 PARTIALLY VALIDATED** (§23).

- **Construction is validated.** The Kael/Lui failure family disappears *by construction* on all four people.
- **Identity is only partly validated.** With existing 3D evidence (variant B), Kael and Nicole are close to their V2 candidates. Lui is close but measurably softer. Bon regresses on hair.
- **2D-only (variant A) is not good enough yet.**

---

## 1. What was built

A complete, deterministic, zero-cost build path from evidence to a mounted HumanBase identity module. It runs on the production runtime (HumanAvatar, body presets, uniform, mount gate, lineup).

1. **CanonicalHead V3 proof template**: one closed head topology for every employee (§3).
2. **Identity fitting** of that head to evidence, in two variants:
   - **B** = the approved illustration's existing 3D translation (the chibified Meshy head already on disk) used as *evidence only*;
   - **A** = 2D-only, from the approved illustration.
3. **Fixed-UV appearance bake** (B: evidence paint projected onto the canonical UV; A: the illustration projected).
4. **Modular hair** as a separate closed solid built *on* the complete head (§6).
5. **Modules:**
   - living-eye and mouth shells (B), re-seated under a "never sinks" rule;
   - a neck extension from the HumanBase body stub;
   - existing fit-space glasses equip unchanged.
6. **Automated QA:**
   - 8 construction invariants plus a 14-view visibility check (`qa.mjs`);
   - identity signals (`identity-qa.mjs`);
   - the existing production mounted gate;
   - a determinism check;
   - a blind comparison artifact.

## 2. Files changed / created

**New** (all untracked) under `frontend/scripts/avatar-pipeline/human-base/v3/`:

| File | Purpose |
|---|---|
| `geom.mjs` | Closest point, ray cast, SDF, surface nets (manifold-safe), CG solver, UV raster, repairs |
| `template.mjs` | Builds the canonical head |
| `evidence.mjs` | Reads 3D/2D evidence and validates landmarks |
| `fit.mjs` | Identity fit (variant B) |
| `hair.mjs` | Hair module |
| `build.mjs` | Variant B build |
| `fit2d.mjs` | Variant A build |
| `landmarks2d.mjs` | MediaPipe traits |
| `render.mjs`, `sheets.mjs`, `lineup-shots.mjs` | Visual artifacts |
| `qa.mjs`, `identity-qa.mjs` | Validation |
| `PROOF_REPORT.md` | This report |

**Outputs** (gitignored) under `output/human-base/v3-proof/`:

- `template/`;
- `<who>/{A,B}/pass1/<who>-v1.glb` + `build.json` + `qa-geometry.json`;
- `<who>/B/report.json` (a lineup stub carrying the gate's auto mount; proof only);
- `sheets/`, `blind/`;
- `qa-*.json`, `mounted-gate-B.json`, `population-stats.json`, `determinism.txt`, `index.html`.

**Modified:** none. No tracked file, protected item, production asset, `package.json` or runtime code was changed.

## 3. Canonical head design (proof grade)

- **Source.** Built from the shape of `alex-neutral-head-v1`, the approved family skull every current head was fitted to. Its open edge is the body's neck stub.
- **Build steps:**
  1. Openings capped, then a narrow-band SDF.
  2. Surface nets with ambiguous faces resolved and diagonals chosen manifold-safe.
  3. Simplification (meshoptimizer "Regularize") plus Delaunay flips and tangential relaxation.
  4. **Face region subdivided once** (crack-free).
- **Result:** 18,622 vertices, **37,240 triangles, one closed oriented 2-manifold** (0 boundary / 0 non-manifold, Euler 2). Triangle quality is min 0.65, median 0.97.
- **Why the face subdivision:** the approved style carries lip creases and nose/lid forms in *geometry* (the texture is flat there — verified on the evidence).
- **Semantic regions per vertex:** scalp, face, earL/R, eyeL/R, mouth, nose, jaw, under, nape, side. Ears are detected as stand-off from a smoothed skull.
- **Fixed UV atlas.**
  - Face = one planar chart (no seam crosses the face); side band = cylindrical, with its seam hidden at the front; crown and underside = azimuthal caps; each ear = lateral + medial charts.
  - Uniform texel density, face ×2; 2048² in the proof.
  - Weak point: ear charts overlap a little.
- **Landmarks: 25 semantic vertex IDs, identical across employees.** Eyes, mouth, nose tip, chin, crown, forehead, occiput, nape, temples, cheeks, jaw, and ear root/top/lobe/outer/back for both ears.
- **Neck.** The head is closed underneath; a body-skin neck extension rises from the *exact* HumanBase stub ring (max error 0 m) into the head. There is nothing to cut, and no seam to tuck.
- **Deformation system:**
  1. a fold-free Gaussian-RBF landmark warp (falloff ladder 0.13 → 0.32, first fold-free value wins);
  2. a bi-Laplacian-regularised non-rigid fit with a preconditioned CG solver, over a stiffness schedule λ 30 → 0.15;
  3. each stage accepted only if fold-free, with local fold rollback.

  Topology never changes.
- **Not production yet.** This is not the designed edge-flow head the architecture calls for (P2). It is an automatic proof template.

## 4. Identity fitting method

### Variant B

**Correspondence and placement:**

- **Correspondence:** normal-shooting rays, with closest point as a fallback, point-to-plane, only on skin-confident evidence.
- **Unreliable evidence is ignored:** triangles near open cuts or relabel edges (the 2-ring of every boundary loop).
- **Feature openings stay reliable:** loops around the mouth or eyes count as real anatomy.
- **Ears** use canonical ear geometry, placed and sized by the evidence's ear landmarks. Scale is bounded to 0.5–1.4 with no rotation.
- **Cranium:** stays canonical.

**Landmark validation (new general rule).** The mouth landmark is re-measured on the evidence's own midline profile (the lip crease). Lui's evidence landmark sat at the chin (y 0.824 against a measured 0.98). Kael's, Bon's and Nicole's were about 3 cm-eq low, which the pink-lip/teeth texels confirm for Kael. The fit uses validated landmarks; the output keeps the evidence's runtime landmarks unchanged.

**Fit results:**

| | Final λ | Mean residual (native units) | Folds |
|---|---|---|---|
| Bon | 0.8 | 0.0046 | 0 |
| Kael | 0.15 | 0.0042 | 0 |
| Lui | 0.15 | 0.0044 | 0 |
| Nicole | 0.15 | 0.0044 | 0 |

### Variant A

1. MediaPipe landmarks on the illustration.
2. Width maps at skull scale (face width → canonical face width).
3. **The lower face maps vertically with distinctiveness-preserving compression:** the face-length deviation from the roster mean is kept at 70%, instead of V1's rule that set every face to the canonical length. The cranium maps at skull scale.
4. A fold-free RBF warp.

## 5. Offshorly style preservation

- **Body, rig, materials and the living-eye language are untouched;** the canonical skull is the approved family skull.
- **In B, the style comes from the evidence,** which is already the approved Offshorly translation (`chibify`'s style operators). V3 replaces only the construction. The style operators have **not** yet been ported to canonical coefficients (a limitation).
- **In A, the style is a flat projection of the illustration.** It reads "drawn on" from 3/4 and side views: style fails.
- **Result:** in the lineup and on the mounted gate, the V3-B heads sit inside the family's proportions.
  - Face length to body: 0.462–0.483, inside the 0.43–0.50 band.
  - Skull width to shoulder: 0.505–0.557.

## 6. Hair method (smallest credible)

**Steps:**

1. **Presence and thickness map over the sphere of directions.** B: from the evidence hair surfaces (ignoring brow/lash/fringe paint lying on the face). A: from the front silhouette.
2. **Construction rules:**
   - **holes enclosed by hair are always filled** — the head under hair can never show through;
   - **designed nape hairline:** when the evidence has hair on the back of the head (≥ 50%), hair covers the back of the canonical head down to the canonical nape line;
   - under the head only *hanging* hair is allowed;
   - minimum thickness of about 3 voxels, so there are no thin wedges or fragments;
   - level-set hairline, so there is no staircase.
3. **Solid = an offset of the complete head:** ε < head distance < thickness. The hair can never enter the skull, ears or face.
4. **Ear rule, decided by measured coverage:** exposed ears get a 1.6 cm-eq clearance tuck; covered ears stay hidden.
5. **Meshing and finishing:**
   - surface nets on a blurred field;
   - generic manifold repair, then Taubin smoothing and simplification to 16k triangles, accepted only if still a closed 2-manifold;
   - a final guarantee pass (≥ ε outside the head, ≥ 6 mm from exposed ears).

**Appearance:**

- Hair colour, flow and clump come from the evidence (B) or the illustration (A).
- The scalp under the hair is painted hair base colour **by construction**.

**Interface for later hair systems.** The canonical skull, the region map, the nape line and the ear rules are a stable attach contract. Bald needs no module. A future archetype or lock library plugs in at the "thickness/solid" step without touching the head topology.

## 7. Accessory method

- The existing fit-space glasses (`glasses-rect`, `micah-glasses`) equip unchanged on all four V3-B heads.
- The frame sits in front of the eyes, the temples run to the ears, and nothing is baked.
- They use the evidence's `glassesFit` data (B). Deriving `glassesFit` from canonical landmarks (needed for A and for the future) is not done yet.

## 8–11. Per-person results

Sheets: `sheets/<who>-compare-BA.png`.

**Bon** (approved control):
- **Construction:** clean, and all invariants pass.
- **Face:** close to approved (appearance correlation 0.88 front / 0.97 3/4).
- **Regression:** the separated curtain-fringe strands are lost (smooth shell hair), and a dark painted strand from the evidence shows on the bare forehead. **V3-B Bon is not regression-safe on hair.**
- **Gate:** auto mount 0.98 against the approved 1.0. Skull height to body is 1.116, above the V2 band's 1.09: that band was calibrated on trimmed heads (see §22).

**Kael:**
- **Construction:** clean eyes and face, clean ears with a tuck line, clean continuous hair edge, complete nape, no loose fragments, all invariants pass.
- **Identity:** close to V2 (0.92 / 0.97 correlation), including the toothy grin (the projection bake reaches recessed teeth).
- **Hair:** curl detail is smoother than V2's.

**Lui:**
- **Construction:** complete clean rear skull and nape (V2: visible shred / closure), clean ears with no hair across them, no neck ring, no exposed closure, all invariants pass.
- **Identity:** reads as Lui, with the nose and smile line present. The lower face is softer than V2's (correlation 0.80 front / 0.94 3/4; structural roster rank 1 → 6).

**Nicole:**
- **Construction:** the bob is a closed solid with a complete underside (V2: a bald, exposed underside). Covered ears, all invariants pass.
- **Envelope:** the old conflict is resolved — skull to shoulder 0.505 in band, where V2 failed at 0.459; face length 0.482.
- **Identity:** close at the front (eyes, brows, lips), but the hair framing makes the face read rounder. Correlation 0.68 front / 0.90 3/4; structural rank 2 → 12. Her long, narrow identity is only partly preserved.

## 12. 2D-only vs 2D + existing 3D evidence

**Yes, 3D evidence materially improves identity and style today.**

- **A (2D-only):** reads from the front (the illustration is literally projected), but fails at 3/4, side and back. The paint smears, there is no dimensional nose, lips or lids, and the back-of-head hair is invented. Appearance agreement with V2 is 0.24–0.72 front and 0.55–0.83 3/4, against B's 0.68–0.92 and 0.89–0.97.
- **A's good structural ranks are circular** (its face *is* the illustration).

**Conclusion:** Meshy-like 3D evidence (or a multi-view turnaround plus dimensional feature modules) is still needed.

**2D-only measurement is also weak:**
- the existing `illustration-traits.mjs` failed on 10 of 23 sprites;
- MediaPipe works on stylized art but regresses toward a mean face (sprite trait σ is tiny).

**Not tested:** a 2D+turnaround path (no free turnaround images exist locally for these four).

## 13. Structural QA

`qa-structural.json`. All 8 V3 builds (4 people × A/B) **PASS all 11 checks:**

| Check | What it guarantees |
|---|---|
| T1 | Topology hash identical to the template |
| T2 | One closed oriented manifold |
| T3 | No folds, 0 self-intersections |
| T4 | Hair is a closed manifold, fully outside the head (ray-parity confirmed) |
| T5 | No hair within 4 mm of an exposed ear; nothing below the shoulders |
| T6 | Only module parts (no closure/proxy) |
| T7 | Eye/mouth modules never inside the head |
| T8 | Neck starts at the exact body stub |
| V1 | 0 back-facing (inside) pixels over 14 views |
| V2 | 0 skin-coloured texels under hair |
| V3 | 0 closure visible |

**The same visibility test on V2 / approved:**

| | Closure pixels visible | Back-facing "inside" pixels |
|---|---|---|
| Bon (approved) | 16,262 | 2,443 |
| Kael | 12,694 | 3,051 |
| Lui | 19,411 | 1,444 |
| Nicole | 19,357 | 62,441 |

Production mounted gate (existing code): closure 0% on every V3-B view against V2's 5–6% (worst view 11–28%).

**Real construction bugs found during the proof (fixed generally):**
1. A hair grid clipped at the shoulder line leaked the sign flood fill into the skull.
2. Paint attributes were read un-normalised.
3. Sliver triangles made the fold guard over-sensitive.
4. Two-surface voxel pinches.

## 14. Identity / perceptual QA

`qa-identity.json`, scores only. Roster retrieval uses MediaPipe structural traits, z-scored; the number is the rank of the person's own sprite among 22.

| | Bon | Kael | Lui | Nicole |
|---|---|---|---|---|
| V2 / approved | 15 | 7 | 1 | 2 |
| V3-B | 14 | 6 | 6 | 12 |
| V3-A | 1 | 7 | 8 | 4 |

- **This metric is weak:** approved Bon ranks 15. **It is not a usable gate.**
- **Calibration on our pairs** (7 photo↔sprite pairs): photo→sprite retrieval ranks 1, 4, 4, 6, 8, 13, 14 of 22. The artist keeps eye spacing (r = 0.86) and nose position (0.76) but normalises face length (−0.04). Identity in the Offshorly style rides mostly on hair, brows, eyes and colour.
- **No VLM critic was run.** My own reading of the sheets is not blind and is not counted.
- **Blind artifact:** `blind/blind-comparison.png`; the key is in `blind/blind-key.json` — open it after judging.

## 15. Visual QA artifacts (inspect these)

- `output/human-base/v3-proof/index.html`, which links everything.
- `blind/blind-comparison.png` — judge it first.
- `sheets/{bon,kael,lui,nicole}-compare-BA.png` — 16 views each: front, ¾ L/R, both sides, back, rear ¾, high, low-front, low-rear, both behind-ear views, jaw, nape, face close-up, neck join.
- `sheets/accessories-animation-B.png`.
- `sheets/lineup-{front,profile,back,walk,sit}.png`.
- Live pages (dev server :5173), linked from `index.html`: the lineup with V3-B candidates mounted, and the QA viewer for each V3 file.

## 16. Determinism

Two complete rebuilds of all 8 artifacts produced **byte-identical** GLBs (`determinism.txt`).

## 17. Runtime / mount compatibility

- **Mounting:** the V3 files mount through the production `HumanAvatar` (rebind by joint name, body presets, uniform, mount) and the existing `mounted-gate.run.ts`.
  - Auto mounts: Bon 0.98, Kael 0.945, Lui 0.87, Nicole 0.79 (V2: –, 0.945, 0.885, 0.815).
  - The face-length band holds for all; the skull-width band holds for all, including Nicole.
- **Animation:** idle, walk, sit and head-turn render correctly in the QA viewer and the lineup.
- **Not run:** a garment ↔ skin pose check (the head changed; the garments did not).

## 18. Performance

| Per avatar identity module | Parts (draws) | Tris | Verts | Size |
|---|---|---|---|---|
| Approved Bon (production) | 11 | 175k | 131k | 1.75 MB |
| V2 candidates (optimised) | 11–12 | 107k–130k | 71k–83k | 0.9–1.15 MB |
| **V3-B** | **5** | **~93k** (head 37k · hair 16k · eye+mouth 40k) | **48k** | 4.7 MB raw · **0.57 MB Draco** (Kael) |
| V3-A | 3 | 54k | 28k | 2.7 MB raw |

- **Textures:** one 2048² head texture (WebP ≈ 95 KB) + the eye atlas.
- **Build time on this 8 GB Mac:** B ≈ 50–60 s, A ≈ 10–14 s per person; all 8 in ≈ 4.6 min.
- **Remaining weight:** the inherited per-identity eye shell (~37k tris) and the 37k head. A canonical eye module and head LODs are the obvious next savings. Shared index/UV buffers are now possible, because every head has identical topology.

## 19. Cost

**$0.**
- No paid API, Meshy credits, cloud inference, purchases or trials.
- The 3D evidence was existing local files from earlier generations.

## 20. Dependencies / licences actually used

| Item | Use | Status |
|---|---|---|
| Existing repo deps (three, @gltf-transform, meshoptimizer, sharp, puppeteer, draco3dgltf) | Build / render | Already in the repo; nothing added |
| System Google Chrome | Headless rendering / landmarks | Already installed |
| **@mediapipe/tasks-vision 1.1.0** (npm, `license: Apache-2.0`) | 2D landmarks | Commercial OK. **Kept in the session scratchpad only, not in the repo.** The npm tarball has no LICENSE file; the package metadata says Apache-2.0 |
| **MediaPipe `face_landmarker.task`** (float16 v1, Google storage) | 2D landmarks | Apache-2.0 per the MediaPipe model card. Commercial OK. Scratchpad only |

Nothing non-commercial or research-only was used. Blender was not used.

## 21. Privacy

**What was computed:** face landmarks (MediaPipe, transient) for the 22 approved sprites, 8 real photos (7 in `Raw/` plus `bon-real.jpeg`), 4 prepped illustrations and 12 renders.

**What was deleted:** the raw landmark files (`roster.json`, `test.json`, the per-sprite traits).

**What remains on disk (scores only):**
- `population-stats.json`: per-trait means/σ, the per-pair retrieval ranks and the per-trait correlations;
- `qa-identity.json`: ranks, distances and correlation scores.

**What was never involved:** no face-recognition embeddings were created, and no external service was used.

## 22. Remaining failures / limitations

1. **Hair is the weak point.** The radial-thickness shell is smooth:
   - it loses separated locks and strands (Bon's fringe) and some curl and flow detail;
   - the 2.6 cm-eq minimum thickness makes thin styles bulky;
   - hair is rigid (no chains);
   - long hair beyond a bob is untested;
   - the ear rule is binary (covered/exposed).
2. **Bon's forehead shows the evidence's painted fringe strand** where V3 hair no longer covers it.
3. **Lower-face softness and some structural identity loss** (Lui, Nicole); Nicole's hair framing reads rounder.
4. **The eye/mouth modules are inherited per-identity shells** from the evidence, not canonical sockets. Variant A has no living eyes.
5. **The template is proof grade:** automatic shape, no designed edge loops, ear UV overlaps, and Alex's ears rescaled per person.
6. **B still depends on `chibify`'s style transform and on Meshy evidence.** The style operators have not been ported onto canonical coefficients.
7. **2D-only is inadequate** (§12). The pixel-heuristic illustration measurer is unreliable.
8. **The evidence landmarks are stale:**
   - the mouth landmark is wrong in V2 files (Lui by about 16 cm-eq; others by about 3 cm-eq);
   - V3 corrects it for fitting only;
   - the V2 runtime landmark (used only by the talking mouth) is unchanged.
9. **The mounted gate's skull-height band** was calibrated on trimmed heads; it needs recalibrating for complete skulls.
10. **No reliable automatic identity gate exists yet.**
11. **Self-critic loop: only its bounded building blocks exist.** No closed loop over identity metrics was implemented.
    - Iteration limits: a 4-step warp ladder, 7 fit stages × 3 iterations, local rollback ≤ 40 folds, a 4-target simplification ladder, ≤ 6 repair rounds.
    - Fail-closed exits: no fold-free warp, or no face found in the illustration.
12. **The garment pose check was not re-run.**

## 23. Architecture verdict: **V3 PARTIALLY VALIDATED**

**Validated: construction.**
- One canonical topology for four very different people.
- Complete skull under hair, clean ears, nape and neck connection, and no closure geometry at all.
- Every Kael/Lui/Nicole structural failure class absent, with automated proof (0 vs 12k–19k exposed-closure pixels).
- Nicole's envelope conflict gone.
- Deterministic, mounted on the production runtime, animating, and accessories modular.
- Construction QA is authoritative and cheap.

**Not yet validated: identity at approved quality.**
- With 3D evidence the result is close for Kael and Nicole and slightly softer for Lui.
- Bon regresses on hair: the hair method, not the canonical head, is the cause.
- 2D-only fails style.
- The proof did not show the canonical construction *costing* identity in the face. It did show the proof-grade hair method costing identity, and that identity measurement is still unsolved.

**Not rejected,** because the identity losses trace to replaceable sub-systems (hair method, inherited eye modules, unported style operators), not to the canonical-head hypothesis itself.

## 24. Next smallest step (not started)

**Hair V3.1 on the canonical skull, proven on Bon's curtain fringe and Kael's curls.**

- Build sculpted lock primitives (the existing `build-hair-*` SDF lock language), placed from the evidence's hair surface and flow, with the same construction contract.
- Measure against Bon's approved look, plus a blind check by you.

**Decisions needed from you first:**
1. Your blind verdict on `blind/blind-comparison.png`.
2. Whether you accept B-style 3D evidence (Meshy) as a production dependency until a turnaround-based 2D path is proven.
