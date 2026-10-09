---
name: humanbase-avatar-pipeline
description: Working methodology for developing the HumanBase (Offshorly 3D avatar) pipeline — upload image → identity measurement → styled 3D head → automatic validation. Use whenever building, debugging, or reviewing HumanBase identity extraction (Stage 0), head construction (Stage 1+), sculpt modules, hair/accessory modules, or avatar QA. Not the pipeline itself; never contains employee-specific fixes.
---

# HumanBase avatar pipeline — working methodology

Think as four people at once: a **character artist** (what makes this person recognisable?), a **3D character modeller/sculptor** (is it real, readable form from every angle?), a **technical artist** (does it hold the locked Offshorly style?) and a **geometry/pipeline engineer** (is it deterministic, measurable, fail-closed, automatic?).

**Final goal:** upload → automatic build → automatic validation → production. Human review during development is scaffolding for discovering missing automation. It is never the production workflow.

## Production architecture (DECIDED 2026-10-08): Meshy generates, HumanBase corrects, integrates and validates

Meshy is the head-generation engine. Custom procedural head sculpting (Stage 1) is stopped. Its measurement, envelope and QA work is reused, not discarded.

```
approved illustration → Stage 0 identity (v3/identity) → Meshy head (reuse raw; NEW ≈30 credits, approval first)
  → chibify (Offshorly style: canonical skull/ears/chin, eyes, hair layers) → identity-correct.mjs (Stage 0 targets)
  → accessories → optimise → fail-closed gate on the real HumanBase body (automatic head mount) → visual sign-off → promote (human-gated)
```

- **One command per employee:** `build-employees.mjs --only=<who> --correct`. Corrected builds write `candidates/<who>/corr-pass*/` + `report.corrected.json` and never overwrite V2 candidates. The approved five are frozen fixtures.
- **Non-coder workflow: HumanBase Studio.**
  - Start it with `node scripts/avatar-pipeline/human-base/studio/server.mjs` (opens on :8094; previews need Vite :5173).
  - Steps: reference/upload → identity trace → Meshy (reuse / approval-gated new) → build → preview (lineup, idle/walk) → review sheet → export (`output/human-base/exports/<who>/`, never production).
  - Jobs and logs persist. A Meshy task that was interrupted resumes read-only with `studio/meshy-resume.mjs <who> <taskId>`.
  - New uploads need the free local face model once: `studio/setup-mediapipe.mjs`.
- **Measure Meshy heads with the calibration's own definitions:** dense V3 fit onto the canonical topology → `measure3D`. Never invent a new measurement for a new source.
- **The "too wide" Meshy face is a width : LENGTH error.**
  - Cause: the canonical eye-line envelope compresses the face's length. Example: Kael's face height/eye spacing was −11% with widths on target.
  - Correct it in LENGTH. The traced target drives chibify's own long-face retention (`--faceLenBoost`: chin fixed, eye line moves); the mounted envelope stays the hard limit.
  - Never narrow the skull: FC-SKULL-CONTRACT locks it to ±1.5%. A first attempt that narrowed the whole head fired FC-SKULL-CONTRACT + FC-BROW-GAP and was reverted. Face-only narrowing was already rejected visually in V1.4.
- **Width corrections:**
  - Only below the eye line, as ONE smooth lateral profile (monotone cubic over the named levels, eye-spacing units).
  - Only on the FACE FRONT: a depth window in front of the ear plane, so the ears and skull stay canonical.
  - The neck column never moves. The eyes move rigidly; they are never squashed.
  - Apply ONE spatial warp to every head part (skin, eyes, mouth, hair, closure). Transform normals and lid normals by J⁻ᵀ and flow by J. Carry the landmarks and the glasses-fit grid along. Update the gate's record values. Leave hair-motion JOINTS alone: moving them would break the inverse bind matrices.
- **Evidence-weak targets** (STYLE_PRIOR / hair-bounded) are never forced. Every correction is logged in the build record and the gate report.
- **Corrected candidates are Draco-compressed.** Any renderer needs `DRACOLoader` (`/virtual-office/vendor/draco/`).

## Core principles

