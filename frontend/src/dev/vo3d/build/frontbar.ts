// vo3d build — THE FRONT BAR: geometry shared by the three rooms of the ground floor's street-facing
// architectural bar, Meeting ← Reception → Project.
//
// Everything here is axis-aligned and built in WORLD coordinates. It exists because the same handful of
// architectural moves recur across all three rooms and must land on exactly the same planes, materials and
// proportions or the bar stops reading as one building:
//
//   glassRun / subtract  — the frameless glass run (promoted VERBATIM from build/reception.ts, which now
//                          imports them from here). Reception uses it twice (balustrade + curtain wall);
//                          Meeting and Project use it once each for their share of the street façade.
//   facadeSection        — one room's share of the SHARED south façade: glass + kerb + painted door.
//   coveWall             — the cream plaster wall with a recessed LED cove that closes the north end of
//                          both Meeting and Project.
//   slatPanel            — the vertical wood-batten feature panel (Meeting NW, Meeting kiosk, Project NE).
//   credenzaRun          — the long dark-walnut credenza/console run (Meeting west, Project east).
//   ledgePlanter         — the tall exterior pot standing on the shared front ledge.
//
// The ONE new idea in glassRun is `endPosts`: a run may suppress the mullion at either end so that two
// abutting runs (Meeting|Reception and Reception|Project) share a single post instead of printing two.
import * as THREE from "three";
import { cyl, rbox, shadowed } from "./helpers";
import { contactShadowMat, emissiveMatUnique, facadeGlassMat, glowMat, mat, metal, plastic, wood, type MatKey } from "../render/Materials";
import { animated } from "../render/Ambient";
import { PLINTH, glazingBead, profileRun, skirting } from "./arch";
import { STRUCT } from "../rooms/reception";

export type Span = { x0: number; x1: number };

/** [x0,x1] minus every span in `cuts`, in ascending order, dropping slivers. */
export function subtract(x0: number, x1: number, cuts: Span[]): Span[] {
  let out: Span[] = [{ x0, x1 }];
  for (const c of [...cuts].sort((a, b) => a.x0 - b.x0)) {
    const next: Span[] = [];
    for (const s of out) {
      if (c.x1 <= s.x0 || c.x0 >= s.x1) { next.push(s); continue; }
      if (c.x0 > s.x0) next.push({ x0: s.x0, x1: c.x0 });
      if (c.x1 < s.x1) next.push({ x0: c.x1, x1: s.x1 });
    }
    out = next;
  }
  return out.filter((s) => s.x1 - s.x0 > 0.5);
}

export type GlassRunSpec = {
  /** wall plane: the run is centred on this z and `t` thick */
  z: number;
  x0: number;
  x1: number;
  t: number;
  /** top of the glass */
  h: number;
  /** shoe-rail (sill) height; glass starts here */
  sill: number;
  /** nominal mullion pitch — each panel run divides evenly into whole panels near this */
  panelPitch: number;
  /** solid pilaster centres (world x); they are built proud of the glass plane */
  pilasters?: number[];
  pilasterW?: number;
  /** spans left completely clear (door openings, gate lanes) */
  openings?: Span[];
  topRail?: boolean;
  /** Suppress the mullion post at x0 / x1 (default: both built). Set `false` at a seam where the NEXT
   *  run already carries a post, so Meeting|Reception and Reception|Project read as one continuous
   *  façade instead of showing a doubled post. Only affects the run's own outer ends — interior posts
   *  and posts created by an opening or a pilaster are untouched. */
  endPosts?: { start?: boolean; end?: boolean };
};

