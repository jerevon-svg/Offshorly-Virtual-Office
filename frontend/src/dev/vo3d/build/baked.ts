// vo3d build — baked (V1-plate-measured) decor for a room, built in ROOM-LOCAL units and returned as one
// group that the caller positions at the room's world origin. Visual only: their solids are room.solids.
import * as THREE from "three";
import { boxFromSpec, rbox, shadowed, type BoxSpec } from "./helpers";
import { canvas2d, fabric, mat, metal, plastic, wood } from "../render/Materials";
import { mug, smallPot } from "./props";
import type { ShellSpec } from "../world/WorldState";
import { counterNosing } from "./detail-props";

export type DesignBaked = {
  rearCabinet: BoxSpec; rearCabinetModules: number; coffeeMachine: BoxSpec; rearFrames: BoxSpec[]; rearBooks: BoxSpec;
  whiteboard: { x0: number; x1: number; yBottom: number; yTop: number };
  boards: { z0: number; z1: number; yBottom: number; yTop: number }[];
  bottomCabinets: BoxSpec[]; printer: BoxSpec; plantRack: BoxSpec;
};

// ---- baked items ---------------------------------------------------------------------------------
function whiteboardTexture(): THREE.Texture | null {
  const ctx = canvas2d(512, 256);
  if (!ctx) return null;
  ctx.fillStyle = "#fbfaf7";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#d9463b";
  ctx.font = "bold 40px 'Comic Sans MS', 'Marker Felt', sans-serif";
  ctx.textAlign = "center";
  ["ALWAYS GIVE", "A 100% AT", "WORK"].forEach((t, i) => ctx.fillText(t, 256, 58 + i * 46));
  ctx.font = "22px 'Comic Sans MS', 'Marker Felt', sans-serif";
  ctx.textAlign = "left";
  ["MON - 11%", "TUES - 24%", "WED - 40%", "THURS - 23%", "FRI - 2%"].forEach((t, i) => ctx.fillText(t, 40, 178 + i * 19));
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function rearCabinet(BAKED: DesignBaked): THREE.Group {
  // long white credenza on a dark plinth: alternating wood / olive doors with a
  // groove and a bar handle, top items: coffee machine, frames, books, small pots
  const g = new THREE.Group();
  const b = BAKED.rearCabinet;
  g.add(boxFromSpec(b, plastic("white"), 1.4));
  g.add(rbox(b.w - 3, 1.2, b.d - 3, mat("charcoal", 0.8), b.x + b.w / 2, -0.1, b.z + b.d / 2, 0.2)); // plinth shadow line
  const n = BAKED.rearCabinetModules;
  const mw = (b.w - 4) / n;
  for (let i = 0; i < n; i++) {
    const cx = b.x + 2 + mw * (i + 0.5), fz = b.z + b.d - 0.2;
    const isWood = i % 3 !== 1;
    const door = rbox(mw - 1.2, b.h - 4.5, 1.2, isWood ? wood() : fabric("green"), cx, 2.2, fz, 0.5);
    g.add(door);
    g.add(rbox(mw - 3, 0.35, 0.3, mat("charcoal", 0.8), cx, 2.2 + (b.h - 4.5) * 0.55, fz + 0.5, 0.1)); // groove
    g.add(rbox(mw * 0.3, 0.6, 0.6, metal(), cx, 2.2 + (b.h - 4.5) * 0.62, fz + 0.7, 0.2)); // handle
  }
  // coffee machine: body, tray, cup, top tank
  const cm = BAKED.coffeeMachine;
  const cmx = cm.x + cm.w / 2, cmz = cm.z + cm.d / 2;
  g.add(rbox(cm.w * 0.75, cm.h, cm.d * 0.8, mat("charcoal", 0.45), cmx, b.h, cmz - cm.d * 0.05, 0.9));
  g.add(rbox(cm.w * 0.8, 1, cm.d * 0.95, metal(), cmx, b.h, cmz, 0.3));
  g.add(rbox(cm.w * 0.5, cm.h * 0.3, cm.d * 0.3, mat("charcoal", 0.3), cmx, b.h + cm.h, cmz - cm.d * 0.1, 0.4));
  g.add(mug(cmx, b.h + 1, cmz + cm.d * 0.35));
  const bk = BAKED.rearBooks;
  for (let i = 0; i < 5; i++) {
    const bw = bk.w / 6;
    const bb = rbox(bw, bk.h * (0.7 + (i % 3) * 0.15), bk.d * 0.6, mat(i % 2 ? "green" : "wood", 0.85), bk.x + bw * (i + 0.5) + 1, b.h, bk.z + bk.d / 2, 0.25);
    g.add(bb);
  }
  for (const f of BAKED.rearFrames) {
    g.add(rbox(f.w, f.h, 0.8, plastic("white"), f.x + f.w / 2, b.h, f.z + f.d / 2, 0.25));
    g.add(rbox(f.w * 0.7, f.h * 0.6, 0.2, mat("boardPin", 0.9), f.x + f.w / 2, b.h + f.h * 0.2, f.z + f.d / 2 + 0.5, 0.1));
  }
  g.add(smallPot(b.x + b.w * 0.42, b.h, b.z + b.d * 0.45, 1.6));
  g.add(smallPot(b.x + b.w * 0.86, b.h, b.z + b.d * 0.5, 1.8));
  return g;
}

export function whiteboard(BAKED: DesignBaked, SHELL: ShellSpec): THREE.Group {
  const g = new THREE.Group();
  const wb = BAKED.whiteboard;
  const w = wb.x1 - wb.x0, h = wb.yTop - wb.yBottom;
  const z = SHELL.wallThickness + 0.9;
  g.add(rbox(w + 2, h + 2, 1.4, metal(), wb.x0 + w / 2, wb.yBottom - 1, z - 0.3, 0.4));
  const tex = whiteboardTexture();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }) : plastic("white"));
  face.position.set(wb.x0 + w / 2, wb.yBottom + h / 2, z + 0.5);
  g.add(shadowed(face, false, true));
  g.add(rbox(w * 0.6, 1.2, 1.8, metal(), wb.x0 + w / 2, wb.yBottom - 1.4, z + 0.6, 0.3)); // marker tray
  return g;
}

