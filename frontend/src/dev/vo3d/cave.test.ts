// THE CHAMPIONSHIP CAVE + the monument that opens onto it.
//
// Two things are being defended here, and they are not the same thing:
//
//   1. THE OFFICE IS UNTOUCHED. The CAVE registers a room, a region and a grown world bound. Every one
//      of those is a chance to move a cell of the eleven finished rooms by accident, so the office's own
//      answers are compared BEFORE and AFTER the CAVE exists, over the whole V1 grid, and must be equal.
//      Likewise the monument grew 46 units of podium — vertically — and its FOOTPRINT must be identical.
//
//   2. THE CAVE'S OWN CONTRACT. The 270° mapping is the feature: the video has to land on the front
//      panel at true 16:9 or faces stretch, and the wings have to continue it rather than restart it.
//      That is arithmetic, and arithmetic is testable without a GPU.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { registerGroundFloor } from "./rooms/ground-floor";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import {
  CENTRAL_HUB, centralHubEntities, CHAMPIONSHIP_ENTRANCE_ID, MONUMENT, MONUMENT_FOOTPRINT,
  MONUMENT_INTERACTION_ID, OPEN_BANDS as HUB_BANDS, championshipEntranceApproach, monumentApproach,
} from "./rooms/central-hub";
import {
  CAVE_ID, CAVE_ROOM, EXIT_INTERACTION_ID, FLOOR_RECT as CAVE_FLOOR_RECT, FRONT_CHORD, ORIGIN,
  OUTER_RECT as CAVE_OUTER_RECT, ROOM, SCREEN, SCREEN_INTERACTION_ID, SPAWN, THRESHOLD, VESTIBULE_RECT, VIDEO_WIDTH,
  caveEntities, caveStandTest, exitApproach, inCave, screenApproach, screenPath, toWorld,
} from "./rooms/cave";
import { CAVE_METRICS, attachCaveVideo, buildCave, foldVertices, samplePath, screenTexU, screenU } from "./build/cave";
import { CaveMedia } from "./media/CaveMedia";
import { CAVE_VIDEO_URL } from "./media/CaveMedia";
import { CELL, COLS, ROWS, cellCentre } from "./adapters/v1Grid";
import { FRAME } from "./adapters/v1Floor";
import { NAV_RADIUS } from "./nav/clearance";
import { REACH, collectCandidates } from "./player/PlayerTargeting";
import { BON_STANDING_HEIGHT } from "./adapters/v1Avatar";
import { pointInRect } from "./core/coords";

/** the world exactly as bootstrap assembles it, with the CAVE step optional */
function rig(withCave: boolean) {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  const plan = registerGroundFloor(world);
  if (withCave) {
    world.addRoom(CAVE_ROOM);
    for (const e of caveEntities()) world.addEntity(e);
    world.addRegion({ id: `floor:${CAVE_ID}`, kind: "room-floor", rect: CAVE_FLOOR_RECT, walkable: true, roomId: CAVE_ID });
    world.addRegion({ id: `threshold:${CAVE_ID}`, kind: "room-floor", rect: VESTIBULE_RECT, walkable: true, roomId: CAVE_ID });
    world.bounds = {
      x: Math.min(plan.frame.x, CAVE_OUTER_RECT.x), z: Math.min(plan.frame.z, CAVE_OUTER_RECT.z),
      w: Math.max(plan.frame.x + plan.frame.w, CAVE_OUTER_RECT.x + CAVE_OUTER_RECT.w) - Math.min(plan.frame.x, CAVE_OUTER_RECT.x),
      d: Math.max(plan.frame.z + plan.frame.d, CAVE_OUTER_RECT.z + CAVE_OUTER_RECT.d) - Math.min(plan.frame.z, CAVE_OUTER_RECT.z),
    };
  }
  return world;
}

