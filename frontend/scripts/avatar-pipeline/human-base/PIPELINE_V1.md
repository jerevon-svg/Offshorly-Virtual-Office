# HumanBase Pipeline V1

Universal employee-avatar pipeline: approved illustration → reference prep → Meshy image-to-3D head → `chibify.mjs`
(canonical Alex skull fit, depth band, cranium floor, hairline preservation, living eyes/lids) → `optimize-identity.mjs`.
Accepted 2026-10-04 with five employees.

## Approved production candidates

| Employee | Asset | Head tris | Total tris | Size | Body preset | Accessories |
|---|---|---|---|---|---|---|
| Bon | `public/avatars/human-base-v1/production/bon-v1.glb` | 120k | 160.9k | 1.12 MB | standard | — |
| Micah | `public/avatars/human-base-v1/production/micah-v1.glb` | 80k | 120.8k | 0.79 MB | feminine | `micah-glasses` |
| Angelo | `public/avatars/human-base-v1/production/angelo-v1.glb` | 60k | 100.7k | 0.69 MB | standard | — |
| Clang | `public/avatars/human-base-v1/production/clang-v1.glb` | 60k | 101.6k | 0.81 MB | feminine | `clang-flower` |
| France | `public/avatars/human-base-v1/production/france-v1.glb` | 300k | 340.8k | 1.86 MB | feminine | `france-hair-tail` |

Optimiser: 2048 WebP head texture, Draco. The living-eye atlas (`face_eyes_tex`) is copied back bit-exact — its alpha
carries per-texel codes and data rows and must never be lossy-compressed or resized.

## Regression baselines (local, read-only: `scripts/avatar-pipeline/output/human-base/baseline/`)

- Bon: `bon-meshy-chibi-v2.approved.glb` (ruleset v2; V1 output matches it exactly).
- Micah: `micah-meshy-chibi-v2.approved.glb` — replaced `micah-meshy-chibi-v1.approved.glb` (kept, superseded) after the
  canonical head-depth contract was accepted.
- Checksums of raws, sources, baselines and candidates: `output/human-base/v1-release/MANIFEST.sha256`; final QA sheets in
  `output/human-base/v1-release/qa/`.

## Rulesets

Bon and Micah build with `--ruleset=v2`, new employees with v3 (default). The earlier "v3 preview" heads of Bon and Micah
are retired (moved to `output/human-base/retired/`, removed from the catalogue) and are not production assets.

## Future work (not done in V1)

- **Eye layer overhead:** every head carries ~37k unsimplified `face_eyes` triangles (96×96 grid × 2 eyes). Largest
  remaining triangle saving; deliberately left alone at V1 to keep the eye/lid system stable.
- France's head stays at 300k: below 200k her face shading blotches.
- Angelo's open eye inherits coarse Meshy eye paint (source, not pipeline).

## V1.1 — universal polish / hardening (2026-10-04, local, uncommitted until approved)

Triggered by arbitrary-angle manual review of the V1 candidates. Every fix is a pipeline rule; nothing names an employee.
Rebuild everything from the local raws with `node scripts/avatar-pipeline/human-base/build-employees.mjs` (recipe:
`employees.json`; zero credits). V1 stays recoverable from commit 1a422f8 and the frozen copy in
`output/human-base/v1-release/snapshot/` (production, accessories, full-res identity heads).

**Layered hair** (`hair-layers.mjs`). An identity is no longer one fused surface: `identity_head` (skin) +
`identity_hair_scalp` (hair on the canonical skull) + `identity_hair_main` + `identity_hair_fringe` + `identity_hair_back`
(below the jaw), one shared texture/material. The FRINGE is foreground: hair over the face footprint (mirror-closed, so
a lock over one side is found from the other) that is rooted in the hair mass or clearly stands off the face. It is
lifted (obstacle-constrained, zero at its root unless the root itself sits in the skin) in front of the face, the real
head surface and every visible living-eye texel; its free edges get a hair-coloured wall; strands carrying projected
face/eye paint are repainted in the hair colour; it is rigid on Head near the face. Under a lock that was fused into the
face, the face is rebuilt as an UNDERLAY (flattened onto the face surface, skin colour continued harmonically), and an
eye partly under it is completed from its mirror twin. Painted features (iris, liner, brows) and lash/lid sculpt wholly
inside the eye zone are never fringe; lash fins are pressed onto the face (`flattenEyeSculpt`) — the shell draws the lash.

