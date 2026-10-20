// head-version.mjs — WHICH raw Meshy head a person's HumanBase build uses (2026-10-13). Data, not code: the recipe's optional
// "head" field in employees.json ("v2", "v3", …) names a newer paid head; without it the person uses "v1", the original. A paid
// head is NEVER overwritten: a new head is a new version folder (<who>-head-v<N>), with its own prepared reference
// (meshy-ref/<who>/head-v<N>/), and every older raw head and every build made from it stays where it is.
import fs from "node:fs";

export const MESHY_DIR = "scripts/avatar-pipeline/output/meshy-employees";
export const REF_ROOT = "scripts/avatar-pipeline/output/human-base/meshy-ref";
export const RECIPES = "scripts/avatar-pipeline/human-base/employees.json";
const VERSION = /^v[1-9]\d{0,2}$/;

/** the head version a recipe names ("v1" when it names none); an invalid value throws — a build never guesses */
export function headVersion(recipe) {
  const v = recipe?.head ?? "v1";
  if (typeof v !== "string" || !VERSION.test(v)) throw new Error(`invalid head version ${JSON.stringify(v)} (expected "v1", "v2", …)`);
  return v;
}
export const headName = (who, v = "v1") => `${who}-head-${v}`;
export const rawHeadDir = (who, v = "v1", M = MESHY_DIR) => `${M}/${headName(who, v)}`;
export const rawHeadFile = (who, v = "v1", M = MESHY_DIR) => `${rawHeadDir(who, v, M)}/raw-untouched/${headName(who, v)}-raw-model.glb`;
/** a version's prepared Meshy reference: v1 keeps its original folder, later versions get their own sub-folder */
export const headRefDir = (who, v = "v1", R = REF_ROOT) => (v === "v1" ? `${R}/${who}` : `${R}/${who}/head-${v}`);

/** the head version a person's recipe names, read from employees.json ("v1" for a person without a recipe) */
export function recipeHeadVersion(who, file = RECIPES) {
  let recipes = {};
  try { recipes = JSON.parse(fs.readFileSync(file, "utf8")).employees ?? {}; } catch { return "v1"; }
  return headVersion(recipes[who]);
}
/** the raw head file a person's builds read — throws on an invalid recipe version */
export const recipeRawHead = (who, { M = MESHY_DIR, file = RECIPES } = {}) => rawHeadFile(who, recipeHeadVersion(who, file), M);

/** the first version above v1 with neither a Meshy folder nor a prepared reference — the only place a NEW head may go */
export function nextHeadVersion(who, { M = MESHY_DIR, R = REF_ROOT, exists = fs.existsSync } = {}) {
  for (let n = 2; n < 1000; n++) { const v = `v${n}`; if (!exists(rawHeadDir(who, v, M)) && !exists(headRefDir(who, v, R))) return v; }
  throw new Error(`${who}: no free head version`);
}
