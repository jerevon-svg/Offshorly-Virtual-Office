// studio/identity-upload.mjs — Stage 0 identity analysis of a NEW uploaded illustration (the approved Stage 0 extractor, unchanged), into
// its own folder (output/human-base/studio/stage0/<who>/), then the trace sheet. Zero credits; needs setup-mediapipe.mjs once.
//   node scripts/avatar-pipeline/human-base/studio/identity-upload.mjs <who> <image.png>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MP_DIR, mpReady } from "./setup-mediapipe.mjs";
const [who, img] = process.argv.slice(2), O = "scripts/avatar-pipeline/output/human-base/studio/stage0", D = `${O}/${who}`;
if (!mpReady()) { console.error("the face-landmark model is not installed — run: node scripts/avatar-pipeline/human-base/studio/setup-mediapipe.mjs (free, one time)"); process.exit(2); }
fs.mkdirSync(D, { recursive: true }); fs.writeFileSync(`${D}/sources.json`, JSON.stringify({ note: "studio upload", sources: { [who]: path.resolve(img) } }, null, 1));
execFileSync("node", ["scripts/avatar-pipeline/human-base/v3/identity/run.mjs", `--mp=${MP_DIR}`, `--sources=${D}/sources.json`, `--out=${D}`], { stdio: "inherit" });
const R = JSON.parse(fs.readFileSync(`${D}/identity.json`, "utf8")).results[who]; if (!R?.contour) { console.error("Stage 0 could not trace this illustration (fail closed) — see the log"); process.exit(1); }
execFileSync("node", ["scripts/avatar-pipeline/human-base/studio/trace-sheet.mjs", who], { stdio: "inherit" });