**Tied hair** (`build-hair-tail.mjs` rewrite + `--tie=low|mid|high` in chibify). Back hair below the tie is gathered up
and in, back hair above it is combed toward the tie (kept outside the canonical skull); the accessory is a gather surface
(converging clumps) → tie band → lobed, tapered ponytail mass with a 3-joint chain. France: `--tie=low`.

**Hairline** (`hairlineMap: "rotate"`). The preserved hairline height is reached by rotating about the skull centre, not
by moving vertices straight down — front hair keeps its curvature and thickness (no flat slab / step behind the hairline).

**Canonical skull width** (CLI). The ear-span fit is verified on the OUTPUT and refitted until within ±1.5%. Clang's right
ear was hidden under hair at measure time → V1 head 8.4% oversized (now ×0.917). Others unchanged (100.0%).

**Closure** (`head-closure.mjs`). `baked_interior`: the canonical Alex head shrunk, per direction, 1 cm-eq inside the
nearest identity surface — closes every view into the head (V1 showed the inside of the face from below/behind) without
any outer geometry. Hair shells shade their inside as a shadowed underside (runtime).

**Seam-safe atlas** (`atlas-repack.mjs`). Generated textures pack islands edge to edge; every island now gets a 6 px
gutter of its own edge colour (texel-exact translation; 2112–3008² → 2048 in the optimiser).

**Eyes.** The dashed line along the top of every eye box was the shell sampling the atlas's data rows — discarded in the
shader. The shell's depth bias is constant (no slope factor: it pulled the eye through bangs/nose at oblique angles). The
open eye shades with the shell's smoothed surface (no lumpy eyeball); lids keep V1 shading.

**Glasses** (`humanGlasses.ts`, `build-glasses.mjs` rewrite, `glasses-styles/`). Modules are authored in FIT SPACE (`_GFIT`)
and fitted at equip time to the wearer's `landmarks.glassesFit` (face height field, face half-width, side profile, ears):
rigid frame, hinges just outside the temples, lens plane in front of the eye area, wrap following the face, the smallest
forward offset + pantoscopic tilt that clears cheeks and nose, temples along the head side to the ear and tucked behind.
Any style on any identity (`glasses-rect` universal frames; `micah-glasses` from her illustration).

**Head width investigation.** Clang: real skull-size bug (above). Angelo: skull canonical (100.0%), face aspect equal to
Bon/Micah, jaw ratio 1.15 ≈ canonical Alex 1.12 and his broad-jawed sprite; temple hair excess 0.119 vs approved Bon
0.122 — no universal hair rule separates them (`hairSideCeiling` kept, off). His breadth reads from the grin + identity jaw.

**QA.** `human-base-qa.html?humanbase=1` (dev viewer: orbit, 360° view set, eye states, gaze, hair motion, head turn,
accessories, layer/wire debug, `&src=v1` for the frozen V1). `qa-360.mjs` (orbit / eyes / close-up sheets on the optimised
files) and `check-identity.mjs` (closure, fringe vs face/eye, runtime-fitted glasses, accessories vs skull, skull width).

### V1.1 hardening, round 2 (whole-avatar polish)

**Eye-depth contract** (`eye-socket.mjs`). Generated eyes were balls standing 0.03–0.15 in front of the local face (France
0.12 → bulging plates from ¾/side). Per eye: a SOCKET SURFACE (harmonic fill from the real skin ring round the eye); eye
and lids may rise above it only by a bounded cornea dome (+ a small lid allowance) and sink no deeper than a bounded
recess (soft knee — shape and spacing kept, only depth normalised). The shell lies on the seated eye with an absolute
2.5 mm-eq lift; the published eye half-height is bounded by the eye width (0.3–0.75).

**Skin stage** (`skin-clean.mjs`). Baked shading out of the texture: the low-frequency skin luminance is evened toward the
face's own median (3D-smoothed per-vertex field, rasterised over skin-coloured texels only, hue-preserving — paint,
brows, lips, freckles untouched); a gentle Taubin pass on skin away from the features (eyes, nose, mouth, ears) and an
isolated-spike filter. Hair-shaped geometry painted with skin colour (standing off the skull behind the face) is hair;
every hair layer's face-painted texels are repainted in the hair colour (no pink streaks).

