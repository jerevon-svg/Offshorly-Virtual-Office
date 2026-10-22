# Stage 1 proof: Stage 0 identity → Offshorly style translation → canonical HumanBase

Date: 2026-10-07, 16:18–16:33. Spend: $0. Nothing is committed or promoted, and no protected or production file was touched. Status: awaiting Bon's visual review.

**Code** (untracked):
- `v3/stage1/build.mjs` — selection, population prior, style map, warp, hair, temporary paint, module write
- `v3/stage1/measure.mjs` — model-space identity preservation
- Generalised V3 QA edits: `v3/qa.mjs` gained the `V3_OUT` env and the FC-QA-LIGHT-HAIR fix

**Outputs:** `output/human-base/stage1-proof/`:
- `sheets/stage1-proof-sheet.png`, `sheets/stage1-lineup.png`, `sheets/stage1-nicole-vs-rejected-v3b.png`
- `<who>/S/pass1/<who>-v1.glb`
- `identity-preservation.json`, `qa-structural.json`, `selection.json`
- `population/` (Stage 0 run over all 23 sprites)

## Selection (automatic)

Nicole is the anchor. The other two are the pair that maximises the trio's minimum Stage 0 face-only distance → **Carl + Chris** (min 0.075; next best 0.061).

## Mechanism (one path, identical for all)

1. **Population prior.** The mean Stage 0 face in the normalised frame, over the 23 sprites. Failed features are excluded; low-confidence eyes are excluded.
2. **Style map C.** A thin-plate spline fitted so the population MEAN lands on the canonical HumanBase front landmarks and silhouette arc (max residual 2.4e-4). Canonical = C(mean) by construction.
3. **Person targets.** C(person) − C(mean) at five features (eyes, mouth, nose base, chin) and 12 face-arc silhouette controls.
   - Unknown contour points use the mirrored observed side (flagged).
   - If the mirrored side is also unknown, the target is the mean, i.e. the canonical prior.
4. **Construction.** A Gaussian-RBF warp of the V3 canonical topology in the front plane only:
   - depth is the canonical prior (asserted unchanged), so nothing is flattened;
   - crown, occiput, nape, forehead, ears and neck ring are pinned;
   - a fold-free ladder (σ, then gain) fails closed.
   All three passed at gain 1.0, σ 0.13, with 0 folds.
5. **Hair.** A separate solid built from the Stage 0 hair layer, using the V3 hair contract.
6. **Temporary appearance.** Head paint is vector-rendered from the Stage 0 representation (eyes, iris, lid line, brows, nose base, lips). Hair is a flat colour. Material names carry `TEMP`.

## Identity preservation (model space, orthographic, no camera)

- **Agreement:** the Stage 0 deviation from the population mean vs the 3D deviation from the canonical correlate at r = 0.969 (n = 19).
- **Ordering:** the 3D order of the three matches Stage 0 on 7/7 traits.
- **Nicole vs canonical** (Stage 0 value in brackets): jaw −18% (−14%), chin −17% (−17%), mouth-level width −16% (−10%).
- **Rejected V3-B Nicole:** jaw 1.70 / chin 1.17, against Stage 1's 1.22 / 0.82.
- **Distinctness in 3D:** pairwise Nicole–Carl 0.40, Nicole–Chris 0.50, Carl–Chris 0.20. Distance from canonical: 0.25 / 0.17 / 0.26.

## Validation

- The V3 QA invariants T1–T8 and V1–V3 pass on all three. FC-QA-LIGHT-HAIR is a general QA correction: grey hair base ≠ skin.
- Deterministic: a rebuild is byte-identical.

## Limitations

- **Eyes, brows and lips are flat temporary paint.** There are no living-eye shells yet; the eye shape lives in paint, not lid geometry.
- **Hair is a smooth flat shell.** Nicole's long hair becomes a bob because the module floors at the shoulders.
- **One neutral body is used for all three.** Body and gender are not part of Stage 0.
- **Depth is purely the canonical prior.** Nose, brow and cheek depth do not vary by person.
- **The style map is fitted on 23 illustrations and a single canonical head.** No approved 2D↔3D pairs are used yet.
- **Found during the regression check:** Bon's and Nicole's V3-B files (rebuilt by the retired envelope experiment at 13:40) now fail T3. This is unrelated to Stage 1.

---

# Stage 1 volume pass (variant V): identity-conditioned XYZ geometry (2026-10-07, 16:38–16:59, $0) — awaiting Bon's review

Bon's verdict on the 2D-only pass was **partial**: it read as Stage 0 projected onto a generic head (depth = canonical prior).

**Finding.** Measured in face units, the V3 proof template is about 7× flatter than the approved Offshorly style:

| | approved heads (5) | V3 template |
|---|---|---|
| nose relief | 0.21–0.26 | 0.03 |
| mid-face | 0.09–0.26 | 0.03 |
| cheek depth | −0.41 to −0.55 | −0.28 |

That is why identity could not read as structure.

## Mechanism (one path, no names or per-person values)

1. **2D transfer.** Unchanged, except the ears are no longer pinned. FC-EAR-OVERSHOOT: pinned ears flared under strong narrowing. Each ear now rides RIGIDLY with its skull ring, blended over 6 vertex rings.
2. **STYLE-PRIOR RELIEF (same for everyone).** The median front relief of the five approved heads (bon, micah, angelo, clang, france), used as calibration only:
   - rasterised depth maps, aligned at eyes and mouth;
   - inner-face mask, eye regions excluded, clamped;
   - normalised-convolution smoothing.
   It is applied as Z per canonical vertex. Clay reference: `prior-head.glb`.
