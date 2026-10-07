// vo3d playground — THE MONKEYAGENT TRAVERSAL PLAYGROUND. TEMPORARY, DEV-ONLY.
//
// A small, isolated set of REAL traversal geometry — a trunk, a notched upper deck, a leaning ladder, a fire
// pole, a lower deck with a ramp, a stump, an angled branch, a level branch, a hang bar, a desk and chair, a
// standing bench and a pair of handoff spots — and the traversal graph authored against it. It exists to
// prove the locomotion system (world/monkeyTraversal, avatar/monkeyMotion, avatar/MonkeyLocomotion) on the
// production MonkeyAgent base before the AI Lab V2 treehouse is designed around it. Nothing in the
// production Lab depends on it; deleting this folder and its page removes it.
//
// EVERYTHING IS A FUNCTION OF THE CLOCK: the shared cast runner (avatar/MonkeyCastRunner) replays the
// scenario's timed requests from scratch on `seek(t)`, which is also how the harness captures any instant.
import * as THREE from "three";
import { MonkeyCastRunner, type CastCmd, type CastScenario } from "../avatar/MonkeyCastRunner";
import { offsetGraph, v3, type TLink, type TNode, type TraversalGraph, type V3 } from "../world/monkeyTraversal";

// ============================== GEOMETRY (local frame: y up, the floor at 0) ================================
export const PG = {
  floor: { x0: -290, x1: 290, z0: -175, z1: 135 },
  trunk: { x: -40, z: -90, r: 16, h: 118 },
  /** the upper deck: top y, its rect, and the notch the trunk climb rises through */
  upper: { y: 48, x0: -80, x1: 60, z0: -130, z1: -40, notch: { x0: -55, x1: -25, z0: -74, z1: -40 } },
  ladder: { x: 20, topZ: -40, footZ: -29.8, width: 15, rung: 6 },
  pole: { x: 61.5, z: -81, r: 1.6, top: 70 },
  lower: { y: 24, x0: -205, x1: -130, z0: -62, z1: 0, ramp: { x: -165, z0: 0, z1: 62, w: 26 } },
  stump: { x: -95, z: 22, r: 9, h: 30 },
  angled: { from: v3(-152, 0, -100), to: v3(-80, 48, -100), r: 5 },
  level: { from: v3(60, 48, -100), to: v3(122, 48, -100), r: 4.6 },
  perchDeck: { y: 48, x0: 120, x1: 152, z0: -116, z1: -84 },
  hangBar: { x: -86, y: 65, z0: -128, z1: -96 },
  /** MONKEY-PROPORTIONED STATIONS: a lab stool (seat 12, footrest 7) at an 18-high bench; a 13-high standing
   *  bench. Screens stand ≥ 14 in front of the operator's spine (the chibi head is 9.5 in radius). */
  desk: { x: 120, z: 40, w: 46, d: 26, h: 18, seat: 12, foot: 7 },
  bench: { x: 205, z: 36, w: 40, d: 26, h: 13 },
};
const DECK_T = 4;

function mats() {
  const m = (color: number, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  return {
    floor: m(0xd9d2c4, 0.95), bark: m(0x6b4a32, 0.95), wood: m(0xb88a5a, 0.75), deck: m(0xc9a173, 0.7),
    metal: m(0x9aa3ad, 0.35, 0.6), rope: m(0xc8b089, 0.9), dark: m(0x3a3f47, 0.6), cushion: m(0x7fa38f, 0.9),
    screen: new THREE.MeshStandardMaterial({ color: 0x9cc8ff, emissive: 0x6fa8e8, emissiveIntensity: 0.6 }),
    mark: m(0xe0a95a, 0.6),
  };
}
const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); return o;
};
/** a cylinder from a to b */
function rod(a: V3, b: V3, r: number, m: THREE.Material, seg = 14): THREE.Mesh {
  const A = new THREE.Vector3(a.x, a.y, a.z), B = new THREE.Vector3(b.x, b.y, b.z);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg), m);
  o.position.copy(A).lerp(B, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return o;
}

