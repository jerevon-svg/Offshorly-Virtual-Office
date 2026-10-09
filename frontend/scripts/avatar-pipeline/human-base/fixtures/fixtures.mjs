// fixtures.mjs — the registry's REGRESSION FIXTURES: the approved first five (immutable, must PASS every automated class)
// and the batch-2 broken states (immutable, must FAIL exactly their expected classes). History, never activation logic.
const P = "public/avatars/human-base-v1/production", B = "scripts/avatar-pipeline/human-base/fixtures/broken", R = "scripts/avatar-pipeline/output/human-base";
export const APPROVED = ["bon", "micah", "angelo", "clang", "france"].map((w) => ({ name: w, appearanceId: w, identityFile: `${P}/${w}-v1.glb`, recordFile: `${R}/${w}-meshy-chibi-v1-chibify.json` }));
export const BROKEN = [
  { name: "jona-broken-hair-cage", appearanceId: "jona", expect: ["FC-HAIR-AS-SKIN", "FC-BALD-POCKET", "FC-JAW-RIM"] },
  { name: "kael-broken-collar-ears", appearanceId: "kael", expect: ["FC-COLLAR-AS-HAIR"] },
  { name: "kael-broken-ear-nape", appearanceId: "kael", expect: ["FC-NECK-HAIR"] },   // V2 pass-2 candidate Bon rejected: dark collar band (ears stay sign-off)
  { name: "lui-broken-napeskin-flaps", appearanceId: "lui", expect: ["FC-SKIN-FLAP"] },   // gated napeSkin: closure metrics PASS, skin fins — the gate must still fail it
  { name: "lui-broken-ears-closure", appearanceId: "lui", expect: ["FC-CLOSURE-EXPOSED", "FC-JAW-RIM"] },
  { name: "nicole-broken-narrowed-face", appearanceId: "nicole", expect: ["FC-SKULL-CONTRACT", "FC-CLOSURE-EXPOSED"] },   // judged at the AUTOMATIC mount (as the build gates): the mount absorbs the envelope, the contracted skull + closure still fail
  { name: "nicole-broken-long-face-capped", appearanceId: "nicole", expect: ["FC-FACE-ASPECT-GROWTH"] },   // the bounded long-face extension cannot hold her source face → fail closed (no distortion)
  { name: "nicole-broken-oversized-head", appearanceId: "nicole", expect: ["FC-FACE-ASPECT-GROWTH", "FC-CLOSURE-EXPOSED"] },   // the "oversized head" read was hair flare: skull is in band (hair-independent envelope)
  { name: "jona-broken-skin-flaps", appearanceId: "jona", expect: ["FC-SKIN-FLAP"] },   // hair-as-skin relabel stopped at a fixed chin floor: the hair shell's lower band stayed skin (87 verts at hair radius)
  // AUTOMATED-PASS candidates Bon REJECTED on live inspection (2026-10-06): closure interior visible through the gap between
  // the hair's lower edge and the trimmed nape skin, ragged hair-layer edges, hair cutting across the ear, the neck ring.
  // No automated detector separates these from the approved five yet (they carry the same construction) — they must
  // still never pass the gate: the sign-off classes hold them (visualReject), and they are the regression evidence.
  { name: "kael-broken-visible-shred", appearanceId: "kael", expect: [], visualReject: ["FC-EAR-BOUNDARY", "FC-NAPE-ROUGH"] },
  { name: "lui-broken-visible-shred", appearanceId: "lui", expect: [], visualReject: ["FC-EAR-BOUNDARY", "FC-NAPE-ROUGH"] },
].map((f) => ({ ...f, identityFile: `${B}/${f.name}.glb`, recordFile: `${B}/${f.name}.chibify.json` }));
/** REPAIRED states: the same employees rebuilt by the V2 detector-driven build from their clean raws (build-employees.mjs) —
 *  each must pass the classes its broken fixture failed and its detectors repaired. */
const F = "scripts/avatar-pipeline/human-base/fixtures/repaired";
export const REPAIRED = [
  { name: "kael-repaired", appearanceId: "kael", fixes: ["FC-COLLAR-AS-HAIR", "FC-NECK-HAIR", "FC-JAW-RIM"] },
  { name: "jona-repaired", appearanceId: "jona", fixes: ["FC-HAIR-AS-SKIN", "FC-JAW-RIM", "FC-BALD-POCKET", "FC-SKIN-FLAP"] },
  { name: "lui-repaired", appearanceId: "lui", automatedParity: true, fixes: ["FC-JAW-RIM", "FC-FACE-ASPECT-GROWTH", "FC-CLOSURE-EXPOSED"] },   // topology-B jaw closure clip + bounded long-face retention + own-underside keep
].map((f) => ({ ...f, identityFile: `${F}/${f.name}.glb`, recordFile: `${F}/${f.name}.chibify.json` }));
