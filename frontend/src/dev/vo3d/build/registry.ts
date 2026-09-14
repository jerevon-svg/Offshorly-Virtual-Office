// vo3d build — entity kind → builder. A builder returns a Group positioned in WORLD space for the
// entity's current transform; the scene mirror re-positions it on later transform changes.
import * as THREE from "three";
import type { Entity, RoomDef } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { buildFurniture, FURNITURE_KINDS, type FurnitureKind } from "./furniture";
import { plantFor, type PlantSpec } from "./plants";
import type { SwayNode } from "../render/Sway";
import { cyl, rbox, shadowed } from "./helpers";
import { facadeGlassMat, glassMat, metal, type MatKey } from "../render/Materials";
import { buildShell, type ShellOptions } from "./shell";
import { buildDesignBaked, type DesignBaked } from "./baked";
import { receptionStatic } from "./reception";
import { meetingStatic } from "./meeting";
import { projectStatic } from "./project";
import { gamingStatic } from "./gaming";
import { centralHubStatic } from "./central-hub";
import { executiveStatic } from "./executive";
import { EXEC_KINDS, buildExecFurniture } from "./exec-furniture";
import { CMS_KINDS, buildCmsFurniture } from "./cms-furniture";
import { cmsStatic } from "./cms";
import { AI_KINDS, buildAiFurniture } from "./ai-furniture";
import { aiStatic } from "./ai";
import { DEV_KINDS, buildDevFurniture } from "./dev-furniture";
import { devStatic } from "./dev";
import { QA_KINDS, buildQaFurniture } from "./qa-furniture";
import { qaStatic } from "./qa";

export type BuildResult = { group: THREE.Group; sway: SwayNode[] };

/** roomId → the room's STATIC geometry (shell / architecture / baked decor), returned already placed in
 *  WORLD space. The render layer just looks the room up — it knows nothing room-specific. A room with no
 *  entry contributes no static geometry (it is still an unreconstructed footprint on the ground floor). */
export type RoomStaticBuilder = (room: RoomDef, opts: ShellOptions) => THREE.Group;

function designRoomStatic(room: RoomDef, opts: ShellOptions): THREE.Group {
  if (!room.shell) throw new Error("design room: missing ShellSpec");
  const g = new THREE.Group();
  g.name = `static:${room.id}`;
  g.position.set(room.rect.x, 0, room.rect.z); // its shell and baked decor are measured ROOM-LOCALLY
  g.add(buildShell({ w: room.rect.w, d: room.rect.d }, room.shell, opts));
  g.add(buildDesignBaked(room.baked as DesignBaked, room.shell));
  return g;
}

export const ROOM_STATIC: Record<string, RoomStaticBuilder> = {
  "design-room": designRoomStatic,
  "reception-room": receptionStatic,
  "meeting-room": meetingStatic,
  "project-room": projectStatic,
  "gaming-room": gamingStatic,
  "central-hub": centralHubStatic,
  "executive-room": executiveStatic,
  "cms-room": cmsStatic,
  "ai-room": aiStatic,
  "dev-room": devStatic,
  "qa-room": qaStatic,
};

