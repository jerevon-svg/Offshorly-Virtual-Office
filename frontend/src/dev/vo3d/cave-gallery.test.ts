// THE 270° MEETING GALLERY — layout arithmetic and media lifecycle.
//
// Two things are defended:
//   1. NOBODY IS STRETCHED. Every tile's drawn width/height equals its own source aspect, on a
//      wrap that is 3.4:1 overall — which is exactly the trap a naive "fill the wall" layout falls
//      into. A share keeps the flat front chord to itself and the faces move to the wings.
//   2. THE MEDIA LIFECYCLE LEAKS NOTHING. One element and one texture per live camera, gone on
//      camera-off, leave, CAVE exit and dispose; bounded when a company turns up.
import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildCave, samplePath, frontChordRange } from "./build/cave";
import { CaveGallery, galleryLayout, shortName, MAX_TILES, TILE_BAND } from "./media/CaveGallery";
import { SCREEN } from "./rooms/cave";

const samples = samplePath();
const front = frontChordRange(samples);
const OPTS = (mode: "full" | "wings") => ({ total: front.total, front, mode });

function fakeCamera(identity: string) {
  const attached: HTMLVideoElement[] = [];
  const detached: HTMLVideoElement[] = [];
  return {
    identity,
    attached,
    detached,
    track: {
      attach(el: HTMLVideoElement) { attached.push(el); return el; },
      detach(el: HTMLVideoElement) { detached.push(el); return el; },
    },
  };
}
const cams = (...names: string[]) => names.map((n) => { const c = fakeCamera(n); return { identity: c.identity, track: c.track }; });
const els = () => document.querySelectorAll("video[data-cave-camera]");

describe("the gallery layout", () => {
  it("draws nothing when nobody has a camera on", () => {
    expect(galleryLayout([], OPTS("full"))).toEqual([]);
    expect(galleryLayout([16 / 9], { ...OPTS("full"), mode: "off" })).toEqual([]);
  });

  it("never stretches a tile: drawn width ÷ height IS the source's own aspect", () => {
    for (const count of [2, 3, 4, 6, 9, 12]) {
      const aspects = Array.from({ length: count }, (_, i) => [16 / 9, 4 / 3, 16 / 10][i % 3]);
      const slots = galleryLayout(aspects, OPTS("full"));
      expect(slots).toHaveLength(count);
      slots.forEach((slot, i) => {
        expect((slot.s1 - slot.s0) / slot.height).toBeCloseTo(aspects[i], 5);
        expect(slot.height).toBeLessThanOrEqual(TILE_BAND);
      });
    }
  });

  it("gives 2–4 people big cinematic tiles and reflows smaller as more arrive", () => {
    const h = (n: number) => galleryLayout(Array(n).fill(16 / 9), OPTS("full"))[0].height;
    expect(h(2)).toBe(TILE_BAND);          // the full image band, across the chord and the corners
    expect(h(4)).toBeGreaterThan(TILE_BAND * 0.6);
    expect(h(8)).toBeLessThan(h(4));       // reflow, not overlap
    expect(h(12)).toBeLessThan(h(8));
    expect(h(12)).toBeGreaterThan(20);     // still a face, not a smear
  });

  it("keeps tiles inside the ribbon and never overlapping, at every size", () => {
    for (const count of [2, 5, 8, 12]) {
      const slots = galleryLayout(Array(count).fill(16 / 9), OPTS("full"));
      const ordered = [...slots].sort((a, b) => a.s0 - b.s0);
      expect(ordered[0].s0).toBeGreaterThanOrEqual(0);
      expect(ordered[ordered.length - 1].s1).toBeLessThanOrEqual(front.total + 1e-6);
      for (let i = 1; i < ordered.length; i++) expect(ordered[i].s0).toBeGreaterThanOrEqual(ordered[i - 1].s1 - 1e-6);
      for (const s of slots) {
        expect(s.y).toBeGreaterThanOrEqual(SCREEN.bottom);
        expect(s.y + s.height).toBeLessThanOrEqual(SCREEN.bottom + SCREEN.height + 1e-6);
      }
    }
  });

  it("with a share up, the FLAT FRONT CHORD is left alone and faces go to the wings", () => {
    const slots = galleryLayout(Array(4).fill(16 / 9), OPTS("wings"));
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      // Nothing may overlap the presentation panel's chord — that is where the slides are.
      expect(s.s1 <= front.s0 + 1e-6 || s.s0 >= front.s1 - 1e-6).toBe(true);
      // …and the wings stay supporting cast rather than competing with the content.
      expect(s.height).toBeLessThanOrEqual(TILE_BAND * 0.5 + 1e-6);
    }
    // evenly split between left and right
    expect(slots.filter((s) => s.s1 <= front.s0 + 1e-6)).toHaveLength(2);
  });

  it("centres the row on the front chord so two people face you, not the corner", () => {
    const slots = galleryLayout(Array(2).fill(16 / 9), OPTS("full"));
    const mid = (slots[0].s0 + slots[slots.length - 1].s1) / 2;
    expect(mid).toBeCloseTo(front.total / 2, 3);
  });
});