1. **Identity is not literal face copying.** Preserve the recognisable relationships among traits (spacing, lengths, tapers, shapes, ordering). Do not copy pixels or a drawing's exact geometry.
2. **The style is locked.** Every head belongs to the approved HumanBase family. The approved characters calibrate style and quality only. They are never identities to copy or average into an employee.
3. **The head/face is a proportional coordinate system, not loose landmarks.** Ask "where is the mouth relative to the nose, chin, eyes, jaw and the whole head?" Measure the relationships before sculpting anything.
4. **Translate identity through style.** Use person proportion map → learned style transform → target proportion map → sculpture. The transform is learned from approved sprite → approved 3D pairs, applied per relationship, and multiplicative, so ordering and relative differences survive. Where the approved evidence disagrees (trust < 0.5), the person's own value is used exactly — a "weak" factor still biases everyone the same way (it put every mouth ~6% low). Never replace identity with the style average.
5. **Separate three layers that must not fight:**
   - **Position/proportion:** where things belong in the front view.
   - **Form/volume/depth:** real 3D sculpture. It acts in depth and must not move the front-view layout.
   - **Appearance:** paint, materials, hair colour.

   Once placed, no later stage may move a feature again.
6. **One canonical, safe topology can represent different faces.** Deform it toward per-person targets. Refinement such as subdivision is the same for everyone, deterministic, and keeps the mesh closed and manifold.
7. **Complete skull under hair.** Hair, accessories and glasses are separate modules. They are never destructive skull cuts and never baked into identity geometry.
8. **Occlusion is missing evidence, not missing anatomy.** Hair, glasses or framing hide parts of a face; the face is still there.
   - Infer the hidden boundary as part of ONE continuous, smooth face envelope.
   - Use every constraint at once:
     - visible contour above and below the hidden part;
     - symmetry / the opposite side;
     - the eyes, the centreline, and jaw/chin width and taper;
     - neighbouring curvature;
     - anatomy (the skull contains the eyes);
     - a human face-shape prior scaled to this person's own visible evidence;
     - the style prior.
   - Treat hair as an occlusion BOUND, never as face geometry: the skin/hair boundary is a lower bound, the outer hair silhouette an upper bound.
   - Never fill hidden regions level by level with canonical widths. A narrow face completes narrow and a broad face stays broad; no universal shape rule.
   - Every completed level carries provenance (OBSERVED · MIRRORED · CONSTRAINED · INFERRED · STYLE_PRIOR), so the geometry knows what came from evidence and what was inferred.
9. **Evidence honesty.** Measure only what the image supports:
   - Hair silhouettes are not skull or face width.
   - Mirror the reliable side when one side is hidden.
   - Infer from population relations only when flagged.
   - Leave unknowns to the style-locked envelope.

   Every measurement carries a flag: observed, mirrored, probable, inferred, bound, or hair-dependent.
10. **No person-specific logic.** No employee-name geometry gates and no per-person sculpt constants. Calibration data (for example which sprite an approved head came from) lives in data files, never in code paths.
11. **Remeasure the final mesh.** Measure after all deformation, sculpt modules and safety fades, using the same definitions as Stage 0 and the calibration. Passing the math upstream is meaningless if a later stage moved things.
12. **Visual acceptance and measurement must agree.** If the numbers pass but it looks wrong, a definition is wrong; fix the definition. If it looks right but the numbers fail, find out why before accepting it.

## Method

**Measure before building.** Stage 0 produces an identity proportion map with these relationships:
- **Frame:** face height / eye spacing; temple, eye, cheek, jaw and chin widths; jaw taper; forehead.
- **Vertical:** fractions of eye line → chin covering brow, eye, nose base, mouth and chin.
- **Horizontal:** inner gap, eye width, nose width and mouth width relative to eye spacing.
- **Cross-ratios:** for example (nose→mouth)/(nose→chin).

The eye spacing is the always-reliable unit.

**Use one anatomical definition per landmark, everywhere.** The same function serves construction anchor, calibration and final measurement. Examples:
- **Nose base:** the subnasale = the FIRST strong concave profile corner below the tip (largest slope change in the upper part of tip→mouth). Not a chord (fails on concave lips), not the strongest corner (finds the lip border), not the tip vertex or a region percentile. If the sculpture has no such corner (a barely projecting nose), the nose module must BUILD the junction — a landmark the geometry lacks cannot be measured.
- **Eye:** the visible opening from a front-view depth test.
- **Chin:** the menton.
- **Face outline at a height:** the front-view outline of non-ear surface within a face-relative margin behind the ear plane. A hard plane cut is discontinuous where the cheek straddles the plane (a 2 mm level shift flipped a width by 7%).