describe("the CAVE cannot touch the office", () => {
  it("stands entirely outside the V1 frame, so no grid cell can ever fall inside it", () => {
    const frameEast = FRAME.x + FRAME.w;
    expect(CAVE_OUTER_RECT.x).toBeGreaterThan(frameEast);
    // and the gap is not a rounding accident — it is over a thousand units of clear ground
    expect(CAVE_OUTER_RECT.x - frameEast).toBeGreaterThan(1000);
    for (let cy = 0; cy < ROWS; cy++)
      for (let cx = 0; cx < COLS; cx++)
        expect(inCave(cellCentre({ cx, cy }))).toBe(false);
  });

  it("registering it changes NO office walkability answer, on any cell of the grid", () => {
    const before = rig(false);
    const after = rig(true);
    let checked = 0;
    for (let cy = 0; cy < ROWS; cy++)
      for (let cx = 0; cx < COLS; cx++) {
        const p = cellCentre({ cx, cy });
        expect(after.walkableAt(p)).toBe(before.walkableAt(p));
        expect(after.regionAt(p)?.id ?? null).toBe(before.regionAt(p)?.id ?? null);
        checked++;
      }
    expect(checked).toBe(COLS * ROWS);
  });

  it("its own floor is walkable and belongs to the CAVE, not to any office region", () => {
    const world = rig(true);
    const r = world.regionAt(SPAWN);
    expect(r?.id).toBe(`floor:${CAVE_ID}`);
    expect(r?.roomId).toBe(CAVE_ID);
    expect(world.walkableAt(SPAWN)).toBe(true);
    // a point just outside the shell belongs to nothing at all, exactly as the ground outside the
    // office frame always has
    expect(world.regionAt({ x: CAVE_OUTER_RECT.x - 40, z: SPAWN.z })).toBeNull();
  });
});

describe("the monument grew UP, not OUT", () => {
  it("keeps its declared footprint byte-for-byte, because the podium is never wider than the base", () => {
    expect(MONUMENT.podium.footW).toBe(MONUMENT.base);
    expect(MONUMENT.podium.capW).toBe(MONUMENT.base);
    expect(MONUMENT.podium.bodyW).toBeLessThan(MONUMENT.base);
    expect(MONUMENT_FOOTPRINT).toEqual({
      x: MONUMENT.centre.x - 36.5, z: MONUMENT.centre.z - 36.5, w: 73, d: 73,
    });
  });

  it("stacks its deck out of its own courses, with nothing left over", () => {
    const P = MONUMENT.podium;
    expect(MONUMENT.podiumH).toBe(P.footH + P.bodyH + P.capH);
    expect(MONUMENT.deckY).toBeCloseTo(MONUMENT.discY + MONUMENT.podiumH + MONUMENT.baseH + MONUMENT.stepH + MONUMENT.canvasH, 6);
  });

  it("is now taller than the office it stands in — which is the whole point of the pass", () => {
    const top = MONUMENT.deckY + MONUMENT.statueHeight;
    expect(top).toBeGreaterThan(110);
    expect(top / BON_STANDING_HEIGHT).toBeGreaterThan(3); // the bosses read as architecture, not as figures
    expect(top / 46).toBeGreaterThan(2.4); // 46 = the office wall height (rooms/design-room SHELL)
  });

  it("cuts a portal a standing body actually fits through, inside the shaft that carries it", () => {
    const Q = MONUMENT.portal, P = MONUMENT.podium;
    expect(Q.h).toBeGreaterThanOrEqual(BON_STANDING_HEIGHT); // no ducking into the hero
    expect(Q.h).toBeLessThan(P.bodyH); // …and there is still a header over it
    expect(Q.w).toBeLessThan(P.bodyW - 8); // a pier each side, not a slot across the whole face
    expect(Q.depth).toBeLessThan(P.bodyW / 2); // a recess, not a tunnel through the monument
  });
});

describe("the two hub interactions the monument now carries", () => {
  it("puts the portal on the NORTH face and the plaque on the south, far enough apart never to compete", () => {
    centralHubEntities(); // resolves the room's approach context
    const portal = championshipEntranceApproach();
    const plaque = monumentApproach();
    expect(portal.point.z).toBeLessThan(MONUMENT.centre.z); // north of the ring
    expect(plaque.point.z).toBeGreaterThan(MONUMENT.centre.z); // south of it
    const apart = Math.hypot(portal.point.x - plaque.point.x, portal.point.z - plaque.point.z);
    expect(apart).toBeGreaterThan(REACH); // PlayerTargeting can never offer both at once
    expect(portal.action).toBe("Enter Championship");
  });

  it("stands on floor that was already walkable — the portal opens no cell and moves no band", () => {
    const world = rig(true);
    const p = world.get(CHAMPIONSHIP_ENTRANCE_ID).capabilities.approach!.point;
    expect(world.walkableAt(p)).toBe(true);
    expect(pointInRect(p, MONUMENT_FOOTPRINT)).toBe(false);
    // it is inside the hub's own north gap band, which 6A declared and this pass did not touch
    const north = HUB_BANDS.find((b) => b.id === "hub-gap-north")!;
    expect(pointInRect(p, north.rect) || pointInRect(p, HUB_BANDS.find((b) => b.id === "hub-apron")!.rect)).toBe(true);
  });

  it("registers both of the CAVE's interactables in the CAVE's own room bucket", () => {
    const world = rig(true);
    const byRoom = collectCandidates(world);
    const ids = (byRoom.get(CAVE_ID) ?? []).map((c) => c.id).sort();
    expect(ids).toEqual([EXIT_INTERACTION_ID, SCREEN_INTERACTION_ID].sort());
    expect(byRoom.get(CENTRAL_HUB.id)!.map((c) => c.id)).toContain(CHAMPIONSHIP_ENTRANCE_ID);
    expect(byRoom.get(CENTRAL_HUB.id)!.map((c) => c.id)).toContain(MONUMENT_INTERACTION_ID);
  });
});