describe("the gallery's media lifecycle", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("creates nothing until somebody is inside the CAVE with a camera on", () => {
    const g = new CaveGallery(buildCave());
    g.setMode("full");
    g.setCameras(cams("a@x.com", "b@x.com"));

    expect(els()).toHaveLength(0);
    g.setActive(true);
    expect(els()).toHaveLength(2);
    g.dispose();
  });

  it("holds ONE muted element and ONE texture per live camera", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(cams("a@x.com", "b@x.com", "c@x.com"));

    const list = document.querySelectorAll<HTMLVideoElement>("video[data-cave-camera]");
    expect(list).toHaveLength(3);
    for (const el of list) expect(el.muted).toBe(true); // the meeting's audio is played once, elsewhere
    expect(g.state.drawn).toBe(3);
    g.dispose();
  });

  it("exposes a single camera as SOLO and draws no tile for it", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(cams("a@x.com"));

    // The solo speaker is shown by the front panel + the ambient wrap, not by a tile.
    expect(g.solo).not.toBeNull();
    expect(g.state.drawn).toBe(0);
    expect(els()).toHaveLength(1); // …but its element/texture exist, because the panel samples them

    g.setCameras(cams("a@x.com", "b@x.com"));
    expect(g.solo).toBeNull();
    expect(g.state.drawn).toBe(2);
    g.dispose();
  });

  it("reflows on camera-off and leave, releasing that participant's element", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    const three = cams("a@x.com", "b@x.com", "c@x.com");
    g.setCameras(three);
    expect(els()).toHaveLength(3);

    g.setCameras([three[0], three[2]]); // b turned their camera off (the store drops them)
    expect(els()).toHaveLength(2);
    expect(g.state.drawn).toBe(2);

    g.setCameras([three[0]]); // c left the meeting entirely
    expect(els()).toHaveLength(1);
    expect(g.state.drawn).toBe(0); // …and one camera is the solo view again
    g.dispose();
  });

  it("re-attaches to the NEW track when somebody turns their camera off and on again", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    const first = fakeCamera("a@x.com");
    const second = fakeCamera("a@x.com"); // same person, new publication
    g.setCameras([{ identity: "a@x.com", track: first.track }, ...cams("b@x.com")]);
    g.setCameras([{ identity: "a@x.com", track: second.track }, ...cams("b@x.com")]);

    expect(first.detached).toHaveLength(1);
    expect(second.attached).toHaveLength(1);
    g.dispose();
  });

  it("frees everything on leaving the CAVE and rebuilds on return", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(cams("a@x.com", "b@x.com"));
    expect(els()).toHaveLength(2);

    g.setActive(false); // walked out: no decode for a room nobody is in
    expect(els()).toHaveLength(0);
    expect(g.count).toBe(2); // the meeting is untouched — nothing was unsubscribed

    g.setActive(true);
    expect(els()).toHaveLength(2);
    g.dispose();
  });

  it("bounds what it decodes when a company turns up", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(cams(...Array.from({ length: 40 }, (_, i) => `p${i}@x.com`)));

    // 40 people in the meeting, a bounded stage on the wall: the rest cost no decode and no upload.
    expect(g.state.cameras).toBe(40);
    expect(g.state.drawn).toBe(MAX_TILES);
    expect(els()).toHaveLength(MAX_TILES);
    expect(g.state.hidden).toBe(40 - MAX_TILES);
    g.dispose();
  });

  it("repeats — on, off, on — leaking no element, texture or tile", () => {
    const build = buildCave();
    const g = new CaveGallery(build);
    g.setActive(true);
    g.setMode("full");
    const meshCount = () => { let n = 0; build.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };

    g.setCameras(cams("a@x.com", "b@x.com", "c@x.com"));
    const withTiles = meshCount();
    for (let i = 0; i < 4; i++) {
      g.setCameras([]);
      expect(els()).toHaveLength(0);
      g.setCameras(cams("a@x.com", "b@x.com", "c@x.com"));
      expect(els()).toHaveLength(3);
      expect(meshCount()).toBe(withTiles); // tile meshes are POOLED, never re-created
    }

    g.dispose();
    expect(els()).toHaveLength(0);
  });

  it("does nothing at all when told the same camera list twice", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    const list = cams("a@x.com", "b@x.com");
    g.setCameras(list);
    g.consumeChange();

    g.setCameras([...list]); // a fresh array, identical contents

    expect(g.consumeChange()).toBe(false);
    g.dispose();
  });

  it("labels a participant by the readable half of the one identity the store has", () => {
    expect(shortName("bon@offshorly.com")).toBe("bon");
    expect(shortName("jan.dela.cruz@offshorly.com")).toBe("jan dela cruz");
  });
});

