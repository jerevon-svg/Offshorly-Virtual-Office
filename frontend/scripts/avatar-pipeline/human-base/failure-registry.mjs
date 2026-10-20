// failure-registry.mjs — THE HUMANBASE FAILURE REGISTRY (V2, 2026-10-06). ZERO CREDITS.
//
// Every failure class the pipeline has learned, as DATA: a stable id, the detector that measures it on THIS build, the
// threshold (calibrated on the approved first five = immutable passing fixtures, and on the batch-2 broken fixtures =
// immutable failing fixtures), the repair that runs when it fires, contraindications, and the validation after repair.
//
//   DETECT FAILURE CLASS → APPLY ITS REPAIR (only if auto-safe) → REBUILD FROM THE CLEAN RAW → REVALIDATE → PASS or FAIL CLOSED
//
// Employee names appear ONLY in `history` (who first exposed the class) — never in activation. A detected, unresolved class
// is a build FAILURE (the candidate never reaches production/). A class no detector separates reliably is a mandatory,
// artifact-hash-bound VISUAL SIGN-OFF — it can never silently pass.
//
// Evidence sources:  record  = the build's chibify record (in-stage detections, measured source vs after)
//                    artifact = the optimised identity file (check-identity identityMetrics + failure-detectors.mjs)
//                    mounted  = the final avatar on the production runtime (mounted-gate.run.ts: preset, uniform, accessories, HEAD_MOUNT)

/** @typedef {{ pass: boolean, value: unknown, threshold: string }} Verdict */
const v = (pass, value, threshold) => ({ pass: !!pass, value, threshold });

/** the nape closure in motion: the worst sample over the bind pose + idle + walk (pct overall, worst view) — one definition, gate + tests */
export const closureInMotion = (e) => { const M = e.mounted.motion; if (!M) throw new Error("no motion evidence"); let pct = 0, worst = 0, at = null; for (const [pose, x] of Object.entries(M)) { pct = Math.max(pct, x.pct); if (x.worstPct > worst) { worst = x.worstPct; at = `${pose}/${x.worstView}`; } } return { pct, worstPct: worst, at }; };
/** PRODUCTION MOTION BAND (Option A, Bon 2026-10-19): the approved five's own measured maxima on closureInMotion (bon 6.67 / 16.87,
 *  micah 4.91 / 23.42, angelo 5.21 / 11.27, clang 3.9 / 16.32, france 6.99 / 20.85). Inside it the measure does NOT separate production
 *  quality from visually rejected napes (kael-visible-shred 6.99 / 13.72, kael-ear-nape 4.35 / 9.49 sit in it too), so a head there is
 *  never passed automatically: it goes to VISUAL REVIEW (a hash-bound sign-off of this class). Above it = FAIL (lui-visible-shred,
 *  lui-ears-closure, jona-hair-cage). The welded tier (≤ 1 % / ≤ 5 %) passes automatically as before. */
export const PRODUCTION_MOTION_BAND = Object.freeze({ pct: 6.99, worstPct: 23.42 });
/** EXACT-ASSET GRANDFATHERING: the five approved production files — signed off before a `grandfather` class existed — keep that
 *  sign-off for such classes by their EXACT bytes (sha256 of the file) only. A rebuild, a modified copy or a new employee has other bytes
 *  and is gated in full; no other class is ever waived. */
