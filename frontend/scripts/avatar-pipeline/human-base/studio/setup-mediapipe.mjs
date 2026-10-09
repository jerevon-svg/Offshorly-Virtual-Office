// studio/setup-mediapipe.mjs — ONE-TIME, FREE setup of the local face-landmark model the Stage 0 identity analysis uses for NEW uploads
// (Google MediaPipe Tasks Vision, Apache-2.0; ~10 MB). Kept OUTSIDE the repo (~/.cache/humanbase-mp), nothing added to package.json.
//   node scripts/avatar-pipeline/human-base/studio/setup-mediapipe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
export const MP_DIR = process.env.HB_MP_DIR ?? path.join(os.homedir(), ".cache", "humanbase-mp");
export const mpReady = () => fs.existsSync(path.join(MP_DIR, "package", "vision_bundle.mjs")) && fs.existsSync(path.join(MP_DIR, "face_landmarker.task"));
if (process.argv[1]?.endsWith("setup-mediapipe.mjs")) {
  if (mpReady()) { console.log(`already installed: ${MP_DIR}`); process.exit(0); }
  fs.mkdirSync(MP_DIR, { recursive: true });
  const tgz = execFileSync("npm", ["pack", "@mediapipe/tasks-vision", "--silent", "--pack-destination", MP_DIR], { encoding: "utf8" }).trim().split("\n").pop();
  execFileSync("tar", ["-xzf", path.join(MP_DIR, tgz), "-C", MP_DIR]); fs.rmSync(path.join(MP_DIR, tgz));
  const r = await fetch("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"); if (!r.ok) throw new Error(`model download HTTP ${r.status}`);
  fs.writeFileSync(path.join(MP_DIR, "face_landmarker.task"), Buffer.from(await r.arrayBuffer()));
  console.log(mpReady() ? `installed → ${MP_DIR}` : "install incomplete"); }
