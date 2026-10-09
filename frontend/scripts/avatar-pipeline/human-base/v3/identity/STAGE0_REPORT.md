# Stage 0: illustrated image → automatic identity representation

Date: 2026-10-07. Status: awaiting Bon's visual approval. Nothing is committed or promoted, and no production files were touched. Spend: $0.

## Run

From `frontend/`:

```
node scripts/avatar-pipeline/human-base/v3/identity/run.mjs --mp=<mediapipe dir>        # extraction
node scripts/avatar-pipeline/human-base/v3/identity/stability.mjs --mp=<mediapipe dir>  # noise floor (optional)
node scripts/avatar-pipeline/human-base/v3/identity/report.mjs                          # sheets, traits, distances
```

Outputs go to `scripts/avatar-pipeline/output/human-base/stage0-identity/`:
- `stage0-review-sheet.png`
- `stage0-face-only-overlay.png`
- `identity.json` (the representation)
- `traits.json`, `distances.json`, `stability.json`

## Method

The method has one path, and every threshold is expressed in face units (IOD = 160 px canonical).

1. **Background.** Transparent inputs use alpha. Opaque inputs use the dominant top/side border colours, then extend into the backdrop's own cast shadow.
2. **Detector.** MediaPipe (Apache-2.0) only supplies the frame (iris centres) and seed regions. No output point is taken from its mesh.
3. **Canonical crop.** The image is low-pass downscaled first, then rotated so the eye line is level.
4. **Skin model.** A per-image Lab Gaussian model is built from cheek, forehead and nose seeds. A secondary tone is accepted only if it is a lighter, same-hue variant of the dominant tone.
5. **Hair layer.** Hair is thick non-skin connected to the crown zone. It is stored separately from the face.
6. **Face contour.** 96 rays from the mid-face pass through face skin. They may cross internal features only inside the eye–nose–mouth hull. A ray stops at background, hair, or a stroke into other skin (neck or ear). Each point is labelled and given a confidence.
7. **Mirror test.** A hair-bounded side that is narrower than a trustworthy mirror side is marked hair-occluded (unknown).
8. **Features.**
   - Eyes: sclera (judged relative to the person's skin) plus the thick dark iris and liner.
   - Brows: black top-hat ink.
   - Nose base: compact ink near the nose axis.
   - Mouth: the widest horizontal ink structure.
9. **Normalised frame.** Origin = measured eye midpoint, x = eye line, unit u = √(IOD × eye→mouth).

## Generalised failure classes learned (each was fixed by a mechanism, then all six were re-run)

| class | symptom | generalised mechanism |
|---|---|---|
| FC-SKIN-HAIR-TONE | Seeds landing on hair created a "skin tone" that swallowed hair (Nicole, Ali, Arisha). | A secondary tone must be a lighter, same-hue, similarly chromatic variant of the dominant tone. |
| FC-SEED-OFF-FACE | The detector's chin seed (placed for a human-length face) sat on Carl's neck, so the neck counted as face. | Face skin = components overlapping the inner eyes–nose–mouth hull only. |
| FC-BACKDROP-SHADOW | A cast shadow on an opaque backdrop was read as hair (Ali). | Extend the background into darker pixels with the same chromaticity as a chromatic backdrop colour. |
| FC-FEATURE-LEAK | Eye and brow ink bled into hair or glasses frames (Nicole, Arisha). | Opening plus an anatomical ellipse around the iris; brow ink is opened. |
| FC-NOSE-ACCESSORY / FC-NOSE-SCATTER | Glasses rims or stray shading set the nose width. | Use compact components only, near the nose axis, in the lowest band. |
| FC-ALIAS-THIN-LINES | Bilinear sampling at about 0.4× broke 1–3 px lines differently at each scale or roll. | Lanczos low-pass downscale before the rotation. |
| FC-THIN-ATTACHMENT / FC-TAPER-END | Lash, crow's-feet and crease strokes moved eye and mouth corners. | Corners = outermost columns at ≥ 20% of the widest opening; mouth ends also need ≥ 35% of the central line strength. |
| FC-LENS-TINT | The sclera behind lenses failed a fixed "white" test. | Sclera = light and much less chromatic than this person's own skin. |
| FC-THIN-LINE-BREAK / FC-SEED-OFF-FEATURE | Chris's mouth line was fragmented, and the detector's low mouth centre picked the lower-lip shading. | Close small breaks; the mouth = the widest horizontal ink structure. |
| FC-NOSE-MOUTH-CROSSTALK | The upper-lip stroke was taken as the nose base. | The nose window ends 0.08·EM above the measured mouth. |

## Results

- **Distinctness.** The 15 pairwise face-only distances range from 0.029 (Arisha–Rhendel) to 0.136 u (Nicole–Chris).
- **Noise floor.** The same image under 55% scale, 6° roll and re-framing (18 runs) gives mean 0.006 and max 0.018 u. The closest pair is therefore 1.7× the maximum noise and about 5× the mean.
- **Trait stability under the same perturbations:**
  - Inner triangle and lower-face lengths: ≤ 2.5%.
  - Face widths: ≤ 4.3%.
  - Nose width: 2.9%. Eye width: 5.9%.
  - Mouth width: 11.7% (Ali's grin creases).
- **Determinism.** A fresh run with MediaPipe re-detected gives byte-identical `identity.json` (sha256 `42d1d7ea…`), landmarks and canonical crops.

## Residuals (open; not patched per person)

- **Nicole's viewer-left eye.** It still captures a light wedge toward the hair edge, so the table uses her confident other eye. Proposed class: FC-SCLERA-SPILL.
- **Arisha.** Her viewer-right eye and brow show small spikes at the glasses hinge.
- **Hair-bounded sides.** These are medium confidence (dashed). They are consistent with the mirror side but not proven face edges.
- **The mirror test assumes a near-frontal pose.** Angled photos will need a pose-aware version.
- **Ali.** He has no file in `~/Downloads/Employee Sprite/`, so `~/Downloads/Bonfolio/Illustrations/ali.png` (house style, opaque backdrop) was used.

## Eye refinement (2026-10-07, 15:45–16:01, $0) — awaiting Bon's review

Bon's verdict was: keep the representation, but the eyes were inaccurate across several people. The face contour, mouth, nose and hair extraction were not touched, and they are byte-identical to before for all six.

**New eye model (aperture).** The eye is the visible opening, i.e. sclera ∪ iris. Liner, wings, lashes, glasses, hair, wrinkles and shading only bound the opening.
- Iris: a robust Kåsa circle fitted to the iris↔sclera boundary (23–48 edge points per eye).
- Lids: 9 samples per lid, each flagged observed or inferred. Samples are inferred where liner and iris ink touch.
- Corners: where the opening ends. A corner that runs into hair, background or the search limit is reported as not observable.
- Liner ink attached to the eye is owned by the eye, never by the brow.
- Brows: columns that depart grossly from a robust smooth fit are trimmed, and the trimmed end is flagged.

**Normalised frame.** The frame now uses the canthal centres (corner midpoints): they are gaze-invariant and stable to ≤ 1 px, whereas iris centres moved 3–10 px. Eyes with confidence < 0.5 are left out of the identity vector.

**New eye traits:**
- iris Ø relative to width and to opening
- iris vertical placement in the opening
- upper-lid peak position
- lower-lid sag and upper-lid rise
- inner-corner gap and outer span
- left/right width and openness asymmetry
- observed fraction

**Failure classes learned:**
- FC-LINER-AS-CORNER (winged liner set the outer corner)
- FC-IRIS-RUN (an iris measured from a dark run includes liner)
- FC-LINER-OVER-IRIS
- FC-LIGHT-IRIS (a grey iris passed the "white" test, so the iris boundary is a luminance drop)
- FC-SHADED-SCLERA (rejected an eye-absolute white threshold, which dropped cel-shaded sclera)
- FC-SINGLE-SEED-APERTURE
- FC-BROW-MERGE

**Results:**
- All 12 eyes have confidence 0.9 and iris confidence 0.9.
- Same-image noise: mean 0.008 and max 0.024 u (before: 0.006 / 0.018). Eye width now moves ≤ 2.6% under perturbation.
- Closest different pair: Arisha–Rhendel at 0.036 u (before 0.029), 1.5× the max noise.
- Deterministic: fresh run sha256 `8312d797…`.

**Residual.** Brow ends that touch hair or frames remain contaminated and are flagged uncertain rather than tuned: Nicole viewer-left (outer), Arisha viewer-right (outer), Rhendel (inner ends).

The sheet is `stage0-eye-closeup.png`. The before state is in `_before-eyes/`.

## Semantic eye pass: structure vs appearance (2026-10-07, 16:05–16:16, $0) — awaiting Bon's review

**Failure class FC-SHADE-AS-LID.** The opening had been defined by brightness, so two things became structure:
- the grey→white contrast edge of shading ON the eyeball (lid shadow or cel shadow) was taken as the eyelid;
- a thick lid stroke merged with the iris cut the lid through the iris.

Ali and Chris showed it most clearly.

**Structural model:**
- **Eyeball** = sclera including its shaded parts: non-skin, neutral relative to the person's own skin, not stroke-dark, opened 3×3.
- **Opening** = eyeball ∪ iris disc.
- **Lid boundary** is found by scanning outward from the opening:
  - No ink → the opening edge is the boundary.
  - Ink ≤ 0.09·IOD thick → a drawn lid line. The boundary is its centre line, and the width is stored as line weight (appearance).
  - Thicker dark → shading, not lid (flagged).
- **Over the iris** (stroke and iris ink merged, including highlight- or antialias-topped columns): the lid = the stroke's visible outer edge ∓ its half-width, interpolated from the observed columns either side (inferred). If the lid has no stroke anywhere, the iris-to-skin edge is observed.
- Iris fit, face contour, mouth, nose and hair are unchanged (byte-identical).

**Appearance layer** (kept separately; never deforms structure):
- line work: lid lines, liner, wings, lashes — band-limited and stroke-thin
- shading on the eyeball
- iris highlights
- under-eye shading/lines: thin horizontal marks, aspect ≥ 2.5
- lid crease: thin marks above the lid
- glasses/accessory: chromatic non-skin
- whether a cel-shadow split crosses the eye

**Results:**
- All 12 eyes have confidence 0.9.
- Same-image noise: mean 0.007, max 0.024. Closest pair: Arisha–Rhendel 0.036 (1.5× max noise).
- Deterministic: sha256 `c4fc3426…`.

**Limitation.** Under-eye arcs that sit inside a cel-shadow band (Carl and Chris, viewer-left) merge with the band and are omitted from the appearance layer. This affects appearance only, not structure.