/** Frameless glass wall run: shoe rail + glass + mullion posts (+ top rail), with pilasters and openings. */
export function glassRun(spec: GlassRunSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "glass-run";
  const { z, t, h, sill, panelPitch } = spec;
  const pilasterW = spec.pilasterW ?? 12;
  const pilasters = spec.pilasters ?? [];
  const ep = spec.endPosts ?? {};
  const cuts: Span[] = [...(spec.openings ?? []), ...pilasters.map((x) => ({ x0: x - pilasterW / 2, x1: x + pilasterW / 2 }))];
  const glassH = h - sill;
  const railM = plastic("white");

  for (const s of subtract(spec.x0, spec.x1, cuts)) {
    const w = s.x1 - s.x0, cx = (s.x0 + s.x1) / 2;
    // shoe rail (brushed metal shoe on a pale base) and the glass it carries
    g.add(rbox(w, sill, t, railM, cx, 0, z, 0.5));
    // the brushed shoe is WIDER than the sill it carries, so its top face must not land on the sill's top
    // plane: coplanar faces over a run this long z-fight the length of the façade. 0.15 down reads as the
    // sill sitting INTO its shoe (the correct detail) and is invisible at any camera distance.
    g.add(rbox(w, 1.6, t * 1.25, metal(), cx, sill - 1.75, z, 0.3));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, glassH - 0.8), facadeGlassMat());
    pane.position.set(cx, sill + glassH / 2, z);
    g.add(shadowed(pane, false, false));
    // capping rail: seen from the game camera a frameless pane is almost edge-on and disappears, so the cap
    // is what actually draws the line. Deliberately wider than the pane (the source shows the same profile).
    if (spec.topRail) g.add(rbox(w, 2.6, t * 2.6, metal(), cx, h - 2.6, z, 0.8));
    // GLAZING BEADS. The pane above is a single-sided plane with no thickness: square-on it reads as
    // glass, off-axis as a tinted quad floating in an opening. The two long joints are where real glazing
    // has a gasket, and putting a lit metal edge on them is what gives the sheet a set-in depth.
    g.add(glazingBead({ axis: "x", at: z, from: s.x0 + 0.3, to: s.x1 - 0.3, y0: sill + 0.2, y1: sill + glassH - 0.4, t }));
    // mullion posts: the run's two ends plus an even division near panelPitch. End posts are inset by half
    // their width so a run NEVER overhangs its span — Reception must not put geometry over a neighbour's edge.
    const panels = Math.max(1, Math.round(w / panelPitch));
    const postW = Math.min(1.8, w);
    // Under a capping rail the post stops 0.3 short of the run's top: a post that reached h would put its
    // top face on the RAIL's top plane, and the rail is wider, so every post printed a flickering tick on
    // the rail — the most-looked-at line in the room. Buried 0.3 in, the post ends inside solid rail.
    const postH = glassH - (spec.topRail ? 0.3 : 0);
    for (let i = 0; i <= panels; i++) {
      if (i === 0 && ep.start === false && Math.abs(s.x0 - spec.x0) < 1e-6) continue; // the neighbour's run owns this post
      if (i === panels && ep.end === false && Math.abs(s.x1 - spec.x1) < 1e-6) continue;
      const at = Math.min(Math.max(s.x0 + (w * i) / panels, s.x0 + postW / 2), s.x1 - postW / 2);
      g.add(rbox(postW, postH, t * 1.35, railM, at, sill, z, 0.4));
    }
  }
  for (const x of pilasters) g.add(rbox(pilasterW, h, t * 1.9, railM, x, 0, z, STRUCT.capRadius));
  return g;
}

// ---- the shared south façade ------------------------------------------------------------------------

export type FacadeSectionSpec = {
  /** the run's own span along the bar; clamp these to the room's real neighbours, never to its art box */
  x0: number;
  x1: number;
  /** the SHARED façade plane (FACADE_Z) — the wall body is centred on facadeZ + t/2 */
  facadeZ: number;
  t: number;
  h: number;
  panelPitch: number;
  pilasterW: number;
  /** the painted door span, if this section has one. STATIC glass only — no DoorCapability, no grid cells. */
  door?: Span;
  endPosts?: { start?: boolean; end?: boolean };
  name?: string;
};

