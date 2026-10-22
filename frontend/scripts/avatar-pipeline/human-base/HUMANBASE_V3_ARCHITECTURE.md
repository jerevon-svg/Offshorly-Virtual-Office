# HumanBase V3: Architecture Decision Report (upload → voilà)

2026-10-07 · research and decision only. Nothing has been implemented, committed or spent. This file is new and untracked.
Inputs: the repository (`human-base/*`, `src/dev/vo3d/human/*`, fixtures, batch-2 review sheets), the approved sprites
(`~/Downloads/Employee Sprite/`, 24 people, 7 with raw photos), the raw Meshy heads (10 employees, already paid for), and a
web survey of current tools and licenses (sources at the end).

---

## A. Executive conclusion

**Recommendation: a canonical-construction hybrid ("scan-wrap").**

- **Generated meshes stop being production geometry.** Meshy (or any image-to-3D output) becomes *identity evidence*, the way
  a scan is in a film pipeline.
- **One designed head for everyone.** Every production head is the same HumanBase head topology: closed skull, ears, eye
  sockets, closed mouth, a neck ring identical to the body's, fixed UVs, landmark vertex IDs, morph targets and rig weights.
- **Identity comes from fitting, not from the source mesh.** The head is deformed toward the employee by a bounded,
  style-constrained fit. It is textured by baking the evidence (and the approved illustration) onto the fixed UV.
- **Hair, facial hair and glasses are modules built on the canonical skull** under clearance constraints. Nothing is cut out
  of a fused surface again.

**Why.**

1. **Every Kael/Lui-class defect comes from cutting and relabelling an arbitrary fused surface.** On a fixed topology there is
   nothing to cut. The skull is always whole, an ear is always an ear, and the neck seam is the body's own.
2. **We have already built both halves, separately, and each failed on the other half.**
   - Phase 3A/3B (`build-canonical-head.mjs`, `fit-identity.mjs`, `build-hair-medium.mjs`) proved *construction*: a closed
     canonical head, morphs and SDF hair. It failed on *identity*: 10 sliders plus procedural paint looked generic, and
     "procedural paint can't match production's painted textures".
   - Pipeline V1/V2 proved *identity*: Meshy relief and Meshy's painted texture. It fails on *construction*: 22 failure classes
     in three days, three of them with no detector.
   - V3 joins them: canonical topology, fed by dense identity (registration residual plus baked painted texture). This is the
     standard production "wrap" workflow (scan → base mesh → texture transfer).
3. **Industry precedent.** The stylized avatar systems that run at scale (Memoji, Bitmoji 3D, Meta Avatars, Ready Player Me,
   VRoid) use one canonical head, parameters, and modular hair and accessory libraries. None of them ship per-user generated
   topology.
4. **Runtime.** About 10k head triangles instead of 60–300k (plus 37k eye triangles), shared index and UV buffers across all
   employees, and facial animation that can be authored once for everyone later.
5. **Edit Avatar becomes a parameter editor**, not a regeneration.

**Identity is anchored on the approved Offshorly 2D illustration.** That is the artist's identity → style decision, and it
already exists for 24 employees. It is anchored neither on the raw photo nor on Meshy. Identity is checked with
*discriminative* tests ("does this render pick out its own employee from the roster?"), never with "looks good".

**Meshy becomes optional evidence.** The proof needs zero credits because the raw heads are already on disk. The proof also
measures whether 3D evidence is needed at all (a 2D-only fit vs a fit with 3D evidence). TRELLIS.2 (MIT) is the open
replacement candidate.

**What happens to the current code.**

- **Keep:** body, rig, animations, hands/IK, garments, the runtime composer, glasses fitting, the living-eye system, the
  mounted gate, fail-closed promotion, the registry and fixture discipline, the lineup/QA tooling, and chibify's *style rules*
  (rewritten as maths on the canonical domain).
- **Retire:** the whole topology-repair layer. That is the hair/skin split, canonical cut, closure shells, base cap, pocket
  closure, rim tuck, jaw clip, nape skin, the relabels and the twin patch — most of `chibify.mjs` + `hair-layers.mjs` +
  `head-closure.mjs`.

---

## B. Current pipeline autopsy

### What is fundamentally right

| Asset | Why it is sound |
|---|---|
| `humanBaseContract.ts` (skeleton, slots, sockets, `HeadMount`, `HUMAN_BUDGETS`) | Contract-first runtime; it already assumes modular identity, hair and accessory slots |
| Body, rig, clips, hand/IK, `humanClearance`, garments + `repair-base` | Shared, measured, live for five avatars, with local/remote parity |
| `gate.mjs`, `promoteCandidate`, hash-bound `approvals/`, build stamps, `fixtures/` (positive + negative), `pipeline-contract.test.mjs` | The right *process* scaffolding for fail-closed automation |
| `CHIBI_RULES` (skull from ears, multi-band damping, bounded eye enlargement, projection, lower face, hairline, long-face retention) | Good *style* knowledge. Only the domain it runs on (an arbitrary mesh) is wrong |
| `prep-reference.mjs`, `svg-strip-layers.mjs`, `illustration-traits.mjs`, `fit-identity.mjs` | The illustration is treated as the identity source, and it is measured, not eyeballed |
| Living-eye system, equip-time glasses fit (`humanGlasses.ts`, `_GFIT`), SDF lock hair language | Modular and parameter-driven: the V3 philosophy already |

### What is fundamentally wrong

1. **Topology is an input, not a design.** Each Meshy head arrives with unknown topology: about 10k UV charts, with
   hair/skin/glasses/collar fused. Every invariant (closed skull, ear boundary, nape, neck seam) has to be *re-established by
   repair* for every person. The failure space is open-ended: 22 registry classes, FC-EAR-BOUNDARY / FC-NAPE-ROUGH /
   FC-HAIR-SPIKE with no separating detector, and `napeSkin` regressed all five.
2. **Segmentation deletes triangles using per-vertex colour labels.** Layer boundaries can only follow existing triangle
   edges, so staircase hair/skin and ear boundaries are guaranteed by construction, not by accident.
3. **A Meshy head has no skull under its hair.** The pipeline synthesizes one from stacked proxies: the interior shell (the
   Alex head shrunk 1 cm inside a jagged surface), the skull-base filler, the base cap, nape skin and `keepOwnUnderside`.
   These proxies overlap and show through gaps.
4. **Repairs interact.** Rim tuck vs closure clip vs nape skin vs pocket closure: fixing one head breaks another. The
   per-employee `historyRepairs` recipe is the symptom.
5. **Validation is proxy-based and doesn't separate visible from invisible defects.** It measures closure % below the eye line
   and island counts, with thresholds tuned on five heads. France at 3.6% was approved; Kael/Lui at 1.5–1.8% were rejected.
   Kael and Lui both *passed* automation.
6. **The envelope is a set of independent 1-D bands** (face-length band ∩ skull-width band). Their intersection is empty for
   legitimate long, narrow faces (Nicole).
7. **Identity is never measured.** Gates check geometry; recognisability is judged by eye.
8. **Runtime cost.** 60–300k head triangles + 37k eye triangles per head; five avatars ≈ 1.78M coworker triangles and 15–18
   draws each.

### B2. What caused the Kael/Lui class (Q2)

Each step below is locally reasonable. The composition is the defect:

1. **Meshy returns one fused surface.** The hair is a thick shell with no skull under it, and the nape is generated anatomy.
2. **The cut removes real skin under short hair.** chibify labels vertices hair or skin by texture colour. The canonical cut
   then deletes everything below the Alex underside (`nape++; return 0`), including the real skin beneath short hair.
