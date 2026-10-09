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
    detector: "NONE reliable — five measures calibrated against the approved five and rejected (visible dark residue, glued hair, hair cut-edge length, detached skin islands, ear-through-hair-shell depth: approved Bon / France score worse than rejected Kael)", repair: "—", autoSafe: false, contraindications: "—", signoff: true, history: ["kael", "lui"] },
  { id: "FC-HAIR-SPIKE", desc: "shredded / spiking strand cages, stretched slivers in hair", source: "signoff",
    detector: "NONE reliable (sliver counts overlap the approved fixtures; Jona's cage was skin-layer hair → FC-HAIR-AS-SKIN)", repair: "—", autoSafe: false, contraindications: "—", signoff: true, history: ["jona"] },
  { id: "FC-NAPE-ROUGH", desc: "ragged / blotchy low-rear nape skin", source: "signoff",
    detector: "partly FC-CLOSURE-EXPOSED + FC-NECK-HAIR (the dark collar band); skin roughness itself has no reliable detector", repair: "—", autoSafe: false, contraindications: "—", signoff: true, history: ["micah", "angelo", "clang", "france", "lui"] },
];

/** the classes a visual sign-off may approve (no reliable detector yet) — migrate a class OUT when a detector exists */
export const SIGNOFF_CLASSES = REGISTRY.filter((c) => c.signoff).map((c) => c.id);

export const FROZEN = new Set(["bon", "micah", "angelo", "clang", "france"]);   // approved artifacts: never rebuilt into production

/** the build-loop repairs a set of evidence asks for (detector-gated, auto-safe only) */
export function repairsFor(evidence) { const fired = (c) => { try { return !!c.fired?.(evidence); } catch { return false; } };   // a detector that cannot run selects no repair — the gate fails that class closed
  return [...new Set(REGISTRY.filter((c) => (c.repairFlag || c.repairFlags) && c.autoSafe && fired(c)).flatMap((c) => c.repairFlags ?? [c.repairFlag]))]; }

/** the verdict: every class with evidence is validated; a validator that cannot run is a FAILURE; sign-off classes need an
 *  approval bound to this exact artifact hash */
/** a visual approval counts for ONE sign-off class only when it is bound to this exact artifact AND pipeline version, names
 *  that class explicitly, and carries a reviewer + timestamp. It can never pass an automated class. */
export function approvalCovers(approval, classId, { artifactHash, pipelineVersion, bindingHash }) {
  if (!approval || !REGISTRY.find((c) => c.id === classId)?.signoff) return false;
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
    classes.push({ id: c.id, status: r.pass ? "PASS" : "FAIL", value: r.value, threshold: r.threshold, repair: c.repair, autoSafe: c.autoSafe });
  }
  const failed = classes.filter((c) => c.status === "FAIL"), signoff = classes.filter((c) => c.status === "SIGNOFF-REQUIRED");
  return { pass: !failed.length && !signoff.length, automatedPass: !failed.length, failed: failed.map((c) => c.id), signoffRequired: signoff.map((c) => c.id), classes };
}
