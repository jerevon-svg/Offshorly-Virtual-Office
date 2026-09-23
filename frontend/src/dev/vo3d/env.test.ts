import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { phaseForHour } from "../../data/officePhase";
import { ENV_TIME_MODES, TimeOfDay, envPhaseFor, envPhaseForHour } from "./env/timeOfDay";
import { ENV_PRESETS, blendPreset, lerpHex, overlay } from "./env/presets";
import { DEFAULT_LIGHT } from "./render/Renderer";
import {
  CROSSINGS, EXPANSION_LOTS, GRADE, GROVES, LOTS, OFFSHORLY_LOT, PARKING, POND, PODIUM, ROADS, ROAD_Y,
  SPECIMENS, TREE_LINES, VEHICLES, WORLD_CENTRE, WORLD_RADIUS, roadById, roadRect,
} from "./world/campus";
import { buildExterior } from "./build/exterior";
import { CameraModes, OFFICE_VIEW } from "./render/CameraModes";
import { FRAME } from "./adapters/v1Floor";
import { pointInRect, type Rect } from "./core/coords";

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.z >= outer.z && inner.x + inner.w <= outer.x + outer.w && inner.z + inner.d <= outer.z + outer.d;
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

describe("vo3d env — V1 is the source of truth for the clock", () => {
  it("consumes V1's classification instead of re-deriving it, folding morning into day", () => {
    expect(envPhaseFor("morning")).toBe("day");
    expect(envPhaseFor("day")).toBe("day");
    expect(envPhaseFor("sunset")).toBe("sunset");
    expect(envPhaseFor("night")).toBe("night");
    // every V1 boundary, taken from V1 itself — nothing here restates a boundary hour
    for (const h of [0, 5.99, 6, 9.99, 10, 16.99, 17, 18.99, 19, 23.5]) {
      expect(envPhaseForHour(h), `hour ${h}`).toBe(envPhaseFor(phaseForHour(h)));
    }
  });

  it("AUTO follows the real clock; a manual override changes only what V2 reads", () => {
    let hour = 12;
    const t = new TimeOfDay(() => hour, 0);
    expect(t.phase(0)).toBe("day");
    expect(t.overridden).toBe(false);

    hour = 18;
    expect(t.phase(1)).toBe("sunset");
    hour = 21;
    expect(t.phase(2)).toBe("night");

    t.mode = "day"; // dev override: visual testing only
    expect(t.phase(3)).toBe("day");
    expect(t.overridden).toBe(true);
    expect(t.realPhase).toBe("night"); // the V1 clock kept running underneath and was not written to
    expect(phaseForHour(21)).toBe("night"); // ...and V1's own rules are unchanged

    t.mode = "auto";
    expect(t.phase(4)).toBe("night"); // back on real time immediately
  });

  it("throttles the clock read rather than formatting a date every frame", () => {
    let reads = 0;
    const t = new TimeOfDay(() => { reads++; return 12; }, 30_000);
    expect(reads).toBe(1); // once at construction
    for (let f = 0; f < 600; f++) t.phase(f * 16);
    expect(reads).toBe(1); // 9.6s of frames, still inside one poll window
    t.phase(40_000);
    expect(reads).toBe(2);
  });

  it("offers exactly AUTO + the three presented phases", () => {
    expect(ENV_TIME_MODES).toEqual(["auto", "day", "sunset", "night"]);
  });
});