3. **The triangle split creates jagged edges.** `hair-layers` splits the fused surface by triangle into scalp / main / back:
   - mixed triangles produce a staircase lower hair edge;
   - an ear boundary is a colour edge running *through* triangles, so it comes out jagged;
   - hair crossing an ear can't be separated from the ear.
4. **The hole is closed from inside and shows through.** `interiorShell` is lumpy because it follows a jagged surface 1 cm in.
   It is visible through the gap between `identity_hair_scalp`'s lower edge and the trimmed nape. That is what reads as "skin
   patches / loose fragments under the rear hair" (proved by hiding layers on 2026-10-06).
5. **The neck ring.** The generated neck wall is removed, a funnel is built to the HumanBase neck, and the rim is tucked. The
   result is a seam that is *near* the body's neck ring but is not the same vertices.
6. **The gate missed it.** The gate counted closure only below the eye line, so the defect passed.

**Conclusion:** the defect class is intrinsic to subtractive segmentation of fused, generated topology. More detectors would
only chase its instances.

---

## C. State of the art: tools and findings

Verdicts: **USE** (deployable, recommended), **STUDY** (architectural inspiration or a candidate to evaluate),
**REJECT** (licence or fit).

### Construction / geometry

| Candidate | What / why it matters to us | License (code / weights) | Hardware | Verdict |
|---|---|---|---|---|
| Non-rigid template registration (optimal-step NICP, ARAP, Laplacian/biharmonic): `trimesh` (`nricp_amberg`/`nricp_sumner`), `libigl` | The core "wrap the canonical head onto the evidence" operation | trimesh MIT; libigl MPL-2.0 | CPU, seconds | **USE** (or our own JS solver) |
| R3DS **WrapX** | Industry-standard wrapping tool with a Python API (wrap, project, texture transfer) | Commercial, paid | CPU | **STUDY**; buy only if our solver stalls |
| **manifold3d** | Booleans and SDF level sets with guaranteed-manifold output; has JS/WASM. Hair/beard shells, ear subtraction | Apache-2.0 | CPU / WASM | **USE** |
| meshoptimizer / gltf-transform | LODs, simplification, quantisation (gltf-transform is already used) | MIT | CPU | **USE** |
| Instant Meshes | Field-aligned remeshing of hair shells | BSD | CPU | STUDY |
| Blender `bpy` | Authoring/baking the canonical head; optional batch baking | GPL tool, outputs unrestricted | CPU | STUDY (authoring) |
| PyTorch3D / Mitsuba 3 | Differentiable rendering, if silhouette gradients prove necessary | BSD | CPU/GPU | STUDY |
| nvdiffrast | Fast differentiable rasteriser | NVIDIA "1-Way Commercial": research/evaluation only | CUDA | **REJECT** for production (also check it isn't pulled in transitively, e.g. by TRELLIS baking) |

### Head / face models and landmarks

| Candidate | What / why | License | Hardware | Verdict |
|---|---|---|---|---|
| **MediaPipe Face Landmarker** | 478 3D landmarks, 52 ARKit-style blendshapes, head pose. Input gating, photo traits, expression neutrality, future viseme naming | Apache-2.0, code **and** weights | CPU/WASM; runs on this Mac and in the browser | **USE** (still to verify on flat illustrations) |
| **FLAME 2023 Open** | Realistic parametric head: closed head with ears, eye sockets, jaw and neck. Candidate *base topology* to wrap onto the Offshorly family mean, and a photo shape-measurement space | **CC-BY-4.0** (older FLAME versions are non-commercial) | CPU | **STUDY → possible USE** (verify contents, give attribution) |
| DECA / EMOCA / MICA / SMIRK / **Pixel3DMM** | Photo → FLAME fitting networks | Non-commercial (Pixel3DMM: CC-BY-NC-4.0) | CUDA | **REJECT** (inspiration only) |
| SAM 3D Body + MHR | Single-image body mesh recovery; MHR body model | Apache-2.0 | GPU | REJECT (we already own the body) |

### 3D generation (evidence providers)

| Candidate | What / why | License | Hardware | Verdict |
|---|---|---|---|---|
| **Meshy-6** | Proven on our prepped illustrations. Now has multi-image (1–4 views), symmetry and quad remesh | Paid API | Cloud | **KEEP as optional evidence**, never as topology |
| **TRELLIS.2** (4B) | Current open quality leader for image → 3D | MIT, no territory or revenue clauses | NVIDIA ≥ 24 GB, so a rented GPU (a few cents per head) | **STUDY → candidate Meshy replacement** |
| Step1X-3D, TripoSG/TripoSR | Open alternatives | Apache-2.0 / MIT | NVIDIA GPU | STUDY |
| Hunyuan3D 2.x | Strong quality | Tencent community licence: **excludes EU/UK/South Korea**, MAU cap | GPU | **REJECT** (Offshorly works with UK clients) |
| StdGEN | Single image → 3D character *decomposed* into body / clothes / hair | Code Apache-2.0; **checkpoints research-only**; VRoid training data | GPU | STUDY the idea, REJECT the weights |
| Hunyuan3D-Part / PartField | 3D part segmentation | Not verified | GPU | STUDY only |

### Hair

| Candidate | What / why | License | Verdict |
|---|---|---|---|
| **SRM-Hair** | Morphable *hair mesh* with vertex-consistent semantics driven by coefficients. Confirms the "template hair + coefficients" representation | BY-NC-ND | **STUDY** (validates our design) |
| Perm | Parametric multi-style hair | Research | STUDY |
| DiffLocks, Im2Haircut, HairLRM, strand LRMs (2025–26) | Single image → realistic *strands* | Mostly MPI / research | **REJECT**: wrong representation for sculpted chibi locks, and strands at 50 browser avatars aren't feasible |
| VRoid Studio | Guide-curve procedural hair meshes for stylized characters | Free app, proprietary | STUDY (design precedent) |

### 2D understanding, segmentation and editing

| Candidate | What / why | License | Hardware | Verdict |
|---|---|---|---|---|
| SAM 3 | Text-prompted masks ("hair", "glasses", "beard", "hat") on photos | SAM Licence: commercial use allowed; has IP-claim termination and indemnity terms | GPU (CPU slow) | **USE after legal review** |
| BiRefNet | Background removal | MIT | GPU/CPU | USE |
| RMBG-2.0 | Background removal | CC-BY-NC | — | REJECT |
| Face parsers trained on CelebAMask-HQ | Face/hair parsing | Dataset is non-commercial | — | Avoid |
| **Qwen-Image-Edit-2509** | Open image editing with identity consistency and multi-image input. Candidate for open Stage A (photo → Offshorly), turnarounds, de-glassing | Apache-2.0 | ~20B, cloud GPU | **STUDY → open replacement for Gemini/GPT-image** |
| FLUX.1 Kontext [dev] | Image editing | Non-commercial weights | — | REJECT |
| InstantID / PuLID / PhotoMaker | Identity-preserving generation | Depend on InsightFace (non-commercial) weights | — | REJECT |
| Gemini (Stage A), GPT-image (Stage B turnaround) | Already production-proven for our style | Paid APIs | Cloud | **KEEP** for now |

### Identity / perceptual / critics

| Candidate | What / why | License | Verdict |
|---|---|---|---|
| InsightFace / ArcFace | Face-recognition embeddings | Code MIT, **weights non-commercial** (paid licence on request). Also degrade on stylized faces | **REJECT** |
| **StyleID** (Apr 2026) | Stylization-agnostic identity metric, calibrated against human judgements | CC-BY-NC-SA | **STUDY**: copy the *method* (calibrate an encoder on our own pairs) |
| Stylized-Face (ICCV 2025) | Evidence that real-face recognisers fail on stylized faces | Research | STUDY |
| **SigLIP 2**, **DINOv2** | Image embeddings for roster-retrieval identity tests and style-distance | Apache-2.0 | **USE** (the small variants run on CPU locally) |
| DINOv3 | Stronger features | Custom Meta licence; commercial allowed with terms | Optional |
| **Qwen3-VL** (2B–235B) | Open VLM critic: lineup tests and defect localisation | Apache-2.0 | **USE** (cloud for the large models; a small one might fit on the 8 GB Mac) |
| Claude / Gemini vision APIs | Paid VLM critic alternative | Paid | Optional |

### Rigging / animation

| Candidate | Verdict |
|---|---|
| **UniRig** (MIT code; checkpoints/data under their own terms) | **REJECT for the core.** Our rig is canonical. With a canonical head, the skin weights *are* the template's. At most it might rig odd accessories later. |
| **UniMate** (arXiv Sep 2026, text → motion across arbitrary skeletons; code and weights "upon publication") | **REJECT / watch.** It solves skeleton diversity we don't have. |

---

## D. Architecture options

| | **A. Generated topology + repair** (current V2, hardened) | **B. Canonical construction + evidence fitting** (scan-wrap) | **C. Pure parametric kit** (avatar-system style, 2D only) | **D. End-to-end generative + part decomposition + auto-retopo + auto-rig** |
|---|---|---|---|---|
| Identity fidelity | High (raw relief + paint) | **High** (dense residual + baked paint) | Medium; bounded by the library (Phase 3B failed here) | Medium–high |
| Stylization control | Low–medium (rules on unknown meshes) | **High** (rules on a semantic domain) | High | Low |
| Construction reliability | **Low** (open failure space) | **High** (invariants by construction) | High | Low–medium |
| Topology guarantees | None | **Total** (identical topology) | Total | None (retopo heuristics) |
| Hair reliability | Low (fused split) | High (modules on the skull) | High, but limited variety | Low–medium (part separation unreliable) |
| Accessories | Medium (glasses modular; source fused) | High | High | Low |
| Input robustness | Medium (Meshy sensitive) | High (multi-evidence + priors + confidence) | High | Medium |
| Automation | Low (visual sign-off classes) | **High** | High | Medium |
| Scale to 100+ | Poor (per-head surprises) | **Good** | Good | Medium |
| Browser runtime | Poor (60–300k head tris) | **Good** (~10k, shared buffers) | Excellent | Medium |
| Determinism | Yes (given raw) | Yes (given cached evidence) | Yes | Weak |
| Local/offline | Construction yes, generation no | Construction + QA yes; evidence optional | Fully | No |
| GPU | Cloud (Meshy) | Optional (evidence) | None | NVIDIA required |
| macOS feasibility | Yes | Yes | Yes | No (CUDA) |
| Implementation complexity | Already sunk; rising | Medium–high (head design + fit + hair library) | Medium (heavy art authoring) | High, with research risk |
| Paid dependency | Meshy | None required | None | None/low |
| Licensing | OK | OK (MIT/Apache/CC-BY stack) | OK | Many components non-commercial |
| Likely failures | Closure, ears, nape, seams, spikes | Under-fit identity, hair archetype miss, rare evidence errors | Generic look | Topology and part errors, rig errors |
| Maintainability | Poor | **Good** (few, local, testable stages) | Good | Poor |

**Option E (neural heads: Gaussian splats / NeRF): rejected outright.** It doesn't fit browser runtime at 50 avatars,
skeletal rigging, garments or determinism.

**Verdict: B, with C's parametric layer as its backbone.**

- The semantic sliders, hair archetypes and accessory catalogue are C. They give editability and priors.
- The evidence-driven residual and baked texture are what make it *recognisable*. They address C's (and Phase 3B's) failure.