export function buildPlaygroundGeometry(): THREE.Group {
  const g = new THREE.Group();
  g.name = "monkey-playground";
  const M = mats();
  const F = PG.floor;
  g.add(box(F.x1 - F.x0, 2, F.z1 - F.z0, M.floor, (F.x0 + F.x1) / 2, -2, (F.z0 + F.z1) / 2));
  // trunk with a bark-ish faceting and a branch stub above the deck
  const T = PG.trunk;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(T.r * 0.9, T.r * 1.08, T.h, 18, 6), M.bark);
  trunk.position.set(T.x, T.h / 2, T.z);
  g.add(trunk);
  g.add(rod(v3(T.x, 92, T.z), v3(T.x - 40, 112, T.z - 18), 6, M.bark));
  // the upper deck, NOTCHED where the trunk climb rises through it
  const U = PG.upper, N = U.notch;
  const deck = (x0: number, x1: number, z0: number, z1: number) => g.add(box(x1 - x0, DECK_T, z1 - z0, M.deck, (x0 + x1) / 2, U.y - DECK_T, (z0 + z1) / 2));
  deck(U.x0, N.x0, N.z0, U.z1); // west of the notch
  deck(N.x1, U.x1, N.z0, U.z1); // east of the notch
  deck(U.x0, U.x1, U.z0, N.z0); // north band, round the trunk
  for (const [x, z] of [[U.x0 + 3, U.z0 + 3], [U.x1 - 3, U.z0 + 3], [U.x0 + 3, U.z1 - 3], [U.x1 - 3, U.z1 - 3], [-10, U.z1 - 3]]) g.add(box(5, U.y - DECK_T, 5, M.wood, x, 0, z));
  // a low rail on the north edge only (the others are traversal edges)
  g.add(box(U.x1 - U.x0, 1.6, 1.6, M.wood, (U.x0 + U.x1) / 2, U.y + 12, U.z0 + 1));
  for (let x = U.x0 + 4; x < U.x1; x += 22) g.add(box(1.6, 12, 1.6, M.wood, x, U.y, U.z0 + 1));
  // the leaning ladder against the deck's south edge
  const L = PG.ladder;
  for (const sx of [-1, 1]) g.add(rod(v3(L.x + sx * L.width / 2, 0, L.footZ), v3(L.x + sx * L.width / 2, U.y + 8, L.topZ - 1.7), 0.9, M.wood));
  for (let y = L.rung; y < U.y; y += L.rung) {
    const k = y / U.y, z = L.footZ + (L.topZ - L.footZ) * k;
    g.add(rod(v3(L.x - L.width / 2, y, z), v3(L.x + L.width / 2, y, z), 0.55, M.wood, 8));
  }
  // the fire pole off the deck's east edge
  const P = PG.pole;
  g.add(rod(v3(P.x, 0, P.z), v3(P.x, P.top, P.z), P.r, M.metal));
  g.add(rod(v3(P.x, P.top, P.z), v3(U.x1 - 4, P.top, P.z), 1, M.metal));
  // lower deck + ramp
  const W = PG.lower;
  g.add(box(W.x1 - W.x0, W.y, W.z1 - W.z0, M.wood, (W.x0 + W.x1) / 2, 0, (W.z0 + W.z1) / 2));
  const rampLen = Math.hypot(W.ramp.z1 - W.ramp.z0, W.y);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(W.ramp.w, 2, rampLen), M.deck);
  ramp.position.set(W.ramp.x, W.y / 2 - 1, (W.ramp.z0 + W.ramp.z1) / 2);
  ramp.rotation.x = Math.atan2(W.y, W.ramp.z1 - W.ramp.z0);
  g.add(ramp);
  // stump
  const S = PG.stump;
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(S.r, S.r * 1.15, S.h, 16), M.bark);
  stump.position.set(S.x, S.h / 2, S.z);
  g.add(stump);
  // branches: the angled one up to the deck, the level one out to the perch deck. The traversal line is the
  // branch's TOP, so the cylinder sits a radius below it.
  const A = PG.angled;
  g.add(rod(v3(A.from.x - 6, A.from.y - A.r - 4, A.from.z), v3(A.to.x + 4, A.to.y - A.r, A.to.z), A.r, M.bark));
  const B = PG.level;
  g.add(rod(v3(B.from.x - 4, B.from.y - B.r, B.from.z), v3(B.to.x + 4, B.to.y - B.r, B.to.z), B.r, M.bark));
  const PD = PG.perchDeck;
  g.add(box(PD.x1 - PD.x0, DECK_T, PD.z1 - PD.z0, M.deck, (PD.x0 + PD.x1) / 2, PD.y - DECK_T, (PD.z0 + PD.z1) / 2));
  g.add(box(4, PD.y - DECK_T, 4, M.wood, (PD.x0 + PD.x1) / 2, 0, (PD.z0 + PD.z1) / 2));
  // hang bar, carried on two short arms off the deck's west edge
  const H = PG.hangBar;
  g.add(rod(v3(H.x, H.y, H.z0), v3(H.x, H.y, H.z1), 1.3, M.wood));
  for (const z of [H.z0, H.z1]) g.add(rod(v3(H.x, H.y, z), v3(U.x0 + 2, U.y - 2, z), 1.1, M.wood));
  // the work spots: a bench with a lab stool, a standing review bench — screens set back on a riser
  const D = PG.desk;
  g.add(box(D.w, 2, D.d, M.wood, D.x, D.h - 2, D.z));
  for (const sx of [-1, 1]) g.add(box(2, D.h - 2, D.d - 2, M.dark, D.x + sx * (D.w / 2 - 2), 0, D.z));
  g.add(box(28, 3, 6, M.dark, D.x, D.h, D.z - D.d / 2 + 3));
  g.add(box(26, 15, 1.2, M.dark, D.x, D.h + 3, D.z - D.d / 2 + 3));
  g.add(box(24, 13, 0.3, M.screen, D.x, D.h + 4, D.z - D.d / 2 + 3.8));
  g.add(box(14, 0.8, 5, M.dark, D.x, D.h, D.z + D.d / 2 - 6));
  // the stool: seat, column, footrest ring
  const sz = D.z + D.d / 2 + 4.5;
  g.add(box(12, 2, 11, M.cushion, D.x, D.seat - 2, sz));
  g.add(box(2.4, D.seat - 2, 2.4, M.metal, D.x, 0, sz));
  g.add(box(13, 1, 1, M.metal, D.x, D.foot - 0.5, sz + 4.4));
  g.add(box(10, 1.2, 10, M.metal, D.x, 0, sz));
  const Bn = PG.bench;
  g.add(box(Bn.w, 2, Bn.d, M.wood, Bn.x, Bn.h - 2, Bn.z));
  for (const sx of [-1, 1]) g.add(box(2, Bn.h - 2, Bn.d - 2, M.dark, Bn.x + sx * (Bn.w / 2 - 2), 0, Bn.z));
  g.add(box(32, 6, 6, M.dark, Bn.x, Bn.h, Bn.z - Bn.d / 2 + 3));
  g.add(box(30, 18, 1.2, M.dark, Bn.x, Bn.h + 6, Bn.z - Bn.d / 2 + 2));
  g.add(box(28, 16, 0.3, M.screen, Bn.x, Bn.h + 7, Bn.z - Bn.d / 2 + 2.8));
  // a sleeping cushion on the upper deck, handoff marks on the floor
  g.add(box(24, 1.6, 30, M.cushion, 30, U.y, -103));
  for (const n of HANDOFF_MARKS) { const o = new THREE.Mesh(new THREE.CircleGeometry(5, 20), M.mark); o.rotation.x = -Math.PI / 2; o.position.set(n.x, 0.05, n.z); g.add(o); }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