// PHASE 7D — THE GALLERY IS THE ROOM, NOT THE CAMERAS.
//
// A meeting where nobody has turned a camera on is still a meeting, and the wall used to fall back to
// the boxing video while people sat in it talking. Membership drives the tiles now; a camera is a
// property of a member. These pin the four states the CAVE's screen has to tell apart.
describe("members without cameras", () => {
  /** Members as CaveLiveShare now builds them: everybody in the room, camera optional. */
  const members = (...names: string[]) => names.map((identity) => ({ identity }));

  it("draws a tile per member when every camera is off", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(members("a@x.com", "b@x.com", "c@x.com"));

    expect(g.count).toBe(3);
    expect(g.state.drawn).toBe(3);
    // And not one <video> element: a camera-off member costs a cached canvas, never a decode.
    expect(els().length).toBe(0);
  });

  it("counts members, so the CAVE shows a gallery rather than the boxing video", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(members("a@x.com"));
    // applyCaveMode keys the whole decision off this: > 0 means "there is a meeting to show".
    expect(g.count).toBeGreaterThan(0);
  });

  it("does not give a lone camera-off member the immersive speaker view", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(members("a@x.com"));
    // `solo` fills the whole room with one person's picture — there is no picture here.
    expect(g.solo).toBeNull();
    expect(g.state.drawn).toBe(1);
  });

  it("still gives a lone member WITH a camera the immersive view", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(cams("a@x.com"));
    expect(g.solo).not.toBeNull();
    g.dispose();
  });

  it("mixes cameras and portraits in one wall, and attaches only the real ones", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras([...cams("a@x.com"), ...members("b@x.com", "c@x.com")]);

    expect(g.count).toBe(3);
    expect(g.state.drawn).toBe(3);
    expect(els().length).toBe(1);
    g.dispose();
  });

  it("empties when the last participant leaves, which is what restores the boxing video", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras(members("a@x.com", "b@x.com"));
    expect(g.count).toBe(2);

    g.setCameras([]);

    expect(g.count).toBe(0);
    expect(g.state.drawn).toBe(0);
    expect(els().length).toBe(0);
  });

  it("names every member, camera on or off", () => {
    const g = new CaveGallery(buildCave());
    g.setActive(true);
    g.setMode("full");
    g.setCameras([...cams("angelo@x.com"), ...members("micah@x.com")]);
    expect(g.state.names).toContain(shortName("angelo@x.com"));
    expect(g.state.names).toContain(shortName("micah@x.com"));
    g.dispose();
  });
});