---

## E. Recommended final architecture

```
UPLOAD  (1–3 images: photo · selfie · angled photo · illustration · existing Offshorly sprite)
 │
 0  INPUT GATE (local)       MediaPipe: face count, yaw/pitch, landmark confidence, blur/resolution, occlusion
 │                           (SAM 3 masks), domain = photo | illustration → reject with a *specific* request, never guess
 │
 1  IDENTITY ABSTRACTION     photo → Offshorly 2D illustration (Gemini today; Qwen-Image-Edit as the open path) × 3
 │  (2D, cheap,              illustration/sprite input → used directly (prep-reference: de-glass, flat light)
 │   inspectable)            choose the candidate by photo↔illustration identity QA (§J) → IdentitySpec v1
 │                           (traits + categories + colours + per-trait confidence)
 │
 2  EVIDENCE (cached by      2a multi-view turnaround of the illustration (GPT-image Stage B / Qwen-Image-Edit)
 │   content hash)           2b optional 3D evidence: Meshy raw (today) · TRELLIS.2 on a rented GPU (open path)
 │                           2c photo measurements (MediaPipe landmarks, optional FLAME-Open fit for profile)
 │
 3  CANONICAL FIT (local,    canonical HumanBase head → semantic morphs → Offshorly shape-space coefficients →
 │   deterministic)          band-limited residual; data terms only where the evidence is skin-confident;
 │                           distinctiveness-preserving style mapping; hard constraints (no flips, envelope, sockets)
 │
 4  APPEARANCE               bake evidence / illustration → fixed canonical UV; UV-space skin cleaning and brows;
 │                           living eyes from IdentitySpec; scalp under the hairline = hair base colour
 │
 5  MODULES                  hair (archetype retrieval + SDF fit on the skull) · facial hair · glasses (catalogue +
 │                           canonical landmarks) · garments / body preset (existing)
 │
 6  COMPOSE + MOUNT          shared neck ring (no seam to build) · automatic mount (existing) · LODs · merge-on-equip
 │
 7  QA + SELF-CRITIC         construction invariants · multi-view ID-buffer renders (mounted, animated) · identity ·
 │                           style · runtime ↺ bounded optimiser on continuous parameters (≤ N evaluations)
 │
 8  PROMOTE or FAIL CLOSED   hash-bound promotion (existing `promoteCandidate`) → VO; failures produce an evidence
                             pack + a reason + (when the cause is the input) a request for a specific better image
```

---

## F. Identity system

**Anchor.** The approved Offshorly illustration is the identity contract.

- It records an artist's judgement of *what makes this person recognisable in our style*: which traits survive, which are
  amplified and which are dropped. That is exactly the decision we otherwise can't automate.
- Photo → illustration is the stage where image models are strongest, and the result is cheap to inspect.
- The 3D is validated against the illustration (style space), not against the photo.

**Representation: hybrid, explicit and auditable (Q9).**

1. **Trait vector.** Measured ratios, normalised by face half-width at the eye line (this is what `illustration-traits.mjs`
   already does). It covers face width/length, jaw, chin, cheek, eye size, spacing, tilt and shape, brow shape and thickness,
   nose width and length, lip fullness and mouth width. Profile traits (projection, skull length) come from the turnaround or
   the 3D evidence.
2. **Categories.** Hair archetype + parameters, part side, fringe, ear visibility, facial-hair type, glasses style, and marks
   (moles, dimples, freckles).
3. **Colours.** Skin lit/shade, hair, iris, brow, lip.
4. **Evidence pointers.** Baked texture, 3D evidence, turnaround.
5. **Per-trait confidence.**

Embeddings are used **only for QA**, never as the identity carrier. We don't have the data to train a latent space, and a
latent isn't editable or auditable.

**Identity through strong stylization (Q6).** Use face-space theory: identity is the *deviation from the population norm*
(caricature works by exaggerating it). Chibi compresses absolute proportions toward a style mean, so we keep the *direction
and rank order* of each deviation and compress only its magnitude:

```
z_i = (x_i − μ_pop,i) / σ_pop,i             trait i, measured in the illustration domain
s_i = μ_style,i + σ_style,i · g(k_i · z_i)  g = soft clip (tanh-like); k_i = per-trait retention gain
```

- The style envelope is a **joint Mahalanobis bound** on the coefficients, not independent bands. A long, narrow face stays
  "the longest face in the office", just compressed. This removes the Nicole infeasibility at the root.
- The current long-face retention (≤ 1.42 growth) becomes a special case of this rule.

**Calibration from our pairs (Q7).**

- **Data:** 7 photo ↔ illustration pairs (Alex, Chris, Cyrus, Kylle, Micah and Rhendel in `Raw/`, plus Bon's `bon-real.jpeg`;
  Lalaine has a photo but no sprite), 24 illustrations, and 5 approved 3D heads.
- **What it can calibrate:**
  1. per-trait retention gains `k_i`: which traits the artist keeps, amplifies or drops (for example hair silhouette ≈ fully
     kept, nose ≈ heavily compressed);
  2. population statistics `μ, σ` in the illustration domain (n = 24, growing);
  3. ground truth for the identity-QA thresholds (own vs other pairs).
- **What it can't do:** train a generator. It is enough to fit about 15 gains and validate metrics. Every approved employee
  adds a sample.
- **Data hygiene:** `~/Downloads/Jigsaw Staff Photos` are not Offshorly employees and must not be used.

**Uncertainty (Q32).** Each trait carries a confidence:

- the ear shape under long hair → low → the family prior is used;
- back hair from a single front photo → low → the archetype prior plus the turnaround;
- a heavy yaw input → low profile confidence.

A low-confidence trait that is *critical* (face outline, hair archetype) triggers a request for one more image instead of a
guess. Confidence is recorded in the build stamp and shown in Edit Avatar.

---

## G. Offshorly style system

Style is a set of shared, locked layers. Identity can only move *inside* them:

1. **The canonical head design.** The family mean shape and the construction locked by the art direction (almond eyes with
   dimensional lids, a dimensional simplified nose, sculpted lips, clean skin). It is authored once and approved by Bon.
2. **The style shape space.** The mean and allowed variance per region, from the approved family *registered to the canonical
   topology* (the five now, the whole roster later). PCA gives a data prior; the semantic sliders (`SHAPE_CONTROLS`) give
   editability.
3. **`CHIBI_RULES` as operators on coefficients.**
   - skull width from the ears;
   - multi-band damping becomes frequency limits on the residual (keep the low manifold-harmonic bands, damp mid, drop high);
   - bounded eye enlargement, reduced projection, shorter lower face, hairline preservation.

   The same knowledge, applied where every vertex has a meaning.
4. **The material and shader language** (`humanMaterials`, living eyes) and the **hair language** (broad sculpted locks,
   directional sweep, soft grooves: already the `build-hair-*` contract).
5. **Body proportions** are fixed by HumanBase. The head mount stays measured (the existing automatic mount).

**Style QA** (§J) measures each layer: coefficient Mahalanobis distance to the family, feature-size bands, embedding distance
to the approved renders' centroid, and the mounted proportion envelope.

---

## H. Canonical 3D construction

**Head asset spec (CanonicalHead V2):**

- **Size and topology:** about 8–12k triangles at LOD0, quad-derived, with edge loops around the eyes, mouth and ears.
- **Built-in anatomy:** a closed skull; the ears are part of the head (morph-controlled, with a "tucked" variant for covering
  hair); eye sockets sized for the living-eye shells; a closed mouth with a lip line.
- **Neck seam:** the boundary loop is the *same vertex ring* as the body's neck seam (identical positions, normals and
  weights), so there is no seam to build.
- **UV:** fixed and seam-safe, with high texel density on the face and a scalp region.
- **Regions:** skin / lips / brow / scalp-under-hair, as mask channels.
- **Landmarks:** vertex IDs (a MediaPipe/FLAME-compatible subset) replace landmark *detection* on our own output.
- **Morphs:** semantic morphs (the existing `SHAPE_CONTROLS`) + PCA style modes + reserved slots for future ARKit-52
  expressions (empty for now: the mouth stays inert).
- **Weights:** Head-rigid plus the neck blend, identical for everyone.

**Where the topology comes from (Decision Point).**

1. Bon retopologizes the family mean head in Blender. Best artistic control; Bon is the designer.
2. Wrap the FLAME 2023 Open topology (CC-BY) onto the family mean. Gives immediate landmark/expression compatibility, but has
   realistic-ear topology density.
3. **For the proof only:** the existing `canonical-head-v1.glb` (closed icosphere skull + kept ears, landmarks and morphs),
   remeshed to about 20k.

Recommendation: use 3 to prove the architecture and 1 for production, using 2's landmark set as a reference.

**Fit algorithm (deterministic):**

1. Landmark correspondence:
   - template landmarks are known vertex IDs;
   - evidence landmarks come from chibify's existing `measureHead()` (eyes from sclera texels, ears, chin/nose/mouth
     profile). Reuse it.
2. Soft evidence segmentation: the existing colour classifier gives skin confidence ∈ [0,1]. **Nothing is cut**; confidence
   only weights the data term.
3. Coarse → fine:
   - similarity transform (skull from ears);
   - semantic morphs + PCA coefficients (least squares on landmarks and silhouettes);
   - ARAP/Laplacian residual with decreasing stiffness, data term on skin-confident evidence only (face, ears, exposed neck).
4. Under the hair, the skull is held by the style prior (canonical skull ≤ r ≤ evidence hair inner envelope). It is *never*
   pulled toward hair geometry.
5. Style mapping (§F/§G), then hard checks:
   - no inverted or degenerate triangles;
   - triangle quality ≥ the template's;
   - no self-intersection (BVH);
   - envelope;
   - socket and mouth regions within bounds;
   - topology hash identical.

**Guaranteed by construction:** a closed skull, clean ears, eye sockets, mouth, neck seam, UVs, weights and landmarks. **No
closure or proxy geometry exists in the asset at all**, so FC-CLOSURE-EXPOSED, FC-NAPE-ROUGH, FC-JAW-RIM, FC-SKIN-FLAP,
FC-BALD-POCKET and the neck ring stop being possible.

**Appearance:**

- Bake the evidence texture onto the canonical UV (raycast along the template normals, nearest-surface fallback; skin
  regions only). This keeps the painted Meshy/illustration look that Phase 3B lacked.
- Skin delight and brow closing run in UV space (identical layout for everyone, so the rules are simpler and stable).
- The living-eye bake is reused on the fixed sockets.
- The scalp under the hairline is painted hair base colour, so any gap under hair reveals *hair*, never skin.

---

## I. Hair, facial hair and accessories

### The hair module contract (enforced, not hoped for)

- **Skull clearance:** the inner surface stays ≥ skull + ε (SDF test).
- **Ears:** hair stays outside the ear capsules, *or* the archetype declares "ears covered" and the head uses its ear-tucked
  morph. Hair never goes *through* an ear.
- **Hairline:** a designed hairline curve on the canonical UV (front, sides, nape) where scalp paint switches to hair base.
- **Below the neck line:** no geometry unless declared hanging parts.
- **Rig:** Head-rigid near the scalp; chains for the hanging parts.
- **Body:** clearance against the body capsules (`humanClearance`).

### Generation: retrieval + deformation + construction (Q10)

