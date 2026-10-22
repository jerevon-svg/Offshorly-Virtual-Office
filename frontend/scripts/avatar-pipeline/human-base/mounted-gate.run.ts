// mounted-gate.run.ts — build the FINAL avatar exactly as production does (avatar/humanBody config: body preset, uniform,
// accessories, HEAD_MOUNT) with ONE identity file swapped in (a candidate or fixture), and print its mounted measurements
// as JSON. ZERO CREDITS. Run from frontend/:
//   npx vite-node scripts/avatar-pipeline/human-base/mounted-gate.run.ts -- <appearance-id> <identity.glb> <prod|auto> […]
// mount "prod" = the configured HEAD_MOUNT; "auto" = computed from THIS identity (face size vs canonical Bon from six
// hair-independent measures — cheek / jaw / eye-line width, chin→eye, eye spacing, ear span — ×0.98 on the feminine preset),
// the pipeline's own normalization for a new candidate (no hand-entered mount)
// The appearance id only selects the production APPEARANCE (preset / uniform / accessories / mount) the identity is worn
// with — the measurements and the registry verdict never branch on it.
import fs from "node:fs";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HumanAvatar, setGlbFetcher } from "../../../src/dev/vo3d/human/HumanAvatar";
import { nodeIO, publicPath } from "../../../src/dev/vo3d/human/humanGlb.testutil";
import { appearanceFor, candidateAppearance, HUMANBASE_CATALOGUE, identityHeadAsset } from "../../../src/dev/vo3d/avatar/humanBody";
// a NEW employee has no production appearance yet: the pipeline recipe (employees.json) names their body preset; no recipe = fail closed
const recipeOf = (id: string): { body?: string } | null => { try { return JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/employees.json", "utf8")).employees?.[id] ?? null; } catch { return null; } };
import { closureWallEvidence, motionEvidence, mountedMetrics } from "../../../src/dev/vo3d/human/gate/mountedGate";
import { idleClip } from "../../../src/dev/vo3d/human/humanBaseContract";

const args = process.argv.slice(2).filter((a) => a !== "--");
setGlbFetcher(async (url: string): Promise<GLTF> => {
  const io = await nodeIO(), file = url.startsWith("file:") ? url.slice(5) : publicPath(url);
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === "KHR_draco_mesh_compression" || e.extensionName === "EXT_texture_webp") e.dispose();
  const glb = await io.writeBinary(doc), buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => new GLTFLoader().parse(buf, "", res, rej));
});
async function faceMeasures(file: string) {
  const r = (await (await nodeIO()).read(file)).getRoot(), lm = r.listScenes()[0].getExtras() as { humanIdentity: { landmarks: { eyes: { l: number[]; r: number[] }; attach: { ears: { l: { root: number[] }; r: { root: number[] } } } } } };
  const L = lm.humanIdentity.landmarks, ey = L.eyes.l[1], P = r.listMeshes().find((m) => m.getName() === "identity_head")!.listPrimitives()[0].getAttribute("POSITION")!.getArray()!;
  const band = (y0: number, y1: number, zmin: number) => { let a = 9, b = -9; for (let i = 0; i < P.length; i += 3) if (P[i + 1] >= y0 && P[i + 1] <= y1 && P[i + 2] > zmin) { a = Math.min(a, P[i]); b = Math.max(b, P[i]); } return b - a; };
  return [band(ey - 0.12, ey - 0.06, 0.15), band(0.9, 0.95, 0.15), band(ey - 0.02, ey + 0.02, 0.15), ey - 0.805, L.eyes.r[0] - L.eyes.l[0], L.attach.ears.r.root[0] - L.attach.ears.l.root[0]];
}
let bonRef: number[] | null = null;
const out: Record<string, unknown> = {};
for (let i = 0; i < args.length; i += 3) {
  const [id, file, mountSpec = "prod"] = [args[i], args[i + 1], args[i + 2]];
  try {
    if (!fs.existsSync(file)) throw new Error(`identity file missing: ${file}`);
    // "mounts:<file>" = the PRODUCTION path (appearanceFor with a validated-head record, as VALIDATED_HEADS feeds the runtime)
    const rec = recipeOf(id), cfg = mountSpec.startsWith("mounts:") ? appearanceFor(id, JSON.parse(fs.readFileSync(mountSpec.slice(7), "utf8"))) : appearanceFor(id) ?? (rec ? candidateAppearance(id, undefined, rec.body === "feminine" ? "feminine" : "standard") : null);
    if (!cfg) throw new Error(`no production appearance for "${id}" and no pipeline recipe`);
    if (mountSpec.startsWith("mounts:") && !cfg.identity.mount) throw new Error(`no validated mount for "${id}" in ${mountSpec.slice(7)}`);
    if (mountSpec === "auto" || mountSpec === "auto-head") { bonRef ??= await faceMeasures("public/avatars/human-base-v1/production/bon-v1.glb"); const m = await faceMeasures(file);
      const face = Math.exp(m.reduce((a, v, k) => a + Math.log(v / bonRef![k]), 0) / m.length), scale = Math.round(((1 / face) * (cfg.bodyPreset === "feminine" ? 0.98 : 1)) / 0.005) * 0.005;
      cfg.identity.mount = { scale: +scale.toFixed(3), pitchDeg: 0 }; }
    const cat = new Map(HUMANBASE_CATALOGUE); const head = cat.get(cfg.identity.headAssetId) ?? identityHeadAsset(id, ""); cat.set(head.id, { ...head, url: `file:${file}` });
    let h = await HumanAvatar.create(cfg, cat);
    // automatic normalization, step 2 (the rule the approved batch-2 mounts were set with): hold the mounted chin→eye / body
    // inside the approved five's band — face length scales exactly with the mount (it scales about the Head joint)
    // every mounted ratio scales LINEARLY with the mount (it scales about the Head joint), so the mount is chosen as the scale
    // nearest the face-size suggestion that holds face length in the APPROVED band, then — only if the skull would leave the
    // GATE's width / height bands (a naturally long, narrow head) — moved within the gate's face-length band to satisfy them.
    // If no scale satisfies every band the identity is outside the family and the gate fails it closed.
    if (mountSpec === "auto") { const m0 = mountedMetrics(h), s0 = cfg.identity.mount!.scale!, at = (s: number) => ({ fl: m0.faceLenToBody * s / s0, sw: m0.skullWToShoulder * s / s0, sh: m0.skullHToBody * s / s0 });
      let s = s0; const a = at(s0); if (a.fl > 0.482) s = s0 * 0.482 / a.fl; else if (a.fl < 0.451) s = s0 * 0.451 / a.fl;
      const b = at(s); if (b.sw < 0.46) { const sn = s * 0.46 / b.sw, c = at(sn); if (c.fl <= 0.5 && c.sh <= 1.09) s = sn; } else if (b.sw > 0.6) { const sn = s * 0.6 / b.sw, c = at(sn); if (c.fl >= 0.43 && c.sh >= 0.81) s = sn; }
      s = Math.round(s / 0.005) * 0.005; if (Math.abs(s - s0) > 1e-6) { cfg.identity.mount = { scale: +s.toFixed(3), pitchDeg: 0 }; h.dispose(); h = await HumanAvatar.create(cfg, cat); } }
    // INTEGRATION MODE (opt-in, build-employees --integrate): the generated head is never reshaped, so its size is ONE uniform mount
    // scale that puts the hair-independent skull height / body at the centre of the approved five's band (0.873–1.016). Every
    // band — face length included — is then judged by the gate exactly as for any build; nothing is moved to satisfy it.
    if (mountSpec === "auto-head") { const m0 = mountedMetrics(h), s0 = cfg.identity.mount!.scale!, s = Math.round((s0 * ((0.873 + 1.016) / 2) / m0.skullHToBody) / 0.005) * 0.005;
      if (Math.abs(s - s0) > 1e-6) { cfg.identity.mount = { scale: +s.toFixed(3), pitchDeg: 0 }; h.dispose(); h = await HumanAvatar.create(cfg, cat); } }
    out[`${id}|${file}`] = { ok: true, mountSpec, mount: cfg.identity.mount ? { scale: cfg.identity.mount.scale ?? 1, pitchDeg: cfg.identity.mount.pitchDeg ?? 0 } : null, preset: cfg.bodyPreset ?? "standard", worn: [cfg.glasses.assetId].filter(Boolean), wornAccessories: cfg.accessories.map((a) => a.assetId), ...mountedMetrics(h),
      closureWalls: closureWallEvidence(h, idleClip(cfg.idleProfile)),   // report-only (failure-registry REPORT_ONLY); leaves the avatar holding its idle
      motion: motionEvidence(h, idleClip(cfg.idleProfile)) };   // report-only; measured last — it leaves the avatar mid-walk
    h.dispose();
  } catch (e) { out[`${id}|${file}`] = { ok: false, error: String((e as Error)?.message ?? e) }; }   // a detector that cannot run is a FAILURE, never a skip
}
console.log("MOUNTED_GATE_JSON " + JSON.stringify(out));