describe("270° mapping — the video is not stretched", () => {
  it("sizes the front panel to the source's own aspect, exactly", () => {
    expect(VIDEO_WIDTH).toBeCloseTo(SCREEN.height * (16 / 9), 6);
    expect(VIDEO_WIDTH).toBeCloseTo(FRONT_CHORD, 6); // the picture lands on the flat panel, 1:1
  });

  it("runs one continuous ruler round all five segments, wings included", () => {
    const samples = samplePath();
    const total = samples[samples.length - 1].s;
    // arc length is monotonic and finite everywhere
    for (let i = 1; i < samples.length; i++) expect(samples[i].s).toBeGreaterThanOrEqual(samples[i - 1].s);
    // straights + two quadrants, computed independently of the sampler
    const wing = SCREEN.wingZ - SCREEN.inset - SCREEN.cornerR;
    const expected = 2 * wing + 2 * (Math.PI / 2) * SCREEN.cornerR + FRONT_CHORD;
    expect(total).toBeCloseTo(expected, 3);
    expect(CAVE_METRICS.wrapLength()).toBeCloseTo(total, 6);
    // it really is 270° of turning: two quadrants plus two straight wings
    expect(total).toBeGreaterThan(2.5 * FRONT_CHORD);
  });

  it("places u 0…1 across the front panel and mirrors beyond it, symmetrically", () => {
    const samples = samplePath();
    const total = samples[samples.length - 1].s;
    const s0 = (total - VIDEO_WIDTH) / 2;
    expect(screenU(s0, total)).toBeCloseTo(0, 6);
    expect(screenU(s0 + VIDEO_WIDTH, total)).toBeCloseTo(1, 6);
    expect(screenU(total / 2, total)).toBeCloseTo(0.5, 6); // the middle of the wrap is the middle of the frame
    // the wings run off both ends by the same amount, so the mirrored continuation is symmetric
    expect(screenU(0, total)).toBeCloseTo(1 - screenU(total, total), 6);
    expect(screenU(0, total)).toBeLessThan(0);
    expect(screenU(total, total)).toBeGreaterThan(1);
  });

  it("folds the picture on LIVE pixels, never on the source's dark outermost columns", () => {
    const c = SCREEN.edgeCrop;
    expect(c).toBeGreaterThan(0);
    expect(screenTexU(0)).toBeCloseTo(c, 9); // the fold at the west corner
    expect(screenTexU(1)).toBeCloseTo(1 - c, 9); // and at the east corner
    expect(screenTexU(0.5)).toBeCloseTo(0.5, 9); // the middle of the frame is still the middle
    // SWEEP THE WHOLE WRAP: no uv the ribbon can emit may reach the frame's edge, at either end.
    const samples = foldVertices(samplePath());
    const total = samples[samples.length - 1].s;
    for (const p of samples) {
      const t = screenTexU(screenU(p.s, total));
      expect(t).toBeGreaterThanOrEqual(c - 1e-9);
      expect(t).toBeLessThanOrEqual(1 - c + 1e-9);
    }
    // and the fold is a genuine reflection: equal distances either side of it sample the same column
    for (const d of [0.05, 0.2, 0.4]) {
      expect(screenTexU(-d)).toBeCloseTo(screenTexU(d), 9);
      expect(screenTexU(1 - d)).toBeCloseTo(screenTexU(1 + d), 9);
    }
  });

  it("puts a real vertex ON every fold, so no quad interpolates straight through one", () => {
    const raw = samplePath();
    const folded = foldVertices(raw);
    expect(folded.length).toBeGreaterThan(raw.length); // the wings' folds were genuinely missing
    const total = folded[folded.length - 1].s;
    let folds = 0;
    for (let i = 0; i < folded.length - 1; i++) {
      const ua = screenU(folded[i].s, total), ub = screenU(folded[i + 1].s, total);
      if (ub <= ua) continue;
      // no integer STRICTLY inside the interval: every fold is an endpoint
      for (let k = Math.ceil(ua + 1e-9); k <= Math.floor(ub - 1e-9); k++) folds++;
    }
    expect(folds).toBe(0);
    // all four folds are present as vertices (u = −1, 0, 1, 2 over this wrap)
    const us = folded.map((p) => screenU(p.s, total));
    for (const k of [-1, 0, 1, 2]) expect(us.some((u) => Math.abs(u - k) < 1e-6)).toBe(true);
    // and every folded sample still sits ON the path, not on a chord shortcut through the wall
    for (const p of folded) {
      expect(p.x).toBeGreaterThanOrEqual(SCREEN.inset - 1e-6);
      expect(p.x).toBeLessThanOrEqual(ROOM.w - SCREEN.inset + 1e-6);
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 9);
    }
  });

  it("joins every segment to the next without a gap in the plan path", () => {
    const segs = screenPath();
    const endOf = (i: number): { x: number; z: number } => {
      const s = segs[i];
      return s.kind === "line" ? s.to : { x: s.centre.x + Math.cos(s.to) * s.r, z: s.centre.z + Math.sin(s.to) * s.r };
    };
    const startOf = (i: number): { x: number; z: number } => {
      const s = segs[i];
      return s.kind === "line" ? s.from : { x: s.centre.x + Math.cos(s.from) * s.r, z: s.centre.z + Math.sin(s.from) * s.r };
    };
    for (let i = 0; i < segs.length - 1; i++) {
      const a = endOf(i), b = startOf(i + 1);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-9);
    }
  });

  it("faces every sample INWARD, toward the floor the audience stands on", () => {
    const inside = { x: ROOM.w / 2, z: ROOM.d * 0.45 };
    for (const p of samplePath()) {
      const toRoom = { x: inside.x - p.x, z: inside.z - p.z };
      expect(p.nx * toRoom.x + p.nz * toRoom.z).toBeGreaterThan(0);
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 6);
    }
  });
});

