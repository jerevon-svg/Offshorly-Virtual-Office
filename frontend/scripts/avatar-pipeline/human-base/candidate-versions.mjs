// candidate-versions.mjs — NON-DESTRUCTIVE, VERSIONED CANDIDATES (2026-10-10). Every build writes a NEW version and never deletes or
// overwrites an earlier candidate, report, review sheet or export; nothing here knows a name. Under candidates/<who>/:
//   legacy (kept exactly as written)  pass1/ pass2/ + report.json (V2, uncorrected) · corr-pass1/ corr-pass2/ + report.corrected.json
//   versioned                         <tag>-pass1/ <tag>-pass2/ + report.<tag>.json, tag = <kind>-v<N> (kind: base = uncorrected,
//                                     corr = identity-corrected); a kind's legacy layout is its version 1, so the next corrected
//                                     build after the legacy one is corr-v2 and a new employee's first is corr-v1
// Review sheets and exports of a versioned tag live in exports/<who>/<tag>/ (the legacy exports/<who>/ stays as written); a review
// sheet that already exists gets a numbered sibling, an export that already exists is refused.
// EXPERIMENTAL builds (2026-10-13) — built from a head version that is not the person's accepted one (build-employees --head=vN) —
// are their own kinds, xbase / xcorr, so they can never become what the Studio, runtime delivery, approvals or exports select:
// those select current() = the newest build from the ACCEPTED head (head-version.mjs), never latest().
import fs from "node:fs";
import { recipeHeadVersion } from "./head-version.mjs";

export const ROOT = "scripts/avatar-pipeline/output/human-base";
const LEGACY = { base: { passes: ["pass1", "pass2"], report: "report.json" }, corr: { passes: ["corr-pass1", "corr-pass2"], report: "report.corrected.json" } };
const VERSIONED = /^(x?(?:base|corr))-v([1-9]\d*)$/;
export const KINDS = ["base", "corr", "xbase", "xcorr"];

/** where one tag's passes, report and exports live (throws on anything that is not base | corr | base-vN | corr-vN) */
export function layout(who, tag, root = ROOT) {
  if (!/^[a-z0-9-]+$/.test(who ?? "")) throw new Error(`invalid employee id "${who}"`);
  const L = LEGACY[tag], m = VERSIONED.exec(tag ?? ""); if (!L && !m) throw new Error(`invalid candidate tag "${tag}" (expected base | corr | base-vN | corr-vN | xbase-vN | xcorr-vN)`);
  const C = `${root}/candidates/${who}`;
  return { who, tag, kind: L ? tag : m[1], version: L ? 1 : +m[2], dir: C, passes: (L ? L.passes : [`${tag}-pass1`, `${tag}-pass2`, `${tag}-pass3`, `${tag}-pass4`]).map((p) => `${C}/${p}`),
    report: `${C}/${L ? L.report : `report.${tag}.json`}`, exportDir: L ? `${root}/exports/${who}` : `${root}/exports/${who}/${tag}` };
}

/** every version of one kind present on disk (a pass folder or a report), oldest first */
export function versions(who, kind, root = ROOT) {
  if (!KINDS.includes(kind)) throw new Error(`invalid candidate kind "${kind}" (${KINDS.join(" | ")})`);
  const C = `${root}/candidates/${who}`, tags = new Set(); if (!fs.existsSync(C)) return [];
  if (LEGACY[kind]) { const legacy = layout(who, kind, root); if (fs.existsSync(legacy.report) || legacy.passes.some((p) => fs.existsSync(p))) tags.add(kind); }
  for (const f of fs.readdirSync(C)) { const m = /^(?:report\.)?((x?(?:base|corr))-v[1-9]\d*)(?:-pass\d|\.json)$/.exec(f); if (m && m[2] === kind) tags.add(m[1]); }
  return [...tags].map((t) => layout(who, t, root)).sort((a, b) => a.version - b.version);
}

/** the tag the next build of this kind writes: one above the newest version on disk (v1 when there is none) */
export function nextTag(who, kind, root = ROOT) { return `${kind}-v${Math.max(0, ...versions(who, kind, root).map((v) => v.version)) + 1}`; }

/** one version's finished state — its report, report file and final candidate file (null while it has no report) */
export function resolveVersion(who, tag, root = ROOT) {
  const L = layout(who, tag, root); if (!fs.existsSync(L.report)) return null;
  const report = JSON.parse(fs.readFileSync(L.report, "utf8")), finalPass = [...L.passes].reverse().map((p) => `${p}/${who}-v1.glb`).find((f) => fs.existsSync(f)) ?? null;
  return { ...L, report, reportFile: L.report, file: report.candidate && fs.existsSync(report.candidate) ? report.candidate : finalPass };
}