export const GRANDFATHERED = Object.freeze({
  cc44556c73a3cc34f688a429f0db78b3de4354b0c40a5a6b6b58a0e2c81dc1f7: "production/bon-v1.glb",
  ac1f9eadbd7cdc5b268b13cf5267e769f2ee4a5cd6093aad66eda16f20213668: "production/micah-v1.glb",
  c5e6cc2858fc5f8dec31bd95a92422a52361c46f84083d40b2ae797b7cdea685: "production/angelo-v1.glb",
  "8e8ae9b47af76b49cd6c307e8dc32ecc6023a0b945ab71f8c4dca991382f95f2": "production/clang-v1.glb",
  "0123b638cab51a430a916338e6796d646062c14ed51ab6d97471d4104a39a355": "production/france-v1.glb",
});
export const REGISTRY = [
  // ---------------- recovered: automatic in-stage repairs (V1.1–V1.4) — validated on the artifact ----------------
  { id: "FC-FRINGE-EYE", desc: "fringe mistaken for eye paint / hair into the face / an eye cutting through hair", source: "artifact",
    detector: "chibify hair-layers bilateral symmetry contamination test (in-stage)", repair: "fringe lift + fringe texture page + face underlay (in-stage, automatic)", autoSafe: true,
    contraindications: "none known", validate: (e) => v(!e.artifact.fringe || (e.artifact.fringe.intoFace === 0 && e.artifact.fringe.eyeCutsHair === 0), e.artifact.fringe, "intoFace = 0 and eyeCutsHair = 0"), history: ["bon", "micah"] },
  { id: "FC-EYE-COVERED", desc: "an eye partly under a fused lock — incomplete / mirrored-wrong eye", source: "artifact",
    detector: "per-side visible eye-white count vs its partner (in-stage)", repair: "mirrored twin patch + eye completion from the twin (in-stage, automatic)", autoSafe: true,
    contraindications: "none known", validate: (e) => v(!e.artifact.fringe || e.artifact.fringe.eyeCutsHair === 0, e.artifact.fringe?.eyeCutsHair ?? 0, "eyeCutsHair = 0"), history: ["clang", "france"] },
  { id: "FC-BROW-GAP", desc: "brow geometry on hair-motion joints drifting off the face; pale gaps inside the brow", source: "artifact",
    detector: "featuresOnHairJoints (brow-band hair vertices not 100 % Head)", repair: "rigid facial features + brow closing (in-stage, automatic)", autoSafe: true,
    contraindications: "saturated hair next to the brow (see FC-DYED-HAIR-BROW)", validate: (e) => v(e.artifact.featuresOnHairJoints === 0, e.artifact.featuresOnHairJoints, "= 0"), history: ["clang"] },
  { id: "FC-BALD-POCKET", desc: "side / back skin enclosed by hair (bald pockets)", source: "artifact",
    detector: "baldPocketCells (outer radial map; ear-box cells excluded — an ear is not a pocket)", repair: "hair base cap + enclosed-run pocket closure (in-stage, automatic) + crownSkinRelabel (BUILD-LOOP: skin-labelled hair-shell pieces standing off the skull inside the hair mass, which the cap under the hair cannot cover)", repairFlag: "crownSkinRelabel", autoSafe: true,
    contraindications: "a real bald pocket / parting lies ON the skull and is never relabelled", fired: (e) => e.artifact.baldPocketCells >= 20,
    validate: (e) => v(e.artifact.baldPocketCells < 20, e.artifact.baldPocketCells, "< 20 cells (approved ≤ 9 with ears excluded)"), history: ["france", "jona"] },
  { id: "FC-OPEN-HEAD", desc: "directions from the head centre that see no surface (an open view into the head)", source: "artifact",
    detector: "openDirections (spherical visibility map)", repair: "interior closure + skull-base filler (in-stage, automatic)", autoSafe: true,
    contraindications: "none", validate: (e) => v(e.artifact.openDirections < 1.6, e.artifact.openDirections, "< 1.6 % (approved ≤ 1.39; the V1.4 limit 0.5 failed approved Micah)"), history: ["micah"] },
  { id: "FC-SKULL-CONTRACT", desc: "the head no longer fits the canonical skull (face edited inside an unchanged skull, wrong skull fit)", source: "record",
    detector: "output ear half-width / canonical (the build's own skull-width measurement)", repair: "canonical skull-width loop (CLI, automatic)", autoSafe: true,
    contraindications: "a hidden ear measures side skin — see FC-EARS-UNRELIABLE", validate: (e) => v(Math.abs(e.record.skullWidth - 1) <= 0.015, e.record.skullWidth, "|w − 1| ≤ 1.5 %"), history: ["nicole (narrowed)"] },
  { id: "FC-JAW-RIM", desc: "rough jaw / head-neck seam: closure hanging below the head underside in front of the neck. TWO topologies were collapsed here (batch 2): A = a ragged open skin rim (rimTuck tucks it; its jaw-band clip only ran when a rim was found), B = closure hanging below a head with NO open rim (Lui 314 → 314: the clip never ran) or outside the tuck's own neck ring (Jona 121 → 74)", source: "artifact",
    detector: "closureBelowJaw", repair: "rimTuck (topology A: tuck the open rim, no-op when none) + jawClosureClip (topology B: clip hanging closure with the gate's own geometry) — BUILD-LOOP, detector-gated", repairFlags: ["rimTuck", "jawClosureClip"], autoSafe: true,
    contraindications: "behind the neck axis the closure keeps the head closed from below and is never clipped (FC-OPEN-HEAD / FC-CLOSURE-EXPOSED re-validate)", fired: (e) => e.artifact.closureBelowJaw >= 40,
    validate: (e) => v(e.artifact.closureBelowJaw < 40, e.artifact.closureBelowJaw, "< 40"), history: ["bon", "angelo", "clang", "france", "jona", "kael"] },
  { id: "FC-ACCESSORY-FIT", desc: "WORN glasses / hair accessories inside the face or skull", source: "artifact",
    detector: "glasses fit check (worn styles only) · accessory inside-skull count", repair: "fit-space refit (runtime, automatic)", autoSafe: true,
    contraindications: "unworn shared styles are not this employee's failure (V1.4 failed Jona on styles she does not wear)",
    validate: (e) => { const worn = e.worn ?? [], bad = worn.filter((id) => { const g = e.artifact.glasses?.[id]; return g && !(g.inFace === 0 && g.templeInsideSkull === 0 && g.check?.ok); });
      // a worn accessory is judged by its RUNTIME placement (attached: socket fit) where one exists, else by the built module —
      // the static preview GLB of a socket accessory (V1.4 hairAccessories) is not where it is worn (approved Clang: 8 → 0)
      const accBad = (e.wornAccessories ?? []).filter((id) => { const at = e.artifact.attached?.[id]; if (at && typeof at === "object") return !(at.insideSkull === 0 && at.check?.ok); const h = e.artifact.hairAccessories?.[id]; return h ? h.insideSkull > 0 : false; });
      return v(!bad.length && !accBad.length, { badGlasses: bad, badAccessories: accBad }, "worn glasses fit, worn accessories outside the skull at their runtime placement"); }, history: ["micah", "clang", "france"] },
  // ---------------- converted from employee switches to in-stage detectors (batch 2) ----------------
  { id: "FC-EARS-UNRELIABLE", desc: "ears hidden under hair: lateral 'ear' skin is the cheek, the depth fit pushes the face into the hair curtain", source: "record",
    detector: "(eye depth − ear depth) / ear half-width < 0.7 (approved 0.83–1.11)", repair: "ear plane from the canonical eye-plane depth (in-stage, detector-gated)", autoSafe: true,
    contraindications: "visible ears", validate: (e) => v(!e.record.detections?.earsUnreliable?.fired || e.record.detections.earsUnreliable.applied !== false, e.record.detections?.earsUnreliable ?? null, "fired ⇒ repaired in-stage"), history: ["nicole"] },
  { id: "FC-SHOULDER-IMPLAUSIBLE", desc: "long hair spread below the chin read as the bust's shoulder line (at/above the chin)", source: "record",
    detector: "shoulder line ≥ chin − 0.02", repair: "re-measure the flare on non-hair vertices (in-stage, detector-gated)", autoSafe: true,
    contraindications: "none", validate: (e) => v(true, e.record.detections?.shoulderImplausible ?? null, "fired ⇒ re-measured in-stage"), history: ["nicole"] },
  { id: "FC-DYED-HAIR-BROW", desc: "saturated hair paint beside the brow consolidated into the brow's black", source: "record",
    detector: "hair colour chroma (Lab) > 30 (natural hair ≤ 5.4)", repair: "saturated texels are never brow (in-stage, detector-gated)", autoSafe: true,
    contraindications: "brown brow paint on brown hair (chroma kept below the natural-hair range)", validate: (e) => v(true, e.record.detections?.dyedHair ?? null, "fired ⇒ guarded in-stage"), history: ["jona"] },
  // ---------------- new classes (batch 2) ----------------
  { id: "FC-COLLAR-AS-HAIR", desc: "a generated shirt collar kept as identity hair (shirt and hair colours indistinguishable)", source: "artifact",
    detector: "hair-layer vertices below the chin, in front of the neck axis, near the midline", repair: "collarCull — drop below-chin kept 'hair' in that zone (BUILD-LOOP, detector-gated)", repairFlag: "collarCull", autoSafe: true,
    contraindications: "long front locks hang BESIDE the face (outside the midline zone) and are not touched", fired: (e) => e.artifact.collarHair.verts > 4,
    validate: (e) => v(e.artifact.collarHair.verts <= 4, e.artifact.collarHair, "≤ 4 verts (approved ≤ 1)"), history: ["kael"] },
  { id: "FC-NECK-HAIR", desc: "a generated neck / collar painted dark, labelled hair, left INSIDE the neck column — a dark rough band at the head-to-tee transition (rear / low-rear)", source: "artifact",
    detector: "hair-layer vertices inside the HumanBase neck column (r < 0.17) at neck height (y 0.78–0.96)", repair: "neckHairClear — kept hair inside that column / band dropped at the keep stage (BUILD-LOOP, detector-gated)", repairFlag: "neckHairClear", autoSafe: true,
    contraindications: "hanging hair stands OFF the neck (approved long styles ≤ 74 verts inside) and is not touched; root cause seen: the generated-neck ellipse measured forward (cz +0.11, shallow) so the column deletion missed the back of the neck", fired: (e) => e.artifact.neckHair.verts > 300,
    validate: (e) => v(e.artifact.neckHair.verts <= 300, e.artifact.neckHair, "≤ 300 verts (approved ≤ 74)"), history: ["kael"] },
  { id: "FC-HAIR-AS-SKIN", desc: "hair geometry left in the SKIN layer (warm / dyed hair near the skin tone) — no hair processing reaches it; spikes and cages at the face", source: "artifact",
    detector: "head-layer area standing ≥ 3 cm-eq off the canonical skull, away from ears and face front, non-skin colour", repair: "hairAsSkinRelabel — those vertices relabelled hair before the layer split (BUILD-LOOP, detector-gated)", repairFlag: "hairAsSkinRelabel", autoSafe: true,
    contraindications: "beards / sideburns on the face front are excluded by the face-front cut", fired: (e) => e.artifact.hairAsSkin.areaPct > 2,
    validate: (e) => v(e.artifact.hairAsSkin.areaPct <= 2, e.artifact.hairAsSkin, "≤ 2 % of head-layer area (approved ≤ 0.45 %)"), history: ["jona"] },
  { id: "FC-SKIN-FLAP", desc: "skin standing far out of the skull below the eye line behind the ears — fins / panels (the withdrawn napeSkin grew them on Lui while passing every closure metric; also skin-layer hair left standing off the head)", source: "artifact",
    detector: "head-layer + generated-nape-skin vertices > 0.08 outside the canonical skull (eye line − 0.1 … neck top, behind the ear plane, ears excluded)", repair: "none auto-safe yet (a relabel at the classification stage was tried and is ineffective: the far-standing pieces are placed by a later stage) — fails closed", autoSafe: false,
    contraindications: "—", validate: (e) => v(e.artifact.skinFlaps.verts <= 20, e.artifact.skinFlaps, "≤ 20 verts (approved 0; max excess approved 0.061)"), history: ["lui (napeSkin experiment)", "jona"] },
  { id: "FC-CLOSURE-EXPOSED", desc: "closure geometry (interior / skull-base filler) seen first from gameplay low / rear / neck views on the MOUNTED, DRESSED avatar", source: "mounted",
    detector: "orthographic z-buffers over 12 views, head pixels below the eye line, body + garments as occluders", repair: "keepOwnUnderside — the identity's OWN skin below the canonical underside is kept down to the neck attachment line outside the neck column (the head is structurally complete with zero hair; the interior conforms inside it). BUILD-LOOP, detector-gated. (napeSkin stays withdrawn: gated on Lui it passed this metric and grew skin fins — FC-SKIN-FLAP now fails it)", repairFlag: "keepOwnUnderside", autoSafe: true,
    contraindications: "haired heads never fire it (approved ≤ 6.08 %); a kept underside that juts out is caught by FC-SKIN-FLAP", fired: (e) => e.mounted.closure.pct > 8 || e.mounted.closure.worstPct > 26, validate: (e) => v(e.mounted.closure.pct <= 8 && e.mounted.closure.worstPct <= 26, e.mounted.closure, "≤ 8 % overall and ≤ 26 % worst view (approved ≤ 6.08 / 22.91)"), history: ["lui", "nicole"] },
  { id: "FC-HEAD-ENVELOPE", desc: "whole-head / face / body relationship broken: the SKULL too small / large for the shoulders, or the face squeezed inside its skull — measured HAIR-INDEPENDENTLY (hair volume is identity; the V2.0 hair-inclusive version read Nicole's flared bob as an oversized skull)", source: "mounted",
    detector: "mounted identity-skin width at the eye line / shoulders · cheek width / that skin width (hair-inclusive width kept as evidence)", repair: "none auto-safe", autoSafe: false,
    contraindications: "hair volume is never judged here",
    validate: (e) => { const m = e.mounted; return v(m.skullWToShoulder >= 0.46 && m.skullWToShoulder <= 0.6 && m.cheekWToSkullW >= 0.72 && m.skullHToBody >= 0.81 && m.skullHToBody <= 1.09, { skullWToShoulder: m.skullWToShoulder, cheekWToSkullW: m.cheekWToSkullW, skullHToBody: m.skullHToBody, headWincHairToShoulder: m.headWToShoulder }, "skull/shoulders 0.46–0.60 · cheek/skull ≥ 0.72 · skull height/body 0.81–1.09 (approved 0.492–0.557 · 0.798–0.894 · 0.873–1.016) — the hard limit for a naturally long head"); }, history: ["nicole (narrowed)"] },
  { id: "FC-FACE-BODY-SCALE", desc: "mounted face size against the body outside the approved family", source: "mounted",
    detector: "chin→eye / neck-top height", repair: "AUTOMATIC mount normalization in the gate (face size vs canonical Bon from six hair-independent measures, ×0.98 feminine, then held inside the approved chin→eye/body band — reproduces the hand-approved mounts of the first five within ±0.01)", autoSafe: true,
    contraindications: "—", validate: (e) => v(e.mounted.faceLenToBody >= 0.43 && e.mounted.faceLenToBody <= 0.5, e.mounted.faceLenToBody, "0.43–0.50 (approved 0.451–0.482)"), history: [] },
  { id: "FC-FACE-ASPECT-GROWTH", desc: "a long source face compressed into the canonical eye-line envelope comes out round / wide (source-relative identity distortion)", source: "record",
    detector: "(cheek / face length) after chibify ÷ the same in the employee's own generated source", repair: "BOUNDED LONG-FACE RETENTION (in-stage, automatic): when growth exceeds the approved band the face keeps more of its own length (bracketed search to the band edge); no native eye-line ceiling — the mounted envelope (skull height / width, face vs body) is the hard limit and fails closed. Face-only narrowing was REJECTED", autoSafe: true,
    contraindications: "natural wide faces are wide in the source too and pass", validate: (e) => v(e.record.aspectGrowth <= 1.45, e.record.aspectGrowth, "≤ 1.45 (approved 1.19–1.42)"), history: ["nicole", "lui"] },
  // ---------------- no reliable automatic detector yet: mandatory, hash-bound visual sign-off ----------------
  { id: "FC-EAR-BOUNDARY", desc: "dirty skin / hair fragments / cut-outs around the ears", source: "signoff",
    detector: "NONE reliable — 2026-10-12 separation matrix: hair through ear skin (visible: approved 84–319 vs rejected 202–335), closure visible near the ears (approved 7–365 vs rejected 5–678), ear-edge raggedness of visible skin / hair (approved 0.62–0.80 vs rejected 0.58–0.71) all overlap; before that five measures calibrated against the approved five and rejected (visible dark residue, glued hair, hair cut-edge length, detached skin islands, ear-through-hair-shell depth: approved Bon / France score worse than rejected Kael)", repair: "—", autoSafe: false, contraindications: "—", signoff: true, history: ["kael", "lui"] },
  { id: "FC-HAIR-SPIKE", desc: "shredded / spiking strand cages, stretched slivers in hair", source: "signoff",
    detector: "NONE reliable — 2026-10-12: VISIBLE stretched slivers (longest edge > 4× the layer median, aspect > 10) read approved 16.8–53.1 ‰ vs the only real hair reject (Jona's cage, already FC-HAIR-AS-SKIN) 17.0 ‰ and welded builds up to 79.5 ‰; a labelled SYNTHETIC spike case (30 vertices pulled 0.25 eye spacings out) moved Angelo only 19.2 → 21.4 ‰ — no real separation and no real spike fixture, so no detector (earlier: sliver counts overlap the approved fixtures)", repair: "—", autoSafe: false, contraindications: "—", signoff: true, history: ["jona"] },
  { id: "FC-NAPE-ROUGH", desc: "ragged / blotchy low-rear nape skin", source: "signoff",
    detector: "the closure part is AUTOMATIC since 2026-10-12 (FC-CLOSURE-EXPOSED-IN-MOTION, blocking; every visually rejected nape fixture fails it) + FC-NECK-HAIR (the dark collar band); the ragged / blotchy SKIN itself has no separating measure (nape-window raggedness of visible skin / hair edges and identity-space closure overlap approved vs rejected) — sign-off retained for it", repair: "—", autoSafe: false, contraindications: "—", signoff: true, history: ["micah", "angelo", "clang", "france", "lui"] },
  // NAPE CLOSURE IN MOTION (blocking since 2026-10-12, was report-only): FC-CLOSURE-EXPOSED's own measure in the poses VO shows. The
  // separation matrix (approved / visually rejected / repaired / welded): every visually rejected nape fixture 4.35–22.34 % / 9.49–37.37 %,
  // every welded build 0.27–0.53 % / 0.86–2.38 % — the thresholds sit in a 4–8× gap. The approved five (old closure, signed off before this
  // class existed) read 3.9–7.0 % / 11.3–23.4 %: GRANDFATHERED by their exact bytes only, never a rebuild, a modified copy or a new employee
  { id: "FC-CLOSURE-EXPOSED-IN-MOTION", desc: "closure (interior / skull-base filler) seen first from the gate's low / rear / neck views while the avatar IDLES and WALKS, hair dynamics swinging — FC-CLOSURE-EXPOSED's own measure in the poses VO shows (the bind pose holds the hair at rest over the nape): the visible gap between the hair's lower edge and the nape that the visual rejections named", source: "mounted",
    detector: "mounted-gate motionEvidence: the idle and walking clips played frame by frame (one cycle of warm-up), three samples each, closureExposure per sample over the twelve gate views",
    validate: (e) => { const m = closureInMotion(e), B = PRODUCTION_MOTION_BAND, T = `≤ 1 % / ≤ 5 % automatic; ≤ ${B.pct} % / ≤ ${B.worstPct} % (the approved five's band) = visual review; above = fail`;
      if (!(m.pct > 1 || m.worstPct > 5)) return v(true, { ...m, tier: "welded" }, T);
      return m.pct <= B.pct && m.worstPct <= B.worstPct ? { ...v(true, { ...m, tier: "production-band" }, T), review: true } : v(false, { ...m, tier: "above-band" }, T); },
    reviewBand: true,
    calibration: "2026-10-12 separation matrix (mounted, as the contract tests mount): rejected kael-visible-shred 6.99 / 13.72, lui-visible-shred 14.95 / 23.94, kael-ear-nape 4.35 / 9.49, lui-ears-closure 22.34 / 37.37, jona-hair-cage 6.38 / 26.36 · welded lui 0.53 / 2.38, angelo 0.36 / 1.09, france 0.27 / 0.86 · approved (grandfathered) bon 6.67 / 16.87, micah 4.91 / 23.42, angelo 5.21 / 11.27, clang 3.9 / 16.32, france 6.99 / 20.85",
    fired: (e) => { const m = closureInMotion(e); return m.pct > 1 || m.worstPct > 5; }, repairFlag: "keepOwnUnderside",
    repair: "keepOwnUnderside (BUILD-LOOP, detector-gated, 2026-10-13): the identity's own underside skin is kept so the welded underside (development default for rigid / short hair) can still form after the automatic identity correction — on the first unattended new-employee run the corrected rim folded back without it and the weld fell back; the gate re-validates every class after the repair", autoSafe: true, contraindications: "—", grandfather: true, history: ["bon", "kael", "clang", "lui", "france", "micah", "angelo", "jona", "nicole", "luie2e"] },
];