export function buildEntity(e: Entity): BuildResult {
  const sway: SwayNode[] = [];
  if ((FURNITURE_KINDS as readonly string[]).includes(e.kind)) {
    const w = Number(e.props.w), d = Number(e.props.d);
    const group = buildFurniture({
      kind: e.kind as FurnitureKind,
      rect: { x: e.transform.pos.x - w / 2, z: e.transform.pos.z - d / 2, w, d },
      facing: e.props.facing as Facing,
      mirrored: Boolean(e.props.mirrored),
      tone: e.props.tone === "lounge" ? "lounge" : undefined,
      // Phase 5B colour/shape props (rooms/gaming.ts THEME). Absent on every pre-5B entity, so every
      // existing piece keeps its historical materials untouched.
      color: e.props.color as MatKey | undefined,
      colorSeat: e.props.colorSeat as MatKey | undefined,
      accent: e.props.accent as MatKey | undefined,
      shape: e.props.shape === "rect" ? "rect" : undefined,
      glow: e.props.glow === undefined ? undefined : Number(e.props.glow),
      seats: e.props.seats === undefined ? undefined : Number(e.props.seats),
    });
    return { group, sway };
  }
  if (e.kind === "plant") {
    const spec: PlantSpec = { x: e.transform.pos.x, z: e.transform.pos.z, r: Number(e.props.r), h: Number(e.props.h), hanging: Boolean(e.props.hanging), y: Number(e.props.y),
      lush: e.props.lush === undefined ? undefined : Number(e.props.lush), pot: e.props.pot === false ? false : undefined };
    return { group: plantFor(spec, sway), sway };
  }
  if (e.kind === "sliding-door") {
    // glass leaf standing in the wall plane (local x = 0), its long axis along z; handle on the room-side face
    const leafW = Number(e.props.leafW), glassH = Number(e.props.glassH);
    const group = new THREE.Group();
    group.position.set(e.transform.pos.x, 0, e.transform.pos.z);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(leafW, glassH - 1), glassMat());
    pane.rotation.y = Math.PI / 2;
    pane.position.set(0, 3 + glassH / 2, 0);
    group.add(shadowed(pane, false, false));
    group.add(rbox(1, 8, 1.2, metal(), Number(e.props.handleX), 24, Number(e.props.handleZ), 0.3));
    return { group, sway };
  }
  if (e.kind === "glass-door-leaf") {
    // one panel of the Reception bi-parting entrance: frameless pane in slim metal rails with a tubular
    // pull on its leading stile. The GROUP is the carrier the door controller slides; geometry is local.
    const w = Number(e.props.w), h = Number(e.props.h), handle = Number(e.props.handle);
    const group = new THREE.Group();
    group.position.set(e.transform.pos.x, 0, e.transform.pos.z);
    // the leaf is authored in the XY plane (width along local x, faces along local z). A door in an
    // EAST/WEST wall is the same leaf turned a quarter, so the carrier takes the entity's own yaw —
    // 0 for every pre-8 leaf, so Reception's and Executive's entrances are untouched.
    group.rotation.y = e.transform.yaw;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.6, h - 6.4), facadeGlassMat());
    pane.position.set(0, 3.6 + (h - 6.4) / 2, 0);
    group.add(shadowed(pane, false, false));
    group.add(rbox(w - 1.6, 1.6, 1.8, metal(), 0, 1.9, 0, 0.35)); // bottom rail (rides the threshold track)
    group.add(rbox(w - 1.6, 1.6, 1.8, metal(), 0, h - 4.4, 0, 0.35)); // top rail (rides the head track)
    group.add(rbox(1.2, h - 7, 1.4, metal(), handle * (w / 2 - 1.4), 3.6, 0, 0.3)); // leading stile
    group.add(cyl(0.9, 20, metal(), handle * (w / 2 - 5.5), h * 0.3, -1.6)); // pull handle, room side
    return { group, sway };
  }
  // EXECUTIVE ROOM furniture: its own builders, because the shared catalogue above carries the other
  // rooms' visual identity (see build/exec-furniture.ts). Routed by kind, nothing else changes.
  if ((EXEC_KINDS as readonly string[]).includes(e.kind)) {
    const group = buildExecFurniture(e, sway);
    if (group) return { group, sway };
  }
  // CMS ROOM furniture: its own builders, for the same reason (see build/cms-furniture.ts).
  if ((CMS_KINDS as readonly string[]).includes(e.kind)) {
    const group = buildCmsFurniture(e);
    if (group) return { group, sway };
  }
  // AI ROOM furniture: its own builders, for the same reason (see build/ai-furniture.ts).
  if ((AI_KINDS as readonly string[]).includes(e.kind)) {
    const group = buildAiFurniture(e);
    if (group) return { group, sway };
  }
  // DEV ROOM furniture: its own builders, for the same reason (see build/dev-furniture.ts).
  if ((DEV_KINDS as readonly string[]).includes(e.kind)) {
    const group = buildDevFurniture(e);
    if (group) return { group, sway };
  }
  // QA ROOM furniture: its own builders, for the same reason (see build/qa-furniture.ts).
  if ((QA_KINDS as readonly string[]).includes(e.kind)) {
    const group = buildQaFurniture(e);
    if (group) return { group, sway };
  }
  if (e.kind === "solid") return { group: new THREE.Group(), sway }; // footprint-only entity (baked decor drawn by the shell builder)
  throw new Error(`no builder for entity kind "${e.kind}" (${e.id})`);
}