/** One room's share of the continuous street façade: the glass run on the SHARED plane, the exterior kerb
 *  along its base (cut at the doorway so the threshold stays flush), and — where the artwork paints one —
 *  a fixed bi-parting glass door standing in the opening.
 *
 *  The Meeting and Project doors are painted in the production artwork but have NO '+' cells in the V1
 *  walkability grid, so they are reconstructed as ART ONLY: sealed leaves, no capability, no nav change. */
export function facadeSection(spec: FacadeSectionSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "facade-section";
  const { x0, x1, facadeZ, t, h } = spec;
  const openings = spec.door ? [spec.door] : [];
  const pilasters = spec.door ? [spec.door.x0 - spec.pilasterW / 2, spec.door.x1 + spec.pilasterW / 2] : [];
  g.add(
    glassRun({
      z: facadeZ + t / 2, x0, x1, t, h,
      sill: 2.6,
      panelPitch: spec.panelPitch,
      topRail: true,
      pilasters,
      pilasterW: spec.pilasterW,
      openings,
      endPosts: spec.endPosts,
    }),
  );
  // exterior kerb along the façade base (the art's grey plinth), CUT at any doorway. The front ledge
  // beyond it is ground-floor architecture, built once for the whole bar in build/floorplan.ts.
  for (const k of subtract(x0, x1, openings)) {
    const kerb = rbox(k.x1 - k.x0, 2.2, 5, mat("plinth", 1), (k.x0 + k.x1) / 2, -0.6, facadeZ + t + 2.5, 0.4);
    kerb.castShadow = false;
    g.add(kerb);
  }
  if (spec.door) g.add(staticGlassDoors(spec.door, facadeZ + t / 2, h));
  return g;
}

/** A SEALED bi-parting glass door pair standing in the façade plane: two frameless leaves in slim metal
 *  rails, each with a tubular pull on its leading stile, plus the threshold and head tracks. Geometry
 *  only — this never moves and carries no capability (see facadeSection). */
export function staticGlassDoors(door: Span, z: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "static-glass-doors";
  const leafW = (door.x1 - door.x0) / 2;
  g.add(rbox(door.x1 - door.x0, 0.9, 3.4, metal(), (door.x0 + door.x1) / 2, 0, z, 0.25)); // threshold track
  g.add(rbox(door.x1 - door.x0, 1.5, 2.4, metal(), (door.x0 + door.x1) / 2, h - 1.5, z, 0.3)); // head track
  for (const side of [-1, 1] as const) {
    const cx = side < 0 ? door.x0 + leafW / 2 : door.x1 - leafW / 2;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(leafW - 1.6, h - 6.4), facadeGlassMat());
    pane.position.set(cx, 3.6 + (h - 6.4) / 2, z);
    g.add(shadowed(pane, false, false));
    g.add(rbox(leafW - 1.6, 1.6, 1.8, metal(), cx, 1.9, z, 0.35)); // bottom rail
    g.add(rbox(leafW - 1.6, 1.6, 1.8, metal(), cx, h - 4.4, z, 0.35)); // top rail
    // leading stile + pull handle, both on the meeting stile at the centre of the opening
    const lead = side < 0 ? cx + (leafW / 2 - 1.4) : cx - (leafW / 2 - 1.4);
    g.add(rbox(1.2, h - 7, 1.4, metal(), lead, 3.6, z, 0.3));
    g.add(cyl(0.9, 20, metal(), side < 0 ? lead - 4.1 : lead + 4.1, h * 0.3, z - 1.6));
  }
  return g;
}

// ---- the cove wall --------------------------------------------------------------------------------

export type CoveWallSpec = {
  /** the wall's solid footprint in world space (a MASS, not a shell: the art's north wall is deep) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  /** where the LED cove sits, measured down from the top */
  coveDrop?: number;
  /** ambient phase, so two cove walls never breathe in lockstep */
  phase?: number;
  name?: string;
};

/** The cream plaster mass that closes the north end of Meeting and Project, with the recessed LED cove the
 *  artwork paints along the top of its room-facing (south) face: a stepped-back upper band, the lip that
 *  hides the fixture, the warm line itself and one soft downward wash. Restrained on purpose — the cove is
 *  a highlight in the source, not a light source. */