**The chin is its own set of relationships, never the shared prior's.** Position (mouth→menton), width, shape (half-width at 25/50/75% from the chin-width level to the menton: round, broad, square or pointed), projection (depth) and transition. If the chin bottom is left to the style base, every chin comes out alike.

**Solve, don't place-then-patch.**
- The target map defines all front-view positions and shapes through one proportion-space map.
- Only the face's absolute scale and offset in the canonical head are free, solved by least squares against the style base.
- The inverse (3D → person) map must be the same map as the forward warp.
- After a warp, the measured silhouette can come from vertices other than the controlled ones. Solve outlines against measurement, not control points.
- Things a front drawing cannot show (for example nose-tip height above the nostril line) come from style-locked relations learned from the approved heads.

**Deformation has side effects in the dimensions you did not touch.**
- In-plane narrowing keeps depth, so narrowed sides recede. Protect what must not compress:
  - eye sockets move rigidly with their eye;
  - eyeballs are seated behind the person's own surrounding surface;
  - the head must contain its eyes.
- Outline controls keep their relative face height. Never take control heights from samples that may sit on a hair boundary.
- Face placement is fitted on features only.

**Correction fields must be smooth by construction, at the face's scale.** Numbers passing while the clay ripples or creases is not done. Rules learned:
- Express every length relative to the face (eye spacing, eye→chin), never in absolute cm. A "2 cm" smoothing on a large head was one sample wide and let the correction flip sign → a cheek ledge.
- An outline correction is a front-plane map (a function of x, y) like the main warp. Don't weight it by depth at the silhouette: silhouette verts sit near ear depth, and fading them out inflated the front cheek over a static side.
- Lateral ramps are low-slope and C1 (e.g. u²), never a narrow smoothstep band (that stretches the cheek several times the scale error).
- Smooth broad levels together, but keep anatomical targets (chin levels) as their own values.
- Check folds after every iteration. Fade a few marginal triangles locally; stop at the last fold-free state otherwise.
- Ears translate with their root ring; never stretch them with a lateral map.
- **Depth-only forms are height fields along the view axis.** Use smooth bumps with zero-slope edges, never a solid's union solved as a height field: it cliffs at the solid's rim. Relax the displacement field before applying it (a per-vertex facing weight turns normal noise into speckle). Fade by DEPTH behind the form's front, not by surface facing, which leaves a sharp overhang.
- **Below the jaw, lateral corrections use a depth window.** A correction at a given height acts on surface at or in front of that height's outline, fading over a long distance (about 0.8 eye spacing). The under-jaw rises toward the neck behind the chin, through every chin height, so it must follow passively or it shears into a dangling ridge.

## Sculpting rules (learned in the sculptural refinement round)

- **Every clamp is smooth.** A hard `max(z, floor)` or a projection onto a sphere creases wherever it starts acting. Use a C1 smooth max.
- **Eyelids are the person's own surrounding surface rolling onto the eyeball.**
  - The outer lid is `max(own surface, ball + lid thickness)`.
  - The margin rolls from touching the ball out to that surface with a rounded (circular) profile, whose width follows the local depth gap.
  - Never use a lid shell below the face (recessed shelf + circular cliff) or a thin bead (reads as a second cut).
  - Evaluate upper and lower lid profiles everywhere and blend them across the canthal line; nearest-outline assignment creases out of each corner.
  - Relax the lid displacement outside the declared margin, then re-apply the anti-poke floor on every lid vertex.
- **A reference surface must be as clean as the surface it corrects.** `Y = ref + lowpass(Y − ref)` transplants the reference's own noise, so smooth the reference over its whole region.
- **Derive working regions from the forms they hold.** A fixed box cut a full lip's volume off in a ledge, and a fixed blend radius undercut it. Region = form extent + margin; blend ∝ form size.
- **Fair seams, but preserve identity-owned outlines.** Fair the coarse/refined borders, the under-jaw and the ear rings. Ring 1 around the ear is the anatomical ear-root groove; leave it.
  - Never hold one component of a vertex (e.g. a binary x-lock): locked and free neighbours cut a seam and keep the faceting.
  - Instead fair fully, then restore the measured outline with a smooth per-height correction, with minimal intervention: correct only drift beyond a deadband. An exact restore re-imposes the ridge the fairing removed.
  - Restore sensitive relations (e.g. chin-tip roundness) as relations (fraction between chin-width level and menton × current chin width), never at absolute heights.