/** the classes a visual sign-off may approve (no reliable detector yet) — migrate a class OUT when a detector exists */
export const SIGNOFF_CLASSES = REGISTRY.filter((c) => c.signoff).map((c) => c.id);
/** what a reviewer may approve: the sign-off classes + automated classes whose measure has an ambiguous REVIEW band (approval counts
 *  only while the measurement sits in that band — never over a FAIL) */
export const APPROVABLE_CLASSES = REGISTRY.filter((c) => c.signoff || c.reviewBand).map((c) => c.id);

export const FROZEN = new Set(["bon", "micah", "angelo", "clang", "france"]);   // approved artifacts: never rebuilt into production

/** REPORT-ONLY DETECTORS (2026-10-10): measured on every build and written to its report, NEVER part of the verdict (they cannot fail,
 *  pass or approve anything). A detector lives here once it separates the approved five (clear) from the visually rejected fixtures
 *  (fired) with margin; it moves into REGISTRY as an automated class when enough independent cases back it. A candidate measure that
 *  misses its negatives never gets here (2026-10-10: floating skin pieces — the approved heads show small separate skin / closure
 *  pieces as large as the rejected ones, in area, in 3D welding and in image-space detachment; the visible difference is not measured yet). */
export const REPORT_ONLY = [
  { id: "FC-CLOSURE-THROUGH-HAIR", desc: "closure (skin-toned skull filler) showing through a gap in the haircut: a visible closure patch walled in by hair, in the poses VO shows — the gap between the scalp hair's lower edge and the nape opens in MOTION, so the bind-pose gate never saw it", source: "mounted",
    detector: "mounted-gate closureWalls: orthographic label renders over the level / neck / under-hairline / front views, bind pose + idle clip at three phases; per closure patch, the hair share of its border",
    measure: (e) => { const P = e.mounted.closureWalls; if (!P) throw new Error("no closure-wall evidence"); let worst = 0, at = null, bind = 0;
      for (const [pose, V] of Object.entries(P)) for (const [view, x] of Object.entries(V)) { const w = Math.max(0, ...x.walled.filter((p) => p[1] >= 0.8).map((p) => (1000 * p[0]) / Math.max(1, x.headPx)));
        if (w > worst) { worst = w; at = `${pose}/${view}`; } if (pose === "bind") bind = Math.max(bind, w); }
      return { worstPermille: +worst.toFixed(1), at, bindPermille: +bind.toFixed(1) }; },
    fired: (m) => m.worstPermille >= 15, threshold: "largest visible closure patch with ≥ 80 % hair border < 15 ‰ of the view's head",
    calibration: "approved five ≤ 2.5 ‰ · visually rejected short-haircut states 54–58 ‰ (0 ‰ in the bind pose) · a broken bob fixture 80 ‰", repair: "— (next: close the scalp-hair / nape gap that opens in motion)", history: ["lui"] },
  { id: "FC-FRINGE-INTO-FACE-EXACT", desc: "a fringe strand SUNK into the face — FC-FRINGE-EYE's into-face test measured exactly (ray-cast face depth at each point, whole sunk triangles by area), so compression / grid sampling cannot flip it (France flipped 0 ↔ 1 on identical fringe geometry, 2026-10-12)", source: "artifact",
    detector: "fringe-exact.mjs fringeIntoFaceExact: FC-FRINGE-EYE's window (5–30 mm behind the face), frontal zone and silhouette rule on the exact surface; area of fringe triangles with all three corners inside",
    measure: (e) => { const m = e.artifact.fringeExact; if (!m) throw new Error("no exact fringe measure"); return { sunkArea: m.sunkArea, sunkTris: m.sunkTris, inside: m.inside }; },
    fired: (m) => m.sunkArea > 0, threshold: "no fringe triangle sunk whole inside the face",
    calibration: "approved five 0 · France fair6 / v10 / v11 0 · France v8 (uncapped fairing) 1.9e-5 · negative fixtures (fixtures/report-only) 3.6e-4, 6.5e-4 · blind spot: a strand sunk AT the face outline (FC-FRINGE-EYE catches it)", repair: "— (report-only)", history: ["france"] },
  { id: "FC-UNDERSIDE-FOLD", desc: "the welded underside folds BACK over the skin at the weld (≥ 90° to the skin triangle across a rim edge) or into a FIN (two of its own triangles > 120° apart): a lip / pleat at the collar that no texture hides", source: "artifact",
    detector: "underside-weld.mjs weldFoldBacks on the shipped file: rim edges matched to the skin by position (nearest within 0.2 mm-eq, compression moves less), oriented normals; fins by position-matched neighbour edges",
    measure: (e) => { const m = e.artifact.undersideFold; if (!m) throw new Error("no underside fold measure"); return m; },
    fired: (m) => m.foldBacks > 0 || m.fins > 0, threshold: "no fold-back at the weld, no fin",
    calibration: "fires on the v15 France weld (fixtures/report-only/france-v15-underside-fold.glb: 33 fold-backs, 11 fins) and the shipped v14 Lui / Bon welds (12 / 31, 5 / 26); 0 where no welded underside exists (the approved five)", repair: "— (report-only)", history: ["lui", "bon", "france"] },
  { id: "FC-HAIR-THROUGH-UNDERSIDE", desc: "MOVING hair passing THROUGH the welded underside or the closure while the avatar idles / walks (exact triangle tests on the skinned, dynamics-driven mesh); moving hair through the skin is reported alongside", source: "mounted",
    detector: "mounted-gate motionEvidence hairThrough: every identity hair layer but the rigid base cap / scalp against baked_underside, baked_interior / skullbase and identity_head / face_twin",
    measure: (e) => { const M = e.mounted.motion; if (!M) throw new Error("no motion evidence"); let u = 0, c = 0, sk = 0, at = null; for (const [pose, x] of Object.entries(M)) { const h = x.hairThrough; if (h.underside + h.closure > u + c) at = pose; u = Math.max(u, h.underside); c = Math.max(c, h.closure); sk = Math.max(sk, h.skin); } return { underside: u, closure: c, skin: sk, at }; },
    fired: (m) => m.underside > 0 || m.closure > 0, threshold: "no moving-hair triangle through the underside or the closure",
    calibration: "2026-10-12 walking: through the closure Clang 26, France 256, Micah 7, Jona 9, Nicole 156 (fallbacks); France v15 weld 179 underside + 116 closure; Bon, Kael, Lui, Angelo 0 · through the skin 657–5095 everywhere (roots seated in the scalp by design — reported, never fired)", repair: "— (report-only)", history: ["clang", "france", "micah", "jona", "nicole"] },
];

