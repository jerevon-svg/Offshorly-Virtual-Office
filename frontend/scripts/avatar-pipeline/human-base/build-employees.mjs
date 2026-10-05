// build-employees.mjs — REBUILD HumanBase production candidates from the recipe (employees.json). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-employees.mjs [--only=clang,france] [--skip-chibify] [--skip-optim]
//
// Per employee, in order: chibify.mjs (the universal identity pipeline) → its accessories (fitted to the new head) →
// optimize-identity.mjs at the recipe's head budget → public/avatars/human-base-v1/production/<who>-v1.glb.
// Shared accessories (fit-space styles every identity can wear) are built once. Logs: output/human-base/v1.1-release/logs/.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const H = "scripts/avatar-pipeline/human-base", OUT = "scripts/avatar-pipeline/output/human-base/v1.2-release", ID = "public/avatars/human-base-v1/identity";
const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const R = JSON.parse(fs.readFileSync(`${H}/employees.json`, "utf8")), only = opt("only")?.split(",") ?? Object.keys(R.employees);
fs.mkdirSync(`${OUT}/logs`, { recursive: true }); fs.mkdirSync(`${OUT}/optim`, { recursive: true });
const run = (log, script, a, env = {}) => { const t0 = Date.now(); process.stdout.write(`${log} … `);
  const out = execFileSync("node", [script, ...a], { env: { ...process.env, ...env }, maxBuffer: 1 << 28, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  fs.writeFileSync(`${OUT}/logs/${log}.log`, out); console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`); return out; };
const sub = (s, who) => s.replaceAll("{who}", who).replaceAll("{ref}", R.ref.replaceAll("{who}", who));
const accessory = (who, a) => { const idf = `${ID}/${who}-meshy-chibi-v1.glb`;
  if (a.build === "glasses") run(`${a.id}`, `${H}/build-glasses.mjs`, [idf, `${H}/${a.style}`, a.id]);
  if (a.build === "flower") run(`${a.id}`, `${H}/build-hair-flower.mjs`, [idf, sub(a.prep, who), a.id, sub(a.sprite, who)]);
  if (a.build === "tail") run(`${a.id}`, `${H}/build-hair-tail.mjs`, [idf, a.id, `--tie=${a.tie ?? "low"}`, `--length=${a.length ?? "upperBack"}`, `--volume=${a.volume ?? 1}`, `--style=${a.style ?? "pony"}`]); };
for (const who of only) { const e = R.employees[who];
  if (!args.includes("--skip-chibify")) run(`${who}-chibify`, `${H}/chibify.mjs`, [sub(R.raw, who), `${who}-meshy-chibi-v1`, `--ruleset=${e.ruleset}`, `--hair=${e.hair}`, ...(e.motion ? [`--motion=${e.motion}`] : []), ...(e.tie ? [`--tie=${e.tie}`] : []), ...(e.repairs ? [`--repairs=${Object.entries(e.repairs).map(([k, v]) => `${k}:${v ? 1 : 0}`).join(",")}`] : [])]);
  for (const a of e.accessories) accessory(who, a);
  if (!args.includes("--skip-optim")) { run(`${who}-optim`, `${H}/optimize-identity.mjs`, [`${ID}/${who}-meshy-chibi-v1.glb`, `${OUT}/optim`], { TARGETS: String(e.headTris), TEXS: "2048", PREFIX: who, TAG: `-${who}` });
    fs.copyFileSync(`${OUT}/optim/${who}-tri${Math.round(e.headTris / 1000)}k-tex2048.glb`, `public/avatars/human-base-v1/production/${who}-v1.glb`); } }
for (const a of R.sharedAccessories ?? []) if (only.includes(a.previewOn)) accessory(a.previewOn, a);
console.log("done:", only.join(", "));