**Neck / jaw contract.** The canonical HumanBase neck is the neck: generated throat skin below the canonical jaw
underside (in front of the neck column) is pressed onto it; a fused lock's underlay never extends below the jawline
(France's "thick neck" was underlay rebuilt under her side lock).

**Coherent hairstyles.** Tied styles also comb the SIDE hair (behind the face plane, below the tie) back toward the tie;
France: mid tie, fuller tail. Hair relief: painted flow → a few sculpted clumps, gated by measured lock-scale detail —
only smooth caps receive it (Micah full, Clang half, Bon/Angelo/France none: their hair is already sculpted).

**Garment fitting contract + default uniform** (`build-human-garments.mjs --only=tee,joggers`). Tee v3: hangs from the
chest (no waist suck-in), the hem continues the torso (no hoop), the crew collar follows the measured neck/trapezius
profile, sleeves end mid upper arm, pinholes closed. NEW `joggers-offshorly`: one closed solid (pelvis column ∪ baggy leg
tubes along the measured leg axes, continuous crotch fillet, two-leg crease), gathered rib cuffs, rib waistband, thigh
logo. `OFFSHORLY_UNIFORM` (humanCatalogue.ts) = ink tee + black joggers + chalk clogs for Micah, Angelo, Clang, France;
Bon keeps hoodie + denim shorts + clogs (approved; not rebuilt). The catalogue keeps every garment.

**QA.** Viewer adds body close presets (neck, collar, shoulders, waist, crotch, seat, hands, sleeves, ankles), eye high/low,
fringe views, behaviours (idle, walk, run, turn, sit, chin, typing, scooter, agree, listen) and a pose-time garment ↔ skin
check. `qa-360.mjs` sheets: orbit, eyes (6 states + 5 gazes × 7 views), close-ups, body, behaviour (+
`behaviour-garment-check.json`). `check-identity.mjs` adds static garment checks (open loops, pinholes, loose threads,
degenerate triangles).

### V1.1 hardening, round 3 (tied hair, skin integrity, highlights, default outfit, accessory contract)

**Tied hair (France; any ponytail / bun / half-up).** Root anchoring: the tie gather and side comb move only hair, and
moving hair-labelled vertices alone stretched every mixed hair/skin triangle at a hairline into spikes (≈2 700 on France).
The move now ramps in from 0 over 4 cm-eq of geodesic distance from where hair leaves the skin (`hairRootWeights`);
detached strand shells move whole. Hair BASE CAP (`identity_hair_base`): a continuous closed layer under all hair from the
crown to the hairline, never in front of any hair, over exposed scalp, tucked behind the ears; for tied styles the line
runs above the ears at the sides and down to the neck junction at the back centre (a deliberate nape hairline) — no
scalp/neck gaps behind the ears. The tail builder's root has believable volume.

**Skin integrity — root causes found.** (1) Angelo's rough band along the jaw / under the chin was NOT texture: the round-2
jaw contract projected the generated throat onto the canonical underside (stacked, sheared, folded skin — 160–210 flipped
triangles per head); France's "thick neck" it was meant for was the lock underlay (fixed by `minUnderlayY`). The contract
is OFF (kept as an option: monotone, bilinear, edge-faded press + neck taper). (2) The tee COLLAR was a jagged ribbon:
its radius came from binned radial maps (sawtooth) and its weights jumped between bones across the chest/neck boundary —
the profile is now smoothed round the ring, overlaps the torso edge by 1 cm, and `assemble` smooths a part's weights over
3 cm (`weightSmooth`). Bon's faceted lids: edit blending. (3) Fringe strand tips / hairline roots a few mm inside the frontal face (Bon, Clang,
France): a final clamp after the lift puts any fringe vertex 5 mm–3 cm inside the frontal face 2 mm-eq in front of it. Diagnosis tools: viewer debug `tex` (unlit texture vs
geometry), `__qa.hide(prefix)`, neck-join views; `garmentCheck` now counts cloth inside the identity head's skin too.

(4) Nape / back-of-head blotches exposed by tied and short styles (generation residue where hair used to be): skin texels
behind the ear plane and below the eye line (ears excluded) are blended to the measured skin tone. (5) Tied nape hairline:
the hair base line is found on the ACTUAL skull surface per azimuth (a nominal-radius conversion left the lower back bare).

**Hair-flow highlights.** A flow field from the actual hair (root → tip, crown, parting, tie direction, down the tail) +
a restrained anisotropic lane highlight in the person's own lighter hair colour; strength gated by the source paint's own
highlights (Bon 0.45 — never a double highlight; flat black hair ≈ 0.96).