export function leftBoards(BAKED: DesignBaked, SHELL: ShellSpec): THREE.Group {
  const g = new THREE.Group();
  const x = SHELL.wallThickness + 0.8;
  for (const b of BAKED.boards) {
    const len = b.z1 - b.z0, h = b.yTop - b.yBottom;
    g.add(rbox(1.2, h, len, mat("boardBg", 0.95), x, b.yBottom, b.z0 + len / 2, 0.3));
    g.add(rbox(1.0, h + 1.2, len + 1.2, wood(), x - 0.3, b.yBottom - 0.6, b.z0 + len / 2, 0.3)); // frame
    for (let i = 0; i < 8; i++) {
      const pin = rbox(0.5, 4.5, 3.6, mat(i % 3 === 0 ? "boardPin" : i % 3 === 1 ? "wood" : "cushionCream", 0.9), x + 0.9, b.yBottom + 3 + (i % 4) * 7.5, b.z0 + 5 + Math.floor(i / 4) * (len / 2) + (i % 4) * 4, 0.15);
      g.add(pin);
    }
  }
  return g;
}

export function bottomCabinets(BAKED: DesignBaked): THREE.Group {
  // open shelving units: light carcass, one shelf, dividers, books/boxes inside; printer on unit 2
  const g = new THREE.Group();
  BAKED.bottomCabinets.forEach((b, idx) => {
    const carcass = mat("cushionGray", 0.85);
    g.add(rbox(b.w, 1.4, b.d, carcass, b.x + b.w / 2, b.h - 1.4, b.z + b.d / 2, 0.5)); // top
    g.add(rbox(b.w, 1.2, b.d, carcass, b.x + b.w / 2, 0, b.z + b.d / 2, 0.3)); // bottom
    g.add(rbox(b.w, b.h, 1.2, carcass, b.x + b.w / 2, 0, b.z + 0.6, 0.3)); // back
    const n = Math.max(2, Math.round(b.w / 24));
    const cw = b.w / n;
    for (let i = 0; i <= n; i++) g.add(rbox(1.2, b.h, b.d, carcass, b.x + Math.min(b.w - 0.6, Math.max(0.6, cw * i)), 0, b.z + b.d / 2, 0.3));
    g.add(rbox(b.w - 2, 0.9, b.d - 1.5, carcass, b.x + b.w / 2, b.h * 0.5, b.z + b.d / 2 - 0.4, 0.2)); // shelf
    for (let i = 0; i < n; i++) {
      const cx = b.x + cw * (i + 0.5);
      if (i % 2 === 0) {
        g.add(rbox(cw * 0.6, b.h * 0.36, b.d * 0.6, mat(i % 4 === 0 ? "green" : "wood", 0.85), cx, 1.2, b.z + b.d / 2, 0.3)); // box
      } else {
        for (let k = 0; k < 3; k++) g.add(rbox(1.2, b.h * 0.34 - k * 0.6, b.d * 0.55, mat(k % 2 ? "greenDark" : "cushionCream", 0.85), cx - 2 + k * 1.8, 1.2, b.z + b.d / 2, 0.15)); // books
      }
    }
    if (idx === 1) {
      const pr = BAKED.printer;
      const px2 = pr.x + pr.w / 2, pz2 = pr.z + pr.d / 2;
      g.add(rbox(pr.w, pr.h * 0.7, pr.d, mat("charcoal", 0.5), px2, b.h, pz2, 0.9));
      g.add(rbox(pr.w * 0.9, pr.h * 0.3, pr.d * 0.8, mat("cushionGray", 0.5), px2, b.h + pr.h * 0.7, pz2 - pr.d * 0.05, 0.6));
      g.add(rbox(pr.w * 0.7, 0.5, 2.5, plastic("white"), px2, b.h + pr.h * 0.35, pz2 + pr.d / 2 + 1, 0.15)); // paper tray
    }
  });
  return g;
}