- **Modules declare their designed creases** (lid↔ball contact, steep margin roll, canthus corners, lip seam, nostril carves). Surface QA judges every other skin edge and reports the declared count, so nothing can hide there.

## Surface QA (beside identity and structural QA)

- Test what the eye sees, including low angles:
  - creases (dihedral > 30° on skin; visible above about 50° or in numbers);
  - mottling (normal offset from a band-limited copy of the surface, not a bilaplacian, which reads mesh-refinement seams);
  - spikes;
  - jaw/under-jaw creases (low angle);
  - ear-ring creases.
- Render a defect map (front + from below) for every review.
- Calibrate tolerances on evidence: before/after heads, with negative tests that must fail.
- A construction can be numerically clean and still read wrong (and vice versa). Look at 3/4, low 3/4, from below and a face crop every time.

## One definition, everywhere (again)

- Construction and QA must measure the same thing: the same outline definition (including its band and depth margin), the same menton, the same mouth height.
- Each mismatch this round made a "fix" act on something QA never measured. A "robust" solver measurement smeared the chin tip; a different menton made a restore hold the wrong vertex.

## Detection discipline (learned in refinement pass 2)

- **A detector that misses its own negative case is not a gate.** Two I built this pass failed their negatives:
  - a module-footprint check (the region came from the malformed measurement itself);
  - a "skin behind the ball on the view ray" eye check (behind any front ball point the ray is inside the ball, so it can never fire).

  Keep them as report-only evidence, never as pass/fail.
- **A negative test must contain the real defect after every safeguard.** Construction safeguards (anti-poke clamps, containment, the fold fade) silently undid three lid-sink attempts. Inject the defect at the very end, on a diagnostic-only path (`diag-*` output, never `pass1`), and render it to confirm it is actually visible.
- **Prefer literal definitions over proxies.**
  - A T7 poke is "an eyeball point visible OUTSIDE the designed eye opening": the eye module exports its opening. The nearest-surface proxy gave a false positive on rolled lids and MISSED a real penetration (lid ring sunk into the ball).
  - The lip regression check is "lips taper and meet at the measured corners", the invariant the construction enforces.
- **Some defects are not surface-detectable.** A soft, low-angle ridge has the same edge angles and curvature as real anatomy. When a defect comes from a malformed input, the detector belongs upstream (the input gate) or on the construction invariant, not in a surface metric. Say so rather than inventing a metric.
- **Declared designed creases must stay thin.** Check what a declaration hides. Verify a declared band against a render before trusting a pass inside it.

## Holdouts and inputs

- **Stage 0 input plausibility gate (fail closed, `input-gate.mjs`).** Checks:
  - features present;
  - eye-pair symmetry and shape;
  - mouth reliability (detector fallback: low confidence + touching its box);
  - mouth width;
  - mouth tilt vs the eye line;
  - lip outlines ending at the corners;
  - no lip-outline spikes;
  - feature order.

  Limits come from the population's plausible spread, with margin. A refused input is reported with every violated check; Stage 1 never repairs or invents proportions to get past it. Approved/calibration sprites can fail it too (France's eyes), which is a calibration finding, not a reason to loosen the gate.
- **Construction must not depend on a measurement's weakest part.** Outline tails, single points and box-touching detections are the least reliable data. Anchor forms to the reliable landmarks (lips converge on the measured corners) so a noisy tail cannot grow a form.

- Holdouts must be people the mechanism has never seen. Build them from population Stage 0 data via the Stage 0 input path (`V3_S0DIR`), after freezing.
- A Stage 1 fail-closed on a defective Stage 0 input is correct; the missing piece is Stage 0 plausibility gates (eye-pair symmetry, mouth-width range).

## Evidence, calibration and construction (learned in refinement pass 3)

- **Calibration evidence is graded too. Approved is not the same as true.** An approved or semi-approved head can carry bad evidence; France's and Clang's eyes are hidden under bangs.
  - Stage 0's own per-eye flags decide (`withEyeEvidence`): confidence < 0.5, implausible shape, an occluded corner.
  - Rebuild a flagged eye by mirroring the reliable eye about the inner-corner midline. An occluded corner keeps its own observed corner.
  - Record the provenance (`mirrored (eye R unreliable)`) on every relation that uses the eye spacing. If both eyes are bad, mark them `quarantined`, never evidence.
  - Calibration pairs with flagged sprite eyes are QUARANTINED from the eye-shape relations and the eye margin, and this is reported in `style-proportions.json`.
  - Never retune the approved head. Never drop its reliable facial evidence.
  - Lesson: one implausible eye outline inflated the learned eye-width style factor for every new person.
