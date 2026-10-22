// v3/sheets.mjs — write render jobs for the V3 proof comparison sheets (then run render.mjs on them). ZERO CREDITS.
//   node scripts/avatar-pipeline/human-base/v3/sheets.mjs <jobs.json> [--who=…] [--variants=B,A] [--set=compare|orbit]
import fs from "node:fs";
const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const WHO = opt("who", "bon,kael,lui,nicole").split(","), VARIANTS = opt("variants", "B").split(","), SET = opt("set", "compare");
const OUT = "scripts/avatar-pipeline/output/human-base/v3-proof/sheets";
const REF = { bon: "scripts/avatar-pipeline/output/human-base/meshy-ref/bon-head-ref-original.png" };
const refOf = (w) => REF[w] ?? `scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-original.png`;
const OLD = { bon: null, kael: "scripts/avatar-pipeline/output/human-base/candidates/kael/pass2/kael-v1.glb", lui: "scripts/avatar-pipeline/output/human-base/candidates/lui/pass2/lui-v1.glb", nicole: "scripts/avatar-pipeline/output/human-base/candidates/nicole/pass2/nicole-v1.glb" };
const oldLabel = (w) => (w === "bon" ? "APPROVED" : "V2 cand.");
const v3 = (w, v) => `scripts/avatar-pipeline/output/human-base/v3-proof/${w}/${v}/pass1/${w}-v1.glb`;
const VIEWS = ["front", "front34L", "front34R", "sideL", "sideR", "back", "rear34L", "high", "lowFront", "lowRear", "behindEarL", "behindEarR", "jawL", "nape", "eyeFront", "neckJoinBack"];
const jobs = [];
for (const w of WHO) {
  if (SET === "compare") {
    const cols = 2 * (1 + VARIANTS.length), tiles = [{ image: refOf(w), label: `${w} · approved illustration (2D evidence)` }];
    if (fs.existsSync(`scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-final.png`)) tiles.push({ image: `scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-final.png`, label: `${w} · prepped reference (Meshy input)` });
    while (tiles.length < cols) tiles.push({ blank: true });
    for (const v of VIEWS) { if (fs.existsSync(OLD[w] ?? "x") || OLD[w] === null) tiles.push({ who: w, head: OLD[w], view: v, label: `${oldLabel(w)} · ${v}` }); for (const vr of VARIANTS) tiles.push({ who: w, head: v3(w, vr), view: v, label: `V3-${vr} · ${v}` }); }
    jobs.push({ out: `${OUT}/${w}-compare-${VARIANTS.join("")}.png`, title: `${w}: ${oldLabel(w)} vs V3 (${VARIANTS.map((x) => (x === "B" ? "B = 2D+3D evidence" : "A = 2D-only")).join(", ")}) — production HumanAvatar, unmounted QA viewer`, cols, tiles });
  }
}
fs.writeFileSync(args[0], JSON.stringify(jobs));
console.log(`${jobs.length} jobs → ${args[0]}`);