export function plantRack(BAKED: DesignBaked): THREE.Group {
  const g = new THREE.Group();
  const r = BAKED.plantRack;
  for (const y of [r.h - 1, r.h * 0.5]) g.add(rbox(r.w, 1, r.d, wood(), r.x + r.w / 2, y, r.z + r.d / 2, 0.3));
  for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]) {
    g.add(rbox(1, r.h, 1, metal(), r.x + 0.5 + sx * (r.w - 1), 0, r.z + 0.5 + sz * (r.d - 1), 0.2));
  }
  return g;
}

/** All baked decor of the Design Room as one room-local group. */
export function buildDesignBaked(baked: DesignBaked, shell: ShellSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "baked";
  g.add(rearCabinet(baked), whiteboard(baked, shell), leftBoards(baked, shell), bottomCabinets(baked), plantRack(baked));
  g.add(studioDressing(baked));
  return g;
}

/** THE DESIGN ROOM'S SHARE OF THE FINAL ART PASS — ONE thing, because this room is the oldest and
 *  densest in the office and the risk here is not under-dressing, it is burying V1's own composition
 *  under new objects.
 *
 *  The long rear credenza is the room's biggest horizontal surface and the one the camera looks across on
 *  the way in; it met the air on a square arris. It gets the shared worktop bullnose and the room gets
 *  nothing else. A premium studio reads as premium through its edge details, not through more objects.
 *
 *  ROOM-LOCAL, like everything else in this file. */
function studioDressing(baked: DesignBaked): THREE.Group {
  const g = new THREE.Group();
  g.name = "design-studio-dressing";
  const c = baked.rearCabinet;
  g.add(counterNosing({
    axis: "x", at: c.z + c.d, dir: 1, from: c.x + 1, to: c.x + c.w - 1, top: c.h,
    key: "white", name: "design-credenza-nosing",
  }));
  return g;
}