/** the report-only findings for one candidate (never part of the verdict); a measure that cannot run says so */
export function reportOnly(evidence) {
  return REPORT_ONLY.map((d) => { if (!evidence?.[d.source]) return { id: d.id, status: "NOT-MEASURED", value: `no ${d.source} evidence`, threshold: d.threshold };
    try { const value = d.measure(evidence); return { id: d.id, status: d.fired(value) ? "FIRED" : "CLEAR", value, threshold: d.threshold, calibration: d.calibration }; }
    catch (err) { return { id: d.id, status: "NOT-MEASURED", value: `measure error: ${err.message}`, threshold: d.threshold }; } });
}

/** the build-loop repairs a set of evidence asks for (detector-gated, auto-safe only) */
export function repairsFor(evidence) { const fired = (c) => { try { return !!c.fired?.(evidence); } catch { return false; } };   // a detector that cannot run selects no repair — the gate fails that class closed
  return [...new Set(REGISTRY.filter((c) => (c.repairFlag || c.repairFlags) && c.autoSafe && fired(c)).flatMap((c) => c.repairFlags ?? [c.repairFlag]))]; }

/** the verdict: every class with evidence is validated; a validator that cannot run is a FAILURE; sign-off classes need an
 *  approval bound to this exact artifact hash */