export function coveWall(spec: CoveWallSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "cove-wall";
  const { x0, x1, z0, z1, h } = spec;
  const w = x1 - x0, cx = (x0 + x1) / 2, d = z1 - z0;
  const coveY = h - (spec.coveDrop ?? 8);
  g.add(rbox(w, h, d, mat("plaster", 0.96), cx, 0, (z0 + z1) / 2, STRUCT.capRadius));
  // the upper band steps BACK behind the cove lip (0.2 recessed: a coplanar face over a run this long
  // would z-fight the whole wall)
  g.add(rbox(w - 1.2, h - coveY - 2.2, 2.4, mat("wallFace", 1), cx, coveY + 2.2, z1 - 1.4, 0.3));
  // the lip that hides the fixture, standing proud of the wall face
  g.add(rbox(w, 2.2, 2.2, mat("plaster", 0.96), cx, coveY, z1 - 0.4, 0.5));
  // THE FIXTURE, then the light. A cove LED used to be a bare emissive bar hanging under the lip, which
  // is the "glowing shape" failure mode build/led.ts already names: an architectural light is a PHYSICAL
  // CHANNEL first. This is the extrusion the tape sits in — a slim dark aluminium profile with a return
  // under its mouth — and the emitter is inset into it, so from the game camera the eye reads a lit
  // channel rather than a bright rectangle stuck to plaster.
  g.add(rbox(w - 3, 1.5, 1.4, mat("charcoal", 0.55), cx, coveY - 1.5, z1 + 0.35, 0.25));
  g.add(rbox(w - 3, 0.35, 0.5, mat("charcoal", 0.6), cx, coveY - 1.9, z1 + 0.95, 0.12)); // the mouth's return
  // the LED itself: one warm line tucked INSIDE the channel, breathing very slowly and very shallowly
  const led = rbox(w - 5, 0.55, 0.6, emissiveMatUnique("coveWarm", 1.05, 0.3), cx, coveY - 0.9, z1 + 0.55, 0.2);
  g.add(animated(led, { kind: "pulse", period: 11.5, phase: spec.phase ?? 0, min: 0.98, max: 1.14 }));
  // the wash it throws down the wall face (additive plane, no light, no cost)
  const wash = rbox(w - 7, 15, 0.1, glowMat("coveWarm", 0.04), cx, coveY - 16, z1 + 0.3, 0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  g.add(skirting({ axis: "x", from: x0, to: x1, at: z1, y0: 0, dir: 1, key: "white", roughness: 0.6 }));
  return g;
}

// ---- the wood-slat feature panel -------------------------------------------------------------------

export type SlatPanelSpec = {
  /** the axis the panel RUNS along */
  axis: "x" | "z";
  /** the wall-face coordinate it is mounted on (z for an x-run, x for a z-run) */
  at: number;
  /** +1 = the panel faces increasing `at`, -1 = decreasing */
  dir: 1 | -1;
  from: number;
  to: number;
  y0: number;
  y1: number;
  /** batten pitch (the source measures ~7 units) */
  pitch?: number;
  name?: string;
};

/** Vertical wood-batten feature panel: a dark backing board with square battens standing proud of it at an
 *  even pitch. The artwork uses the same panel three times across the bar (Meeting NW corner, the Meeting
 *  kiosk's plant wall, Project NE corner), so it is one helper with a run + a facing. */
export function slatPanel(spec: SlatPanelSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "slat-panel";
  const { axis, at, dir, from, to, y0, y1 } = spec;
  const pitch = spec.pitch ?? 7;
  const len = to - from, h = y1 - y0, mid = (from + to) / 2;
  const put = (along: number, off: number, aw: number, ah: number, ad: number, m: THREE.Material, r: number) =>
    axis === "x" ? rbox(aw, ah, ad, m, along, y0, at + dir * off, r) : rbox(ad, ah, aw, m, at + dir * off, y0, along, r);
  g.add(put(mid, 0.9, len, h, 1.8, mat("walnutDark", 0.9), 0.2)); // backing board
  const n = Math.max(2, Math.round(len / pitch));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const c = from + step * (i + 0.5);
    g.add(put(c, 2.6, step * 0.55, h - 1.2, 2.2, wood("box"), 0.25));
  }
  return g;
}