describe("vo3d env — the presentation table", () => {
  // DAY and Renderer.DEFAULT_LIGHT are one grade written in two places (the renderer stands up before the
  // environment exists). The old test froze DAY at literal numbers to protect the rooms' original grade;
  // the Full Graphics target replaces those numbers, so what is worth asserting is no longer WHICH numbers
  // they are but that the two copies still agree and that DAY is still a clean, un-lit-from-nowhere noon.
  it("keeps DAY and the renderer's standalone default the same single grade", () => {
    const d = ENV_PRESETS.day;
    expect(d.key.intensity).toBe(DEFAULT_LIGHT.keyIntensity);
    expect(d.key.azimuth).toBe(DEFAULT_LIGHT.azimuth);
    expect(d.key.elevation).toBe(DEFAULT_LIGHT.elevation);
    expect(d.hemi.intensity).toBe(DEFAULT_LIGHT.ambientIntensity);
    expect(d.envIntensity).toBe(DEFAULT_LIGHT.envIntensity);
    expect(d.exposure).toBe(DEFAULT_LIGHT.exposure);
    expect(d.exteriorTint).toBe(1);
    expect(d.practicals).toBe(0);
  });

  it("spends DAY's budget on the sun rather than on the fill, which is what puts shadows in it", () => {
    const d = ENV_PRESETS.day;
    // the key has to out-shout everything that fills its own shadows back in, by a wide margin
    expect(d.key.intensity).toBeGreaterThan(3);
    expect(d.key.intensity).toBeGreaterThan((d.hemi.intensity + d.envIntensity + d.fill.intensity) * 1.5);
    // a sun directly overhead casts nothing a top-down camera can see; one low enough to rake is the point
    expect(d.key.elevation).toBeLessThan(60);
    expect(d.key.elevation).toBeGreaterThan(45);
    // exposure comes DOWN as the key goes up, or a brighter sun is just a blown-out one
    expect(d.exposure).toBeLessThan(1.1);
    // the shadow side is lit by sky, and sky is blue: fill must be cooler than the warm key
    expect(d.fill.color & 255).toBeGreaterThan((d.fill.color >> 16) & 255);
  });

  it("grades contact occlusion per phase, strongest where there is most contrast to carry it", () => {
    const [d, s, n] = [ENV_PRESETS.day, ENV_PRESETS.sunset, ENV_PRESETS.night];
    for (const q of [d, s, n]) {
      expect(q.ao).toBeGreaterThan(0);
      // past ~0.7 the office's cream architecture reads as dirty rather than occluded
      expect(q.ao).toBeLessThanOrEqual(0.7);
    }
    expect(s.ao).toBeGreaterThan(d.ao); // the raking phase has the most contrast to spend
    expect(n.ao).toBeLessThan(d.ao); // and the darkest has the least
  });

  it("moves day -> sunset -> night in the direction the brief asks for", () => {
    const [d, s, n] = [ENV_PRESETS.day, ENV_PRESETS.sunset, ENV_PRESETS.night];
    // practicals come up as the light goes down
    expect(d.practicals).toBeLessThan(s.practicals);
    expect(s.practicals).toBeLessThan(n.practicals);
    // the sun rakes at sunset and the key drops hard at night
    expect(s.key.elevation).toBeLessThan(d.key.elevation);
    expect(n.key.intensity).toBeLessThan(s.key.intensity);
    // the exterior darkens, but the global ambient stays high enough to keep interiors readable
    expect(n.exteriorTint).toBeLessThan(s.exteriorTint);
    expect(s.exteriorTint).toBeLessThanOrEqual(d.exteriorTint);
    // NIGHT MUST ACTUALLY BE DARKER THAN DAY. This is what makes every emissive in the world — screens,
    // LED strips, the exterior practicals — the brightest thing on screen without one of them being touched.
    expect(n.key.intensity + n.hemi.intensity + n.envIntensity)
      .toBeLessThan((d.key.intensity + d.hemi.intensity + d.envIntensity) * 0.45);
    expect(n.exposure).toBeLessThan(d.exposure);
    // ...but interiors must not go BLACK with the street, and a figure must still be modelled rather than
    // silhouetted, so neither the ambient budget nor the moon is allowed near zero.
    expect(n.hemi.intensity + n.envIntensity).toBeGreaterThan(0.3);
    expect(n.key.intensity).toBeGreaterThan(0.3);
    expect(n.exposure).toBeGreaterThan(0.6);
    // THE HEMISPHERE MUST BE COOL. It lights up-facing surfaces — from the office camera, nearly the whole
    // image — so a warm one renders night as a dimmer day, which is exactly what it used to do. The warm
    // half of a night interior comes from the rooms' own emissive coves and screens, which no light here
    // touches, and from the warm IBL; it must not come from the hemisphere.
    expect(n.hemi.sky & 255).toBeGreaterThan((n.hemi.sky >> 16) & 255);
    expect(n.key.color & 255).toBeGreaterThan((n.key.color >> 16) & 255);
  });

  it("grades sunset and night hard enough to read as different times of day, not tints", () => {
    const [d, s2, n] = [ENV_PRESETS.day, ENV_PRESETS.sunset, ENV_PRESETS.night];
    // sunset rakes the sun right down — but never below the angle whose shadows outrun the shadow map
    expect(s2.key.elevation).toBeLessThanOrEqual(18);
    expect(s2.key.elevation).toBeGreaterThanOrEqual(14);
    expect(s2.key.intensity).toBeGreaterThan(d.key.intensity); // a stronger, warmer, lower sun
    // night drives the fixtures past nominal and the landscape well down
    expect(n.practicals).toBeGreaterThan(1);
    expect(n.exteriorTint).toBeLessThan(0.3);
    // the sky dome: stars and a moon at night only
    // OFFICE mode needs a flat backdrop per phase, since it draws no landscape at all
    for (const q of [d, s2, n]) expect(typeof q.stage).toBe("number");
    expect(d.skyGrade.stars).toBe(0);
    expect(s2.skyGrade.stars).toBe(0);
    expect(n.skyGrade.stars).toBeGreaterThan(0.5);
    expect(n.skyGrade.moon).toBeGreaterThan(0);
  });

  it("is composable and interpolatable — the seams weather and a 24h cycle will use", () => {
    const rainy = overlay(ENV_PRESETS.day, { key: { intensity: 0.9 }, exteriorTint: 0.8 });
    expect(rainy.key.intensity).toBe(0.9);
    expect(rainy.key.azimuth).toBe(ENV_PRESETS.day.key.azimuth); // untouched fields survive
    expect(rainy.exteriorTint).toBe(0.8);
    expect(ENV_PRESETS.day.key.intensity).toBe(DEFAULT_LIGHT.keyIntensity); // the table itself is not mutated

    expect(lerpHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    const mid = blendPreset(ENV_PRESETS.sunset, ENV_PRESETS.night, 0.5);
    expect(mid.practicals).toBeCloseTo((ENV_PRESETS.sunset.practicals + ENV_PRESETS.night.practicals) / 2, 6);
    expect(blendPreset(ENV_PRESETS.day, ENV_PRESETS.night, 0)).toEqual(expect.objectContaining({ exposure: ENV_PRESETS.day.exposure }));
  });
});

describe("vo3d world — the campus plan is expandable by construction", () => {
  it("gives Offshorly its own lot, containing the whole V1 office podium", () => {
    expect(OFFSHORLY_LOT.status).toBe("developed");
    expect(OFFSHORLY_LOT.companyId).toBe("offshorly");
    expect(contains(OFFSHORLY_LOT.rect, PODIUM)).toBe(true);
    expect(contains(PODIUM, FRAME)).toBe(true);
  });

  it("lays out vacant company parcels that no company occupies and nothing overlaps", () => {
    expect(EXPANSION_LOTS.length).toBeGreaterThanOrEqual(3);
    for (const lot of EXPANSION_LOTS) {
      expect(lot.status).toBe("vacant");
      expect(lot.companyId).toBeUndefined();
      expect(overlaps(lot.rect, OFFSHORLY_LOT.rect)).toBe(false);
    }
    for (let i = 0; i < LOTS.length; i++)
      for (let j = i + 1; j < LOTS.length; j++)
        expect(overlaps(LOTS[i].rect, LOTS[j].rect), `${LOTS[i].id} vs ${LOTS[j].id}`).toBe(false);
  });

  it("connects every company lot to the road network along its declared frontage", () => {
    const edges = ROADS.flatMap((r) => [r.at - r.width / 2, r.at + r.width / 2]);
    const near = (v: number) => edges.some((e) => Math.abs(e - v) < 1e-6);
    for (const lot of LOTS.filter((l) => l.kind === "company")) {
      const r = lot.rect;
      const edge = lot.frontage === "north" ? r.z : lot.frontage === "south" ? r.z + r.d : lot.frontage === "west" ? r.x : r.x + r.w;
      expect(near(edge), `${lot.id} frontage`).toBe(true);
    }
  });

  it("keeps every road clear of the office frame, and crossings on their own road", () => {
    for (const r of ROADS) expect(overlaps(roadRect(r), FRAME), r.id).toBe(false);
    for (const c of CROSSINGS) {
      const r = roadById(c.roadId);
      expect(c.at).toBeGreaterThanOrEqual(r.from);
      expect(c.at).toBeLessThanOrEqual(r.to);
    }
  });

  it("stacks the ground planes so nothing is coplanar, and parks on the Offshorly lot", () => {
    expect(ROAD_Y).toBeLessThan(GRADE); // the carriageway sits a curb below the lawn
    expect(GRADE).toBeLessThan(0); // and the whole campus sits below the office's own floor plane
    expect(contains(OFFSHORLY_LOT.rect, PARKING)).toBe(true);
    expect(overlaps(PARKING, PODIUM)).toBe(false);
  });

  it("puts the horizon further out than the widest normal gameplay view can reach", () => {
    // widest view is roughly 6.7k x 3.8k world units; its half-diagonal must stay inside the terrain
    expect(WORLD_RADIUS).toBeGreaterThan(Math.hypot(6700 / 2, 3800 / 2));
    expect(pointInRect(WORLD_CENTRE, FRAME)).toBe(true);
  });
});

describe("vo3d world — the landscape is composed, not scattered", () => {
  it("plants trees only from named lines, groves and specimens", () => {
    // every row frames the block over a bounded stretch rather than lining a whole road
    for (const l of TREE_LINES) {
      expect(l.to).toBeGreaterThan(l.from);
      expect(l.to - l.from).toBeLessThan(2 * WORLD_RADIUS);
      expect(l.spacing).toBeGreaterThan(150); // a row, not a hedge
    }
    expect(GROVES.length).toBeGreaterThan(0);
    expect(SPECIMENS.length).toBeLessThanOrEqual(6);
  });

  it("leaves each vacant parcel's buildable ground clear: one grove, tucked away from the frontage", () => {
    for (const lot of EXPANSION_LOTS) {
      const inLot = GROVES.filter((g) => g.x > lot.rect.x && g.x < lot.rect.x + lot.rect.w && g.z > lot.rect.z && g.z < lot.rect.z + lot.rect.d);
      expect(inLot.length, lot.id).toBe(1);
      // and it sits in the half of the parcel AWAY from the road it fronts
      const g = inLot[0];
      const depth = lot.frontage === "north" ? g.z - lot.rect.z
        : lot.frontage === "west" ? g.x - lot.rect.x
        : lot.rect.x + lot.rect.w - g.x;
      const span = lot.frontage === "north" ? lot.rect.d : lot.rect.w;
      expect(depth / span, lot.id).toBeGreaterThan(0.4);
    }
  });

  it("puts the one water feature on the Offshorly lot, clear of the building and the roads", () => {
    const bbox = { x: POND.x - POND.rx, z: POND.z - POND.rz, w: POND.rx * 2, d: POND.rz * 2 };
    expect(contains(OFFSHORLY_LOT.rect, bbox)).toBe(true);
    expect(overlaps(bbox, PODIUM)).toBe(false);
    for (const r of ROADS) expect(overlaps(bbox, roadRect(r)), r.id).toBe(false);
  });

  it("places a restrained, hand-placed Philippine transport mix — no filled roads", () => {
    expect(VEHICLES.length).toBeLessThanOrEqual(14);
    const kinds = new Set(VEHICLES.map((v) => v.kind));
    expect(kinds).toEqual(new Set(["car", "jeepney", "tricycle", "motorcycle"]));
    expect(VEHICLES.filter((v) => v.kind === "jeepney").length).toBe(1);
    // nothing is parked ON a carriageway
    for (const v of VEHICLES)
      for (const r of ROADS)
        expect(pointInRect({ x: v.x, z: v.z }, roadRect(r)), `${v.kind} on ${r.id}`).toBe(false);
  });
});

describe("vo3d build — the exterior world stays inside its performance budget", () => {
  const scenery = buildExterior();

  it("adds no real-time lights at all — every exterior lamp is emissive geometry", () => {
    let lights = 0;
    scenery.root.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
  });

  it("keeps the whole world inside a small, instancing-dominated draw budget", () => {
    let draws = 0, instanced = 0, tris = 0;
    scenery.root.traverse((o) => {
      const m = o as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
      if (!m.isMesh) return;
      draws++;
      if (m.isInstancedMesh) instanced++;
      const idx = m.geometry.getIndex();
      const per = (idx ? idx.count : m.geometry.getAttribute("position").count) / 3;
      tris += per * (m.isInstancedMesh ? (m.count ?? 1) : 1);
    });
    expect(draws).toBeLessThanOrEqual(80);
    expect(instanced).toBeGreaterThanOrEqual(12);
    expect(tris).toBeLessThan(250_000);
    // The polish pass CUT planting: the world used to carry well over 300 near trees, and was brought
    // under 170. RE-BASED TO 220 when the rear campus opened: the AI Lab's concealment planting — the
    // rear screen, the lab screen, the two flanks and the lake shore — is the whole reason that area
    // reads as somewhere you discover rather than a building in a field, so it is a deliberate spend,
    // not drift. It is still a third below the pre-polish world, and it costs nothing in submissions:
    // every tree is instanced, and `draws` above is unchanged by it.
    expect(scenery.stats.trees).toBeLessThan(220);
    expect(scenery.stats.trees).toBeGreaterThan(60);
    expect(scenery.stats.vehicles).toBe(VEHICLES.length);
  });

  it("casts shadows only from the near, readable pieces", () => {
    const casters: string[] = [];
    scenery.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) casters.push(o.name); });
    expect(casters).not.toContain("distant-belt");
    expect(casters).not.toContain("distant-hills");
    expect(casters).toContain("car-body");
    expect(casters).toContain("jeepney-body");
    expect(casters).toContain("bench-wood");
  });

  it("switches its practical lights with the phase, and darkens only its own surfaces", () => {
    const lens = findMaterial(scenery.root, "lamp-lenses") as THREE.MeshStandardMaterial;
    const pool = findMaterial(scenery.root, "lamp-pools");
    const body = findMaterial(scenery.root, "car-body");

    scenery.applyPracticals(ENV_PRESETS.day.practicals);
    expect(lens.emissiveIntensity).toBe(0);
    expect(pool.visible).toBe(false);

    scenery.applyPracticals(ENV_PRESETS.sunset.practicals);
    const dusk = lens.emissiveIntensity;
    expect(dusk).toBeGreaterThan(0);
    expect(pool.visible).toBe(true);

    scenery.applyPracticals(ENV_PRESETS.night.practicals);
    expect(lens.emissiveIntensity).toBeGreaterThan(dusk);

    // the night tint is a multiply on the exterior's OWN base colours and is fully reversible
    const day = (body as THREE.MeshStandardMaterial).color.clone();
    scenery.applyTint(ENV_PRESETS.night.exteriorTint);
    expect((body as THREE.MeshStandardMaterial).color.r).toBeLessThan(day.r);
    scenery.applyTint(1);
    expect((body as THREE.MeshStandardMaterial).color.r).toBeCloseTo(day.r, 6);
  });

  it("marks every vacant parcel as future company land, and nothing else", () => {
    const markers: string[] = [];
    scenery.root.traverse((o) => { if (o.name.startsWith("lot-marker:")) markers.push(o.name); });
    expect(markers.length).toBe(EXPANSION_LOTS.length);
    for (const lot of EXPANSION_LOTS) expect(markers).toContain(`lot-marker:${lot.id}`);
    // the developed lot never gets one
    expect(markers).not.toContain("lot-marker:lot-offshorly");
  });

  it("is scenery only: nothing it builds carries an entity, footprint or ambient tagging", () => {
    scenery.root.traverse((o) => {
      expect(o.userData.ambient, o.name).toBeUndefined();
      expect(o.userData.powered, o.name).toBeUndefined();
      expect(o.userData.footprint, o.name).toBeUndefined();
    });
  });
});

