// vo3d build — AI LAB V2: THE TREEHOUSE LAB. Behind `?ailab=v2` (world/labVariant).
//
//   TREEHOUSE = HOME · LAB FLOOR = WORK · PHYSICAL MOVEMENT = WORKFLOW
//
// ONE AUTHORITY. Every number comes from world/ailabV2 (and world/labStations) — the same constants the
// player's collision and the MonkeyAgent traversal graph are derived from — so a deck edge drawn here is the
// deck edge a monkey mantles onto, and a desk drawn here is the desk the player walks round.
//
// THE PIECES: build/labTree (the hero tree, near + far cuts), build/labTreehouse (decks, routes, residence,
// home), build/labShell (plinth, floors, walls, briefing ring, overlook, pavilions), build/labWork (station
// modules, bay furnishings, result gallery), build/labMaterials (materials, screen atlas, environment response).
//
// COST RULES (V1's, kept): no real lights, no shadows, everything static merged into ONE MESH PER MATERIAL. Every
// display in the Lab is one ScreenBank mesh; every window one glazing mesh. The tree swaps to its far cut by its
// size on screen. The whole Lab draws in a couple of dozen calls.
import * as THREE from "three";
import { ColorBaker, Part, mergePainted, triCount } from "./exteriorGeo";
import { LabMaterials, ScreenBank, type ScreenState } from "./labMaterials";
import { buildLabTree, crownWind } from "./labTree";
import { VegLod, dissolvable, dressCanopy, leafCardMaterial, shrinkToward, LEAF_CELL, type VegLevel } from "./vegetation";
import { windByVertex } from "./exteriorShaders";
import { prng, lin } from "./exteriorGeo";
import { buildTreehouse, WindowBank } from "./labTreehouse";
import { buildLabShell, ContactBank, type LabBakers } from "./labShell";
import { ARTIFACT_LIVE, ARTIFACT_PREVIEW, artifactCell, buildLabWork, galleryLampSpots, slotLampColor, type ArtifactSlotState } from "./labWork";
import { LAB2_FLOOR_Y } from "../world/ailabV2";
import { STATIONS } from "../world/labStations";

export type AiLabV2Build = {
  group: THREE.Group;
  /** t: seconds; with the camera and the viewport height the tree picks its level of detail */
  tick(t: number, camera?: THREE.Camera, viewportH?: number): void;
  stats: { draws: number; triangles: number; materials: number; tree: Record<VegLevel, { tris: number; draws: number }>; shrubCards: number };
  /** the Environment's five calls, for the Lab (app/world forwards them) */
  env: LabMaterials["responder"];
  screens: ScreenBank;
  /** the seam for state-driven content: a station's screens + the result gallery's slots */
  setStationState(id: string, state: ScreenState): void;
  setArtifactSlot(index: number, state: ArtifactSlotState): void;
  /** WHO IS AT WHICH STATION right now (station ids): an occupied station's screens WORK; when its agent leaves
   *  after real work they settle DONE for a while, then return to the station's own state */
  setOccupancy(occupied: ReadonlySet<string>): void;
  /** LIVE ORCHESTRATION (app/labWorkforce): a station's screens follow THIS state while it is set — it outranks
   *  the occupancy rule above, so the screens can never contradict the job. null hands the station back. */
  setStationActivity(id: string, state: ScreenState | null): void;
  /** live mode: every station back to standby, every override cleared, the gallery emptied */
  resetLive(): void;
  /** dev: force the tree's level of detail (null = automatic), and read it */
  forceLod(lod: VegLevel | null): void;
  lod(): VegLevel;
};