// ---- the credenza / console run --------------------------------------------------------------------

export type CredenzaRunSpec = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  modules: number;
  /** the face the drawer fronts present to */
  facing: "north" | "south" | "east" | "west";
  /** module reveals run across the long axis; "x" for a run along x, "z" for a run along z */
  along: "x" | "z";
  /** carcass colour. Default = the front bar's dark stained oak; the Gaming Room passes its own THEME so
   *  its media wall is not a warm brown mass in a cool room. */
  body?: MatKey;
  /** OMIT THE RUN'S OWN WORKTOP. Set this when the caller lays its own slab over the run — a white
   *  worktop on a light-oak carcass, an oak top on blue joinery. Without it BOTH tops end at exactly `h`,
   *  which puts two full-footprint horizontal faces on one depth plane: they z-fight, and the run shimmers
   *  and crawls as the camera moves. Five rooms were doing this (QA's storage and supply runs, AI's
   *  counter, Dev's pantry, CMS's print run) and it is why "the QA cabinets flicker". */
  top?: boolean;
  /** toe kick / reveal colour, one step darker than `body` */
  reveal?: MatKey;
  name?: string;
};

/** Long dark-walnut credenza / console run: a recessed toe kick, the body, a slightly proud top slab and
 *  thin dark reveals between the modules on the face that is actually seen. Meeting's west wall unit and
 *  Project's east coffee console are the same object at different lengths. */
export function credenzaRun(spec: CredenzaRunSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "credenza-run";
  const { x, z, w, d, h, modules, along } = spec;
  const body = spec.body ?? "walnut", reveal = spec.reveal ?? "walnutDark";
  const cx = x + w / 2, cz = z + d / 2;
  g.add(rbox(w - 4, 3.2, d - 4, mat(reveal, 0.9), cx, 0, cz, 0.3)); // recessed toe kick
  g.add(rbox(w, h - 4.4, d, mat(body, 0.78), cx, 3.2, cz, 0.5));
  // THE PLINTH SHADOW LINE. A carcass standing on a recessed kick still met the floor in one flat step;
  // the profiled reveal in build/arch.ts puts the dark line where joinery actually has one, which is what
  // makes a run read as built-in rather than as a box set down on the tile. One mesh for the whole run.
  {
    const along = spec.along, faceDir: 1 | -1 = spec.facing === "east" || spec.facing === "south" ? 1 : -1;
    const kickAt = spec.facing === "east" ? x + w : spec.facing === "west" ? x : spec.facing === "south" ? z + d : z;
    g.add(profileRun(PLINTH, {
      axis: along, at: kickAt, from: along === "x" ? x : z, to: along === "x" ? x + w : z + d,
      y0: 0, dir: faceDir, material: mat(reveal, 0.85), name: `${g.name}-plinth`,
    }));
  }
  // the TOP is the face the game camera actually sees, so it carries the run's colour: the same dark
  // stained oak as the body, finished a little glossier so it reads as a worktop rather than a carcass.
  // A caller laying its own worktop passes `top: false` — see the field's note for why that matters.
  if (spec.top !== false) g.add(rbox(w + 1.2, 1.2, d + 1.2, mat(body, 0.55), cx, h - 1.2, cz, 0.35));
  // module reveals: thin dark grooves standing 0.1 proud of the face so they never z-fight it
  const len = along === "x" ? w : d, from = along === "x" ? x : z;
  const face = spec.facing === "east" ? x + w + 0.1 : spec.facing === "west" ? x - 0.1 : spec.facing === "south" ? z + d + 0.1 : z - 0.1;
  for (let i = 1; i < modules; i++) {
    const c = from + (len * i) / modules;
    const groove = along === "x"
      ? rbox(0.7, h - 6.4, 0.5, mat(reveal, 0.9), c, 4.2, face, 0.15)
      : rbox(0.5, h - 6.4, 0.7, mat(reveal, 0.9), face, 4.2, c, 0.15);
    g.add(groove);
  }
  // THE DOOR/DRAWER SPLIT. A module used to be one blank panel between two grooves, which is a carcass
  // with nothing built into it. Real joinery of this length is a drawer bank over a door: one horizontal
  // rail groove across the whole run says so in a single mesh, and each module's face is then read as two
  // components rather than one slab. Standing 0.1 proud of the face, like the vertical reveals.
  const railY = 3.2 + (h - 4.4) * 0.34;
  g.add(along === "x"
    ? rbox(w - 1.4, 0.7, 0.5, mat(reveal, 0.9), cx, railY, face, 0.15)
    : rbox(0.5, 0.7, d - 1.4, mat(reveal, 0.9), face, railY, cz, 0.15));
  // two pulls per module — one on the drawer, one on the door below it — so the hardware states the split
  for (let i = 0; i < modules; i++) {
    const c = from + (len * (i + 0.5)) / modules;
    const pullW = Math.min(14, (len / modules) * 0.5);
    for (const y of [railY + (h - railY) * 0.42, railY - 2.4]) {
      g.add(along === "x"
        ? rbox(pullW, 0.7, 0.8, metal(), c, y, face, 0.2)
        : rbox(0.8, 0.7, pullW, metal(), face, y, c, 0.2));
    }
  }
  return g;
}