**Default outfit.** `OFFSHORLY_UNIFORM` = black Offshorly tee + black baggy joggers + NEW clean white `sneakers` (a sculpted
closed-solid low-top on the measured HumanBase foot: midsole with toe spring, domed upper, toe cap / heel counter, laces,
collar sized from the ankle and kept below the jogger cuff so the cuff rests on it). A default, not baked: every slot stays
editable; Bon keeps his approved outfit.

**Accessory attachment contract** (`humanAccessoryFit.ts`). Identities publish SEMANTIC anchors (`landmarks.attach`): ears
(root/outer/top/lobe/back), nose (bridge/tip), crown, forehead, and the head ENVELOPE (outer head+hair radius per direction
+ a skin-only map; outer = the 85th-percentile radius, so stray strand tips never set it). Anchors live in
`attach-anchors.mjs` (also a CLI that republishes them on existing heads in seconds); an ear is MEASURED only when it passes
a sanity check (reaches the measured ear extreme, 8–30 cm-eq tall, centred on the eye line), else canonical chibi ear
proportions projected onto that head's own skin. Hair accessories slide (≤ 30°, toward the crown) to the nearest direction
that actually has hair. Modules declare where they attach and are authored in that region's frame: glasses (fit space), `hair`
(a direction on the outer hair envelope — clips, flowers), `ear` (earrings), `envelope` (hats, caps, bands — conforming to
the actual hairstyle + clearance), `ears2` (headsets). `checkAccessory` validates every fit (inside skin, lost in hair,
floating, oversized, pieces). GLASSES (rewritten fit): one UNIFORM scale (a round frame stays round) from the eyes, lenses
centred on the pupils, the bridge adapts (bounded widening for a prominent nose), lens plane from lash/lid clearance, bridge
resting on the measured nose bridge, bounded lift + pantoscopic tilt before any forward push, temples over the wearer's own
ear top and tucked behind it. All four glasses styles (rect, classic, Micah's round, Bon's frames) are fit-space modules
now; the clang flower is an envelope-anchored module. `check-identity.mjs` fits EVERY glasses style and every attached
accessory to EVERY identity; `qa-360.mjs --sheets=accessories` writes `accessory-fit-<id>.png` (the same accessory on all
five, 7 views) and a contract demo (headband / earrings / clip, procedural) with `accessory-contract-demo-check.json`.

## V1.2 — foreground fringe separation, error-balanced optimiser, neck/jaw, tied hair (2026-10-05, local, uncommitted)

Every rule below is universal (nothing names an employee). Rebuild: `node scripts/avatar-pipeline/human-base/build-employees.mjs`
(outputs/logs now in `output/human-base/v1.2-release/`). Dev iteration: `chibify.mjs … --fit-from-previous` runs ONE pass with
the skull/depth factors of the last full build (never used by the release build).

**Bilateral symmetry decides painted features vs locks** (`splitHair`). The positional tests ("inside the eye zone, flat on the
face → iris/liner/brow paint", "wholly inside the eye zone → lash sculpt") were satisfied by a lock fused across ONE eye — that
was why Clang's and France's locks stayed baked into the eye. Painted features come in mirror pairs: a front map of the visible
face sheet marks hair-coloured surface; a point is SUPPORTED when hair paint lies within `symTol` of its mirror point about the
face's OWN eye midline (generated faces are off-centre: Angelo's midline is x = −0.018). A side whose eye/brow zone shows more
than `symContam` eye-areas of visible twinless hair is CONTAMINATED (measured: clean heads ≤ 0.12, Clang 0.90, France 1.69;
threshold 0.3). On a contaminated side nothing hair-coloured is trusted as paint, there is no eye-sculpt exemption, and every
hair piece with twinless surface is the lock (flat painted strands included — the hairstyle keeps every strand). Both sides
covered (symmetric curtain bangs) = no twin: the V1.1 positional/relief rules decide, as before. Diagnostic:
`HB_LAYER_MAP=<png>` writes the front role map (skin / hair left in head / paint / eye sculpt / lifted fringe / fused fringe /
twinless).

**Thin fused strands get an underlay.** "Real skin behind the lock" is now tested behind each vertex at its exact spot; the old
3×3-cell neighbourhood always found skin BESIDE a 1–2-cell strand, so thin strands were removed from the face with nothing
under them (the slit/crease along every strand).