/** SIDE BY SIDE, 26 apart (see MonkeyLocomotion.handoffPose) — never face to face */
const HANDOFF_MARKS = [v3(18, 0, 95), v3(44, 0, 95)];

// ============================== THE TRAVERSAL GRAPH =========================================================

const node = (id: string, at: V3, extra: Partial<TNode> = {}): TNode => ({ id, at, ...extra });
const floorLink = (id: string, a: string, b: string, path: V3[]): TLink => ({ id, from: a, to: b, geom: { kind: "ground", path, surface: "floor" } });

export function buildPlaygroundGraph(): TraversalGraph {
  const T = PG.trunk, U = PG.upper, L = PG.ladder, P = PG.pole, W = PG.lower, S = PG.stump, A = PG.angled, B = PG.level, H = PG.hangBar, D = PG.desk, Bn = PG.bench;
  const n: TNode[] = [
    // floor
    node("f-centre", v3(0, 0, 40), { yaw: Math.PI }),
    node("f-west", v3(-120, 0, 60)),
    node("f-east", v3(150, 0, 90)),
    node("f-far-east", v3(250, 0, 80)),
    node("f-trunk", v3(T.x, 0, T.z + T.r + 11)),
    node("f-ladder", v3(L.x, 0, L.footZ + 9)),
    node("f-pole", v3(P.x + 1.6 + 5.6, 0, P.z)),
    node("f-ramp", v3(W.ramp.x, 0, W.ramp.z1 + 10)),
    node("f-branch", v3(A.from.x - 14, 0, A.from.z)),
    node("f-stump-land", v3(-62, 0, 52)),
    node("f-hang-drop", v3(H.x - 9.6, 0, -112)),
    node("f-desk-app", v3(D.x, 0, D.z + 40)),
    node("f-seat", v3(D.x, 0, D.z + D.d / 2 + 4.5), { yaw: Math.PI, action: "work-seated", work: { seatY: D.seat, surfaceY: D.h } }),
    node("f-bench", v3(Bn.x, 0, Bn.z + Bn.d / 2 + 4.5), { yaw: Math.PI, action: "work-standing", work: { surfaceY: Bn.h } }),
    node("f-give", HANDOFF_MARKS[0], { yaw: 0.42, action: "handoff" }),
    node("f-take", HANDOFF_MARKS[1], { yaw: -0.42, action: "handoff" }),
    node("f-sit", v3(-20, 0, 95), { yaw: Math.PI * 0.9, action: "sit" }),
    // upper deck
    node("u-climb-top", v3(U.notch.x1 + 9, U.y, -60)),
    node("u-ladder-top", v3(L.x, U.y, L.topZ - 9)),
    node("u-pole", v3(U.x1 - 6, U.y, P.z - 9)),
    node("u-hang", v3(U.x0 + 6, U.y, -112)),
    node("u-branch", v3(A.to.x + 9, U.y, A.to.z)),
    node("u-level", v3(B.from.x - 8, U.y, B.from.z)),
    node("u-north", v3(-10, U.y, -116)),
    node("u-west", v3(-68, U.y, -116)),
    node("u-sleep", v3(30, U.y, -98), { yaw: Math.PI, action: "sleep" }),
    node("u-sit", v3(0, U.y, -56), { yaw: 0, action: "sit" }),
    // the perch deck at the end of the level branch, the lower deck, the stump, the hang grip
    node("p-perch", v3(136, PG.perchDeck.y, -100), { yaw: 0, action: "perch" }),
    node("l-top", v3(W.ramp.x, W.y, -6)),
    node("l-edge", v3(W.x1 - 6, W.y, -22)),
    node("s-top", v3(S.x, S.h, S.z), { yaw: Math.PI * 0.75, action: "perch" }),
    node("h-grip", v3(H.x, H.y, -112), { yaw: Math.PI, action: "hang", out: v3(-1, 0, 0) }),
  ];
  const links: TLink[] = [
    // the floor network (straight runs that keep clear of the posts, the ladder foot and the pole)
    floorLink("f:centre-west", "f-centre", "f-west", [v3(0, 0, 40), v3(-120, 0, 60)]),
    floorLink("f:centre-east", "f-centre", "f-east", [v3(0, 0, 40), v3(150, 0, 90)]),
    floorLink("f:east-far", "f-east", "f-far-east", [v3(150, 0, 90), v3(250, 0, 80)]),
    floorLink("f:centre-trunk", "f-centre", "f-trunk", [v3(0, 0, 40), v3(-30, 0, 0), v3(T.x, 0, T.z + T.r + 11)]),
    floorLink("f:centre-ladder", "f-centre", "f-ladder", [v3(0, 0, 40), v3(L.x, 0, L.footZ + 9)]),
    floorLink("f:centre-pole", "f-centre", "f-pole", [v3(0, 0, 40), v3(80, 0, -20), v3(P.x + 7.2, 0, P.z)]),
    floorLink("f:west-ramp", "f-west", "f-ramp", [v3(-120, 0, 60), v3(W.ramp.x, 0, W.ramp.z1 + 10)]),
    floorLink("f:west-branch", "f-west", "f-branch", [v3(-120, 0, 60), v3(-150, 0, 10), v3(-210, 0, -40), v3(-180, 0, -100), v3(A.from.x - 14, 0, A.from.z)]),
    floorLink("f:west-stump", "f-west", "f-stump-land", [v3(-120, 0, 60), v3(-62, 0, 52)]),
    floorLink("f:stump-centre", "f-stump-land", "f-centre", [v3(-62, 0, 52), v3(0, 0, 40)]),
    floorLink("f:hang-west", "f-hang-drop", "f-west", [v3(H.x - 9.6, 0, -112), v3(-110, 0, -60), v3(-112, 0, 30), v3(-120, 0, 60)]),
    floorLink("f:east-desk", "f-east", "f-desk-app", [v3(150, 0, 90), v3(D.x, 0, D.z + 40)]),
    { id: "f:desk-seat", from: "f-desk-app", to: "f-seat", geom: { kind: "ground", path: [v3(D.x, 0, D.z + 40), v3(D.x, 0, D.z + D.d / 2 + 4.5)], surface: "floor" } },
    floorLink("f:far-bench", "f-far-east", "f-bench", [v3(250, 0, 80), v3(Bn.x, 0, Bn.z + Bn.d / 2 + 4.5)]),
    floorLink("f:centre-give", "f-centre", "f-give", [v3(0, 0, 40), HANDOFF_MARKS[0]]),
    floorLink("f:east-take", "f-east", "f-take", [v3(150, 0, 90), HANDOFF_MARKS[1]]),
    floorLink("f:give-take", "f-give", "f-take", [HANDOFF_MARKS[0], v3(31, 0, 112), HANDOFF_MARKS[1]]),
    floorLink("f:centre-sit", "f-centre", "f-sit", [v3(0, 0, 40), v3(-20, 0, 95)]),
    // the ramp up to the lower deck, and across it
    floorLink("f:ramp-up", "f-ramp", "l-top", [v3(W.ramp.x, 0, W.ramp.z1 + 10), v3(W.ramp.x, 0, W.ramp.z1), v3(W.ramp.x, W.y, W.ramp.z0), v3(W.ramp.x, W.y, -6)]),
    floorLink("l:top-edge", "l-top", "l-edge", [v3(W.ramp.x, W.y, -6), v3(W.x1 - 6, W.y, -22)]),
    // the upper deck's own network (round the trunk, never through the notch)
    floorLink("u:climb-ladder", "u-climb-top", "u-ladder-top", [v3(U.notch.x1 + 9, U.y, -60), v3(L.x, U.y, L.topZ - 9)]),
    floorLink("u:ladder-pole", "u-ladder-top", "u-pole", [v3(L.x, U.y, L.topZ - 9), v3(U.x1 - 6, U.y, P.z - 9)]),
    floorLink("u:climb-north", "u-climb-top", "u-north", [v3(U.notch.x1 + 9, U.y, -60), v3(-12, U.y, -84), v3(-10, U.y, -116)]),
    floorLink("u:north-west", "u-north", "u-west", [v3(-10, U.y, -116), v3(-68, U.y, -116)]),
    floorLink("u:west-hang", "u-west", "u-hang", [v3(-68, U.y, -116), v3(U.x0 + 6, U.y, -112)]),
    floorLink("u:west-branch", "u-west", "u-branch", [v3(-68, U.y, -116), v3(A.to.x + 9, U.y, A.to.z)]),
    floorLink("u:north-level", "u-north", "u-level", [v3(-10, U.y, -116), v3(B.from.x - 8, U.y, B.from.z)]),
    floorLink("u:north-sleep", "u-north", "u-sleep", [v3(-10, U.y, -116), v3(30, U.y, -98)]),
    floorLink("u:climb-sit", "u-climb-top", "u-sit", [v3(U.notch.x1 + 9, U.y, -60), v3(0, U.y, -56)]),
    floorLink("u:pole-sleep", "u-pole", "u-sleep", [v3(U.x1 - 6, U.y, P.z - 9), v3(30, U.y, -98)]),
    // branches
    { id: "b:angled", from: "f-branch", to: "u-branch", geom: { kind: "ground", surface: "branch", radius: A.r, path: [v3(A.from.x - 14, 0, A.from.z), A.from, A.to, v3(A.to.x + 9, U.y, A.to.z)] } },
    { id: "b:level", from: "u-level", to: "p-perch", geom: { kind: "ground", surface: "branch", radius: B.r, path: [v3(B.from.x - 8, U.y, B.from.z), B.from, B.to, v3(136, U.y, -100)] } },
    // structures
    { id: "c:trunk", from: "f-trunk", to: "u-climb-top", geom: { kind: "climb", bottom: v3(T.x, 0, T.z), top: v3(T.x, T.h, T.z), radius: T.r, out: v3(0, 0, 1), topLedge: { edge: v3(U.notch.x1, U.y, -60), inward: v3(1, 0, 0) } } },
    { id: "c:ladder", from: "f-ladder", to: "u-ladder-top", geom: { kind: "ladder", bottom: v3(L.x, 0, L.footZ), top: v3(L.x, U.y, L.topZ), out: v3(0, 0, 1), rung: L.rung, width: L.width, topLedge: { edge: v3(L.x, U.y, L.topZ), inward: v3(0, 0, -1) } } },
    { id: "c:pole", from: "u-pole", to: "f-pole", geom: { kind: "pole", top: v3(P.x, P.top, P.z), bottom: v3(P.x, 0, P.z), radius: P.r, ledge: { edge: v3(U.x1, U.y, P.z - 9), inward: v3(-1, 0, 0) } } },
    { id: "j:lower-stump", from: "l-edge", to: "s-top", geom: { kind: "jump", apex: 9 } },
    { id: "j:stump-floor", from: "s-top", to: "f-stump-land", oneWay: true, geom: { kind: "jump", apex: 4 } },
    { id: "h:bar", from: "u-hang", to: "h-grip", geom: { kind: "hang", grip: v3(H.x, H.y, -112), along: v3(0, 0, 1), out: v3(-1, 0, 0) } },
    { id: "h:drop", from: "h-grip", to: "f-hang-drop", geom: { kind: "drop" } },
  ];
  const destinations: Record<string, string> = {
    DESK: "f-seat", BENCH: "f-bench", SLEEP_SPOT: "u-sleep", DECK_SIT: "u-sit", PERCH_DECK: "p-perch", STUMP: "s-top",
    HANG_BAR: "h-grip", HANDOFF_GIVE: "f-give", HANDOFF_TAKE: "f-take", FLOOR_SIT: "f-sit", CENTRE: "f-centre",
    FAR_EAST: "f-far-east", WEST: "f-west", TRUNK_FOOT: "f-trunk", LADDER_FOOT: "f-ladder", LADDER_TOP: "u-ladder-top",
    CLIMB_TOP: "u-climb-top", POLE_TOP: "u-pole", POLE_FOOT: "f-pole", LOWER_EDGE: "l-edge", BRANCH_FOOT: "f-branch",
    BRANCH_TOP: "u-branch", LEVEL_START: "u-level", HANG_LEDGE: "u-hang",
  };
  return { nodes: n, links, destinations };
}

