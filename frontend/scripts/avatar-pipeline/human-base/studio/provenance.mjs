// studio/provenance.mjs — WHERE EVERY ARTIFACT OF A PERSON CAME FROM (2026-10-13). One record per person
// (output/human-base/studio/provenance/<who>.json): per stage { mode: "real" | "SIMULATED" | "cached-own", input / output sha256, notes }.
// A SIMULATED stage (a fixture standing in for a paid generation) is labelled everywhere and makes the person's candidates
// non-promotable: a simulated head is never proof that a new identity was generated. Run from frontend/.
import fs from "node:fs";
import crypto from "node:crypto";
import { headName, rawHeadFile, recipeHeadVersion } from "../head-version.mjs";

export const PROV_DIR = "scripts/avatar-pipeline/output/human-base/studio/provenance";
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export function readProvenance(who, dir = PROV_DIR) { const f = `${dir}/${who}.json`; return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { who, stages: {} }; }
/** record one stage (replaces that stage's previous record; every later stage built from older inputs is now stale) */
export function recordStage(who, stage, rec, dir = PROV_DIR) { fs.mkdirSync(dir, { recursive: true }); const p = readProvenance(who, dir);
  p.stages[stage] = { ...rec, at: new Date().toISOString() }; fs.writeFileSync(`${dir}/${who}.json`, JSON.stringify(p, null, 1)); return p; }
/** the stages of this person that were simulated (fixtures standing in for paid generations) */
/** a Meshy head that is a link into ANOTHER person's head folder is a stand-in, whatever the records say (defensive: catches heads
 *  linked before provenance existed) */
export function borrowedHead(who, M = "scripts/avatar-pipeline/output/meshy-employees") { let v = "v1"; try { v = recipeHeadVersion(who); } catch { /* an invalid recipe fails the build itself */ }
  const f = rawHeadFile(who, v, M);
  try { if (!fs.lstatSync(f).isSymbolicLink()) return null; const t = fs.readlinkSync(f); return t.includes(`/${headName(who, v)}/`) ? null : t; } catch { return null; } }
export function simulatedStages(who, dir = PROV_DIR) { const s = Object.entries(readProvenance(who, dir).stages).filter(([, r]) => r.mode === "SIMULATED").map(([k]) => k);
  if (!s.includes("meshy") && borrowedHead(who)) s.push("meshy"); return s; }
/** fail closed: a person whose pipeline used a simulated stage can never be signed off or promoted */
export function assertPromotable(who, dir = PROV_DIR) { const s = simulatedStages(who, dir);
  if (s.length) throw new Error(`refused: ${who} was built from SIMULATED stage(s) (${s.join(", ")}) — a fixture is not a generated identity; run the real paid stage(s) first`); }
