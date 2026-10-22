// studio/meshy-file-raw.mjs — files a finished Meshy head download (meshy-head-image-to-3d.mjs writes <who>-head-v1-raw-* next to its task
// record) into the immutable raw-untouched/ layout the HumanBase build reads. Moves files only; no network, no credits.
//   node scripts/avatar-pipeline/human-base/studio/meshy-file-raw.mjs <who> [v<N>]      (default v1; a newer head is its own version folder)
import fs from "node:fs";
import { headName, headVersion, rawHeadDir } from "../head-version.mjs";
const who = process.argv[2], V = headVersion({ head: process.argv[3] ?? "v1" }), NAME = headName(who, V), D = rawHeadDir(who, V), R = `${D}/raw-untouched`;
if (!fs.existsSync(D)) { console.error(`no Meshy output in ${D}`); process.exit(1); }
fs.mkdirSync(R, { recursive: true }); let n = 0;
for (const f of fs.readdirSync(D)) if (f.startsWith(`${NAME}-raw-`) || f.endsWith(".task.json")) { fs.renameSync(`${D}/${f}`, `${R}/${f}`); n++; }
if (!fs.existsSync(`${R}/${NAME}-raw-model.glb`)) { console.error("no raw model in the download — the Meshy task did not succeed (see its task record)"); process.exit(1); }
console.log(`filed ${n} files → ${R}`);