// ---- exterior ledge planter -------------------------------------------------------------------------

/** The tall dark pot that stands on the shared front ledge, south of the façade. The palm itself is an
 *  entity (so it sways); this is the static pot, built exactly like Reception's flanking planters. */
export function ledgePlanter(x: number, z: number, r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(r, h - 0.2, mat("potDark", 0.55, { metalness: 0.08 }), x, 0, z, r * 0.94));
  g.add(cyl(r + 0.6, 1.4, mat("charcoal", 0.5, { metalness: 0.2 }), x, h - 1.4, z));
  g.add(cyl(r - 1.4, 1.0, mat("potDark", 1), x, h - 0.6, z));
  const shadow = cyl(r + 4, 0.02, contactShadowMat(0.13, "round"), x, 0.04, z);
  shadow.castShadow = shadow.receiveShadow = false;
  g.add(shadow);
  return g;
}

// ---- the interior glazed partition ------------------------------------------------------------------

export type ZSpan = { z0: number; z1: number };

export type GlazedPartitionSpec = {
  /** THE PARTITION PLANE, as a centre line in x. Nothing this builder makes is wider than `t`, so the
   *  whole assembly lives inside [x − t/2, x + t/2] — which is what lets a room stand one exactly on its
   *  own boundary without a single unit of geometry crossing into its neighbour. */
  x: number;
  t: number;
  /** the run, along z */
  z0: number;
  z1: number;
  /** head height (STRUCT.wallHeight for the front bar) */
  h: number;
  /** the solid shoe under the glass: enough to read as architecture, low enough to see straight over */
  spandrel: number;
  /** nominal mullion pitch; each screen divides evenly into whole bays near it */
  panelPitch: number;
  /** the entrance opening. The run is broken here, the reveal is jambed and headed, and NOTHING is built
   *  inside it — the sliding leaves are entities carrying the room's DoorCapability. */
  doorway?: ZSpan;
  /** Suppress the mullion at z0 / z1 (both built by default). `glassRun`'s idea, for the same reason:
   *  where this partition dies into the street façade the two glass walls meet at a CORNER, and a corner
   *  has one post, not two — the façade's own run already carries it. */
  endPosts?: { start?: boolean; end?: boolean };
  name?: string;
};