function findMaterial(root: THREE.Object3D, name: string): THREE.Material {
  const o = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!o) throw new Error(`no mesh ${name}`);
  return o.material as THREE.Material;
}

describe("vo3d render — OFFICE and 3D EXPLORE camera modes", () => {
  // A stand-in for the Renderer surface CameraModes touches. The modes are pure policy, so they can be
  // tested without a WebGL context; the maths below mirrors Renderer.placeCamera exactly.
  const OFFICE: Rect = { x: 0, z: 0, w: 1440, d: 1244 };
  const REF: Rect = { x: 0, z: 0, w: 310, d: 264 }; // Renderer's frustum reference rect (the Design Room)

  function fakeRenderer() {
    const aspect = window.innerWidth / window.innerHeight;
    const R = {
      focus: REF,
      camParams: { pitch: 0, yaw: 0, zoom: 1 },
      // the Renderer's OWN focus point: focusOn writes this, placeCamera copies it into the controls
      target: { x: 0, y: 8, z: 0 },
      camera: { top: 0, right: 0, zoom: 1, position: { x: 0, y: 0, z: 0 }, updateProjectionMatrix() {} },
      controls: { target: { x: 0, y: 8, z: 0 }, enabled: true, enableRotate: true, enablePan: true, screenSpacePanning: true, minZoom: 0.12, maxZoom: 6 },
      constrain: null as (() => void) | null,
      // the PLAYER mode's surface: selecting which camera draws, and the shadow-frame override it sets.
      // OFFICE/EXPLORE only ever CLEAR these — see render/CameraModes.set — so the assertions below are
      // unchanged; the stand-in simply has to carry the whole surface the policy touches.
      shadowFocus: null as unknown,
      shadowRadius: null as number | null,
      setActiveCamera(_c: unknown) {},
      focusedOn: null as Rect | null,
      focusOn(rect: Rect) { this.focusedOn = rect; this.camera.zoom = 1; this.target.x = rect.x + rect.w / 2; this.target.y = 8; this.target.z = rect.z + rect.d / 2 - 6; return 1; },
      placeCamera() {
        this.controls.target.x = this.target.x; this.controls.target.y = this.target.y; this.controls.target.z = this.target.z;
        const h = (REF.d * 0.62 + 40) / this.camParams.zoom; this.camera.top = h; this.camera.right = h * aspect;
      },
    };
    return R;
  }
  const groundRect = (R: ReturnType<typeof fakeRenderer>): Rect => {
    const pitch = (52 * Math.PI) / 180;
    const halfZ = R.camera.top / R.camera.zoom / Math.sin(pitch);
    const halfX = R.camera.right / R.camera.zoom;
    // the orbit target sits at the office datum (y 8), so the screen centre lands datum/tan(pitch)
    // further north on the floor — the same correction the fence itself makes
    const groundZ = R.controls.target.z - R.controls.target.y / Math.tan(pitch);
    return { x: R.controls.target.x - halfX, z: groundZ - halfZ, w: halfX * 2, d: halfZ * 2 };
  };
  // With a COVER fit the viewport is inside the office at every legal zoom, so the check is strict on
  // both axes — no "the viewport is wider than the bounds, so centre it" escape hatch any more.
  const insideBounds = (v: Rect, b: Rect, axis: "x" | "z"): boolean =>
    axis === "x"
      ? v.x >= b.x - 1 && v.x + v.w <= b.x + b.w + 1
      : v.z >= b.z - 1 && v.z + v.d <= b.z + b.d + 1;

  it("OFFICE frames the whole office, fixes the orientation and kills orbit", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    expect(modes.mode).toBe("office");
    expect(R.focusedOn).toBe(OFFICE); // NOT the Design Room
    expect(R.camParams.pitch).toBe(OFFICE_VIEW.pitch);
    expect(R.camParams.yaw).toBe(OFFICE_VIEW.yaw);
    expect(R.controls.enableRotate).toBe(false);
    expect(R.controls.enablePan).toBe(true); // dragging inside the office is normal V1 navigation
  });

  it("makes the whole-office framing the MAXIMUM zoom-out, with real zoom-in headroom", () => {
    const R = fakeRenderer();
    new CameraModes(R as never, OFFICE).set("office");
    expect(R.controls.minZoom).toBe(1); // the dolly floor IS the canonical framing
    expect(R.controls.maxZoom).toBeGreaterThanOrEqual(5); // close inspection of desks/characters
  });

  it("COVERS the viewport with the office at max zoom-out — no empty stage down the sides", () => {
    const R = fakeRenderer();
    new CameraModes(R as never, OFFICE).set("office");
    R.constrain!();
    const v = groundRect(R);
    // the office fills the frame on BOTH axes: the viewport is inside the office, never the other way
    expect(v.w).toBeLessThanOrEqual(OFFICE.w + 1);
    expect(v.d).toBeLessThanOrEqual(OFFICE.d + 1);
    // ...and it is a true maximum: one axis is met exactly, so pulling back any further would show stage
    const tight = Math.abs(v.w - OFFICE.w) < 2 || Math.abs(v.d - OFFICE.d) < 2;
    expect(tight, `viewport ${Math.round(v.w)}x${Math.round(v.d)} vs office ${OFFICE.w}x${OFFICE.d}`).toBe(true);
    // and the viewport still sits wholly inside the bounds
    expect(v.x).toBeGreaterThanOrEqual(OFFICE.x - 1);
    expect(v.x + v.w).toBeLessThanOrEqual(OFFICE.x + OFFICE.w + 1);
    expect(v.z).toBeGreaterThanOrEqual(OFFICE.z - 1);
    expect(v.z + v.d).toBeLessThanOrEqual(OFFICE.z + OFFICE.d + 1);
  });

  it("fences panning by the VIEWPORT, not just the target, at every zoom level", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    for (const dolly of [1, 1.6, 3, 6]) {
      R.camera.zoom = dolly;
      for (const [dx, dz] of [[0, 4000], [0, -4000], [4000, 0], [-4000, 0], [3000, 3000]]) {
        R.controls.target.x += dx;
        R.controls.target.z += dz;
        R.constrain!(); // the fence runs every frame, straight after OrbitControls
        const v = groundRect(R);
        expect(insideBounds(v, OFFICE, "x"), `x at dolly ${dolly}`).toBe(true);
        expect(insideBounds(v, OFFICE, "z"), `z at dolly ${dolly}`).toBe(true);
      }
    }
  });

  it("stops the south drag at the Reception sidewalk — the road is unreachable", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    R.camera.zoom = 3;
    R.controls.target.z += 9000; // drag south as hard as possible
    R.constrain!();
    // the V1 frame's south edge (z 1244) carries the exterior sidewalk under Reception; the main street
    // is at z 1512+ and must never enter the viewport
    expect(groundRect(R).z + groundRect(R).d).toBeLessThanOrEqual(OFFICE.z + OFFICE.d + 1);
    expect(groundRect(R).z + groundRect(R).d).toBeLessThan(1512);
  });

  it("gives more pan range the further in you zoom", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    const reach = (dolly: number) => {
      modes.set("office");
      R.camera.zoom = dolly;
      R.controls.target.x += 9000;
      R.constrain!();
      return R.controls.target.x;
    };
    expect(reach(6)).toBeGreaterThan(reach(2));
    expect(reach(2)).toBeGreaterThan(reach(1));
  });

  it("keeps room focus inside the fence and inside the mode's zoom range", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    const p = modes.focus({ x: 476, z: 427, w: 501, d: 324 }, 0.92);
    expect(p.pitch).toBe(OFFICE_VIEW.pitch);
    expect(p.yaw).toBe(OFFICE_VIEW.yaw);
    expect(R.camera.zoom).toBeGreaterThan(1); // magnified via DOLLY, so the wheel still reaches back out
    expect(R.camera.zoom).toBeLessThanOrEqual(R.controls.maxZoom);
    const v = groundRect(R);
    expect(insideBounds(v, OFFICE, "x")).toBe(true);
    expect(insideBounds(v, OFFICE, "z")).toBe(true);
  });

  it("EXPLORE removes the fence and unlocks orbit, pan and world-scale zoom", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    modes.set("explore");
    expect(R.constrain).toBeNull();
    expect(R.controls.enableRotate).toBe(true);
    expect(R.controls.enablePan).toBe(true);
    expect(R.controls.minZoom).toBeLessThan(0.1); // low enough to see the horizon at a low pitch
  });

  it("cannot leak an explore orientation, pan or zoom back into OFFICE", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("explore");
    R.camParams = { pitch: 17, yaw: 143, zoom: 0.06 };
    R.controls.target.x = 3800;
    R.controls.target.z = -2600;
    R.camera.zoom = 0.4;
    const back = modes.set("office");
    expect(back.pitch).toBe(OFFICE_VIEW.pitch);
    expect(back.yaw).toBe(OFFICE_VIEW.yaw);
    expect(back.zoom).toBe(modes.officeParams.zoom);
    expect(R.focusedOn).toBe(OFFICE);
    expect(R.camera.zoom).toBe(1);
    expect(R.controls.target.y).toBe(8); // the office datum, not whatever altitude explore left behind
    expect(R.constrain).not.toBeNull();
    const v = groundRect(R);
    expect(insideBounds(v, OFFICE, "x")).toBe(true);
    expect(insideBounds(v, OFFICE, "z")).toBe(true);
  });
});