**Mirror-twin face rebuild** (`transplantTwinGeometry` + `rebuildFaceTexels`). Under every fused lock, and over the whole eye /
lid / brow zone (and the fringe footprint) of a contaminated side, the face is rebuilt from its twin: depth = the twin surface
(full weight inside, 4-ring ramp at the border, welded; x/y never move — unfolding slivers would smear their texels), normals =
the twin surface's; texels = the twin's texel at the mirrored 3D point (exact barycentric lookup) + a gradient-domain seam
correction from the border's skin difference; fallback = harmonic skin fill. Runs before the living-eye bake, so the eye shell is
baked from the rebuilt eye. QA contract: hide `identity_hair_fringe` → a complete face with two complete eyes.

**The fringe owns its texels** (`fringeTexturePage`). `identity_hair_fringe` has its own small texture page (Clang 448², France
768²): its islands copied texel-exact from the texture AS GENERATED (before any rebuild), with face-painted texels (skin, eye
white, lid paint projected across a strand) replaced by hair colour. The face beneath can be rebuilt freely; the head atlas no
longer packs lifted fringe islands. The optimiser compresses the page without upscaling it.

**Painted features live in the face layer.** Brows / iris / liner triangles and pressed lash sculpt are `identity_head` (texel-exact
paint), not hair-scalp meshes subject to hair repaint.

**Error-balanced optimiser budget** (`optimize-identity.mjs`) — the Bon shading regression. V1.1 split the hair into layers and
simplified every layer with ONE shared ratio: Bon's 254k-tri face was crushed to ~10% like his 920k-tri hair → faceted cheeks,
nose and jaw (the unoptimised identity was clean). The budget is now spent by geometric error: one bound ε for every layer, the
face held to 0.35·ε, ε found by bisection to meet the target. Bon at 120k: face 63k tris (was ~25k). The same cause produced
France's "face blotches below 200k".

**Jaw underside residue.** Downward-facing skin below the mouth is blended to the measured skin tone like the nape (generation
residue of the cut throat), and relaxed (`relaxUnderside`: Taubin on welded positions, faded in below the jaw contour).
`filletOver` gives the neck extension a flare that tucks past the head's open rim.

**Tied hair** (`build-hair-tail.mjs`). The gather's lower half now reaches the measured nape (elevation solved on the actual
surface by bisection — the back curves in to the neck) and wraps further round behind the ears; the ponytail is five
overlapping tapered locks (own roots inside the tie, different length / curvature / twist, crest highlight root → tip) round a
hidden core, all on the shared 3-joint chain.

**Runtime.** Garments thicken the clearance envelopes by their MEASURED standoff per covered region (`garmentStandoff`: same
percentile/segment method as the body envelopes) when it exceeds the catalogue thickness — baggy joggers keep idle hands out.
`HumanAvatar.apply()` refits glasses and attached accessories after all slots load (load-order independent).

## V1.3 — final hardening: layer ownership, clean skin, garment closure (2026-10-05, local, uncommitted)

All rules universal. Root causes were found by bisection on the real files (debug envs: `HB_LAYER_MAP`, `HB_TRACE=x,y,z`,
`HB_TRACE_HEAD`, `HB_NO_TWIN`, `HB_NO_TG`, `HB_STRIP_RED`; QA viewer `__qa.camCustom()` / `__qa.pick(px, py)` → mesh + face).

**Covered eye = mirrored twin geometry, not repaint** (`buildTwinPatch`). On a contaminated side the eye / lid / lash / brow zone
(grown 30 %) is replaced by a mirrored copy of the twin side's FINAL triangles (face skin + painted features), same texture
coordinates (texel-identical, no resampling), winding reversed, own `identity_face_twin` mesh (face material, no shadow casting).
Own face triangles the patch fully covers are dropped; its rim is blended onto the own surface (depth + normal ramp). The bake rasters
the patch, so the living eye shell is the twin's clean eye. Fringe OFF = complete face; fringe ON = the same face, occluded.
The V1.2 texel mirror stays for the underlay (it now skips texels any surviving surface shares, and reads skin/feature surfaces only).