describe("CAVE collision — honest, and its own", () => {
  const stand = (x: number, z: number): boolean => caveStandTest(toWorld(x, z), NAV_RADIUS);

  it("lets a body stand where the audience goes", () => {
    expect(caveStandTest(SPAWN, NAV_RADIUS)).toBe(true);
    expect(stand(ROOM.w / 2, ROOM.d / 2)).toBe(true);
    expect(stand(ROOM.w / 2, SCREEN.inset + NAV_RADIUS + 10)).toBe(true); // right up to the front panel
  });

  it("refuses to let anyone walk into or behind the screen, on all three sides", () => {
    expect(stand(ROOM.w / 2, 2)).toBe(false); // through the front panel
    expect(stand(4, ROOM.d / 2)).toBe(false); // through the west wing
    expect(stand(ROOM.w - 4, ROOM.d / 2)).toBe(false); // through the east wing
    expect(stand(60, ROOM.d + 4)).toBe(false); // through the back wall, well away from the threshold
  });

  it("cuts the two front corners on the SAME arcs the screen is built from", () => {
    const r = SCREEN.cornerR, i = SCREEN.inset;
    // dead in the corner, outside the arc: refused
    expect(stand(i + 8, i + 8)).toBe(false);
    expect(stand(ROOM.w - i - 8, i + 8)).toBe(false);
    // just inside the same arc: allowed
    const cw = { x: i + r, z: i + r };
    const d = r - NAV_RADIUS - 6;
    expect(stand(cw.x - d * Math.SQRT1_2, cw.z - d * Math.SQRT1_2)).toBe(true);
  });

  it("opens the threshold pocket, and only the threshold pocket, south of the back wall", () => {
    expect(stand(ROOM.w / 2, ROOM.d + 8)).toBe(true); // in the vestibule mouth
    expect(stand(ROOM.w / 2 + THRESHOLD.w, ROOM.d + 8)).toBe(false); // beside it, in solid wall
    expect(stand(ROOM.w / 2, ROOM.d + THRESHOLD.depth + 20)).toBe(false); // past its blind end
  });

  it("claims EVERY point it lets a body stand on as CAVE floor — no unclaimed pockets", () => {
    // THE INVARIANT THIS ROOM LEARNED THE HARD WAY. PlayerMode scopes its interaction candidates to the
    // room the body's REGION names, so a standable point belonging to no region silently targets
    // nothing — and the first build put the way out in exactly such a pocket. Sweep the whole volume:
    // anything the collision test accepts must also be claimed by the CAVE.
    const world = rig(true);
    let standable = 0, inVestibule = 0;
    for (let z = CAVE_OUTER_RECT.z; z <= CAVE_OUTER_RECT.z + CAVE_OUTER_RECT.d + THRESHOLD.depth; z += 4)
      for (let x = CAVE_OUTER_RECT.x; x <= CAVE_OUTER_RECT.x + CAVE_OUTER_RECT.w; x += 4) {
        const p = { x, z };
        if (!caveStandTest(p, NAV_RADIUS)) continue;
        standable++;
        const r = world.regionAt(p);
        expect(r?.roomId).toBe(CAVE_ID);
        expect(r?.walkable).toBe(true);
        if (r!.id.startsWith("threshold:")) inVestibule++;
      }
    expect(standable).toBeGreaterThan(8000);
    expect(inVestibule).toBeGreaterThan(0); // the pocket really is exercised by the sweep
  });

  it("offers the way out to anyone who steps into the vestibule, whichever way they turn", () => {
    const world = rig(true);
    const exitPoint = exitApproach().point;
    expect(world.regionAt(exitPoint)?.roomId).toBe(CAVE_ID);
    // PlayerTargeting.pickTarget ignores facing inside CLOSE_ENOUGH (20). Every standable point in the
    // mouth must be within that of the exit, so leaving is "walk in", never "walk in and aim".
    for (let z = ROOM.d + 1; z <= ROOM.d + THRESHOLD.depth; z += 2) {
      const p = toWorld(ROOM.w / 2, z);
      if (!caveStandTest(p, NAV_RADIUS)) continue;
      expect(Math.hypot(p.x - exitPoint.x, p.z - exitPoint.z)).toBeLessThan(20);
    }
  });

  it("spawns you facing the screen with the exit out of reach behind you", () => {
    const exitPoint = exitApproach().point;
    expect(Math.hypot(SPAWN.x - exitPoint.x, SPAWN.z - exitPoint.z)).toBeGreaterThan(REACH);
    expect(SPAWN.z).toBeLessThan(exitPoint.z); // the exit really is behind
    expect(caveStandTest(exitPoint, NAV_RADIUS)).toBe(true);
    expect(caveStandTest(screenApproach().point, NAV_RADIUS)).toBe(true);
  });

  it("is a room for a crowd: no interior obstacle, and a threshold many bodies wide", () => {
    expect(THRESHOLD.w / (2 * NAV_RADIUS)).toBeGreaterThanOrEqual(6); // ≥ 6 bodies abreast
    // SWEEP THE AUDIENCE FLOOR on a 10-unit lattice and demand that every single point holds a body.
    // The area swept is everything the two corner arcs do not cut: the full width south of the arc
    // centres, plus the front bay between them. A refusal anywhere in here would mean something is
    // standing in the middle of a room whose whole brief is that nothing is.
    const m = NAV_RADIUS + 4;
    const cwX = SCREEN.inset + SCREEN.cornerR, ceX = ROOM.w - SCREEN.inset - SCREEN.cornerR;
    let swept = 0;
    for (let z = SCREEN.inset + m; z <= ROOM.d - m; z += 10)
      for (let x = SCREEN.inset + m; x <= ROOM.w - SCREEN.inset - m; x += 10) {
        const belowCorners = z >= SCREEN.inset + SCREEN.cornerR;
        if (!belowCorners && (x < cwX || x > ceX)) continue; // the arcs' own quadrants, tested above
        expect(stand(x, z)).toBe(true);
        swept++;
      }
    expect(swept).toBeGreaterThan(1800); // ~180,000 sq units ≈ 450 m² of unobstructed floor
  });
});