describe("vo3d env — OFFICE presentation keeps the world a secret", () => {
  // Environment needs a Renderer; this is the slice of it the presentation switch actually writes to.
  function fakeRenderer() {
    return {
      scene: { background: null as unknown, fog: null as unknown, add() {} },
      camera: {},
      target: new THREE.Vector3(),
      camDist: 6000,
      key: new THREE.DirectionalLight(),
      fill: new THREE.DirectionalLight(),
      hemi: new THREE.HemisphereLight(),
      lightParams: {} as never,
      placeLight() {},
      // the levels-only write the environment takes whenever the SUN has not moved (a weather re-grade,
      // a lightning flash) — the path that deliberately does NOT invalidate the shadow map
      applyLightLevels() {},
    };
  }

  it("draws no exterior geometry and no sky in OFFICE, and restores both in EXPLORE", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const scenery = buildExterior();
    const env = new Environment(R as never, scenery);
    env.apply("day");
    expect(scenery.root.visible).toBe(true); // world presentation is the default

    expect(env.setPresentation("office")).toBe(true);
    expect(env.presentation).toBe("office");
    expect(scenery.root.visible).toBe(false); // every tree, road, vehicle, the pond and the lot markers
    expect(R.scene.fog).toBeNull(); // no landscape to haze, and haze would tint the backdrop
    expect(env.setPresentation("office")).toBe(false); // idempotent

    // the manual scenery toggle cannot re-expose the world from inside office mode
    env.sceneryVisible = true;
    expect(scenery.root.visible).toBe(false);

    env.setPresentation("world");
    expect(scenery.root.visible).toBe(true); // the reveal, intact — nothing was deleted
  });

  it("still grades day/sunset/night in OFFICE: the illusion is visibility, not lighting", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const env = new Environment(R as never, buildExterior());
    env.setPresentation("office");
    for (const phase of ["day", "sunset", "night"] as const) {
      env.apply(phase);
      // A GRADE NOW TRAVELS. apply() names the target and the world walks to it over ~5s under tick(),
      // so a test that wants to look at the arrived presentation has to say so. settle() is that, and is
      // also what the screenshot rig uses.
      env.settle();
      expect(env.phase).toBe(phase);
      // the backdrop is the phase's flat stage tone, never its sky
      expect((R.scene.background as THREE.Color).getHex()).toBe(ENV_PRESETS[phase].stage);
      expect((R.scene.background as THREE.Color).getHex()).not.toBe(ENV_PRESETS[phase].sky);
    }
  });
});