**Ownership fixes that removed visible artifacts**
- Lock leftovers outside the patch become face only ON the face footprint above the jaw; elsewhere they keep their hair layer
  (France's skin-coloured fin under the jaw).
- Mixed hair/skin border triangles below the jaw belong to the hanging hair, never the face.
- Fused-lock underlay only where the face surface is defined behind every vertex, never below the head's own jaw.
- Leftover strips that became face: harmonic depth fill from their face-attached rim (depth only) + local skin paint.
- Mouth shell grid only over real face surface (it stood out past the chin as an invisible plank that cast a shadow).
- Atlas repack: zero-area UV triangles still own the texels they sample; islands keep texels they share (Clang's brown brow window).

**Face-framing locks keep their length** (haircut). The U compression + end curl only shape hair behind the ear plane; a long
front lock was squashed into a horizontal blade under the jaw. France's side lock is now a long tapered patilya.

**Tied hair**: side comb only behind the ear plane; base cap reaches the measured nape; the real ear box decides the ear tuck;
stretch invariant removes tie-torn triangles.

**Clean skin contract (shared base bodies)** — `repair-base.mjs` (idempotent; run on both presets): the white specks on hands /
knuckles / wrists were real HOLES: seam-drift split vertices (720 standard / 1229 feminine welded), 3-vertex bow-tie holes, slits and
pinholes filled. Runtime: one skin binding + area-weighted normal per position (no crack when posed), skin texture variation clamped
to ±10 % (stray texels no longer become dark specks).

**Garment closure contract** — `repair-base.mjs --garments` on every garment module: zero-area triangles and fragments out,
T-junctions split, ≤ 11-vertex holes (incl. bow-tie) filled; never welds layers; index buffer only (design unchanged, Bon's outfit
included). Hoodie small holes 26 → 0, tee 8 → 0. Garment shader: a triangle straddling the no-decal UV sentinel never samples the
print (the grey/white specks on Bon's hoodie).

**Seam weld** (`weldSeams`, rule `seamWeld`) exists but is OFF: welding split copies to the most-edited one creased the face.

## V1.4 — final wrap-up rules (2026-10-05, local, uncommitted)

**Facial features are rigid** (root cause of every "brow gap"). Brows / liner / lash sculpt are hair-coloured, land in a hair layer
and were weighted onto the hair-motion chains: at runtime the brow drifted off the face and the interior showed through. Every
feature vertex and every non-fringe hair vertex on the face footprint or brow band is skinned 100 % to Head.

**Brow repair** (skin stage): consolidation (mid-tone / saturated brown brow interiors → the brow's own dark colour) + morphological
closing of the brow mask (texture-dark ∪ hair-layer brow coverage, 7.5 mm-eq) fills enclosed pale gaps — the employee's own
brow shape is kept (only enclosed gaps change). The living-eye bake sees the hair repaint of brow-band hair geometry.

**Head rim tuck + closure clip** (Bon's jaw). The head's open underside rim (per vertex: skin boundary below the mouth near the
neck axis) is smoothed and tucked inside the neck column; displacement diffused over 8 rings. The neck "fillet" is OFF (it flared
outward). Closure geometry (interior, skull-base filler) below the head's own underside, outside the neck column and IN FRONT of the neck axis (the jaw band) is clipped — behind the neck it is what keeps the head closed from below;
the skull-base filler is clipped by the same rule (omitting it opened views into a canonical-fallback-neck head).

**Base-cap pocket closure** (France). Uncovered side/back runs bounded by hair or cap on both ends (≤ 45° per row, ≤ 14 rows per
column, behind ear plane + `capPocket`, never the ear box) are covered by the base cap.

**Face hole invariant.** Small boundary loops on the face front (eye openings excluded) are closed (`baked_holefill`, loop colour).

**New automated invariants** (`check-identity.mjs`, part of PASS): `featuresOnHairJoints` (brow-band hair vertices not 100 %
Head = 0), `faceHoleVerts` (skin-only boundary on the face front, outside the twin patch — informational: generated heads keep legitimate open edges), `closureBelowJaw` (closure
triangles below the head underside outside the neck column, < 40), `baldPocketCells` (side/back skin enclosed by hair in the
outer radial map, < 20). With the V1.1–1.3 checks (closure, fringe into face / eye through hair, glasses & accessories inside
skull/face, skull width, garment holes / fragments / degenerate) these cover the failure classes found on the first five.

**Failure classes → protecting rule** (for employee #6+):
| Failure | Rule |
|---|---|
| fringe mistaken for eye paint | bilateral symmetry contamination test (V1.2) |
| eye/skin pixels in hair, face under bangs incomplete | fringe texture page + mirrored twin patch (V1.2–1.3) |
| bald side / nape pockets | base cap to measured nape + pocket closure (V1.3–1.4) · `baldPocketCells` |
| broken tied-hair gather | side comb behind ear only, stretch invariant, front locks keep length (V1.3) |
| optimiser destroying the face | error-balanced budget, face ×0.35 (V1.2) |
| eye shells at grazing angles | constant depth bias, eye-depth contract, shell yields to geometry in front (V1.1–1.3) |
| rough jaw / head-neck seam | rim tuck + closure clip (V1.4) · `closureBelowJaw` |
| dirty / holed body skin | `repair-base.mjs` + seam normals / weights (V1.3) |
| garment holes / fragments / print specks | `repair-base.mjs --garments`, decal straddle guard (V1.3) |
| garment / body penetration | measured garment standoff (V1.2) · behaviour garment check |
| accessory anchors inside skull/face | ear mirror pair, never medial, face surface incl. patch (V1.2–1.3) |
| brow gaps | rigid features + brow closing (V1.4) · `featuresOnHairJoints` |
| UV / seam artifacts | seam-safe atlas incl. zero-area / shared texels (V1.1–1.3) |
| floating mouth-shell plank | mouth shell only over real face (V1.3) |

**Nape skin — the rear closure is a real exterior surface** (`napeSkin`, V1.4 final). Root cause of the blotchy / ragged rear
underside: the canonical cut removes the generated nape, and that region was "closed" only by the interior shell (shrunk 1 cm
inside every jagged surface → lumpy) and the Alex skull-base filler (poking through); hiding them showed the face from inside
(Micah 1.39 % open). Now, in a radial map about the skull centre, every direction below the eye line gets one smooth skin
surface: behind the ear plane radius = max(canonical skull, smooth upper envelope of the identity skin + 2.5 mm), starting 4
rows above the base cap's hairline (tucked inside skin there); in front of the ear plane only below that column's own jaw rim,
inside the jaw skin (the approved jaw shape is kept; columns whose rim already tucks into the neck are skipped). Every column is
eased onto the HumanBase neck column (join row smoothed round the neck, below the neck-extension top) and resampled to a regular
36-row grid (no stair-steps → no radial streaks). Generated skin flaps standing out of it are pressed 3 mm-eq inside (flap press);
the skull-base filler is dropped and redundant interior below the neck-extension top is clipped.
Invariant `exposedInteriorPct / exposedInteriorWorstViewPct`: orthographic z-buffers from 48 underside / low-rear / low-side
directions on the shipped file; % of head pixels below the eye line whose first surface is closure geometry (outside the neck
tube). Diagnostic: `HB_EXPOSED=1` lists the exposed hit points.

## KNOWN FAILURE ≠ MANDATORY REPAIR (2026-10-05, supersedes "every rule is universal")

The universal `napeSkin` closure regressed all five employees (artificial rear panels, ear→jaw stretching, nape seams) and was
withdrawn. Generated identity heads are heterogeneous, so the pipeline is:

GENERATE → ANALYSE THIS EMPLOYEE → DETECT FAILURE CLASSES → APPLY ONLY THE REPAIRS THIS EMPLOYEE NEEDS → VALIDATE → PRESERVE
EVERYTHING THAT ALREADY PASSES.

- A learned fix is a reusable **conditional repair recipe**, not a stage every head goes through.
- Gates, in order of preference: (1) a measured detector inside the stage itself (fringe → bilateral symmetry contamination; twin
  patch / face rebuild → contaminated side; base-cap pocket closure → enclosed pocket ≥ `pocketMinCells`; brow closing → only
  enclosed gaps change; face-hole fill → only real holes); (2) where no detector separates need reliably, the employee's recipe
  (`employees.json` → `repairs`, passed as `--repairs=name:0|1`), decided from that employee's visual QA.
- Current recipe repairs: `rimTuck` (head underside rim tuck + jaw-band closure clip) — Bon, Angelo, Clang, France; NOT Micah
  (no visible difference → preserved). `napeSkin` — nobody. The logged `rim detector: jaggedness` did not separate need on the
  first five (Bon 0.33 needed it, Micah 0.48 did not) and is diagnostic only.
- Rule for employee #6+: build once with conditional repairs off, run `check-identity.mjs` + the QA sheets, enable only the recipes
  whose failure is actually visible, rebuild that employee only. A repair that changes regions it was not enabled for is a bug.
