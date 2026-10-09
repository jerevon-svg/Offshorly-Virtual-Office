// v3/stage1/fitmean.mjs — writes clay GLBs of the dense approved fits + their vertex-wise MEAN (same topology ⇒ crisp mean)
import fs from "node:fs";
import { Document } from "@gltf-transform/core";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
const tpl = loadTemplate(), O = "scripts/avatar-pipeline/output/human-base/stage1-proof/approved-fits", W = ["bon", "micah", "angelo", "clang", "france"];
const fits = W.map((w) => Float32Array.from(JSON.parse(fs.readFileSync(`${O}/${w}.json`, "utf8")).X));
const mean = new Float32Array(tpl.P.length); for (const X of fits) for (let i = 0; i < mean.length; i++) mean[i] += X[i] / fits.length;
async function glb(P, f) { const doc = new Document(), buf = doc.createBuffer(), prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(P).setBuffer(buf)).setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(tpl.I)).setBuffer(buf));
  doc.createScene().addChild(doc.createNode("identity_head").setMesh(doc.createMesh("identity_head").addPrimitive(prim))); await io.write(f, doc); }
for (let k = 0; k < W.length; k++) await glb(fits[k], `${O}/${W[k]}-fit.glb`);
await glb(mean, `${O}/mean-fit.glb`); fs.writeFileSync(`${O}/mean.json`, JSON.stringify({ X: Array.from(mean, (v) => +v.toFixed(5)) })); console.log("written");