describe("vo3d render — OFFICE vertical pan is bounded through the REAL input path", () => {
  // REGRESSION: live QA found vertical panning effectively infinite while horizontal was correct.
  //
  // The clamp helper was fine; the bug was upstream of it. OrbitControls' screen-space panning moves the
  // target along the CAMERA'S local Y axis, which at a 52-degree pitch is mostly world-Y — so a vertical
  // drag lifted the target instead of sliding it north/south, and the fence (which reads only x and z)
  // never saw it. Measured live: target.y went 8 -> 1752.7 -> -1736.7 across 30 drags.
  //
  // So this test does NOT call the clamp with synthetic deltas. It reproduces the real chain — a REAL
  // THREE camera, posed by the real Renderer maths, panned by the exact vector OrbitControls computes
  // from that camera's matrix — and runs the constrain hook between updates, exactly as render() does.
  const OFFICE: Rect = { x: 0, z: 0, w: 1440, d: 1244 };
  const REF: Rect = { x: 0, z: 0, w: 310, d: 264 };
  const CAM_DIST = 6000;

  function rig() {
    const aspect = window.innerWidth / window.innerHeight;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 15000);
    const controls = { target: new THREE.Vector3(0, 8, 0), enabled: true, enableRotate: true, enablePan: true, screenSpacePanning: true, minZoom: 0.12, maxZoom: 6 };
    const R = {
      focus: REF, camera, controls,
      camParams: { pitch: 0, yaw: 0, zoom: 1 },
      target: new THREE.Vector3(0, 8, 0), // the Renderer's own focus point, as in the real class
      constrain: null as (() => void) | null,
      // PLAYER-mode surface (see the note on the other stand-in): OFFICE/EXPLORE only clear these
      shadowFocus: null as unknown,
      shadowRadius: null as number | null,
      setActiveCamera(_c: unknown) {},
      focusedOn: null as Rect | null,
      focusOn(rect: Rect) {
        this.focusedOn = rect;
        camera.zoom = 1;
        this.target.set(rect.x + rect.w / 2, 8, rect.z + rect.d / 2 - 6);
        return 1;
      },
      placeCamera() {
        // the real Renderer.placeCamera, verbatim in the parts that matter here
        controls.target.copy(this.target);
        const p = this.camParams;
        const pitch = THREE.MathUtils.degToRad(p.pitch), yaw = THREE.MathUtils.degToRad(p.yaw);
        const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        camera.position.copy(controls.target).addScaledVector(dir, CAM_DIST);
        camera.up.set(0, 1, 0);
        camera.lookAt(controls.target);
        const halfH = (REF.d * 0.62 + 40) / p.zoom;
        camera.top = halfH; camera.bottom = -halfH; camera.left = -halfH * aspect; camera.right = halfH * aspect;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      },
    };
    return R;
  }

  /** OrbitControls.pan(), reproduced exactly: both branches of panUp, and panLeft. */
  function orbitPan(R: ReturnType<typeof rig>, deltaX: number, deltaY: number) {
    const { camera, controls } = R;
    camera.updateMatrixWorld();
    const offset = new THREE.Vector3();
    // panLeft: the camera's local X axis
    const left = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const distL = (deltaX * (camera.right - camera.left)) / camera.zoom / window.innerWidth;
    offset.addScaledVector(left, -distL);
    // panUp: local Y under screenSpacePanning, otherwise worldUp x cameraRight
    const up = new THREE.Vector3();
    if (controls.screenSpacePanning) {
      up.setFromMatrixColumn(camera.matrix, 1);
    } else {
      up.setFromMatrixColumn(camera.matrix, 0);
      up.crossVectors(camera.up, up);
    }
    const distU = (deltaY * (camera.top - camera.bottom)) / camera.zoom / window.innerHeight;
    offset.addScaledVector(up, distU);
    // OrbitControls.update() applies the accumulated offset to BOTH target and position
    controls.target.add(offset);
    camera.position.add(offset);
    R.constrain?.(); // …and then render() hands the fence the last word
    camera.updateMatrixWorld();
  }

  /** the ground the viewport covers, derived from the CAMERA, not from the target */
  function groundSpan(R: ReturnType<typeof rig>) {
    const { camera } = R;
    const halfScreen = camera.top / camera.zoom;
    const sinP = Math.sin(THREE.MathUtils.degToRad(OFFICE_VIEW.pitch));
    // where the camera's centre ray meets y = 0
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const tRay = camera.position.y / -dir.y;
    const centre = camera.position.clone().addScaledVector(dir, tRay);
    return { centreZ: centre.z, centreX: centre.x, N: centre.z - halfScreen / sinP, S: centre.z + halfScreen / sinP,
      W: centre.x - camera.right / camera.zoom, E: centre.x + camera.right / camera.zoom };
  }

  it("uses ground-plane panning in OFFICE and screen-space panning in EXPLORE", () => {
    const R = rig();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    expect(R.controls.screenSpacePanning).toBe(false); // the actual root cause of the unbounded pan
    modes.set("explore");
    expect(R.controls.screenSpacePanning).toBe(true); // EXPLORE keeps its freedom
  });

  it("holds the office datum under repeated REAL vertical drags, at every zoom", () => {
    for (const dolly of [1, 2, 4, 6]) {
      const R = rig();
      const modes = new CameraModes(R as never, OFFICE);
      modes.set("office");
      R.camera.zoom = dolly;
      R.placeCamera();
      for (const dir of [1, -1]) {
        for (let i = 0; i < 60; i++) orbitPan(R, 0, dir * 300); // sixty full-screen drags, one way
        const g = groundSpan(R);
        expect(R.controls.target.y, `target.y drift at dolly ${dolly}`).toBeCloseTo(8, 6);
        expect(g.N, `north at dolly ${dolly}`).toBeGreaterThanOrEqual(OFFICE.z - 1);
        expect(g.S, `south at dolly ${dolly}`).toBeLessThanOrEqual(OFFICE.z + OFFICE.d + 1);
      }
    }
  });

  it("still holds the approved horizontal bounds under repeated REAL drags", () => {
    for (const dolly of [1, 2, 4, 6]) {
      const R = rig();
      const modes = new CameraModes(R as never, OFFICE);
      modes.set("office");
      R.camera.zoom = dolly;
      R.placeCamera();
      for (const dir of [1, -1]) {
        for (let i = 0; i < 60; i++) orbitPan(R, dir * 400, 0);
        const g = groundSpan(R);
        expect(g.W, `west at dolly ${dolly}`).toBeGreaterThanOrEqual(OFFICE.x - 1);
        expect(g.E, `east at dolly ${dolly}`).toBeLessThanOrEqual(OFFICE.x + OFFICE.w + 1);
      }
    }
  });

  it("survives a diagonal drag storm — no axis leaks while the other is pinned", () => {
    const R = rig();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("office");
    R.camera.zoom = 3;
    R.placeCamera();
    for (let i = 0; i < 200; i++) orbitPan(R, (i % 7 - 3) * 260, (i % 5 - 2) * 260);
    const g = groundSpan(R);
    expect(R.controls.target.y).toBeCloseTo(8, 6);
    expect(g.N).toBeGreaterThanOrEqual(OFFICE.z - 1);
    expect(g.S).toBeLessThanOrEqual(OFFICE.z + OFFICE.d + 1);
    expect(g.W).toBeGreaterThanOrEqual(OFFICE.x - 1);
    expect(g.E).toBeLessThanOrEqual(OFFICE.x + OFFICE.w + 1);
  });
});