- **One quantity, one definition, from calibration to QA.** The eye width went through four definitions; each stage "passed" its own, and the opening came out 10% narrow.
  - Now: the locked eye range is calibration DATA (verified heads only) → applied in the target map → construction solves a fixed point so QA's own measurement equals the target → QA.
  - QA measures the mean corner width over the corner-midpoint spacing. Scaling about the centroid moves the corner midpoints, so the solve must use QA's definition.
  - When style limits identity, the target says so: `style-limited`, with the identity value kept beside it and reported by identity QA. A silent clamp is forbidden.
- **The upper face/cranium follows the evidence; there is no single skull width.**
  - The outline band reaches the temple (where the evidence is), not just the eye line.
  - Above it, the correction is carried into the cranium on a smooth ramp to about 60% of the crown height.
  - It is applied to the whole cross-section (not the front only: back-edge dent).
  - It uses a wider σ above the eye line (no pinch).
  - **Still open:** with large temple corrections (Ivory) the transition reads as a shoulder or step in front/3/4, and every gate passes. The cranium needs one smooth monotone half-width profile, not an additive band. A silhouette-curvature check is needed, with a negative test.
- **The nose is one continuous nasal base, not separate primitives.**
  - Wings, columella base and sill form a single bar from wing to wing through the subnasale, seated at the median depth of the surrounding skin and tapering toward the sill.
  - The alar groove is on the cheek side only; it never crosses the tip on narrow noses.
  - Nostrils are carved below the tip on the base (never on the wing flank), with the rim ring declared.
  - Separate wing spheres sank inside the face and read as pebbles. A larger blend did not fix them; it made other noses worse.
- **Solve at the levels QA measures.** The outline solve uses the measured menton (not the target menton). The restore's relation reference is the restore target, not the faired width. Both were "one definition" bugs that showed up as chin-roundness failures on other people.
- **Attached parts follow the surface they attach to.** Ears follow their nearest root-ring vertex. A rigid translation of the whole ear spiked the root on large warps.
- **Hair must clear the FINAL head.** Clearance checked before the last face passes let hair end up inside. Use a smooth push field (2-ring falloff) plus recomputed normals; a single-vertex push does nothing visible.
- **Rejected attempts (do not retry blindly):**
  - an x-only silhouette hold (changes the chin relations);
  - fairing ring 1 at the ear (breaks the root groove → T4);
  - a larger nose-wing blend (0.8);
  - landed-outline inverse anchors. These trade the hair V1 defect for V2 and remain an open coupling for the hair round.
- **The T7 opening rule must respect self-occlusion.** Only ball points facing the view count. The back of the ball and points in a deep socket are not pokes. Re-prove the negatives (lid-sink, ball-push) after every rule change.

## Stage 1 trace round (2026-10-08; procedural sculpting then stopped — the lessons are reusable for correcting Meshy heads)

- **Hair over the skull is an occlusion boundary.** Above the eye line, an edge with hair directly outside is where hair covers skin. It is a lower bound, even when it carries a "reliable" face-stroke label: one hair strand faked 27% narrow temples.
- **Measure outlines on exact cross-sections** (mesh edges ∩ plane). A vertex band on coarse rows reads as a ±5% staircase, and a dense target fitted onto that staircase grows lobes.
- **The skull above the ear top:**
  - Target the whole cross-section: the low-passed canonical skull × the person's traced width ratio, carried to the crown.
  - Blend from front-only to whole-section over about 0.45 face heights.
  - A short blend, two solves meeting at a junction, or a warp fighting the solve each drew a ridge from the eye to the ear.
- **One warp control per quantity.** Let the warp place features and heights, and set widths ONCE (split the lateral and vertical fields).
- **The face outline is one convex curve.** Use a least-squares concave profile over the traced levels, not independent level pieces (those leave lobes). Smooth on the chin at the chin's own scale.
- **Closed smile = seam first.**
  - One smooth seam through the traced corners, with curvature traced if the mouth is drawn as a line, else the population closed-smile curvature.
  - Low, soft lip forms that vanish at the corners.
  - No lip tubes and no chin pad.