// ============================== SCENARIOS ===================================================================

/** the playground's requests and scenarios are the shared cast runner's (avatar/MonkeyCastRunner) */
export type Cmd = CastCmd;
export type Scenario = CastScenario;

const go = (t: number, a: string, to: string): Cmd => ({ t, a, op: "go", to });
export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  // ONE MOVE PER SCENARIO, for verification captures
  knuckle: { id: "knuckle", note: "long floor run: upright → knuckle → upright", start: { pip: { node: "f-west", yaw: 1.4 } }, length: 16, cmds: [go(0.5, "pip", "FAR_EAST"), go(0, "pip", "WEST")] },
  walk: { id: "walk", note: "short upright walks", start: { nova: { node: "f-centre", yaw: Math.PI } }, length: 14, cmds: [go(0.5, "nova", "FLOOR_SIT"), go(0, "nova", "CENTRE"), go(0, "nova", "HANDOFF_GIVE")] },
  scamper: { id: "scamper", note: "mid-length scamper (Pip)", start: { pip: { node: "f-centre", yaw: 2 } }, length: 10, cmds: [go(0.5, "pip", "LADDER_FOOT"), go(0, "pip", "CENTRE")] },
  climb: { id: "climb", note: "trunk climb up, side mantle onto the notched deck, and back down", start: { pip: { node: "f-trunk", yaw: Math.PI } }, length: 22, cmds: [go(0.5, "pip", "CLIMB_TOP"), go(0, "pip", "TRUNK_FOOT")] },
  ladder: { id: "ladder", note: "ladder up and down", start: { milo: { node: "f-ladder", yaw: Math.PI } }, length: 18, cmds: [go(0.5, "milo", "LADDER_TOP"), go(0, "milo", "LADDER_FOOT")] },
  pole: { id: "pole", note: "fire-pole descent", start: { nova: { node: "u-pole", yaw: Math.PI / 2 } }, length: 7, cmds: [go(0.5, "nova", "POLE_FOOT")] },
  jump: { id: "jump", note: "ramp, jump to the stump, perch, jump down", start: { pip: { node: "l-edge", yaw: Math.PI / 2 } }, length: 9, cmds: [go(0.5, "pip", "STUMP"), go(3.2, "pip", "CENTRE")] },
  branch: { id: "branch", note: "angled branch up, deck, level branch out to the perch", start: { pip: { node: "f-branch", yaw: Math.PI / 2 } }, length: 24, cmds: [go(0.5, "pip", "BRANCH_TOP"), go(0, "pip", "PERCH_DECK")] },
  hang: { id: "hang", note: "hang from the bar, climb back up, hang again, drop", start: { pip: { node: "u-hang", yaw: Math.PI } }, length: 16, cmds: [go(0.5, "pip", "HANG_BAR"), go(4.5, "pip", "HANG_LEDGE"), go(7.5, "pip", "HANG_BAR"), go(11, "pip", "WEST")] },
  rest: { id: "rest", note: "sleep, sit, perch", start: { milo: { node: "u-sleep" }, nova: { node: "u-sit" }, pip: { node: "s-top" } }, length: 8, cmds: [] },
  work: { id: "work", note: "seated typing at the desk, standing review at the bench", start: { milo: { node: "f-desk-app", yaw: Math.PI }, pip: { node: "f-far-east", yaw: Math.PI } }, length: 12, cmds: [go(0.5, "milo", "DESK"), go(0.5, "pip", "BENCH")] },
  handoff: {
    id: "handoff", note: "carry a packet, approach, hand it over, talk", start: { nova: { node: "f-centre", yaw: Math.PI }, milo: { node: "f-east", yaw: -2 } }, length: 14,
    cmds: [{ t: 0, a: "nova", op: "carry", packet: "design" }, go(0.5, "nova", "HANDOFF_GIVE"), go(0.5, "milo", "HANDOFF_TAKE"),
      { t: 4.2, a: "nova", op: "attend", target: "milo" }, { t: 4.2, a: "milo", op: "attend", target: "nova" }, { t: 4.4, a: "nova", op: "say", dur: 2.2 },
      { t: 6.8, op: "handoff", giver: "nova", receiver: "milo", packet: "design" }, { t: 8.9, a: "milo", op: "say", dur: 1.6 }, go(10.8, "milo", "DESK"), { t: 10.8, a: "nova", op: "attend", target: null }],
  },
  // THE TOUR: all three, everything, in one continuous piece
  tour: {
    id: "tour", note: "all three agents, every movement type, two handoffs", length: 92,
    start: { milo: { node: "u-sleep" }, nova: { node: "u-sit" }, pip: { node: "h-grip" } },
    cmds: [
      // wake and come down three different ways
      go(1, "pip", "WEST"), go(2.5, "nova", "POLE_FOOT"), go(3.5, "milo", "LADDER_FOOT"),
      // Nova: to the bench… Pip: up the angled branch… Milo: knuckle-run across
      go(9, "nova", "CENTRE"), go(9, "pip", "BRANCH_TOP"), go(9, "milo", "FAR_EAST"),
      go(18, "pip", "PERCH_DECK"), go(18, "nova", "FLOOR_SIT"),
      { t: 26, a: "nova", op: "carry", packet: "design" }, go(26, "nova", "HANDOFF_GIVE"), go(24, "milo", "HANDOFF_TAKE"),
      { t: 31, a: "nova", op: "attend", target: "milo" }, { t: 31, a: "milo", op: "attend", target: "nova" }, { t: 31.2, a: "nova", op: "say", dur: 2.2 },
      { t: 33.5, op: "handoff", giver: "nova", receiver: "milo", packet: "design" }, go(36, "milo", "DESK"), { t: 36, a: "nova", op: "attend", target: null },
      go(37, "nova", "CENTRE"), go(42, "nova", "TRUNK_FOOT"), go(44, "nova", "CLIMB_TOP"), go(0, "nova", "DECK_SIT"),
      // Pip comes back along the branch, down the pole, across to the handoff spot
      go(30, "pip", "LEVEL_START"), go(0, "pip", "POLE_FOOT"), go(0, "pip", "HANDOFF_TAKE"),
      { t: 50, a: "milo", op: "carry", packet: "design" }, go(50, "milo", "HANDOFF_GIVE"),
      { t: 54, a: "milo", op: "attend", target: "pip" }, { t: 54, a: "pip", op: "attend", target: "milo" }, { t: 54.2, a: "milo", op: "say", dur: 1.8 },
      { t: 56.5, op: "handoff", giver: "milo", receiver: "pip", packet: "design" }, { t: 58.8, a: "pip", op: "say", dur: 1.4 },
      go(60, "pip", "BENCH"), { t: 60, a: "milo", op: "attend", target: null }, go(61, "milo", "LADDER_FOOT"), go(0, "milo", "LADDER_TOP"), go(0, "milo", "SLEEP_SPOT"),
      { t: 60, a: "pip", op: "attend", target: null },
      go(76, "pip", "WEST"), go(0, "pip", "LOWER_EDGE"), go(0, "pip", "STUMP"),
    ],
  },
};

// ============================== THE PLAYGROUND ==============================================================

/** the playground = its geometry + the shared cast runner on its graph. The graph is placed (offsetGraph), never
 *  the group: the agents' poses are in WORLD space, so the IK reaches real world points. */
export class MonkeyPlayground extends MonkeyCastRunner {
  constructor(origin: V3 = v3(0, 0, 0)) {
    super(offsetGraph(buildPlaygroundGraph(), origin), SCENARIOS);
    this.root.name = "monkey-playground-root";
    const geo = buildPlaygroundGeometry();
    geo.position.set(origin.x, origin.y, origin.z);
    this.root.add(geo);
    this.scenario = SCENARIOS.tour;
  }
}
