// studio/orchestrator.mjs — THE CONNECTED UPLOAD → AVATAR WORKFLOW (2026-10-13). A pure planner (plan) over a person's on-disk
// state (stateOf): which stage runs next, which waits for an explicit PAID approval, which is blocked by a failure — and a stage is
// done only when its artifact was made FROM the current inputs (hash / time association), so a re-upload re-runs everything after it
// and a resumed run continues where it stopped. Paid stages (photo → illustration, Meshy head) never run without approval; a mock
// (SIMULATED, labelled in provenance, never promotable) can stand in for them. Run from frontend/.
import fs from "node:fs";
import { productionCandidate } from "../candidate-versions.mjs";
import { readProvenance, sha256File } from "./provenance.mjs";
import { rawHeadFile, recipeHeadVersion } from "../head-version.mjs";

export const STAGES = ["illustrate", "identity", "illustrationQA", "meshy", "build", "sheet", "export"];
export const PAID = { illustrate: "one gpt-image-1 images/edits call (photo → front illustration)", meshy: "≈30 Meshy credits (one image-to-3D head)" };

/** the person's state, read from disk (all association by hash / time — never by assuming) */
export function stateOf(who, { O = "scripts/avatar-pipeline/output/human-base", M = "scripts/avatar-pipeline/output/meshy-employees" } = {}) {
  const S = `${O}/studio`, up = fs.existsSync(`${S}/uploads.json`) ? JSON.parse(fs.readFileSync(`${S}/uploads.json`, "utf8"))[who] ?? null : null, prov = readProvenance(who, `${S}/provenance`);
  const mt = (f) => (f && fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0), photo = up?.photo && fs.existsSync(up.photo) ? up.photo : null;
  // an existing employee's approved illustration + Stage 0 live in the curated population set (Studio's own key rule: bon ↔ jerevon)
  const P = `${O}/stage1-proof/population`, popR = fs.existsSync(`${P}/identity.json`) ? JSON.parse(fs.readFileSync(`${P}/identity.json`, "utf8")).results ?? {} : {}, key = popR[who] ? who : who === "bon" && popR.jerevon ? "jerevon" : who;
  const own = fs.existsSync(`${S}/uploads/${who}.png`), ill = own ? `${S}/uploads/${who}.png` : fs.existsSync(`${P}/${key}-canonical.png`) ? `${P}/${key}-canonical.png` : null;
  const s0own = `${S}/stage0/${who}/identity.json`, s0 = own || fs.existsSync(s0own) ? s0own : popR[key] ? `${P}/identity.json` : s0own, raw = rawHeadFile(who, recipeHeadVersion(who), M);   // the recipe's head version (v1 unless it names a newer one)
  const V = productionCandidate(who), rep = V?.report ?? null, built = rep?.builtAt ? Date.parse(rep.builtAt) : 0, pi = prov.stages.illustration, qa = prov.stages.illustrationQA, mz = prov.stages.meshy;
  return {
    hasPhoto: !!photo,
    illustration: { exists: !!ill, fromCurrentPhoto: !photo || (!!pi && pi.photoSha256 === sha256File(photo) && !!ill && pi.outputSha256 === sha256File(ill)), mode: pi?.mode ?? (ill ? "uploaded" : null) },
    stage0: { exists: fs.existsSync(s0), fresh: fs.existsSync(s0) && (!own || mt(s0) >= mt(ill)) },   // a population record is curated with its illustration
    qa: { done: !!qa && Date.parse(qa.at) >= mt(s0) && fs.existsSync(s0), pass: !!qa?.pass, failed: qa?.failed ?? [] },
    // a head is for THIS illustration only when its provenance says so. A head with no provenance (made before provenance existed)
    // still counts for an uploaded-illustration run, but never for a PHOTO run — an old head is not a generation from a new photo.
    meshy: { exists: fs.existsSync(raw), mode: mz?.mode ?? (fs.existsSync(raw) ? "cached-own" : null), forCurrentIllustration: !ill ? true : mz?.illustrationSha256 ? mz.illustrationSha256 === sha256File(ill) : !photo },
    build: !rep ? { status: "none" } : { status: built < Math.max(mt(s0), mt(raw)) ? "stale" : rep.automatedPass ? (rep.pass ? "pass" : "awaiting-signoff") : "failed", tag: V.tag, failed: rep.failed ?? [] },
    sheet: { exists: !!V && fs.existsSync(V.exportDir) && fs.readdirSync(V.exportDir).some((f) => f.endsWith("-pipeline-sheet.png") || /-pipeline-sheet\.\d+\.png$/.test(f)) },
    export: { exists: !!V && fs.existsSync(`${V.exportDir}/manifest.json`) },
  };
}

/** the next step (pure): { stage, action: "run" | "needs-approval" | "blocked" | "complete", mock?, reason } */
export function plan(st, { approve = {}, mock = {} } = {}) {
  const paid = (stage, why) => (mock[stage] ? { stage, action: "run", mock: mock[stage], reason: `${why} — SIMULATED by a fixture (labelled, never promotable)` }
    : approve[stage] ? { stage, action: "run", reason: `${why} — paid run approved` } : { stage, action: "needs-approval", cost: PAID[stage], reason: why });
  if (st.hasPhoto && (!st.illustration.exists || !st.illustration.fromCurrentPhoto)) return paid("illustrate", "no illustration made from the current photo");
  if (!st.illustration.exists) return { stage: "illustrate", action: "blocked", reason: "no photo and no illustration uploaded" };
  if (!st.stage0.exists || !st.stage0.fresh) return { stage: "identity", action: "run", reason: "Stage 0 missing or older than the illustration" };
  if (!st.qa.done) return { stage: "illustrationQA", action: "run", reason: "the illustration has not been checked" };
  if (!st.qa.pass) return { stage: "illustrationQA", action: "blocked", reason: `illustration implausible for Stage 0: ${st.qa.failed.join(", ")}` };
  if (!st.meshy.exists || !st.meshy.forCurrentIllustration) return paid("meshy", st.meshy.exists ? "the Meshy head was made from a different illustration" : "no Meshy head for this person");
  if (st.build.status === "none" || st.build.status === "stale") return { stage: "build", action: "run", reason: st.build.status === "none" ? "no candidate yet" : "the candidate is older than its inputs" };
  if (st.build.status === "failed") return { stage: "build", action: "blocked", reason: `automated gate failed (fail closed): ${st.build.failed.join(", ")}` };
  if (!st.sheet.exists) return { stage: "sheet", action: "run", reason: "no review sheet for this candidate" };
  if (!st.export.exists) return { stage: "export", action: "run", reason: "not packaged yet" };
  return { stage: null, action: "complete", reason: st.build.status === "pass" ? "delivered" : "delivered for review — the three visual sign-offs remain (approve.mjs)" };
}
