// THE CAVE IN PRESENTATION MODE — a live LiveKit screen share on the front panel.
//
// Three things are being defended, and they are not the same thing:
//
//   1. THE BOXING VIDEO IS UNTOUCHED. With no share in the room, every surface, material and uv in
//      the CAVE is bit-for-bit what it was: the panel is hidden and holds no map at all.
//   2. A SHARE IS NEVER STRETCHED AND NEVER MIRRORED. It lands on the flat 320 × 180 front chord,
//      fitted to its own aspect, and the 270° wings — whose uvs MIRROR the picture — never sample it.
//   3. THE LIFECYCLE LEAKS NOTHING. Attach only when there is both a share and a body inside; one
//      element and one texture per share; both gone on stop, on leaving, and on repeat.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildCave, setCavePresentation, attachCaveVideo } from "./build/cave";
import { CavePresentation, PANEL_ASPECT } from "./media/CavePresentation";
import { SCREEN, VIDEO_WIDTH, ORIGIN, ROOM } from "./rooms/cave";

/** A stand-in for a LiveKit video track: the attach/detach surface, and nothing else. */
function fakeTrack() {
  const attached: HTMLVideoElement[] = [];
  const detached: HTMLVideoElement[] = [];
  return {
    attached,
    detached,
    attach(el: HTMLVideoElement) { attached.push(el); return el; },
    detach(el: HTMLVideoElement) { detached.push(el); return el; },
  };
}

const panelOf = (b: ReturnType<typeof buildCave>) => b.presentation.mesh;
const panelMat = (b: ReturnType<typeof buildCave>) => b.presentation.material;

describe("the presentation panel", () => {
  it("is the flat 320 × 180 front chord, at the video's own true aspect", () => {
    const built = buildCave();
    const geo = panelOf(built).geometry as THREE.PlaneGeometry;

    // The room was measured so that 180 × 16/9 = 320 = the front chord. The panel IS that rectangle,
    // which is what makes a 16:9 share land on it with no fitting at all.
    expect(geo.parameters.width).toBe(VIDEO_WIDTH);
    expect(geo.parameters.height).toBe(SCREEN.height);
    expect(VIDEO_WIDTH / SCREEN.height).toBeCloseTo(PANEL_ASPECT, 6);
  });

  it("stands on the front chord, facing the room, clear of the ribbon", () => {
    const built = buildCave();
    const p = panelOf(built).position;

    expect(p.x).toBeCloseTo(ORIGIN.x + ROOM.w / 2, 6);
    expect(p.y).toBeCloseTo(SCREEN.bottom + SCREEN.height / 2, 6);
    // a hair south of the screen path's north run — in front of the ribbon, never inside it
    expect(p.z).toBeGreaterThan(ORIGIN.z + SCREEN.inset);
    expect(p.z - (ORIGIN.z + SCREEN.inset)).toBeLessThan(2);
    expect(panelOf(built).rotation.y).toBe(0); // a PlaneGeometry already faces +z, into the room
  });

  it("costs nothing until somebody shares: hidden, and holding no texture", () => {
    const built = buildCave();
    expect(panelOf(built).visible).toBe(false);
    expect(panelMat(built).map).toBeNull();
  });
});

