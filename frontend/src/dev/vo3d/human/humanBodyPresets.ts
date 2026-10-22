// vo3d human — BODY PRESETS: one rig, several body silhouettes.
//
// A preset is a smooth, restrained DISPLACEMENT of bind-pose positions (native base units). It is applied once to the
// body (build-body-preset-feminine.mjs bakes it into human-base-feminine.glb) and, at equip time, to every garment
// worn over it — so modular clothing follows the preset without per-preset garment files. The skeleton, inverse binds,
// weights, clips and sockets are never touched; hands, feet, neck and head are outside every field.
import type { BodyPreset } from "./humanBaseContract";

export const FEMININE = {
  chestUnderArm: 0.94, // x scale below the arm root (y≈0.58–0.66)
  waist: 0.9, //          x scale at the waist (y≈0.50–0.55)
  waistDepth: 0.95, //    z scale at the waist
  hips: 1.045, //         x scale at the hips (y≈0.40–0.46)
  shoulderSlope: 0.012, // shoulder-top corners lowered
  limbSlim: 0.94, //      arm thickness about the bone axis
} as const;

/** what kind of body part a vertex sits on — the body's `_region`, or a garment's dominant joint */
export type PresetPart = "torso" | "chest" | "armL" | "armR" | "none";
export type PresetJoints = { spineZ: number; armL: [number, number, number]; handL: [number, number, number]; armR: [number, number, number]; handR: [number, number, number] };

const sm = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const keys = (k: readonly (readonly [number, number])[], y: number): number => {
  if (y <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (y <= k[i][0]) { const [y0, v0] = k[i - 1], [y1, v1] = k[i]; return v0 + (v1 - v0) * sm(y0, y1, y); }
  return k[k.length - 1][1];
};

/** displace one bind-pose position in place; returns true when it moved. ONE CONTINUOUS SPATIAL FIELD for the body and
 *  every garment: the torso field (width/depth by height) blended into the arm field (slimming about the arm axis) by
 *  how far out along the arm the point is — so separately modelled garment parts (torso, sleeves, hem, collar) that
 *  overlap at seams move identically and never tear apart. `_part` is accepted for compatibility and ignored. */
export function presetDisplace(preset: BodyPreset | undefined, p: [number, number, number], _part: PresetPart | null, j: PresetJoints): boolean {
  if (!preset || preset === "standard") return false;
  const F = FEMININE; const [x0, y0, z0] = p;
  // torso
  const SX = [[0.3, 1], [0.36, 1 + (F.hips - 1) * 0.6], [0.42, F.hips], [0.46, F.hips], [0.52, F.waist], [0.55, F.waist], [0.6, F.chestUnderArm], [0.66, F.chestUnderArm], [0.72, 1], [0.8, 1]] as const;
  const SZ = [[0.44, 1], [0.52, F.waistDepth], [0.55, F.waistDepth], [0.62, 1]] as const;
  const armRoot = sm(0.62, 0.7, y0) * sm(0.15, 0.2, Math.abs(x0));
  const tx = x0 * (1 + (keys(SX, y0) - 1) * (1 - armRoot)), tz = j.spineZ + (z0 - j.spineZ) * keys(SZ, y0);
  const ty = y0 - F.shoulderSlope * sm(0.72, 0.78, y0) * sm(0.1, 0.19, Math.abs(x0)) * (1 - sm(0.2, 0.215, Math.abs(x0)));
  // arm (the side the point is on), fading out over the hand
  const a = x0 >= 0 ? j.armL : j.armR, h = x0 >= 0 ? j.handL : j.handR;
  const d = [h[0] - a[0], h[1] - a[1], h[2] - a[2]], L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = Math.max(0, Math.min(1, ((x0 - a[0]) * d[0] + (y0 - a[1]) * d[1] + (z0 - a[2]) * d[2]) / L2));
  const c = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], k = 1 + (F.limbSlim - 1) * sm(0, 0.08, t) * (1 - sm(0.85, 1, t));
  const ax = c[0] + (x0 - c[0]) * k, ay = c[1] + (y0 - c[1]) * k, az = c[2] + (z0 - c[2]) * k;
  // how much the point belongs to the arm: out past the shoulder, at arm height
  const w = sm(0.19, 0.26, Math.abs(x0)) * sm(0.55, 0.6, y0);
  p[0] = tx + (ax - tx) * w; p[1] = ty + (ay - ty) * w; p[2] = tz + (az - tz) * w;
  return p[0] !== x0 || p[1] !== y0 || p[2] !== z0;
}

/** a garment vertex's part from its dominant joint (garments carry no regions) */
export function partFromJoint(name: string): PresetPart {
  if (/^(Hips|Spine|Spine01|Spine02|LeftUpLeg|RightUpLeg)$/.test(name)) return "torso";
  if (/^(LeftShoulder|RightShoulder|neck)$/.test(name)) return "chest";
  if (/^Left(Arm|ForeArm)$/.test(name)) return "armL";
  if (/^Right(Arm|ForeArm)$/.test(name)) return "armR";
  return "none";
}