3. **IDENTITY-CONDITIONED VOLUME** (`depthprior.mjs`):
   - About 15 observables are measured on the Stage 0 representation and converted to population z-scores (23 sprites).
   - A fixed linear map W turns them into 13 drives: nose projection/root/width, brow ridge, eye socket, cheekbone, cheek fullness, mid-face, muzzle, lips, chin projection, jaw taper, temple, forehead.
   - The drives scale localised smooth fields. Inferred depth moves only in Z (or along the normal behind the silhouette); nose width is the only observed interior X change.
   - The sum of fields is relaxed over the surface and tapered to zero at the ears.
   - Local fold rollback, with a gain ladder as fallback. All three ran at gain 1, with no rollback needed.

## Observed vs inferred

- **Observed** (Stage 0): frontal silhouette (widths, taper, chin length), feature positions, nose width, lip height, mouth width, brow–eye gap, brow thickness, eye openness, hairline (low weight).
- **Inferred:** all depth (prior relief plus identity-conditioned fields).

## Results

- **Clay geometry** (`sheets/stage1-clay-geometry.png`): three different structures.
  - Carl: broad, round, flatter mid-face, short nose.
  - Nicole: narrow oval, projecting nose and mid-face, tapered jaw.
  - Chris: long lower face, longest chin, lean cheeks.
- **XYZ** (`sheets/stage1-xyz-overlay.png`, `xyz-displacement.json`): face displacement from the prior.

  | | RMS dx | RMS dy | RMS dz | max dz |
  |---|---|---|---|---|
  | Nicole | 0.015 | 0.011 | 0.008 | 0.029 |
  | Carl | 0.008 | 0.008 | 0.004 | 0.015 |
  | Chris | 0.013 | 0.011 | 0.004 | 0.013 |

- **Relief** (`relief-calibration-V.json`): nose relief 0.13–0.23 and cheek depth −0.28 to −0.47, i.e. inside or near the approved range.
- **Validation:** T1–T8 and V1–V3 PASS on all three. A byte-identical rebuild confirms determinism.

## Limitations

