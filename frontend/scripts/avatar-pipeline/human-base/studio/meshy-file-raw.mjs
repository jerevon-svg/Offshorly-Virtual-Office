// studio/meshy-file-raw.mjs — files a finished Meshy head download (meshy-head-image-to-3d.mjs writes <who>-head-v1-raw-* next to its task
// record) into the immutable raw-untouched/ layout the HumanBase build reads. Moves files only; no network, no credits.
//   node scripts/avatar-pipeline/human-base/studio/meshy-file-raw.mjs <who>
import fs from "node:fs";
const who = process.argv[2], D = `scripts/avatar-pipeline/output/meshy-employees/${who}-head-v1`, R = `${D}/raw-untouched`;
if (!fs.existsSync(D)) { console.error(`no Meshy output in ${D}`); process.exit(1); }
fs.mkdirSync(R, { recursive: true }); let n = 0;
for (const f of fs.readdirSync(D)) if (f.startsWith(`${who}-head-v1-raw-`) || f.endsWith(".task.json")) { fs.renameSync(`${D}/${f}`, `${R}/${f}`); n++; }
if (!fs.existsSync(`${R}/${who}-head-v1-raw-model.glb`)) { console.error("no raw model in the download — the Meshy task did not succeed (see its task record)"); process.exit(1); }
console.log(`filed ${n} files → ${R}`);
