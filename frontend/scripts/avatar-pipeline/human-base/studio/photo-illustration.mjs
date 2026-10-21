// studio/photo-illustration.mjs — RAW PHOTO → the person's Offshorly house-style front HEADSHOT (the input Stage 0 traces and Meshy
// turns into the head), 2026-10-13; recipe corrected 2026-10-19.
// THE PRODUCTION-FIVE INPUT: Bon, Micah, Angelo, Clang and France were built from FLAT semi-flat vector headshots (the Stage A
// "{Name}_Sprite.png" corpus: the established Stage A prompt + approved sprites as style reference). The 2026-10-13 version fed the
// soft-3D OffshorlyChibi (Stage B) prompt instead — Meshy turns a soft-3D render into an anime chibi outside the family (Nicole /
// Jona head v2). Now: the Stage A prompt verbatim + the approved five's own sprites as style references, in ONE gpt-image-1
// images/edits call (PAID, run only after the Studio's explicit approval). illustration-qa.mjs refuses a soft render (art-class).
//   node photo-illustration.mjs <who> <photo> [--mock=<fixture.png>]
// --mock = a SIMULATED stage: the fixture illustration stands in for the paid generation, labelled SIMULATED in provenance (and so
// never promotable). Writes output/human-base/studio/uploads/<who>.png + provenance. Run from frontend/. Never prints the key.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadEnvKey, redact, callImagesEdit } from "../../generate-production-v2.mjs";
import { recordStage, sha256File } from "./provenance.mjs";
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp");

/** the established Stage A prompt (2026-08-07, verbatim) that produced the approved sprites */
export const STAGE_A_PROMPT = "Create a digital portrait illustration in a clean, semi-flat vector style with soft shading and muted pastel colors. Style: Inspired by Studio Ghibli aesthetics but modernized and minimal; smooth linework, no sketch texture; soft lighting and gentle shadows; subtle gradients, no harsh contrast; calm, friendly facial expression; slightly stylized proportions (slightly elongated face and neck); clean, polished, professional look; no blush on, use only as needed. Composition: head and shoulders portrait; subject facing forward; centered and symmetrical; neutral beige or muted background; soft shadow cast behind the subject; copy clothing; 500px by 500px. Rendering: high resolution, digital illustration, vector-like finish, flat colors with light depth, no photorealism, no hyper-detailed textures. Reference: use the uploaded images as style reference — match the same illustration style, proportions, shading, and color.";
/** one API call carries what the Gemini session held as context: which image is the person, which are style only */
export const PROMPT = `The FIRST image is the photo of the person to portray. Every other image is an approved Offshorly illustration used ONLY as style reference — never copy their faces, hairstyles or clothing. Portray the person from the first image: a true front view, head straight and level, both eyes looking at the viewer, both ears visible where the hair allows.\n\n${STAGE_A_PROMPT}`;
/** the style references: the approved five's own sprites (local, read-only) */
export const STYLE_REFS = ["angelo", "clang", "france", "micah"].map((w) => `scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-original.png`);
const mime = (f) => (f.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
/** ONE paid images/edits call: the photo first, then the style references */
export async function generateHeadshot(apiKey, photo, label, refs = STYLE_REFS) {
  const missing = refs.filter((f) => !fs.existsSync(f)); if (missing.length) throw new Error(`style reference missing: ${missing.join(", ")}`);
  const form = new FormData(); form.append("model", "gpt-image-1"); form.append("image[]", new Blob([fs.readFileSync(photo)], { type: mime(photo) }), "person");
  refs.forEach((f, i) => form.append("image[]", new Blob([fs.readFileSync(f)], { type: mime(f) }), `style-${i + 1}.png`));
  form.append("prompt", PROMPT); form.append("n", "1"); form.append("size", "1024x1024");
  return callImagesEdit(apiKey, form, label); }

/** the established background rule: flat #FF00FF → keyed out; flattened onto white for Stage 0 (soft edge by distance to magenta) */
export async function keyMagentaToWhite(buf) { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { const d = Math.hypot(data[i] - 255, data[i + 1], data[i + 2] - 255), a = Math.max(0, Math.min(1, (d - 60) / 80));
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * a + 255 * (1 - a)); data[i + 3] = 255; }
  return sharp(data, { raw: info }).png().toBuffer(); }

if (process.argv[1]?.endsWith("photo-illustration.mjs")) {
  const [who, photo] = process.argv.slice(2), mock = process.argv.find((a) => a.startsWith("--mock="))?.slice(7);
  if (!who || !photo || !fs.existsSync(photo)) { console.error("usage: photo-illustration.mjs <who> <photo> [--mock=<fixture.png>]"); process.exit(2); }
  const out = `scripts/avatar-pipeline/output/human-base/studio/uploads/${who}.png`; fs.mkdirSync(path.dirname(out), { recursive: true });
  // the generated illustration IS this person's illustration from now on — registered exactly like an upload (uploads.json), from the photo
  const register = () => { const U = "scripts/avatar-pipeline/output/human-base/studio/uploads.json", up = fs.existsSync(U) ? JSON.parse(fs.readFileSync(U, "utf8")) : {};
    up[who] = { ...(up[who] ?? {}), file: out, at: new Date().toISOString(), fromPhoto: photo, simulated: !!mock }; fs.writeFileSync(U, JSON.stringify(up, null, 1)); };
  try {
    if (mock) { if (!fs.existsSync(mock)) throw new Error(`mock fixture missing: ${mock}`); fs.copyFileSync(mock, out);
      recordStage(who, "illustration", { mode: "SIMULATED", photoSha256: sha256File(photo), outputSha256: sha256File(out), fixture: mock, note: "a fixture illustration stands in for the paid photo → illustration generation" });
      register(); console.log(`SIMULATED illustration for ${who} ← ${mock} (no generation, zero cost)`); }
    else { const key = loadEnvKey(path.resolve(".env"), "OPENAI_API_KEY") || loadEnvKey(path.resolve("../backend/.env"), "OPENAI_API_KEY");   // gen-server's location first, then the project's existing backend configuration — never printed
      if (!key) throw new Error("OPENAI_API_KEY missing (frontend/.env and backend/.env) — the photo → illustration stage cannot run");
      const t0 = Date.now(), gen = await generateHeadshot(key, photo, `${who}/front-headshot`); fs.writeFileSync(out, await keyMagentaToWhite(gen));   // keying is a no-op on the Stage A beige background
      recordStage(who, "illustration", { mode: "real", photoSha256: sha256File(photo), outputSha256: sha256File(out), model: "gpt-image-1 images/edits 1024x1024", prompt: "STAGE_A_PROMPT + approved-five style references", styleRefs: STYLE_REFS, seconds: Math.round((Date.now() - t0) / 1000) });
      register(); console.log(`illustration for ${who} generated (one paid images/edits call)`); }
  } catch (e) { console.error(`illustration failed: ${redact ? redact(String(e?.message ?? e)) : String(e?.message ?? e)}`); process.exit(1); }
}