- **Volume amplitudes are capped by the approved family's own spread.** Approved heads vary little in nose relief (sd 0.021), so identity depth differences are moderate, not caricatured.
- **The style map is linear and hand-signed.** W comes from anthropometric/style relationships, not learned from data. Only the scale of the relief is calibrated on approved heads. Five approved pairs are too few to regress W.
- **Temporary paint is front-projected,** so it can sit slightly off the new 3D nose and muzzle (Nicole's nose line).
- **Small crease artifacts** remain near the ear roots (Chris, Carl side view).
- **Nicole's 2D transfer ran at 85% gain** (σ 0.18) under the fold guard.
- **One neutral body** is used for all three. **Hair** is the flat temporary shell.

---

# Stage 1 parametric sculpture pass (2026-10-07, 17:05–17:28, $0) — awaiting Bon's clay review

Bon approved the direction but not the visual: the forms were crude and read as a projected 2D face.

## What is style-locked (same for every employee)

- **The Offshorly facial sculpture.**
  1. The canonical topology is DENSELY fitted to each of the five approved HumanBase heads (V3 `fit3D`; calibration only — `fitapproved.mjs`).
  2. The vertex-wise mean is taken. All fits share the same vertices, so the mean stays crisp.
  3. It is blended into the canonical face region (`base2.mjs`): skull, ears and neck stay canonical; the mean fades out where the approved evidence is unreliable (down-facing jaw/under-chin surfaces); roughness-adaptive smoothing removes fit noise.
  4. Any surviving fold is resolved by a smooth fade.
- **Construction:** topology, UVs, rigid canonical ears, neck, and the V3 invariants.
- **Mean-face proportion layout:** the population Stage 0 mean maps exactly onto the base (thin-plate style map).

## What is identity-variable (driven by Stage 0 only)

**OBSERVED** — the 2D transfer through the style map onto the base:
- frontal silhouette (face width/length/taper, jaw, chin);
- eye centres, mouth, nose base, chin;
- nose width (interior).

**INFERRED** — seven semantic sculpture regions (nose · lips/muzzle · chin · cheeks · brow · eyes · mid-face):
- each region's sculpted relief (its normal component vs the canonical blank) is scaled by f_r = 1 + sd_r · drive_r;
- drive_r is a fixed linear map of population z-scores of Stage 0 observables;
- f_r is bounded by the approved fits' own range for that region;
- plus a small inferred jaw-taper field.

Factors for this trio:

| | nose | lips | chin | cheeks | brow | eyes | mid-face |
|---|---|---|---|---|---|---|---|
| Nicole | 1.21 | 1.05 | 0.78 | 1.44 | 0.79 | 0.89 | 1.61 |
| Carl | 0.99 | 1.00 | 0.77 | 1.20 | 1.04 | 1.10 | 0.65 |
| Chris | 1.14 | 0.71 | 1.36 | 0.79 | 0.67 | 0.83 | 1.17 |

**Person-specific logic: NONE.** No names, no per-person values, no manual descriptions. The approved heads are calibration only, and the base is their mean.

## Failure classes learned this pass

- FC-MASK-CLIFF
- FC-RELIEF-SPILL
- FC-TANGENTIAL-RELIEF (sculpt along the normal, not raw Z)
- FC-FIT-BOUNDARY
- FC-FIT-NOISE
- FC-ROLLBACK-PATCHWORK (smooth fold fade replaces zone rollback)
- FC-EAR-OVERSHOOT (earlier pass)

## QA

- T1–T8 and V1–V3 PASS on all three.
- Deterministic: a rebuild is byte-identical.

## Honest status

The clay heads are now clean, smooth Offshorly faces, with no cliffs or crust. They differ in proportion and in nose, cheek and chin sculpture.

Remaining gaps:
- **Softer than the individual approved heads:** the mean of five plus smoothing loses crispness. Eyes are soft domes, and mouths are faint.
- **Identity depth deltas are modest:** max |dz| vs the base is 0.015 / 0.004 / 0.007.
- **The regional map is hand-signed**, not learned from data; its range comes from the five approved fits.
- **Temporary hair regressed on Chris** (crown missing; the hair module was not adapted to the new base).
- **The eye-corner/lid geometric controls were disabled** (they destabilised the warp).

---

# Sculpture-basis pass (2026-10-07 17:05–17:41, $0)

## Mechanism
- `sculpt.mjs` adds 30 named operators on the canonical topology. Each operator is a Gaussian region mask located from landmark vertex ids, in face units.
- Operator kinds: tz (depth), ty (vertical), txo (outward), sx/sx0 (width), sy (height), rot (tilt) and inf (normal inflation).
- **Calibration:** each approved fit is projected onto each operator field around the approved mean; the sd sets the amplitude. Calibration caps by kind and a floor at 0.4 × the median of the kind.
- **Drive:** Stage 0 observables → population z-scores. Observed dims map directly; inferred dims use fixed linear relations of z. Drive clamped to |drive| ≤ 2.
- **Safety:** deflation is halved (FC-DEFLATE-GASH). The summed displacement is relaxed for 6 iterations (FC-OPERATOR-RIPPLE). fadeFolds runs at gain 1 → 0.75 → 0.5, then fails closed.
- **Eye identity is geometric:** eyeWidth, eyeOpenness, eyeTilt (rot), eyeInnerCorner (txo), eyeSocketDepth, upperLidFullness and underEyeFullness.
- **Frozen at 17:36:54:** `FROZEN-algorithm.sha256` (10 code files + base2/population/mean data). The holdout Arisha/Rhendel/Ali was built after the freeze; the hashes re-verified OK after the holdout.

## Results
- **Normal displacement vs the style prior (RMS / max):**

  | | RMS normal | max |
  |---|---|---|
  | Nicole | 0.0151 | 0.0548 |
  | Carl | 0.0103 | 0.0322 |
  | Chris | 0.0107 | 0.0349 |
  | Arisha | 0.0103 | 0.0332 |
  | Rhendel | 0.0076 | 0.027 |
  | Ali | 0.0082 | 0.0381 |

- All six built at basis gain 1 with 0 faded verts. QA T1–T8 and V1–V3 PASS for all six.
- Determinism: Carl + Ali rebuilt byte-identical.
- **Sheets:**
  - `sheets/stage1-clay-six.png` (prior + 6 × 5 views)
  - `sheets/stage1-delta.png` (signed normal delta, ±0.025)
  - `sheets/stage1-clay-geometry.png` (dev trio)

## Honest limitations
- The drive map is hand-signed anthropometry. Only the amplitudes are learned (from 5 approved fits).
- The population used for z-scores contains all 23 sprites, including the holdout. That is unsupervised normalisation, not tuning.
- Forms remain softer than individual approved heads (mean-of-five base).
- Chris shows faint forehead bands and a hard mouth line.
- Ears read blue on the delta map: rigid ears are translated by the 2D width change. That is not ear sculpting.
- The one name in the algorithm files is `build.mjs` `--anchor` default `nicole`. It is used only in trio-selection mode (no `--who`) and never touches geometry.

---

# Proportion audit + identity layout correction — Nicole only (2026-10-07 19:03–20:05, $0)

Sheet: `sheets/stage1-nicole-proportions.png`. It shows:
- the Stage 0 sketch;
- the old clay (from the approved six-person sheet);
- the corrected clay (front, 3/4, side, close-up with neutral eyeballs);
- Bon as a quality reference;
- a projected overlay (Stage 0 targets vs final 3D);
- a ratio table.

Audit tool: `audit-layout.mjs` (final-geometry measurement: visible eye openings by front z-buffer; menton; silhouette widths).

## Where it drifted (stage-by-stage trace, legacy pipeline)
1. **Style map C overwrote proportions.**
   - C is a near-interpolating spline: population-mean face → style base layout.
   - Every person got the style base's absolute proportions plus Jacobian-scaled deviations.
   - The warp itself pushed mouth→chin from 0.305 (style base) to 0.244. Stage 0 says 0.346.
2. **Wrong nose anchor.** Stage 0's nose BASE was pinned to the canonical nose TIP vertex, giving an upper lip of 0.387 H vs 0.198.
3. **Basis double-counted in-plane placement.** Its in-plane operators (eye width, inner corner, tilt, mouth/chin/jaw width) moved features again after the warp.
4. **Eye construction narrowed the opening.**
   - Radial lid moves from the ball centre slid the projected aperture inward.
   - The ball depth reference was off-axis, so the ball poked out laterally while the inner corner was covered.
   - Socket walls were judged against oblique template normals and faded back.
   - Net effect: eye width 0.40 vs 0.51, inner gap 0.60 vs 0.50, which reads as "eyes too far apart".

## Generalised mechanism now
- **Layout = the person's own Stage 0 layout.** All ratios are fixed. The only style factors are learned from the approved heads (their sprite → their approved 3D):
  - `calibrate-layout.mjs` → `style-layout.json`;
  - k_y = 0.774 ± 0.036 (vertical);
  - k_fw = 1.18 ± 0.12 (outline vs features);
  - approved 3D ranges, ±10% margin, used as clamps only.
- **Placement:** per-person least squares fits scale + offset only against the style base layout (minimal deformation).
- **Outline:** hands over to the canonical cranium silhouette above the eye line.
- **Nose anchor:** the style base's nostril line, measured the same way as in the calibration.
- **Basis:** volume-only (tz / inf). In-plane placement belongs to the layout.
- **Inverse map:** person ↔ 3D uses the same layout map (all observed feature points anchored).
- **Eyes:**
  - front-plane height field (z-only moves) on the measured Stage 0 aperture, clamped to the approved width range;
  - ball radius 1.08 × half-width, front at the head's own surface at the aperture centre;
  - lids never below the ball outside the aperture;
  - z-only regions use the front-projection fold test.
- **Fixed bugs:**
  - a swallowed-else NaN;
  - the build now fails closed on non-finite vertices;
  - the cheekbone width now uses the raw contour.

## Results (target = Stage 0 × learned style translation)

| Ratio | Stage 0 | Target | Old | Corrected |
|---|---|---|---|---|
| eye→nose / H | 0.456 | 0.456 | 0.363 | 0.469 |
| nose→mouth / H | 0.198 | 0.198 | 0.387 | 0.207 |
| mouth→chin / H | 0.346 | 0.346 | 0.250 | 0.324 |
| chin share of lower face | 0.637 | 0.637 | 0.393 | 0.610 |
| inner gap / IOD | 0.497 | 0.497 | 0.602 | 0.507 |
| eye width / IOD | 0.510 | 0.510 | 0.400 | 0.497 |
| mouth width / IOD | 0.703 | 0.703 | 0.509 | 0.695 |
| nose width / IOD | 0.381 | 0.381 | 0.301 | 0.388 |
| face height / IOD | 1.55 | 1.199 | 1.067 | 1.171 |
| IOD / face width at nose level | 0.616 | 0.520 | 0.573 | 0.490 |

- IOD / face width: the face is 6% wider than target. Eye-line width is not comparable (Stage 0 contour there is hair-bounded; 3D is the style-locked cranium).

## QA and checks
- Warp at full gain (σ 0.18, 0 folds). Feature modules at gain 1, 0 faded vertices.
- QA T1–T8 / V1–V3 PASS (`V3_TEMPLATE` = HD).
- T7 now has an eyeball rule: poke-through 0 and coincident surfaces 0. The rim tolerance is 0.5 mm, and lids start 0.6 mm outside the ball.
- Byte-identical rebuild. Protected files untouched. $0.

## Not done / remaining
- The other five were NOT rebuilt. Their outputs predate this mechanism.
- The freeze hash from the six-person proof no longer matches; the code changed by request.
- Sculptural quality still clearly below the approved five: nose base lumpy with nostril dimples, thin lid lines, soft lips. Not touched, per instruction.

---

# Identity Proportion Map (IPM) — head/face as a proportional system (Nicole only, 2026-10-07 20:27–20:47, $0)

Sheet: `sheets/stage1-nicole-ipm.png`. It shows SOURCE → MEASURED MAP → STYLE TARGET → FINAL CLAY, overlays, and a RAW | TARGET | FINAL | ERROR table.

## Modules
- `proportions.mjs`:
  - `measureS0` / `measure3D`: same definitions in 2D and 3D, eye spacing as the unit, evidence flags per measurement;
  - `learnStyle` / `translate`: per relationship, log-ratio, shrunk to identity when the approved heads disagree; approved range used as a soft clamp;
  - `layoutWarp`: proportion-space map; features keep their shapes;
  - `subnasale`: one anatomical nose-base definition.
- `calibrate-proportions.mjs` → `style-proportions.json`. Contents:
  - the style transform;
  - locked relation: nose tip above subnasale = 0.134 H (median);
  - population cheek/jaw prior: 1.86, n = 10.
- `measure-final.mjs`: re-measures the finished clay.
- `review-ipm.mjs`: the sheet.
- Data files, so no names live in code: `approved-pairs.json`, `approved-heads.json`.

## Learned style transform (approved sprite → approved 3D)

| Relationship | Factor | Trust |
|---|---|---|
| face height / IOD | ×0.81 | 0.81 |
| eye → nose base / H | ×1.003 | 0.94 |
| nose → chin / H | ×0.999 | 0.96 |
| eye width / IOD | ×1.08 | 0.63 |
| inner gap / IOD | ×0.93 | 0.63 |

- The other vertical intervals have weak evidence (trust < 0.5), so they stay near the person's raw values.
- Nose and mouth width have no style evidence, so identity is kept.

## Construction changes
- **Placement:** the layout comes entirely from the target map; only the face's scale and offset are least-squares fitted to the style base.
- **Nose:** subnasale anchor plus a style-locked tip control.
- **Outline evidence:**
  - reliable edge → used;
  - opposite side reliable → mirrored;
  - hair-bounded below the mouth line → probable (hair falls behind the jaw);
  - otherwise → the canonical envelope.
- **Outline solve:** front silhouette matched to the target jaw/chin widths after the warp (FC-SILHOUETTE-SWAP).
- **Form never moves proportion:** basis volume, chin pad and lower-face clean-up act in depth only (FC-FORM-MOVES-OUTLINE).
- **T7 eyeball rule:** visibility along view rays (front, ±35°). A negative test with balls inflated 4–8% gives 4–5 pokes.

## Final 3D vs style target (Nicole)
All evidence-backed relationships are within 5%:

| Relationship | Error |
|---|---|
| face height / IOD | 0.0% |
| jaw width / IOD | −0.5% |
| chin width / IOD | −1.3% |
| chin / jaw | +0.1% |
| brow → eye | +5.0% |
| eye → nose | +1.0% |
| nose → mouth | −3.0% |
| mouth → chin | +0.4% |
| nose → chin | −0.9% |
| inner gap | +4.7% |
| eye width | −4.8% |
| nose width | −0.9% |
| mouth width | −0.5% |

- Cheek width: Nicole's cheek edge is hair-bounded. The inferred value (1.94 IOD) is not enforced; the canonical gives 2.26.

## Checks
- QA T1–T8 / V1–V3 PASS.
- Byte-identical rebuild. Nothing faded.
- Protected files untouched.
- New skill: `.claude/skills/humanbase-avatar-pipeline/SKILL.md`.

## Unsolved
- Cheek/temple width wherever hair hides it (canonical envelope).
- Only 4 certain approved pairs, so several style factors have weak evidence.
- Sculptural quality: lid plateau around the eyes, nose surface, lower-face mottling.
- The other five were NOT rebuilt.

---

# Shape completion — occlusion is missing evidence, not missing anatomy (2026-10-07, $0)

## Sheets
- `sheets/stage1-nicole-shape-completion.png`:
  - SOURCE → VISIBLE EVIDENCE + occlusion bounds → INFERRED COMPLETE FACE (drawn under the hair) → STYLE-TRANSLATED ENVELOPE → FINAL CLAY;
  - eight cross-sections;
  - CURRENT vs SHAPE-COMPLETED vs Bon and France (style only).
- `sheets/stage1-{ali,carl,arisha}-shape-completion.png`: frozen-mechanism holdouts.
- `sheets/stage1-shape-completion-lineup.png`.

## Mechanism (`envelope.mjs`)
- **One profile.** A smooth, symmetric half-width profile over the face height, solved once from:
  - visible edges;
  - symmetry;
  - hair as occlusion bounds (skin/hair boundary = lower bound, outer hair = upper bound);
  - curvature smoothness;
  - eye containment (canthus + the approved minimum eye-to-side margin);
  - a leave-one-out population shape prior, filled by the style-base shape where the population is blind, and scaled to the person's own evidence.
- **Provenance per level:** OBSERVED · MIRRORED · CONSTRAINED · INFERRED · STYLE_PRIOR.
- **Downstream use:** the completed widths feed the proportion map, so calibration learned eye/cheek widths ×1.02 (trust 0.82) once the sprites were completed.

## Construction
- **Outline controls:** taken at each style-base silhouette vertex's relative height, cranium hand-off above the temple, chin bottom left as form (FC-ARC-HEIGHT-DRIFT, FC-CHIN-SPIKE).
- **Placement:** features only (FC-PLACEMENT-HAIR-DRIFT).
- **Socket anchors:** move rigidly with each eye (FC-SOCKET-COMPRESSION).
- **Eyeball seating:** the ball sits behind the person's own surrounding surface, with a radial containment safety net (FC-EYE-SEAT, FC-EYE-CONTAINMENT).
- **Eye rim:** steeper crossing (inset 0.06, margin offset 2 mm).
- **Outline solve:** stays below the mouth, because a full-height lateral solve creased the cheeks (FC-UPPER-OUTLINE-CREASE).

## QA (T7 eyeball rule)
- Views: front, ±35°, ±90°.
- A poke = visible (5-ray robust, FC-QA-RAY-CELL-SKIP) + outside the head locally + nearest surface a lid (beyond half the built lid thickness, FC-QA-GRAZING-APERTURE).
- Negative test: balls inflated 0–10% give 0 pokes (they stay inside the 5–9 mm lid shells); 15% gives 33.

## Final vs target error (%) — `s` marks STYLE_PRIOR / cranium levels

| | forehead | temple | eye | cheek | nose-lvl | mouth-lvl | jaw | chin | faceH | eye→nose | nose→mouth | mouth→chin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nicole (dev) | +9s | +4s | −1 | +1 | −7.5 | 0 | 0 | 0 | −0.4 | +1.7 | −2.7 | −0.6 |
| Ali (holdout) | +10s | +5s | −3 | −2 | −4 | −2 | 0 | 0 | +0.3 | +17.5 | −24 | −0.4 |
| Carl (holdout) | +2s | +3 | −2 | +1 | −8 | −4.5 | 0 | 0 | +0.3 | 0 | −2.4 | +0.8 |
| Arisha (holdout) | +7s | +4s | −1 | 0 | −10 | −3 | 0 | 0 | −0.1 | +9.6 | −18.5 | +0.1 |

## QA and checks
- Nicole, Ali, Carl: PASS.
- Arisha: V2 fails — 1 skin-coloured vertex under the hair in the TEMP paint layer (appearance, not clay geometry).
- Deterministic.
- Freeze: `FROZEN-shape-completion.sha256`, verified (16/16 code) before the holdouts.

## Unsolved
- Nose-base height does not generalise to 2 of 3 holdouts (subnasale lands low on Ali and Arisha); not tuned.
- Nose-level width is 4–10% narrow everywhere.
- Forehead/temple are canonical (style prior) by design.
- Arisha's temporary-paint V2 failure.
- Sculpture quality.

---

# Round: nose → mouth → chin, chin shape, outline construction (2026-10-08)

**Fixed and generalised (all `FC-…` rules live in code):**
- **Nose base:** one shared subnasale definition: the first strong concave corner below the tip. When the geometry lacks one, the nose module builds the junction (`FC-NOSE-BASE-UNBUILT`). Ali and Arisha's nose-base failures are gone; every eye→nose value is within 0.01 of target.
- **Mouth low:** weak style evidence (trust < 0.5) now keeps the identity value exactly (`FC-WEAK-STYLE-BIAS`). noseMouth and mouthChin are identity relations, because the approved heads disagree with each other.
- **Chin:**
  - Chin shape is its own set of relations: half-width at 25/50/75% of the way from the chin-width level to the menton (`FC-CHIN-PRIOR-OVERRIDE`).
  - The chin mass is a smooth height bump sized to the person (`FC-CHIN-RIM-CLIFF`, `FC-DEPTH-SHEAR`).
- **Outline solve (eye line → menton):**
  - A front-plane map smoothed at the face's own scale, coarse to fine.
  - A u² lateral ramp and a fixed midline.
  - Chin levels kept as separate targets.
  - Ears translate with their root ring.
  - Fold check every iteration, with a local fade ladder.
  - Related rules: `FC-OUTLINE-LEDGE`, `-RIPPLE`, `-ONSET-CREASE`, `-FOLD`, `FC-EAR-STRETCH`.
- **Measurement:** one continuous face-outline definition (`faceOutlineX`, margin 0.2 × eye spacing behind the ear plane), used by calibration, construction and QA. The old hard plane cut flipped Nicole's nose-level width by 7% (`FC-OUTLINE-PLANE-DISCONTINUITY`). Style transforms were recalibrated under it.
- **Per-stage drift:** stageMaps are recorded after warp+outline, basis, HD lift and features. Diagnostic skips: `V3_DIAG_SKIP=outline,basis`, `HB_FEAT_STOP=taubin|polish|eyes|nose`. Findings:
  - Ali's cheek ledge came from the outline solve.
  - Carl's jagged chin came from the chin module.
  - The nose-level width "loss" was the measurement plane.
- **Fail-closed identity QA:** `qa-identity.mjs` runs 20 checks per head.

**Nose → mouth → chin.** Format: target / before → **after**. Vertical relations are fractions of eye→chin; chin shape is half-width over chin width. Holdouts have no before build.

| who | eye→nose | nose→mouth | mouth→chin | chin 50% | chin 75% |
|---|---|---|---|---|---|
| nicole | 0.44 / 0.42 → **0.43** | 0.20 / 0.25 → **0.21** | 0.36 / 0.34 → **0.35** | 0.76 / 0.72 → **0.72** | 0.50 / 0.47 → **0.47** |
| ali | 0.35 / 0.33 → **0.34** | 0.25 / 0.29 → **0.26** | 0.40 / 0.38 → **0.40** | 0.74 / 0.66 → **0.74** | 0.50 / 0.45 → **0.45** |
| carl | 0.44 / 0.44 → **0.44** | 0.18 / 0.19 → **0.18** | 0.38 / 0.37 → **0.38** | 0.83 / 0.70 → **0.87** | 0.63 / 0.52 → **0.61** |
| arisha | 0.41 / 0.38 → **0.41** | 0.22 / 0.27 → **0.22** | 0.37 / 0.35 → **0.37** | 0.74 / 0.72 → **0.70** | 0.50 / 0.56 → **0.45** |
| chris (holdout) | 0.39 / — → **0.38** | 0.19 / — → **0.20** | 0.42 / — → **0.42** | 0.87 / — → **0.87** | 0.64 / — → **0.62** |
| rhendel (holdout) | 0.45 / — → **0.44** | 0.20 / — → **0.20** | 0.36 / — → **0.36** | 0.75 / — → **0.79** | 0.50 / — → **0.41** |

**QA:**
- Nicole, Ali, Carl, Arisha: identity QA 20/20 and structural QA all pass.
- Rebuilds are deterministic (Nicole GLB identical across rebuilds).
- Mechanism frozen in `stage1-proof/FROZEN-nose-mouth-chin.sha256` (21 files), still intact after the holdout builds.
- **Frozen holdouts, untuned:**
  - **Chris** fails identity silhouette (chin bottom 6–10% too wide at t 0.80–0.85) and structural T7 (one eyeball vertex pokes through a lid).
  - **Rhendel** fails chinRound75 (0.41 vs 0.50, pointier than target); structural QA passes.

**Sheets** (in `stage1-proof/review-nmc/`):
- `<who>-review.png`: source → measured map → style target → final clay with target ○ vs final ● and an aligned silhouette; before/after; per-stage table with QA.
- `four-before-after.png`
- `holdouts.png`

**Unresolved:**
- The chin bottom is the least general part: both holdout misses are there, and all four show a small speck at the menton.
- The under-jaw seam is rough in low 3/4; it predates this round.
- Ali has a soft dent in front of the ear.
- Orange-peel noise from the approved fits is still visible on the lower face.

---

# Round: sculptural refinement (2026-10-08, second pass)

**Holdout chin-bottom failures fixed (both general):**
- The outline solve now measures with the shared outline definition (`FC-OUTLINE-DEFINITION-MISMATCH`).
- The cheek band runs down to the chin-width level (`FC-JAW-CHIN-GAP`).
- Below the jaw, a depth window lets the under-jaw follow passively (`FC-UNDERJAW-SHEAR`).
- The menton has one shared definition (`mentonY`).

**Sculpture:**
- **Eyelids:** the own surface now rolls onto the eyeball (`FC-LID-SHELL-CLIFF`), with a canthus blend (`FC-CANTHUS-SEAM`), lid fairing (`FC-LID-CONSTRUCTION-LINES`) and smooth clamps (`FC-CLAMP-CREASE`).
- **Mottling:** removed with a polished clean-up reference (`FC-CLEANUP-NOISE-TRANSPLANT`, `-BORDER-NOISE`).
- **Seam fairing:** covers the under-jaw, the jaw, the refinement border and ear rings 2–8. It includes a crease relaxer, an outline-preserving minimal-intervention restore, and a relation-matched chin tip (`FC-LOWANGLE-SEAM`, `FC-BASE-JAW-RIDGE`, `FC-RESTORE-RESHARPEN`, `FC-CHIN-TIP-RELATION`).
- **Chin and nose:** a relaxed height-field chin with a depth fade (`FC-FORM-SPECKLE`, `FC-CHIN-EDGE-CREASE`) and a soft subnasale junction (`FC-SUBNASALE-SLIT`).
- **Lips:** the lip region and blend radius are derived from the lip volumes (`FC-LIP-REGION-CUTOFF`).

**New fail-closed surface QA:** `qa-surface.mjs` checks creases, mottling, spikes, low angle and ear seams. Modules declare their designed creases, and it writes a defect map for each head. Negative tests: Nicole and Arisha's pre-round meshes give 1,433 and 1,752 crease edges, max ~150°, mottling 0.003, and both fail.

**Results** (final, deterministic; Carl's GLB is identical on rebuild):

| who | identity | surface | crease edges (max °) | mottling p99 | low-angle | structural |
|---|---|---|---|---|---|---|
| nicole | 20/20 | PASS | 8 (35°) | 0.0008 | 2 | T7 flags 1 vertex at the outer canthus (inspected: ball seen through the aperture beside the rolled margin; the rule's lid threshold predates rolled lids; rule not loosened without a negative test) |
| ali | 20/20 | PASS | 8 (39°) | 0.0009 | 1 | PASS |
| carl | 20/20 | PASS | 4 (36°) | 0.0008 | 3 | PASS |
| arisha | 20/20 | FAIL | 16 (52°) | 0.0009 | 11 | PASS |
| chris | 20/20 | FAIL | 42 (55°) | 0.0010 | 37 | PASS |
| rhendel | 20/20 | PASS | 9 (37°) | 0.0008 | 3 | PASS |

**Frozen-mechanism holdouts** (`FROZEN-sculpt.sha256`; never built before; Stage 0 from population via `V3_S0DIR`):
- **karen:** identity 20/20, surface PASS (17 edges, 44°), structural PASS.
- **kylle:** identity 20/20, surface PASS (4 edges, 33°), structural PASS.
- **adam:** fails closed at the layout warp. The cause is a defective Stage 0 input (right eye 123 px vs left 75 px, mouth 257 px).

**Sheets** (in `stage1-proof/review-sculpt/`): `before-after-six.png` (+`-half`), `low-angle.png`, `holdouts.png`, `defect-maps/`.

**Unresolved:**
- The chin underside on broad chins: Chris (42 crease edges, 55°) and Arisha (52°). Fairing it and holding the chin-tip identity pull against each other.
- Small alar-groove creases (4–6 edges) and slight lid-margin serration at mesh resolution.
- Nicole's T7 flag (above).
- Adam: Stage 0 needs plausibility gates.

---

# Refinement pass 2 (2026-10-08)

**1. Kylle mouth-to-cheek crease**
- **Root cause:** a malformed Stage 0 mouth. Confidence 0.45, touching its box, mouth tilted 12.8°, and the lower-lip outline ending 38 px off the corner. The lip module grew a tube along that tail.
- **Construction fix (general):** lips taper and converge onto the measured corners (`FC-LIP-END-SPIKE`). The lip region is derived from the volumes on all sides (`FC-LIP-REGION-CUTOFF`).
- **Input fix:** the new Stage 0 gate refuses Kylle.
- **Detection:** no surface metric separates this soft ridge from anatomy. Tried and recorded: crease angle, mid-frequency offset, chain length, and module footprint (the footprint check failed its negative and is report-only). What closes the gap:
  - the input gate;
  - the proven lip-ends invariant check (`L_lipEnds`): the legacy Kylle build fails it (end offset 0.133 > 0.08).

**2. Chris/Arisha chin underside**
- Silhouette-holding edge rounding: the outline band holds and the surface behind comes up to meet it (`FC-CHIN-EDGE-RESHARPEN`).
- **Arisha:** now PASSES surface QA (8 creases, max 44°, low-angle 4).
- **Chris:** improved but still FAILS (34 edges, max 59°, low-angle 29; was 42/55°/37).
- Identity is 20/20 for both.

**3. Nicole T7**
- Diagnosed as a false positive: the ball is seen through the aperture, but the nearest skin is the rolled margin at 3.2 mm, just past the 3.05 mm rim band.
- Revised rule: from the front/±35° views, a poke is a visible eyeball point outside the designed eye opening, which the eye module now exports. The side views keep the original rule and threshold.
- Negative tests (diagnostic builds, kept in `nicole/V/diag-lidsink` and `diag-ballpush`):
  - Lid ring sunk into the ball: legacy rule 0 pokes (MISSED), revised rule 52 (caught).
  - Eyeballs pushed through the lids: legacy 3, revised 1 (both catch it).
  - Nicole final: legacy 1 (false positive), revised 0.
- I also rejected one candidate rule ("skin behind the ball on the view ray") because it is geometrically unable to fire.

**4. Stage 0 input gate** (`input-gate.mjs`, fail-closed in build)
- **Refused:**
  - **adam:** eye ratio 1.64, mouth 1.57 eye spacings, mouth detection unreliable, lip ends off the corners, lip spike.
  - **alex:** mouth unreliable, mouth width 1.46, lip ends off the corners.
  - **cyrus:** no nose base.
  - **france:** eye ratio 1.38, eye shape 1.02. France is an approved calibration pair, so this is a calibration finding.
  - **kylle:** mouth unreliable, tilt 12.8°, lip-end gap 0.28, lip spike 0.22.
- All other 24 records pass.

**Validation** (deterministic; Chris's GLB is identical on rebuild; frozen in `FROZEN-refinement2.sha256`; post-freeze QA-only note in `FROZEN-refinement2.NOTE.txt`):

| who | identity | surface | structural |
|---|---|---|---|
| nicole | 20/20 | PASS (6, 35°) | PASS (T7 resolved) |
| ali | 20/20 | PASS (7, 39°) | PASS |
| carl | 20/20 | PASS (2, 35°) | PASS |
| arisha | 20/20 | PASS (8, 44°) | PASS |
| chris | 20/20 | FAIL (34, 59° chin underside) | PASS |
| rhendel | 20/20 | PASS (7, 37°) | PASS |
| bhong (holdout) | FAIL: eye width −10.7%, inner gap +12.7% | PASS | PASS |
| esson (holdout) | 20/20 | PASS | PASS |
| ivory (holdout) | FAIL: temple +16%, silhouette sample 16.3% | PASS | PASS |

- Negatives:
  - Nicole and Arisha's pre-round meshes fail surface QA (over 1,400 creases each).
  - The Kylle lip-ridge build fails `L_lipEnds`.
  - The lid-sink and ball-push builds fail T7.

**Sheets** (in `stage1-proof/review-refine2/`): `before-after-six`, `chin-underside`, `kylle`, `t7-negatives`, `holdouts`, `defect-maps/`.

**Remaining:**
- Chris's chin underside.
- Bhong: very large eyes sit at the locked Offshorly eye-width maximum, and the visible opening comes out 10% under even that clamped width. Construction and target also disagree on the clamp.
- Ivory: temple width above the eye line follows the canonical cranium.
- Nose wings read as detached round "pebbles" on several heads; surface QA does not see it.
- Small lid-margin step and serration (Rhendel's outer corner).
- France's Stage 0 eye measurement feeds the style calibration.

## Refinement pass 3 (2026-10-08) — calibration evidence, eye width, cranium, nose base, chin

- **France/Clang calibration eyes.** This is genuinely invalid evidence, not a detector error.
  - France's right eye: Stage 0 conf 0.3, implausible shape; the outline climbs into the bangs.
  - Clang's left eye: outer corner occluded (`dark-beyond-lid`).
  - Fix: `withEyeEvidence` mirrors the reliable eye, with provenance. Both pairs are QUARANTINED from the eye-shape relations and the eye side margin.
  - The eye range is calibration data from the verified heads: 0.207–0.326 halfW/IOD.
  - Production heads are untouched. Sheet: `review-refine3/calibration-eyes.png`.
- **Bhong eye width.** One definition: calibration range → target (`style-limited` with the identity value kept) → construction fixed point (`eyeWidthSolve`) → QA. They now agree.
- **Ivory temple.**
  - Band to the temple, cranium carry (halfAbove ramp to 60% crown), full-section correction, wider σ above the eye line.
  - Identity: PASS.
  - **Visual: FAIL.** There is a cranium shoulder/step at temple level in front close and 3/4, and no gate catches it (QA gap).
- **Nose base.** One continuous bar (wing → subnasale → wing), median-seated, tapered sill, cheek-side alar groove, nostrils below the tip. No pebbles on 12/12. Wide noses (Esson, Ivory) read as a flat bar and need visual review.
- **Chin.** The solve uses the measured menton, and the restore reference is fixed. Chris still FAILS surface QA (under-chin 23 edges, nose-side 10, face 3; max 51°).
- **Also fixed:**
  - T7 self-occlusion (facing condition + the literal opening rule in the far branch); negatives re-proven (lid-sink 52, ball-push 1);
  - ear nearest-ring follow;
  - hair final clearance.
- **Regression:** `regress.mjs` 12/12 PASS (eye-evidence, quarantine, style-limit and gate negatives).
- **Determinism:** OK. Freeze: `FROZEN-refinement3.sha256` intact.
- **Holdouts:** Jan PASS. Lui PASS. Kael FAILS identity (chinW −6.8%) and surface (81 creases, mouth at t0.7).
- **Arisha:** V2 structural (1 skin-paint vertex, temporary appearance layer) deferred to the hair/appearance round.

## Trace round (2026-10-08) — final Stage 1 work; procedural head sculpting then STOPPED (Meshy chosen as the head engine)

Reference-driven construction on the dev set (nicole, ali, carl, arisha, chris, rhendel, bhong, esson, ivory, kael):

- **Skull.** Hair-over-skull edges are bounds, not skin. The cranium is targeted on exact whole sections: the low-passed canonical skull × the traced ratio. There is a long front→section blend, and the warp sets outline heights only (widths are built once).
  - Silhouette QA: 10/10 PASS.
  - Ivory's waist went from 0.045 to 0.0016.
- **Outline.** The one shared outline definition is now exact (edge sections). Recalibrated: the chin-roundness style factors moved to ≈ identity. The face outline is a least-squares convex profile.
- **Mouth.** Seam-first closed smile (mouth.mjs: line / lips / open classification, population closed-smile prior). The chin pad is removed.
  - Smile edge slope 0.93–1.62, against 2.28–6.7 on every pass-3 tube-lip build.
- **Nose.** One continuous form (faired seat, tip + nasal base + columella), soft nostrils, base height built to measure.
- **Under-jaw.** Thin-plate fairing.
- **QA status.**

  | QA | Pass | Notes |
  |---|---|---|
  | Identity | 10/10 | |
  | Structural | 9/10 | Kael V1: 11 back-facing pixels on the TEMPORARY hair |
  | Surface | 9/10 | Chris chin-corner creases, max 59° |
  | Silhouette | 10/10 | |
  | Feature form | 10/10 | |

- **Negative tests.** `regress.mjs` has build-level negatives for stepped temples, a pointed chin, thick smile strips, a chin ridge, detached nose volumes and under-jaw creases. All of them fail as required. The jagged-lid detector failed its own negative, so it is REPORT-ONLY.
- **Stopped.** The user returned to Meshy as the primary head engine. This work is preserved; its measurement/QA code is reused by `human-base/identity-correct.mjs` (Meshy head correction).