describe("the built volume", () => {
  it("comes back hidden, with its screen and its reflection in it", () => {
    const built = buildCave();
    expect(built.group.visible).toBe(false);
    expect(built.group.getObjectByName("cave-screen")).toBeDefined();
    expect(built.group.getObjectByName("cave-screen-reflection")).toBeDefined();
    expect(built.group.getObjectByName("cave-shell-0")).toBeDefined();
  });

  it("stands inside its own shell, and nowhere near the office", () => {
    const built = buildCave();
    built.group.visible = true;
    const box = new THREE.Box3().setFromObject(built.group);
    expect(box.min.x).toBeGreaterThanOrEqual(CAVE_OUTER_RECT.x - 1);
    expect(box.max.x).toBeLessThanOrEqual(CAVE_OUTER_RECT.x + CAVE_OUTER_RECT.w + 1);
    expect(box.max.y).toBeLessThanOrEqual(ROOM.ceiling + ROOM.wallT + 1);
    expect(box.min.x).toBeGreaterThan(FRAME.x + FRAME.w);
  });

  it("draws the whole theatre in a handful of meshes — one of them the entire 270° screen", () => {
    const built = buildCave();
    let meshes = 0;
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeLessThanOrEqual(10);
    const screen = built.group.getObjectByName("cave-screen") as THREE.Mesh;
    expect(screen.geometry.getAttribute("position").count).toBeGreaterThan(40); // the curve is real
  });

  it("hands ONE texture to EVERY surface that shows the video — never one decoder per wall", () => {
    const built = buildCave();
    const tex = new THREE.Texture();
    attachCaveVideo(built, tex);
    expect(built.videoMaterials.length).toBeGreaterThan(1);
    for (const m of built.videoMaterials) {
      expect((m as THREE.MeshBasicMaterial).map).toBe(tex); // the SAME object, not an equal one
      expect((m as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    }
    // idempotent: re-entering must not churn materials
    attachCaveVideo(built, tex);
    for (const m of built.videoMaterials) expect((m as THREE.MeshBasicMaterial).map).toBe(tex);
  });
});

describe("the media source", () => {
  it("is SUNTOUCAN.mp4, served from the app's own base path", () => {
    expect(CAVE_VIDEO_URL).toMatch(/vo3d\/suntoucan\.mp4$/);
    expect(CAVE_VIDEO_URL.startsWith("/")).toBe(true); // built from import.meta.env.BASE_URL, not hardcoded
  });

  it("fetches and allocates NOTHING until somebody walks in", () => {
    const media = new CaveMedia();
    expect(media.texture).toBeNull();
    expect(media.element).toBeNull();
    expect(media.state.status).toBe("absent");
  });

  it("creates exactly one element and one texture, however many times it is asked", () => {
    const media = new CaveMedia();
    const a = media.ensure();
    const b = media.ensure();
    expect(a).toBe(b);
    expect(media.element).not.toBeNull();
    expect(media.element!.loop).toBe(true);
    // CLAMPED on both axes: the 270° fold lives in the geometry (build/cave.ts screenTexU), which folds
    // about a CROPPED edge the sampler's MirroredRepeat cannot address. A wrapping texture here would
    // silently put the source's dark outermost columns back at every seam.
    expect(a!.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(a!.wrapT).toBe(THREE.ClampToEdgeWrapping);
    media.dispose();
    expect(media.texture).toBeNull();
  });
});

describe("the room definition", () => {
  it("measures a genuine event hall, not a corridor with a screen at the end", () => {
    expect(ROOM.w * ROOM.d).toBeGreaterThan(200_000); // > 500 m² gross at 5 cm/unit
    expect(ROOM.ceiling / BON_STANDING_HEIGHT).toBeGreaterThan(6); // the reference's tall black box
    expect(CAVE_ROOM.floorRect).toEqual({ x: ORIGIN.x, z: ORIGIN.z, w: ROOM.w, d: ROOM.d });
    expect(CAVE_ROOM.wallSolids).toEqual([]); // outside the V1 lattice: it answers with caveStandTest
  });

  it("keeps its interior a whole number of cells clear of its own shell", () => {
    expect(CAVE_OUTER_RECT.w).toBe(ROOM.w + 2 * ROOM.wallT);
    expect(CAVE_OUTER_RECT.d).toBe(ROOM.d + 2 * ROOM.wallT);
    expect(ROOM.wallT).toBeLessThan(CELL);
  });
});