1. **Archetype.** Choose from IdentitySpec categories plus silhouette features (top-2 kept). The VLM can classify, and the
   front illustration hair mask decides between candidates. Library v1 (about 12–16 archetypes):
   - bald, buzz, short crop, short textured/curly, side part, quiff/pompadour;
   - curtain/medium, bob, long straight, long wavy/curly, afro/volume;
   - ponytail / bun / half-up (with tie height); fringe variants as parameters.
2. **Template.** Each archetype is authored once, in canonical skull space, as SDF lock primitives (the existing
   `build-hair-medium/long/tail` builders are exactly this). Parameters: volume, length, part, fringe length/side, curl
   amplitude, lock count, tie position.
3. **Fit.** Gradient-free optimisation of the parameters against the evidence silhouettes: front illustration hair mask, side
   and back turnaround masks, and the 3D-evidence hair envelope when present. Then an optional bounded SDF blend toward the
   evidence envelope for recognisable asymmetry (Kael's messy crown).
4. **Construct.** SDF ∩ outside(skull + ε) − ear capsules → manifold level set (manifold3d / surface nets) → remesh → smooth →
   hair-language pass. Colour comes from IdentitySpec; AO and flow are baked; the colour/flow of the evidence hair is
   optionally projected.

**Per hair type:**

| Case | How it's handled |
|---|---|
| **Bald (Q11)** | No hair module; scalp = skin. The head is complete by construction, so **bald becomes the easiest case** (it is one of the hardest today: Alex). Shine/AO via material. |
| **Very short / buzz** | A texture layer (hair-colour scalp + density mask + subtle normal bump), plus an optional 2–3 mm shell when the measured thickness warrants it. |
| **Curls / afro** | An archetype with lobed primitives. Deterministic noise is seeded from the IdentitySpec hash, not from a random number. |
| **Long hair over the shoulders (Q12)** | The hair module has a cranial part (Head-rigid) and a hanging part with chain joints. In bind pose the hanging part rests outside the shoulder/chest capsules (draped over a capsule, as `build-hair-long` already does). At runtime, the existing HairDynamics springs + capsule collision. Garments are tested against hair in the behaviour sweep. |
| **Ponytail / bun / half-up** | The existing tail accessory approach, re-anchored to canonical tie sockets (the side comb is now a template parameter, not a deformation of fused hair). |

### Facial hair (Q14)

- **Stubble / shadow:** a UV-space texture layer on the canonical jaw/upper-lip region (mask × density × colour).
- **Moustache / beard / goatee:** a shell module anchored to canonical jaw and lip landmarks, under the same SDF contract
  (outside skin + ε, mouth line kept clear). It comes from an archetype library + parameters, like hair.

### Glasses and other accessories (Q13)

- **Glasses are never baked.**
  - **Evidence:** the illustration is de-glassed in 2D (existing `prep-reference.mjs` / `svg-strip-layers.mjs`; SAM 3 masks +
    an image edit for photos).
  - **Style:** retrieved from the illustration (shape, colour, rim thickness, lens tint) into the `glasses-styles/` catalogue.
  - **Fit:** the existing fit-space fit (`humanGlasses.ts`), now driven by canonical landmark *vertex IDs* (deterministic).
  - **Checks:** a penetration check against the face and the ear tuck.
- **Earrings:** a socket at the canonical earlobe vertex.
- **Hats (later):** a hat module plus a hair "compressed" variant parameter.
- **Everything else:** sockets on canonical vertices.

---

## J. Automatic QA and the self-critic

### Tiers

1. **Construction invariants** (deterministic, hard gates):
   - topology hash == canonical;
   - 0 flipped / degenerate triangles; quality bounds;
   - 0 self-intersections;
   - Jacobian/stretch bounds per region;
   - envelope (Mahalanobis);
   - hair inner clearance ≥ ε at 100% of samples; ear clearance; nothing below the neck line except declared parts;
   - head neck ring == body ring;
   - accessory and garment penetration (existing `garmentCheck`);
   - weights == canonical;
   - runtime budgets;
   - rebuild determinism (equal hashes).
2. **Render-based checks** (deterministic and exact, because class IDs come from construction):
   - **Views:** 14 fixed views (front, ¾ L/R, both sides, rear ¾ L/R, back, high, low-front, low-rear, underside, both ears,
     jaw/neck, nape), rendered on the **mounted, dressed** avatar (existing mounted gate) in idle and sampled
     walk/sit/turn/scooter frames.
   - **Per-pixel buffers:** mesh ID, material class, UV region, back-face flag.
   - **Rules:**
     - visible classes per region must be in an allowed set (nape: hair ∪ hair-base ∪ neck skin);
     - 0 back-face pixels;
     - hair silhouette contour curvature below a spike threshold;
     - colour continuity across the hairline.
3. **Identity (Q25):**
   - (a) landmark agreement: canonical landmarks projected *analytically* vs the illustration's measured landmarks;
     per-trait error within a tolerance tied to `k_i`;
   - (b) silhouette IoU: face + hair front vs illustration, sides/back vs turnaround;
   - (c) colour ΔE: skin, hair, iris, brow;
   - (d) **roster retrieval:** SigLIP 2 / DINOv2 embedding of the front and ¾ renders against all illustrations. The render must
     rank its own illustration top-1 with a calibrated margin ("recognisable among colleagues", operationalised);
   - (e) **VLM lineup:** the render + 5 shuffled same-presentation illustrations, forced choice, 3 permutations, must be
     correct 3/3 (Claude / Gemini / Qwen3-VL).

   Thresholds are calibrated on the approved five (positives) and cross-pairs (negatives).
4. **Style (Q26):**
   - coefficient Mahalanobis distance ≤ bound;
   - feature-size bands;
   - embedding distance to the approved-family centroid;
   - the mounted proportion envelope;
   - a VLM rubric (advisory only).
5. **Runtime:** triangles, draws, texture memory, file size, LOD screen error, load time.

**Photo ↔ illustration QA (Stage 1):** the same tests (d) and (e) between the photo and the candidate illustrations, plus
MediaPipe landmark-ratio agreement with domain-calibrated tolerances.

### The self-critic (Q28, Q29)

- **Parameters:** θ = shape coefficients, retention gains, hair archetype parameters, mount.
- **Objective:** weighted identity + style error, subject to the tier-1 hard constraints.
- **Optimiser:** CMA-ES or Nelder–Mead with a fixed seed. Budget ≤ 40 evaluations (each is fit + render, seconds to tens of
  seconds). Discrete choices (archetype) are limited to the top-2.
- **Termination:** pass, stall (improvement < δ over 5 evaluations), or budget exhausted → fail closed with the best attempt
  and a per-metric report.
- **No infinite loops, structurally:**
  - repairs are pure functions in a DAG, applied at most once each, never triggered by their own output;
  - the loop can't change the evidence or call paid services;
  - the VLM's role is to *localise* (which view, which region → which parameter group), never to approve alone.

### What counts as FAIL CLOSED (Q30)

The avatar fails closed (the employee keeps the existing placeholder; access is never blocked) if any of these holds:

1. any tier-1 invariant fails;
2. any tier-2 region rule fails;
3. the identity retrieval or lineup test fails after the budget;
4. the style envelope is exceeded;
5. the input gate fails (specific reason: "face turned more than 35°", "hair cut off by the frame", "two faces");
6. a critical trait has low confidence and no fallback prior is allowed;
7. a provider error, or the evidence hash changed during the build.

The output is always an evidence pack: renders, metrics, and the stage that failed.

---

## K. Failure-learning system (Q31)

**Registry v3 entry:**

- `id`, `symptom` (views and region), `layer` (input | identity | fit | module | compose | runtime)
- `rootCause`
- `prevention` (template, module contract or prior: *preferred*)
- `detector` (hard invariant or render rule)
- `repair` (only if prevention is impossible: bounded, idempotent)
- `fixtures` (broken + fixed), `firstSeen`, `registryVersion`

**Lifecycle:**

1. A novel failure fails closed and produces an evidence pack.
2. One human diagnosis assigns it to a layer.
3. Fix it **at the highest layer possible**: a template or contract change fixes every future employee and needs no detector.
4. Otherwise add a detector + bounded repair.
5. Add fixtures.
6. Run a **full-roster rebuild** from cached evidence (local, zero credits, minutes).
7. Bump the registry version.

**Enforcement:**

- A contract test fails if pipeline source contains an employee identifier.
- Per-employee data is limited to IdentitySpec and evidence. There are no "recipe repairs".

**The existing 22 classes:** most are archived as "prevented by construction". Their broken fixtures stay as regression proof
that the V3 path can't reproduce them.

---

## L. Performance / LOD strategy

| | Today (5 avatars) | V3 target per avatar |
|---|---|---|
| Head | 60–300k tris + ~37k eye tris | ~10k (LOD0) / ~3k (LOD1) / ~800 (LOD2), plus shared eye shells (~1–2k) |
| Hair | fused in the head | 4–15k by archetype, LODs from meshoptimizer |
| Body + garments + shoes | ~40k | unchanged now, LOD later |
| Draws | 15–18 | 2–4 after merge-on-equip (skinned merge + atlas) |
| Head texture | 2048 WebP + per-head eye atlas | 1024² (2048 near-LOD) KTX2/Basis + shared eye atlas with per-employee parameters |

- **Shared buffers.** The canonical head means *one* index buffer, UV set and LOD chain for all employees. Each employee
  carries a position buffer (or base + morph weights + residual). The LODs of the canonical topology are authored once, and
  the residual is transferred.
- **Budget at 50 visible avatars:** a LOD mix of about 1–1.5M tris and about 100–200 draws, with GPU texture memory around
  50 MB. Later: octahedral impostors at far range.
- **5 / 20 / 50 test scenes** are added to the QA rig as acceptance criteria for the migration phase.

---

## M. Keep / extend / replace / retire

| Action | Items |
|---|---|
| **Keep** | `humanBaseContract.ts`, `HumanAvatar.ts`, `humanRig`, `humanBehavior`, `humanInteraction`, `humanClearance`, `humanMaterials`, `humanHair` (dynamics), `humanGlasses` + `humanAccessoryFit`, body presets, `build-human-base`, `build-human-garments`, `repair-base`, `mounted-gate` + `gate/mountedGate.ts`, `gate.mjs` + `promoteCandidate` + `approve.mjs`, registry *format*, `fixtures/`, `pipeline-contract.test.mjs`, `human-base-lineup.html` + QA viewer + `qa-360.mjs`, `prep-reference`, `svg-strip-layers`, `illustration-traits`, `measure-heads`, the approved five production GLBs (stay live until their V3 versions pass A/B) |
| **Extend** | `build-canonical-head.mjs` → CanonicalHead V2 (production topology, neck-ring identity, UV, region masks, PCA modes); `fit-identity.mjs` → the fit engine front end (it already searches morphs from illustration traits); `build-hair-medium/long/tail` → archetype library; `check-identity.mjs` + `failure-detectors.mjs` → render-ID rules + identity/style QA; `employees.json` → IdentitySpec + evidence manifest; `humanCatalogue` → hair, facial-hair and glasses catalogues; `optimize-identity` → canonical LODs + KTX2 |
| **Replace** | `chibify.mjs` (transform an arbitrary mesh) → style operators on canonical coefficients (port `CHIBI_RULES` + `measureHead()`); `hair-layers.mjs` (split fused hair) → hair module builder; `skin-clean.mjs` → UV-space version; `eye-socket.mjs` → canonical sockets (the eye-depth contract becomes intrinsic); `atlas-repack.mjs` → unnecessary for heads (fixed UV) |
| **Retire** | canonical cut, `interiorShell` / `head-closure.mjs`, skull-base filler, hair base cap, pocket closure, `rimTuck`, `jawClosureClip`, `napeSkin`, `keepOwnUnderside`, `hairAsSkinRelabel`, `crownSkinRelabel`, `neckHairClear`, `collarCull`, twin patch / underlay / texel mirror, fused-fringe lift, `extract-legacy-head.mjs`, `historyRepairs` recipes, the hand-tuned closure-percentage gates |

---

## N. Cost / license / hardware matrix

| Component | Free / open | Commercial OK | Runs locally on this 8 GB Mac | Needs GPU / cloud | Paid |
|---|---|---|---|---|---|
| Canonical fit, bake, hair SDF, QA renders, gates | ✔ (our code + MIT/Apache/MPL libs) | ✔ | ✔ | — | — |
| MediaPipe Face Landmarker | ✔ | ✔ Apache | ✔ | — | — |
| SigLIP 2 / DINOv2 (small) | ✔ | ✔ Apache | ✔ (CPU) | — | — |
| Qwen3-VL | ✔ | ✔ Apache | 2B/4B maybe (tight) | 8B+ | rented GPU |
| Claude / Gemini VLM critic | — | ✔ | — | cloud | ≈ cents per avatar |
| Stage A photo → illustration: Gemini | — | ✔ | — | cloud | ≈ cents |
| Stage A open path: Qwen-Image-Edit | ✔ | ✔ Apache | ✘ | ✔ | rented GPU |
| Turnaround: GPT-image / Qwen-Image-Edit | — / ✔ | ✔ | ✘ | ✔ | API / rented GPU |
| 3D evidence: Meshy-6 | — | ✔ (paid plan) | — | cloud | credits |
| 3D evidence: TRELLIS.2 | ✔ | ✔ MIT (check dependencies) | ✘ (needs ≥ 24 GB NVIDIA) | ✔ | rented GPU |
| SAM 3 | ✔ | ✔ with SAM-licence terms | slow on CPU | ✔ preferred | — |
| FLAME 2023 Open | ✔ | ✔ CC-BY-4.0 | ✔ | — | — |
| WrapX (optional) | — | ✔ | ✔ | — | licence |
| **Not deployable:** InsightFace weights, Pixel3DMM / DECA / EMOCA / MICA / SMIRK, StyleID weights, SRM-Hair, StdGEN checkpoints, FLUX.1 Kontext [dev], RMBG-2.0, nvdiffrast, Hunyuan3D (EU/UK/KR exclusion) | | ✘ | | | |

**Can we avoid paid generation services entirely (Q19)?**

- **Technically, yes:** Qwen-Image-Edit + TRELLIS.2 + Qwen3-VL on rented GPU time costs cents per employee, with no vendor
  lock-in.
- **Fully local and free** holds for construction and QA, and for evidence only if the 2D-only fit proves sufficient (the
  proof measures this).
- **Recommendation:** put every generative step behind a provider interface. Keep Gemini/GPT-image while they are the proven
  path, and switch per stage when the open model passes the same QA.

**Privacy (decision for Bon/legal):**

- Employee photos already go to third-party APIs.
- Face embeddings computed for QA should be ephemeral (not stored).
- Upload should carry consent wording.
- The FLAME CC-BY attribution and the SAM licence need a quick legal read.

---

## O. Implementation roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **P0** | This decision + Bon's answers to the Decision Points | Approved direction |
| **P1: Proof** (§P) | Canonical fit + bake + SDF hair + render-ID QA on Bon / Kael / Lui (+ Nicole) from existing raw heads, dev-flag only | §Q met |
| **P2: CanonicalHead V2** | Production topology (Bon retopo), UV, region masks, neck-ring identity, semantic + PCA morphs, LOD chain | Bon approves the neutral head; invariants by test |
| **P3: Identity system** | IdentitySpec, trait extraction (illustration + photo), population stats, retention-gain calibration from the 7 pairs, identity QA with calibrated thresholds | The approved five pass retrieval + lineup; cross-pairs fail |
| **P4: Hair system** | Archetype library v1 (12–16), SDF fit, chains, bald/buzz/long/tied/curly | All 24 sprites get a plausible archetype; contract invariants at 100% |
| **P5: Accessories / facial hair** | Glasses on canonical landmarks, stubble layer, beard shells, earring socket | Penetration 0; Micah/Bon/France glasses parity |
| **P6: QA + self-critic + registry v3** | 14-view mounted ID renders, the bounded optimiser, fail-closed policy, roster regression job | A full-roster rebuild is deterministic; zero employee identifiers in the source |
| **P7: Migration** | Rebuild the approved five on V3 (A/B vs V1 in the lineup), then Kael, Lui, Jona, Nicole, Alex, Jan, then the remaining sprites | Bon's A/B approval on the five; batch 2 automated PASS that survives visual review |
| **P8: Runtime** | Merge-on-equip, KTX2, shared buffers, 5/20/50-avatar perf scenes | fps targets met on the M1 test machine |
| **P9: Product** | Upload flow (input gate → Stage A → evidence → build → promote), placeholder swap, Edit Avatar | Employee #100 needs no developer action |

---

## P. First technical proof (smallest test of the new architecture)

**Scope:** zero credits, dev-flag only, nothing touching production or the protected files.

**Cases:**

- **Bon** (approved control);
- **Kael** (short messy hair: ear, nape and hairline stress);
- **Lui** (rear skull/neck, hair over the ear);
- **Nicole** (stretch case: a long, narrow face with a bob — tests the joint envelope and long hair).

**Inputs:** existing raw Meshy heads (`output/meshy-employees/{who}-head-v1/raw-untouched/`), the prepped refs and sprites,
and approved `bon-v1.glb` as the visual control.

**Steps:**

1. **Template.** Use `canonical-head-v1.glb`, remeshed to about 20k, with a neck ring snapped to the HumanBase body ring and
   landmark IDs from its existing landmarks.
2. **Correspondence.** Landmarks from chibify's `measureHead()` on each raw head (ported read-only into a new module), plus
   soft skin confidence.
3. **Fit.** Similarity → semantic morphs → ARAP/Laplacian residual on skin-confident evidence → existing `CHIBI_RULES` as
   coefficient operators → hard checks.
4. **Bake.** Raw texture → canonical UV (skin regions); scalp-under-hair = hair base colour; reuse the living-eye bake on the
   canonical sockets.
5. **Hair.** One SDF shell per person from the evidence hair envelope: ∩ outside(skull + ε), minus ear capsules (or the
   ears-covered variant), with the designed hairline. Head-rigid for Kael/Lui; the bob's lower band clears the body capsules
   for Nicole.
6. **Mount and dress.** Use the existing automatic mount and `OFFSHORLY_UNIFORM`; a glasses module on Bon (modularity check).
7. **QA.** Tier-1 invariants; 14-view mounted ID renders in idle + walk + sit; the existing V2 gate classes; identity tests
   (d) and (e) against all 24 sprites; lineup page `?candidate=` side by side with V1/V2.
8. **Ablation.**
   - **2D-only fit:** front illustration + Stage-B turnaround silhouettes (existing GPT-image turnarounds, if on disk; no new
     generation without approval).
   - **vs 3D-evidence fit:** decides Meshy's future role.

**Deliverables:** a new `human-base/v3/` module set and output under `output/human-base/v3-proof/`. Nothing in `production/`,
no edits to V2 files.

---

## Q. Proof success criteria (all measurable)

### Construction (all cases, 100% required)

- Topology hash identical to the template for every head. 0 non-manifold edges. The only boundary is the neck ring.
- 0 self-intersections, 0 flipped triangles. Minimum triangle quality ≥ 0.5 × the template's minimum.
- **0 closure / proxy / filler parts** in the asset.
- Hair: the inner-surface signed distance to the skull is ≥ ε (1.5 mm-eq) at 100% of samples. 0 hair vertices inside the ear
  capsules (unless ears-covered). 0 hair below the neck line except declared hanging parts.
- The head neck ring matches the body ring in position (max error < 1e-5) and in normals.
- Mounted ID renders (14 views × idle/walk/sit):
  - 0 disallowed-class pixels per region (nape ⊆ {hair, hair-base, neck skin});
  - 0 back-face pixels;
  - 0 spike contours over threshold.
- Every existing V2 detector class passes, *including* the three that had no detector: Bon confirms the ear / nape / hair-spike
  views visually during the proof.
- Determinism: two rebuilds produce identical hashes.
- Runtime: head ≤ 20k (proof template), hair ≤ 15k, head texture ≤ 2048, draws ≤ today's.

### Identity

- **Bon control:**
  - front silhouette IoU ≥ 0.90 against the approved `bon-v1` render;
  - landmark ratio error ≤ the calibrated tolerance;
  - Bon judges "same character" in the lineup.
- **Kael, Lui, Nicole:**
  - roster retrieval ranks the own sprite top-1 among the 24;
  - VLM lineup 3/3 correct;
  - in Bon's **blind** comparison (shuffled V2-candidate vs V3 renders), V3 is rated at least as recognisable as V2 for each
    person.
- The ablation reports both fits' metrics.

### Style

- Shape coefficients within the family Mahalanobis bound (≤ 2.5σ).
- Mounted proportions within the existing envelope.
- In the lineup with the approved five, Bon judges "same Offshorly family".

**The proof fails** if any construction criterion fails, or if V3 loses on recognisability to the V2 candidate for Kael or
Lui. In that case the dense-residual / texture approach needs rethinking before P2.

---

## R. End-state user experience (employee #100) (Q33)

**A good real photo:**

1. Upload. The input gate passes in under a second.
2. Stage A produces 3 Offshorly illustrations; identity QA picks the best. Optionally the employee taps "That's me", or picks
   one of the 3 — the only human touch, and it's their own face.
3. The turnaround (and optional 3D evidence) is generated and cached.
4. The canonical fit, bake, hair archetype + fit, glasses and outfit run.
5. 14-view QA, identity and style tests, and up to 40 self-critic evaluations follow.
6. Promote. The placeholder in VO swaps to the real avatar live.

**Total:** about 3–10 minutes; no developer involved. Access to VO is never blocked meanwhile (the existing placeholder
policy).

**An imperfect or angled photo:**

- The input gate measures yaw, occlusion and resolution.
- **Moderately angled** (for example ≤ 35°): the build proceeds. The profile/back traits get low confidence and use archetype
  and family priors; Stage A's frontalised illustration carries the face.
- **A critical trait is unrecoverable** (half the face shadowed, hair cropped off): the system fails closed *before*
  generation with a specific ask, for example "please add one photo facing the camera" or "hair is cut off at the top".
  Multiple images are accepted and fused (the turnaround and identity QA use all of them).

**An illustration (or an existing Offshorly sprite):**

- Stage A is skipped.
- `prep-reference` (de-glass, flat light) → IdentitySpec straight from the illustration → the same evidence/fit path.
- A non-Offshorly illustration style is first restyled to the Offshorly 2D language (Stage A in edit mode) so the trait
  statistics stay in-domain.

**Profile → Edit Avatar (Q34).**

- An avatar is `{IdentitySpec, shape coefficients, texture ref, hair archetype + parameters, facial hair, glasses, garments,
  body preset, colours}`.
- Edit Avatar is a live parameter editor on the existing runtime composer:
  - hair archetype / length / part / colour;
  - glasses on/off and style;
  - outfit;
  - bounded face sliders (within the style envelope);
  - "re-generate from a new photo".
- Every save re-runs the cheap tier-1/2 gates server-side and creates a versioned, hash-bound avatar with rollback. Paid or GPU
  stages run only when a new photo is uploaded.

---

## Answers to the 35 questions (index)

1. **Right / wrong:** §B.
2. **Kael/Lui cause:** §B2.
3. **Arbitrary generated topology in production?** No. It is evidence only.
4. **Canonical topology?** Yes (§H).
5. **How identity fills it:** landmarks → semantic morphs → shape-space coefficients → band-limited residual on skin-confident
   evidence → baked texture (§H).
6. **Identity under chibi:** distinctiveness-preserving compression (§F).
7. **Pairs:** yes, as calibration of retention gains and QA ground truth; not for training (§F).
8. **Explicit Offshorly shape space?** Yes: semantic sliders + PCA from the registered family + bounded residual (§G).
9. **Representation:** a hybrid of explicit traits + coefficients + texture; embeddings for QA only (§F).
10. **Hair:** archetype retrieval + SDF fit on the skull, with a module contract (§I).
11. **Bald:** no module; complete skull by construction (§I).
12. **Long hair:** cranial + hanging chain parts, capsule clearance, springs (§I).
13. **Glasses:** catalogue + canonical landmark vertex IDs, never baked (§I).
14. **Facial hair:** UV stubble layer; beard shells under the SDF contract (§I).
15. **Models that help:** MediaPipe, SigLIP 2 / DINOv2, Qwen3-VL, Qwen-Image-Edit, SAM 3, TRELLIS.2, manifold3d, trimesh /
    libigl, FLAME 2023 Open (§C).
16. **Not commercially usable:** InsightFace weights, Pixel3DMM / DECA / EMOCA / MICA / SMIRK, StyleID, SRM-Hair, StdGEN
    checkpoints, FLUX Kontext dev, RMBG-2.0, nvdiffrast; Hunyuan3D is territory-restricted (§C, §N).
17. **Fully local:** all construction and QA, MediaPipe, small embedding models, possibly a small VLM (§N).
18. **GPU / cloud:** image generation and editing, 3D evidence, large VLMs (§N).
19. **Avoid paid services?** Yes, via open models on rented GPU; design provider interfaces (§N).
20. **Meshy:** an optional 3D-evidence provider; the proof's ablation decides whether we need it.
21. **UniRig:** no; canonical weights make it unnecessary (§C).
22. **UniMate:** no (text-to-motion for arbitrary skeletons; unreleased) (§C).
23. **Missed alternatives:** manifold3d, the FLAME 2023 Open CC-BY base, MediaPipe, roster-retrieval identity testing, the
    StyleID-style calibration, the SRM-Hair representation, WrapX, Qwen-Image-Edit / Qwen3-VL (§C).
24. **Multi-view QA:** 14 mounted, animated views with ID buffers and region rules (§J).
25. **Identity QA:** landmarks, silhouettes, colours, roster retrieval, VLM lineup, calibrated (§J).
26. **Style QA:** Mahalanobis, bands, embedding centroid, mounted envelope (§J).
27. **Geometry QA:** construction invariants (§J).
28. **Iterate automatically?** Yes: a bounded optimiser on continuous parameters (§J).
29. **Prevent infinite loops:** budget, stall rule, a repair DAG, no evidence/paid calls inside the loop (§J).
30. **Fail closed:** §J.
31. **Learning:** registry v3, prevention-first (§K).
32. **Confidence:** per-trait, with priors or requests (§F).
33. **Employee #100:** §R.
34. **Edit Avatar:** §R.
35. **What I'd build today:** B as specified. The order: proof (P1) → canonical head → identity QA → hair library → migration
    → runtime → upload / Edit Avatar.

## Decision Points for Bon

1. **Approve architecture B and the proof scope** (Bon / Kael / Lui / Nicole, zero credits)?
2. **Production canonical-head topology:** Bon retopologizes in Blender (recommended), or a FLAME-2023-Open-derived base?
3. **Stage A:** keep Gemini, or evaluate Qwen-Image-Edit (open, rented GPU)?
4. **VLM for the lineup QA:** Claude/Gemini API (simplest) or self-hosted Qwen3-VL?
5. **Legal / privacy read:** the SAM licence terms, FLAME CC-BY attribution, upload consent, and not storing face embeddings.

## Sources

- FLAME (2023 Open, CC-BY-4.0; older versions non-commercial): https://flame.is.tue.mpg.de/ · https://flame.is.tue.mpg.de/modellicense.html
- TRELLIS.2 (MIT; ≥ 24 GB NVIDIA): https://huggingface.co/microsoft/TRELLIS.2-4B · https://app.cinevva.com/guides/ai-3d-model-generators
- Hunyuan3D 2.1 licence (EU/UK/KR excluded): https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE
- Open image-to-3D licences (Step1X-3D Apache; TripoSG/SR MIT): https://www.cmarix.com/blog/top-open-source-ai-models-for-3d-image-generation/
- StdGEN (code Apache; checkpoints research-only): https://github.com/hyz317/StdGEN · https://arxiv.org/html/2411.05738v2
- UniRig (MIT code): https://www.sourcepulse.org/projects/2180219 · https://huggingface.co/VAST-AI/UniRig
- UniMate (Sep 2026): https://www.alphaxiv.org/abs/2609.05415.md
- InsightFace model licensing: https://www.insightface.ai/solutions/face-recognition-licensing · https://pypi.org/project/insightface/0.7.2
- nvdiffrast licence: https://huggingface.co/spaces/ginipick/SORA-3D/blob/e3df509037b8d7a49ea8599caebb1c08922cea96/extensions/nvdiffrast/LICENSE.txt · https://github.com/microsoft/TRELLIS/issues/298
- Pixel3DMM (CC-BY-NC): https://github.com/SimonGiebenhain/pixel3dmm · https://arxiv.org/abs/2505.00615v1
- StyleID (CC-BY-NC-SA): https://arxiv.org/html/2604.21689 · Stylized-Face: https://openaccess.thecvf.com/content/ICCV2025/papers/Peng_Stylized-Face_A_Million-level_Stylized_Face_Dataset_for_Face_Recognition_ICCV_2025_paper.pdf
- SRM-Hair: https://arxiv.org/abs/2503.06154 · DiffLocks: https://difflocks.is.tue.mpg.de/ · Im2Haircut: https://arxiv.org/abs/2509.01469 · HairLRM: https://arxiv.org/pdf/2606.15238
- MediaPipe Face Landmarker: https://ai.google.dev/mediapipe/solutions/vision/face_landmarker · https://huggingface.co/fernandotonon/QtMeshEditor-facemesh-onnx
- Qwen-Image-Edit-2509 (Apache-2.0): https://huggingface.co/Qwen/Qwen-Image-Edit-2509
- Qwen3-VL (Apache-2.0): https://www.local-llm.net/models/qwen3-vl/
- SAM 3 licence: https://blog.roboflow.com/what-is-sam3/ · https://www.infoq.com/news/2025/11/meta-sam3
- SAM 3D Body / MHR (Apache-2.0): https://arxiv.org/abs/2602.15989 · https://pypi.org/project/mhr/
- DINOv3 licence: https://ai.meta.com/resources/models-and-libraries/dinov3-license
- Meshy-6 features: https://runware.ai/docs/models/meshy-6 · https://docs.meshy.ai/pt-PT/api/changelog
- WrapX non-rigid registration: https://russian3dscanner.com/docs/WrapX/wrap.nonRigidRegistration.html