/** A FRAMELESS GLASS PARTITION running north–south: solid shoe, brushed sill cap, a pane in slim mullions,
 *  a capping rail, and — where the room puts its entrance — a cased opening with a head over it.
 *
 *  This is `glassRun`'s idea turned through ninety degrees. It is a separate builder rather than an axis
 *  parameter for the reason build/cms.ts already states at its own west screen: glassRun's proportions
 *  (×1.25 shoe, ×1.35 mullion, ×2.6 cap) are authored against a ~3-unit façade pane standing in a 6-unit
 *  wall, and an interior partition between two rooms of one open floor has neither that depth to spend nor
 *  a neighbour's edge to spare. Every member here is clamped to `t` instead.
 */
export function glazedPartition(spec: GlazedPartitionSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "glazed-partition";
  const { x, t, h, spandrel } = spec;
  const fr = plastic("white");
  const glassH = h - spandrel;
  const runs: ZSpan[] = (spec.doorway
    ? [{ z0: spec.z0, z1: spec.doorway.z0 }, { z0: spec.doorway.z1, z1: spec.z1 }]
    : [{ z0: spec.z0, z1: spec.z1 }]
  ).filter((r) => r.z1 - r.z0 > 0.5);

  for (const r of runs) {
    const len = r.z1 - r.z0, cz = (r.z0 + r.z1) / 2;
    g.add(rbox(t, spandrel, len, mat("plaster", 0.96), x, 0, cz, 0.5)); //            solid shoe
    g.add(rbox(t, 1.4, len, metal(), x, spandrel - 1.55, cz, 0.3)); //                brushed sill cap
    // the pane itself: a real slab rather than a plane, because this wall is seen EDGE-ON from the game
    // camera far more often than square-on, and a zero-thickness quad vanishes at that angle
    const pane = rbox(t * 0.34, glassH - 1.0, len - 2, facadeGlassMat(), x, spandrel + 0.5, cz, 0.1);
    g.add(shadowed(pane, false, false));
    // the two long joints, so the sheet reads as glass SET INTO a frame rather than a tinted quad
    g.add(glazingBead({ axis: "z", at: x, from: r.z0 + 0.4, to: r.z1 - 0.4, y0: spandrel + 0.4, y1: spandrel + glassH - 0.6, t: t / 1.45 }));
    // mullions: both ends plus an even division near panelPitch
    const bays = Math.max(1, Math.round(len / spec.panelPitch));
    const MULL = Math.min(1.9, len);
    const ep = spec.endPosts ?? {};
    for (let i = 0; i <= bays; i++) {
      if (i === 0 && ep.start === false && r.z0 === spec.z0) continue; // the neighbouring run owns this post
      if (i === bays && ep.end === false && r.z1 === spec.z1) continue;
      const at = Math.min(Math.max(r.z0 + (len * i) / bays, r.z0 + MULL / 2), r.z1 - MULL / 2);
      g.add(rbox(t * 0.85, glassH - 0.3, MULL, fr, x, spandrel, at, 0.4));
    }
    g.add(rbox(t, 2.2, len, metal(), x, h - 2.2, cz, 0.6)); //                        capping rail
  }

  if (spec.doorway) {
    const d = spec.doorway;
    const HEAD_Y = 36; // the same reveal height CMS's and QA's entrances use
    // the opening's two jambs — slim posts IN the partition plane; a jamb is a reveal, not a buttress
    for (const z of [d.z0 - 2.5, d.z1 + 2.5]) g.add(rbox(t, h, 5, fr, x, 0, z, 0.4));
    // the head, so the doorway reads as an opening rather than a gap where the glass stopped
    g.add(rbox(t, h - HEAD_Y, d.z1 - d.z0, mat("plaster", 0.96), x, HEAD_Y, (d.z0 + d.z1) / 2, 0.4));
    g.add(rbox(t, 1.2, d.z1 - d.z0, metal(), x, HEAD_Y - 1.2, (d.z0 + d.z1) / 2, 0.3)); // head track
    // and the flush threshold the leaves ride, laid at 0.3 exactly as every other door on this floor
    const sill = rbox(t, 0.3, d.z1 - d.z0, metal(), x, 0, (d.z0 + d.z1) / 2, 0.1);
    sill.castShadow = false;
    g.add(sill);
  }
  return g;
}