- **One continuous nose.**
  - Fair its seat first, with plain Laplacian smoothing (Taubin is a band-pass that keeps multi-edge dimples).
  - Then tip + one nasal base + columella.
  - Nostrils are soft normal dimples, not carves.
  - Build the nose base to measure: the shared subnasale definition, solved.
- **Under-jaw:** use a thin-plate (bi-Laplacian) fairing of the down-facing surface, protected near the front outline.
- **Detectors must fail their negatives:**
  - Silhouette QA (waist, convexity, chin lobe, chin-tip exponent) and feature QA (smile edge slope, chin ridge, nose dip-and-rise) do fail theirs.
  - The jagged-lid roughness did NOT, so it is report-only.

**Clay first.** Validate geometry in one neutral clay material with neutral eyeball spheres:
- No hair, brows, iris, paint or texture (appearance hides mistakes).
- Views: front, 3/4, side, high 3/4, low 3/4, plus a close-up.
- Show source → measured map → style target → final clay, with landmark overlays and a RAW | TARGET | FINAL | ERROR table.

## Engineering rules

- **Construction by invariant beats endless repair.** Build things so they are correct by construction. For example, eyelids are a front-plane height field over a real eyeball, so the measured aperture survives exactly.
- **Turn every unknown failure into an automatic rule:** solve it once → generalise it → encode it as a detector, prevention or repair, named `FC-…` in code → future matching cases become automatic. Never fix one person by hand.
- **Deterministic and fail-closed:**
  - Rebuilds are byte-identical.
  - Every guard either passes, falls back along a documented ladder, or throws.
  - Non-finite vertices are a hard failure. JSON silently turns NaN into `null`.
- **Holdouts are tested with a frozen mechanism** (hash the code and data before building them). A holdout failure is reported, never tuned away from that holdout.
- **Identity QA is fail-closed and separate from structural QA.** Re-measure the final head against its style-translated map: widths, silhouette, chin shape, face height, the nose–mouth–chin chain and feature widths, each with an evidence-graded tolerance. A valid mesh is not proof it is still this person.
- **Diagnose drift per construction stage.** Record the same proportion map after every stage (warp+outline, basis, HD lift, features, final). Use diagnostic stage skips to see which stage makes a value — or a visual defect — leave its target, then fix that stage's mechanism. Never fix it downstream.
- **QA rules must test the real failure** (for example "eyeball visible in front of a lid along a view ray", not "closest-point sign"). Prove each new rule can fail with a negative test before trusting a pass.
- **Folds are judged per construction type.** A height-field region folds only when its front-projected triangle inverts; steep socket walls are not folds. Hidden geometry (inside an eyeball) is not visible-fold material.
- **Never rely on a "pass" without a measurement.** Report numbers, determinism, spend and what is still unsolved.
- **Dense one-line code:** never put a `//` comment in the middle of a statement; it silently swallows the rest. Run `node --check` on every edited module before building.
- **Production safety:**
  - No paid APIs or credits without explicit approval.
  - Approved/production assets are read-only calibration.
  - Protected files are untouched.
  - No commit, push or promotion unless asked.

## Review checklist (every proof)

- [ ] The proportion map is shown with evidence flags; nothing hair-bounded is treated as observed.
- [ ] The style target is shown with its learned transform and trust; weak evidence keeps identity.
- [ ] The final mesh is re-measured with the same definitions; errors are listed per relationship.
- [ ] Clay views are complete, eyeballs are visible, and there is no appearance layer.
- [ ] Structural QA passes (topology, manifold, folds/self-intersection, modules, eyeball visibility, neck); the rebuild is deterministic.
- [ ] Identity QA passes (widths, silhouette, chin shape, nose–mouth–chin, features), and the clay is free of ledges, ripples and crumples in 3/4 and low 3/4. Both must hold.
- [ ] A per-stage drift table is shown; frozen holdouts are reported as built, never tuned.
- [ ] Surface QA passes (creases, mottling, spikes, low angle, ear seams) with defect maps; the negative tests still fail.
- [ ] No name gates or per-person constants; protected and production files are untouched.
- [ ] Calibration evidence flags are shown (mirrored / quarantined), and the style-limited targets are listed with their identity values.
- [ ] The front close silhouette has been checked for cranium shoulders or steps. No gate measures silhouette curvature yet.
- [ ] What remains weaker than the approved heads is stated plainly.