/** a visual approval counts for ONE sign-off class only when it is bound to this exact artifact AND pipeline version, names
 *  that class explicitly, and carries a reviewer + timestamp. It can never pass an automated class. */
export function approvalCovers(approval, classId, { artifactHash, pipelineVersion, bindingHash }) {
  const c = REGISTRY.find((x) => x.id === classId); if (!approval || !(c?.signoff || c?.reviewBand)) return false;
  return approval.artifactHash === artifactHash && approval.pipelineVersion === pipelineVersion && !!bindingHash && approval.bindingHash === bindingHash && Array.isArray(approval.classes) && approval.classes.includes(classId)
    && typeof approval.reviewer === "string" && approval.reviewer.trim().length > 0 && !Number.isNaN(Date.parse(approval.timestamp ?? ""));
}

export function evaluate(evidence, { approval = null, artifactHash = null, pipelineVersion = null, bindingHash = null } = {}) {
  const classes = [];
  for (const c of REGISTRY) {
    if (c.signoff) { const ok = approvalCovers(approval, c.id, { artifactHash, pipelineVersion, bindingHash });
      classes.push({ id: c.id, status: ok ? "PASS" : "SIGNOFF-REQUIRED", value: ok ? { reviewer: approval.reviewer, at: approval.timestamp } : null, threshold: "visual sign-off bound to artifact hash + validated mount + pipeline version + this class" }); continue; }
    if (!evidence[c.source]) { classes.push({ id: c.id, status: "FAIL", value: `no ${c.source} evidence`, threshold: "evidence required" }); continue; }
    let r; try { r = c.validate(evidence); } catch (err) { classes.push({ id: c.id, status: "FAIL", value: `validator error: ${err.message}`, threshold: "validator must run" }); continue; }
    if ((!r.pass || r.review) && c.grandfather && artifactHash && GRANDFATHERED[artifactHash]) { classes.push({ id: c.id, status: "GRANDFATHERED", value: { asset: GRANDFATHERED[artifactHash], measured: r.value }, threshold: r.threshold }); continue; }
    if (r.pass && r.review) { const ok = approvalCovers(approval, c.id, { artifactHash, pipelineVersion, bindingHash });   // the ambiguous band: a visual decision, never automatic
      classes.push({ id: c.id, status: ok ? "PASS" : "SIGNOFF-REQUIRED", value: ok ? { ...r.value, reviewer: approval.reviewer, at: approval.timestamp } : r.value, threshold: r.threshold }); continue; }
    classes.push({ id: c.id, status: r.pass ? "PASS" : "FAIL", value: r.value, threshold: r.threshold, repair: c.repair, autoSafe: c.autoSafe });
  }
  const failed = classes.filter((c) => c.status === "FAIL"), signoff = classes.filter((c) => c.status === "SIGNOFF-REQUIRED");
  return { pass: !failed.length && !signoff.length, automatedPass: !failed.length, failed: failed.map((c) => c.id), signoffRequired: signoff.map((c) => c.id), classes };
}