describe("switching the CAVE into presentation mode", () => {
  const videoTex = () => new THREE.Texture();

  it("puts the share on the panel and drops the 270° wings to a dark surround", () => {
    const built = buildCave();
    const video = videoTex();
    attachCaveVideo(built, video);
    const share = videoTex();

    setCavePresentation(built, share, 16 / 9);

    expect(panelOf(built).visible).toBe(true);
    expect(panelMat(built).map).toBe(share);
    // THE WHOLE POINT: the wings' uvs mirror the picture round the curve, so they must not sample
    // a spreadsheet. The map is dropped entirely — a material still sampling the video would keep
    // the GPU uploading a frame nobody can see.
    for (const m of built.videoMaterials) {
      expect((m as THREE.MeshBasicMaterial).map).toBeNull();
      expect((m as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0xffffff);
    }
  });

  it("fits the share inside the panel instead of stretching it, either way round", () => {
    const built = buildCave();
    const share = videoTex();

    setCavePresentation(built, share, 16 / 9);
    expect(panelOf(built).scale.x).toBeCloseTo(1, 6);
    expect(panelOf(built).scale.y).toBeCloseTo(1, 6);

    // a 16:10 laptop — wider than tall relative to the panel? no: TALLER. pillar the width.
    setCavePresentation(built, share, 16 / 10);
    expect(panelOf(built).scale.y).toBeCloseTo(1, 6);
    expect(panelOf(built).scale.x).toBeCloseTo((16 / 10) / PANEL_ASPECT, 6);
    // …and the picture's own aspect is preserved exactly: width/height on the wall == source aspect
    const w = VIDEO_WIDTH * panelOf(built).scale.x;
    const h = SCREEN.height * panelOf(built).scale.y;
    expect(w / h).toBeCloseTo(16 / 10, 6);

    // an ultrawide share — letterbox the height
    setCavePresentation(built, share, 21 / 9);
    expect(panelOf(built).scale.x).toBeCloseTo(1, 6);
    expect((VIDEO_WIDTH * 1) / (SCREEN.height * panelOf(built).scale.y)).toBeCloseTo(21 / 9, 6);
  });

  it("survives a nonsense aspect rather than collapsing the panel", () => {
    const built = buildCave();
    setCavePresentation(built, videoTex(), 0);
    expect(panelOf(built).scale.x).toBe(1);
    expect(panelOf(built).scale.y).toBe(1);
  });

  it("restores the boxing video exactly, with the panel blank again", () => {
    const built = buildCave();
    const video = videoTex();
    attachCaveVideo(built, video);
    setCavePresentation(built, videoTex(), 4 / 3);

    setCavePresentation(built, null);
    attachCaveVideo(built, video); // what bootstrap's applyCaveMode does on the way back

    expect(panelOf(built).visible).toBe(false);
    expect(panelMat(built).map).toBeNull();
    for (const m of built.videoMaterials) {
      expect((m as THREE.MeshBasicMaterial).map).toBe(video);
      expect((m as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    }
  });

  it("repeats without drift: share, stop, share again", () => {
    const built = buildCave();
    const video = videoTex();
    attachCaveVideo(built, video);
    for (let i = 0; i < 3; i++) {
      const share = videoTex();
      setCavePresentation(built, share, 16 / 9);
      expect(panelMat(built).map).toBe(share);
      setCavePresentation(built, null);
      attachCaveVideo(built, video);
      expect(panelMat(built).map).toBeNull();
      expect((built.videoMaterials[0] as THREE.MeshBasicMaterial).map).toBe(video);
    }
  });
});

describe("the presentation adapter (the LiveKit → three.js seam)", () => {
  // Each of these builds its own adapter; the jsdom document is shared, so the hidden elements of
  // an earlier test would otherwise be counted by a later one.
  beforeEach(() => { document.body.innerHTML = ""; });

  it("does nothing at all until it has BOTH a share and a body in the CAVE", () => {
    const p = new CavePresentation();
    const track = fakeTrack();

    p.setSource(track, "b@example.com");
    expect(p.texture).toBeNull();
    expect(track.attached).toHaveLength(0);
    expect(p.state.status).toBe("waiting");

    p.setActive(true);
    expect(p.texture).not.toBeNull();
    expect(track.attached).toHaveLength(1);
    expect(p.state.status).toBe("live");
  });

  it("never unmutes its element — the call's audio is played once, elsewhere", () => {
    const p = new CavePresentation();
    p.setSource(fakeTrack(), "b@example.com");
    p.setActive(true);

    expect(p.element!.muted).toBe(true);
    expect(p.element!.autoplay).toBe(true);
    expect(p.element!.playsInline).toBe(true);
  });

  it("creates exactly ONE element and ONE texture per share", () => {
    const p = new CavePresentation();
    const track = fakeTrack();
    p.setActive(true);
    p.setSource(track, "b");
    const tex = p.texture;

    p.setSource(track, "b"); // the same track arriving again (a re-notify) changes nothing
    p.setActive(true);

    expect(p.texture).toBe(tex);
    expect(track.attached).toHaveLength(1);
    expect(document.querySelectorAll("video[data-cave-screen-share]")).toHaveLength(1);
  });

  it("detaches and disposes on stop — no element, no texture, no leak", () => {
    const p = new CavePresentation();
    const track = fakeTrack();
    p.setActive(true);
    p.setSource(track, "b");
    const tex = p.texture!;
    const dispose = vi.spyOn(tex, "dispose");

    p.setSource(null); // the presenter pressed Stop sharing

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(p.texture).toBeNull();
    expect(p.element).toBeNull();
    // ALWAYS detached with its own element: a bare detach() would rip the call overlay's tile off
    // the same track.
    expect(track.detached).toHaveLength(1);
    expect(document.querySelectorAll("video[data-cave-screen-share]")).toHaveLength(0);
    expect(p.state.status).toBe("off");
  });

  it("frees the texture on leaving the CAVE but keeps the subscription, and re-attaches on return", () => {
    const p = new CavePresentation();
    const track = fakeTrack();
    p.setSource(track, "b");
    p.setActive(true);

    p.setActive(false); // walked out while the share is still running
    expect(p.texture).toBeNull();
    expect(p.state.status).toBe("waiting"); // the SOURCE is remembered — nothing unsubscribed
    expect(track.detached).toHaveLength(1);

    p.setActive(true); // walked back in
    expect(p.texture).not.toBeNull();
    expect(track.attached).toHaveLength(2);
  });

  it("swaps cleanly when a presenter replaces their track, or another presenter takes over", () => {
    const p = new CavePresentation();
    const first = fakeTrack();
    const second = fakeTrack();
    p.setActive(true);
    p.setSource(first, "b");
    const firstTex = p.texture;

    p.setSource(second, "c");

    expect(first.detached).toHaveLength(1);
    expect(second.attached).toHaveLength(1);
    expect(p.texture).not.toBe(firstTex);
    expect(p.state.presenter).toBe("c");
    expect(document.querySelectorAll("video[data-cave-screen-share]")).toHaveLength(1);
  });

  it("repeats — share / stop / share — without leaving anything behind", () => {
    const p = new CavePresentation();
    p.setActive(true);
    for (let i = 0; i < 4; i++) {
      p.setSource(fakeTrack(), "b");
      expect(document.querySelectorAll("video[data-cave-screen-share]")).toHaveLength(1);
      p.setSource(null);
      expect(document.querySelectorAll("video[data-cave-screen-share]")).toHaveLength(0);
    }
    expect(p.texture).toBeNull();
  });

  it("reports a change exactly once, so materials are touched only when something moved", () => {
    const p = new CavePresentation();
    p.setActive(true);
    p.setSource(fakeTrack(), "b");

    expect(p.consumeChange()).toBe(true);
    expect(p.consumeChange()).toBe(false);

    // a frame in which nothing about the source changed must not re-touch anything
    p.sample();
    expect(p.consumeChange()).toBe(false);
  });

  it("reports the STOP as a change too, so the CAVE actually goes back to its own video", () => {
    const p = new CavePresentation();
    p.setActive(true);
    p.setSource(fakeTrack(), "b");
    p.consumeChange();

    p.setSource(null); // presenter pressed Stop sharing

    // Without this the panel stayed up over a dead track and SUNTOUCAN never resumed.
    expect(p.consumeChange()).toBe(true);
    expect(p.consumeChange()).toBe(false);
  });

  it("reports leaving the CAVE as a change as well", () => {
    const p = new CavePresentation();
    p.setSource(fakeTrack(), "b");
    p.setActive(true);
    p.consumeChange();

    p.setActive(false);
    expect(p.consumeChange()).toBe(true);
  });

  it("refits when the source's shape changes mid-share (a presenter switching monitors)", () => {
    const p = new CavePresentation();
    p.setActive(true);
    p.setSource(fakeTrack(), "b");
    p.consumeChange();
    expect(p.aspect).toBeCloseTo(PANEL_ASPECT, 6); // the panel's own, until metadata lands

    Object.defineProperty(p.element!, "videoWidth", { value: 1440, configurable: true });
    Object.defineProperty(p.element!, "videoHeight", { value: 900, configurable: true });
    p.sample();

    expect(p.aspect).toBeCloseTo(1440 / 900, 6);
    expect(p.consumeChange()).toBe(true);
    p.sample(); // the same numbers on the next frame: nothing to do
    expect(p.consumeChange()).toBe(false);
  });
});
