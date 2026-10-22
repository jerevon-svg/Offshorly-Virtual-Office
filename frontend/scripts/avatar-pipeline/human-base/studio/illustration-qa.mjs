// studio/illustration-qa.mjs <who> — AUTOMATIC QA of the person's illustration (2026-10-13): the established Stage 0 input
// plausibility gate (v3/stage1/input-gate.mjs inputGate: features present, eye pair, mouth, lips, feature order) on THIS person's
// Stage 0 record. Fail closed (exit 1) — a generated illustration that Stage 0 cannot read plausibly never reaches Meshy or the build.
// + ART STYLE (2026-10-19): the approved five were all built from FLAT house-style headshots (the Stage A sprites); a SOFT-3D render
// gives Meshy an anime-chibi head outside the family (Nicole / Jona head v2). art-class.mjs (flatness ≥ SOFT_BELOW) is the check.
import fs from "node:fs";
import { createRequire } from "node:module";
import { inputGate } from "../v3/stage1/input-gate.mjs";
import { artClass, SOFT_BELOW } from "../art-class.mjs";
import { recordStage } from "./provenance.mjs";
import { approvedSource } from "./approved-source.mjs";
const who = process.argv[2], O = "scripts/avatar-pipeline/output/human-base", own = `${O}/studio/stage0/${who}/identity.json`, pop = `${O}/stage1-proof/population/identity.json`;
const popR = fs.existsSync(pop) ? JSON.parse(fs.readFileSync(pop, "utf8")).results ?? {} : {}, key = popR[who] ? who : who === "bon" && popR.jerevon ? "jerevon" : who;   // Studio's own key rule
const p = fs.existsSync(own) ? JSON.parse(fs.readFileSync(own, "utf8")).results?.[who] : popR[key];
if (!who || !p) { console.error(`no Stage 0 record for ${who} — run identity first`); process.exit(2); }
// the illustration this person's Stage 0 was traced from: the Studio upload, else the roster's approved sprite
const up = fs.existsSync(`${O}/studio/uploads.json`) ? JSON.parse(fs.readFileSync(`${O}/studio/uploads.json`, "utf8"))[who] : null;
const ill = [up?.file, `${O}/studio/uploads/${who}.png`, `${O}/meshy-ref/${who}/${who}-ref-original.png`, approvedSource(who)].find((f) => f && fs.existsSync(f)) ?? null;   // + the approved sprite: a roster person with no head yet
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp");
const art = ill ? artClass((await sharp(ill).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data) : null;
const g = inputGate(p), artOk = !!art && !art.soft && art.flatness !== null;
const failed = [...g.failed.map((k) => ({ check: k, value: g.checks[k].value, limit: g.checks[k].limit })), ...(artOk ? [] : [{ check: "flatHouseStyle", value: art?.flatness ?? null, limit: `flatness ≥ ${SOFT_BELOW}`, illustration: ill }])];
const pass = g.pass && artOk; recordStage(who, "illustrationQA", { mode: "real", pass, failed: failed.map((f) => f.check), art: art && { ...art, illustration: ill } });
console.log(JSON.stringify({ who, pass, art: art && { flatness: art.flatness, soft: art.soft }, failed }));
process.exit(pass ? 0 : 1);