/** the newest version of a kind with a finished report — HISTORY (whatever head it was built from). Selection uses current(). */
export function latest(who, kind, root = ROOT) { const L = versions(who, kind, root).filter((v) => fs.existsSync(v.report)).at(-1); return L ? resolveVersion(who, L.tag, root) : null; }

/** THE PRODUCTION BUILD KIND (2026-10-19, Bon: "return to the proven production-five approach"). The approved five were built
 *  base — chibify → accessories → optimise, never identity-warped; the identity-corrected kind regressed faces (2026-10-13 audit)
 *  and stays an opt-in experiment (build-employees --correct). Studio, approvals, exports and runtime delivery select THIS kind. */
export const PRODUCTION_KIND = "base";
/** the person's current production candidate (current() of PRODUCTION_KIND) */
export const productionCandidate = (who, root = ROOT) => current(who, PRODUCTION_KIND, root);
/** WHAT DELIVERY SELECTS (2026-10-21): the exact version a recorded HUMAN APPROVAL names — approve.mjs --tag=<tag> binds a
 *  sign-off to that version's artifact, so an approved experimental build (e.g. a --meshy-first xbase) can be delivered without a
 *  rebuild — and only while the approval's artifact hash still matches that version's report; otherwise (no approval, no tag, a
 *  stale approval) the production candidate, exactly as before. It never weakens a check: delivery still requires every sign-off
 *  the report needs to be bound to this artifact (runtime-avatars.mjs / promoteCandidate). */
export function deliveryCandidate(who, approval, root = ROOT) {
  if (approval?.tag) { const v = resolveVersion(who, approval.tag, root); if (v?.report?.artifactHash && v.report.artifactHash === approval.artifactHash) return v; }
  return productionCandidate(who, root);
}

/** the CURRENT candidate of an accepted kind (base | corr): the newest finished build made from the person's ACCEPTED head (the
 *  recipe's "head", v1 by default) and not marked experimental — what the Studio, runtime delivery, approvals and exports select.
 *  A build from any other head version (an experiment, or a failed new head) is never selected; null when there is none. */
export function current(who, kind, root = ROOT, accepted = null) {
  if (kind !== "base" && kind !== "corr") throw new Error(`current() selects accepted builds (base | corr), not "${kind}"`);
  let head = accepted; if (!head) { try { head = recipeHeadVersion(who); } catch { return null; } }   // an invalid recipe selects nothing
  for (const v of versions(who, kind, root).filter((x) => fs.existsSync(x.report)).reverse()) {
    const r = resolveVersion(who, v.tag, root); if (r && !r.report.experimental && (r.report.head ?? "v1") === head) return r; }
  return null;
}

/** refuse to write where anything already exists — a build never overwrites or deletes an earlier candidate */
export function assertFresh(paths) {
  for (const p of paths) if (fs.existsSync(p)) throw new Error(`refused: ${p} already exists — builds never overwrite or delete an earlier version (build a new tag)`);
}

/** a NEW file next to an existing one: x.png → x.2.png → x.3.png … (review sheets are versioned, never overwritten) */
export function freshFile(f) {
  if (!fs.existsSync(f)) return f; const i = f.lastIndexOf("."), b = f.slice(0, i), e = f.slice(i);
  for (let n = 2; ; n++) if (!fs.existsSync(`${b}.${n}${e}`)) return `${b}.${n}${e}`;
}

/** the newest review sheet in an export folder (x.png, x.2.png, …) or null */
export function newestSheet(dir, who) {
  if (!fs.existsSync(dir)) return null; let best = null, bestN = 0;
  for (const f of fs.readdirSync(dir)) { const m = new RegExp(`^${who}-pipeline-sheet(?:\\.(\\d+))?\\.png$`).exec(f); if (m && +(m[1] ?? 1) > bestN) { bestN = +(m[1] ?? 1); best = `${dir}/${f}`; } }
  return best;
}

/** the report that belongs to a candidate file (…/<tag>-passN/<who>-v1.glb → its tag's report; legacy pass / corr-pass included).
 *  The lineup page (src/dev/vo3d/human/playground/lineup.ts) applies the same rule in the browser. */
export function reportFor(file) {
  const m = /^(.*)\/(?:([^/]+)-)?pass\d\/[^/]+$/.exec(file ?? ""); if (!m) return null; const [, dir, t] = m;
  return `${dir}/${t === undefined ? "report.json" : t === "corr" ? "report.corrected.json" : `report.${t}.json`}`;
}