const TREE_TOP = 272;
/** merge leaf-card geometries (position/normal/uv/color/wind) */
function mergeCards(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const keys = ["position", "normal", "uv", "color", "wind"] as const, out = new THREE.BufferGeometry();
  for (const k of keys) {
    const size = gs[0].getAttribute(k).itemSize, total = gs.reduce((n, g) => n + g.getAttribute(k).array.length, 0), arr = new Float32Array(total);
    let o = 0; for (const g of gs) { arr.set(g.getAttribute(k).array as Float32Array, o); o += g.getAttribute(k).array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** `live`: the Lab is driven by the orchestration presenter — floor stations start in STANDBY (they wake when a job
 *  reaches them) and the result gallery starts EMPTY (a slot fills when an artifact is docked). Without it, the
 *  approved Phase 3 presentation: founders' stations on, the gallery showing its preview queue. */
export function buildAiLabV2(opts: { live?: boolean } = {}): AiLabV2Build {
  const live = !!opts.live;
  const gallerySlots = live ? ARTIFACT_LIVE : ARTIFACT_PREVIEW;
  const root = new THREE.Group();
  root.name = "ai-lab-v2";
  const lab = new THREE.Group();
  lab.name = "ai-lab-v2-deck";
  lab.position.y = LAB2_FLOOR_Y; // every height in world/ailabV2 is above the Lab floor's top (y 0)
  root.add(lab);
  const M = new LabMaterials();
  const screens = new ScreenBank();
  const B: LabBakers = {
    stone: new ColorBaker(), plaster: new ColorBaker(), timber: new ColorBaker(), dark: new ColorBaker(), metal: new ColorBaker(), roof: new ColorBaker(), fabric: new ColorBaker(),
    pave: new ColorBaker(), warm: new ColorBaker(), soil: new ColorBaker(), lanterns: new ColorBaker(), spill: new ColorBaker(), indicators: new ColorBaker(),
    leaves: [], bark: new Part(), contact: new ContactBank(), prints: new WindowBank(),
  };
  buildLabShell(B, screens);
  buildLabWork(B, screens, gallerySlots);
  const th = buildTreehouse(screens);
  const tree = buildLabTree();

  const meshes: THREE.Mesh[] = [];
  const add = (name: string, geo: THREE.BufferGeometry | null, mat: THREE.Material, parent: THREE.Object3D = lab) => {
    if (!geo || !geo.getAttribute("position")?.count) return null;
    const m = new THREE.Mesh(geo, mat);
    m.name = `ai-lab-v2-${name}`;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    parent.add(m);
    meshes.push(m);
    return m;
  };
  /** one geometry from several bakers of the same material */
  const merge = (...bs: ColorBaker[]) => { const gs = bs.map((b) => b.geometry()).filter((g): g is THREE.BufferGeometry => !!g); return gs.length ? (gs.length === 1 ? gs[0] : mergePainted(gs)) : null; };

  add("stone", merge(B.stone), M.painted("stone", 0.92, {}, 0.42));
  add("plaster", merge(B.plaster, th.plaster), M.painted("plaster", 0.9, {}, 0.6));
  add("timber", merge(B.timber, th.timber), M.painted("timber", 0.78, {}, 0.34));
  add("dark", merge(B.dark, th.dark), M.painted("dark", 0.66, {}, 0.32));
  add("metal", merge(B.metal, th.metal), M.painted("metal", 0.38, { metalness: 0.45 }, 0.2));
  add("roof", merge(B.roof, th.roof), M.painted("roof", 0.55, {}, 0.22));
  add("fabric", merge(B.fabric, th.fabric), M.painted("fabric", 0.95));
  add("pave", merge(B.pave), M.floor("pave", "paving", 0.84, 0.32));
  add("warm", merge(B.warm), M.floor("warm", "paving-warm", 0.82, 0.3));
  add("soil", merge(B.soil), M.floor("soil", "soil", 0.96, 0.55));
  add("lanterns", merge(B.lanterns, th.lanterns), M.practical("lanterns", 1.6, 0xffc98a));
  add("indicators", merge(B.indicators, th.indicators), M.indicator("indicators", 0.95));
  const spill = add("spill", merge(B.spill, th.spill), M.spill("spill", 0.32));
  if (spill) spill.renderOrder = 2;
  // LIVE: the gallery's lamps follow each slot's state (one instanced draw for the frame lamps, one for the counter's)
  const lamps = live ? (() => {
    const spots = galleryLampSpots(), mat = M.indicator("lamps", 0.95);
    const frameG = new THREE.CylinderGeometry(1.1, 1.1, 0.8, 10), dockG = new THREE.BoxGeometry(3, 0.3, 0.6);
    for (const g of [frameG, dockG]) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3));
    const frames = new THREE.InstancedMesh(frameG, mat, spots.frames.length), docks = new THREE.InstancedMesh(dockG, mat, spots.docks.length);
    const m = new THREE.Matrix4();
    spots.frames.forEach((p, i) => frames.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.4, p.z)));
    spots.docks.forEach((p, i) => docks.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.15, p.z)));
    frames.name = "ai-lab-v2-gallery-lamps"; docks.name = "ai-lab-v2-dock-lamps";
    lab.add(frames, docks);
    const c = new THREE.Color();
    const set = (i: number, s: ArtifactSlotState) => {
      frames.setColorAt(i, c.setHex(slotLampColor(s))); frames.instanceColor!.needsUpdate = true;
      if (i < spots.docks.length) { docks.setColorAt(i, c.setHex(slotLampColor(s))); docks.instanceColor!.needsUpdate = true; }
    };
    spots.frames.forEach((_, i) => set(i, "empty"));
    return { set };
  })() : null;
  const contact = add("contact", B.contact.geometry(), M.contact());
  if (contact) contact.renderOrder = 1;
  add("prints", B.prints.geometry(), M.printed());
  add("glazing", th.windows.geometry(), M.glazing());
  // THE LAB'S SHRUBS AND PLANTERS on the same ladder: their masses become a dark heart, dressed in leaf cards
  const shrubRnd = prng(77), shrubTone = { base: lin(0x5f8f43), dark: lin(0x2d4f26), light: lin(0xa7c865) };
  const shrubSrc = [...B.leaves, ...th.leaves];
  const shrubCards = shrubSrc.map((g) => {
    const pos = g.getAttribute("position"), n = Math.max(4, Math.min(16, Math.round(pos.count / 40)));
    return dressCanopy(g, shrubRnd, n, { n: 9, size: [3.2, 5.6], cells: [LEAF_CELL.spray, LEAF_CELL.dense, LEAF_CELL.small], tone: shrubTone, wind: (p) => 0.25 + Math.max(0, p.y) * 0.004, flutter: 0.35, outward: 0.5 }, 3.2);
  });
  add("leaves-small", shrubSrc.length ? mergePainted(shrubSrc.map((g) => shrinkToward(g, 0.86))) : null, M.leaves("crown", 1));
  const cardM = M.adopt("cards-small", leafCardMaterial(M.windGain, M.windTime, 1.4), 0.5);
  add("leaves-small-cards", shrubCards.length ? mergeCards(shrubCards) : null, cardM);
  const screenMesh = screens.mesh(M.screen());
  screenMesh.matrixAutoUpdate = false;
  lab.add(screenMesh);
  meshes.push(screenMesh);

  // ---- THE TREE: near / mid / far cuts on the vegetation ladder, each with its own dissolving materials. The
  //      treehouse's own woody bits (stump, hang twig) ride with every cut. ----
  const own = B.bark.p.length ? B.bark.geometry(false) : null, thBark = th.bark.p.length ? th.bark.geometry(false) : null;
  const withOwn = (g: THREE.BufferGeometry) => mergePainted([g, ...[own, thBark].filter((x): x is THREE.BufferGeometry => !!x).map((x) => x.clone())]);
  const levels = ["near", "mid", "far"] as const;
  const vegGroups = {} as Record<VegLevel, THREE.Group>, fades = {} as Record<VegLevel, { value: number }>;
  const treeStats = {} as Record<VegLevel, { tris: number; draws: number }>;
  for (const lvl of levels) {
    const cut = tree[lvl], fade = { value: 1 }, g = new THREE.Group();
    g.name = `ai-lab-v2-tree-${lvl}`;
    lab.add(g);
    const barkM = M.adopt(`bark-${lvl}`, dissolvable(windByVertex(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95 }), M.windGain, M.windTime, 0.55), fade), 0.5);
    const coreM = M.adopt(`core-${lvl}`, dissolvable(windByVertex(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 }), M.windGain, M.windTime, 0.8), fade), 0.55);
    const meshesBefore = meshes.length;
    add(`tree-bark-${lvl}`, withOwn(cut.bark), barkM, g);
    add(`tree-core-${lvl}`, cut.core, coreM, g);
    if (cut.cards) add(`tree-leaves-${lvl}`, cut.cards, M.adopt(`cards-${lvl}`, dissolvable(leafCardMaterial(M.windGain, M.windTime, 1.6), fade), 0.5), g);
    vegGroups[lvl] = g; fades[lvl] = fade;
    treeStats[lvl] = { tris: 0, draws: meshes.length - meshesBefore };
  }
  const veg = new VegLod(vegGroups, fades, { mid: 240, near: 760 });
  void crownWind;

  // ---- STATE: every station's screens follow its declared state; the gallery shows its preview queue ----
  for (const st of STATIONS) screens.setState(st.id, st.state === "future" ? "offline" : st.state);
  screens.setState("QA_02", "idle");
  gallerySlots.forEach((s, i) => screens.setState(`artifact-${i + 1}`, s === "empty" ? "idle" : "active"));

  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  lab.updateMatrixWorld(true);
  const tris = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) n += triCount(m.geometry); }); return Math.round(n); };
  for (const l of levels) treeStats[l].tris = tris(vegGroups[l]);
  // what is drawn at hero distance: everything but the mid and far tree cuts
  const triangles = tris(lab) - treeStats.mid.tris - treeStats.far.tris;
  const draws = meshes.length - treeStats.mid.draws - treeStats.far.draws;
  veg.update(0, 1, "far");

  let forced: VegLevel | null = null, lastT = 0;
  // ---- STATION ACTIVITY: working while occupied, done for a while after real work, then the station's own state ----
  // live: the floor's stations idle in standby until a job wakes them (the overlook consoles keep their own state)
  const declared = (s: (typeof STATIONS)[number]): ScreenState => (s.state === "future" ? "offline" : live && s.at.y === 0 ? "idle" : s.state);
  const base = new Map(STATIONS.map((s) => [s.id, declared(s)]));
  const activity = new Map<string, ScreenState>();
  const since = new Map<string, number>(), doneUntil = new Map<string, number>();
  let occ: ReadonlySet<string> = new Set();
  let clock = 0;
  const DONE_HOLD = 22, REAL_WORK = 3;
  const settle = (t: number) => {
    for (const st of STATIONS) {
      const id = st.id, b = base.get(id)!;
      if (b === "offline") continue;
      let want: ScreenState = b;
      const forced = activity.get(id);
      if (forced) { since.delete(id); doneUntil.delete(id); want = forced; }
      else if (occ.has(id)) { if (!since.has(id)) since.set(id, t); want = "working"; }
      else {
        const s0 = since.get(id);
        if (s0 !== undefined) { since.delete(id); if (t - s0 >= REAL_WORK) doneUntil.set(id, t + DONE_HOLD); }
        if ((doneUntil.get(id) ?? -1) > t) want = "done";
      }
      if (screens.state(id) !== want) screens.setState(id, want);
    }
  };
  const camPos = new THREE.Vector3(), treePos = new THREE.Vector3();
  return {
    group: root,
    tick(t, camera, viewportH) {
      // (the wind clock comes from the Environment: app/world forwards windTick)
      M.screenTime.value = t;
      clock = t;
      settle(t);
      const dt = Math.min(0.25, Math.max(0, t - lastT)); lastT = t;
      if (!camera) return;
      let px = 0;
      if (viewportH) {
        // the tree's height on screen, in pixels: ortho from the zoomed frustum, perspective from distance
        const o = camera as THREE.OrthographicCamera;
        if (o.isOrthographicCamera) px = (TREE_TOP * viewportH * o.zoom) / (o.top - o.bottom);
        else {
          const p = camera as THREE.PerspectiveCamera;
          camera.getWorldPosition(camPos);
          lab.localToWorld(treePos.set(740, 140, -760));
          px = (TREE_TOP * viewportH) / (2 * Math.max(1, camPos.distanceTo(treePos)) * Math.tan(((p.fov ?? 50) * Math.PI) / 360));
        }
      }
      veg.update(px, dt, forced);
    },
    stats: { draws, triangles, materials: M.count, tree: treeStats, shrubCards: shrubCards.reduce((n, g) => n + g.getAttribute("position").count / 6, 0) },
    env: M.responder,
    screens,
    setStationState: (id, state) => screens.setState(id, state),
    setArtifactSlot: (i, s) => {
      // the slot's content becomes what it now holds (empty / ready / needs input / needs approval)
      screens.setCell(`artifact-${i + 1}`, artifactCell(s === "empty" ? "ready" : s));
      screens.setState(`artifact-${i + 1}`, s === "empty" ? "idle" : "active");
      lamps?.set(i, s);
    },
    setOccupancy: (o) => { occ = o; settle(clock); },
    setStationActivity: (id, s) => { if (s) activity.set(id, s); else activity.delete(id); settle(clock); },
    resetLive: () => {
      activity.clear(); since.clear(); doneUntil.clear(); occ = new Set();
      settle(clock);
      gallerySlots.forEach((s, i) => { screens.setCell(`artifact-${i + 1}`, artifactCell(s === "empty" ? "ready" : s)); screens.setState(`artifact-${i + 1}`, s === "empty" ? "idle" : "active"); lamps?.set(i, s); });
    },
    forceLod: (l) => { forced = l; },
    lod: () => veg.level,
  };
}
