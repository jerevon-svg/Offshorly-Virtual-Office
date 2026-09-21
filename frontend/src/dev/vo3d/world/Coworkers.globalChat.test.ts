// V1/V2 FINAL PARITY — GLOBAL CHAT ACTIVITY, at the body.
//
// The one thing the presence fact drives, in V1 and now in V2: a SEATED coworker who has a visible,
// non-minimized Global Chat window open plays `sitting-answering` instead of the folded-arms sit
// (render3d/characterAnimationState.ts's isGlobalChatActive branch). Everything else about the body —
// walking, the seat pose, the facing — is untouched, because V1's own resolver puts walking and sitting
// ahead of this and never lets it reach a STANDING body at all.
//
// Asserted against the real Coworkers module with the same GLB/loader stub the seating tests use, so
// what is measured is the clip the mixer was actually asked for, not a flag.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers, type SeatAnchorPose } from "./Coworkers";
import { CLIP_IDLE, CLIP_SIT, CLIP_SIT_ANSWER, CLIP_WALK } from "../adapters/v1Avatar";
import type { Vo3dCoworker } from "../app/coworkers";

/** What a shipped package carries. The "legacy" case below re-stubs this without the answering clip. */
let packagedClips = [CLIP_IDLE, CLIP_SIT, CLIP_SIT_ANSWER, CLIP_WALK];
vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) =>
    Promise.resolve({
      id, gltf: {} as never, scene: new THREE.Group(),
      clips: packagedClips.map((name) => new THREE.AnimationClip(name, 1, [])),
      triangles: 100, headY: 36,
    }),
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

const ALEX = "alex@offshorly.com";
const SEAT = "dev-room/bay-chair-n1";
const BOX = { width: 26, height: 37 };

let cw: Coworkers;
let parent: THREE.Group;
const anchor: SeatAnchorPose = { contact: new THREE.Vector3(300, 15, 300), yaw: 0, kind: "seat" };

const rosterRow = (seat: string | null): Vo3dCoworker => ({
  email: ALEX, displayName: "Alex", avatarId: "alex", point: { x: 300, z: 300 }, box: BOX,
  posSource: "desk", facing: "south", ...(seat ? { seat } : {}),
}) as Vo3dCoworker;

const clipOf = () => cw.positions()[0]?.clip;

beforeEach(() => {
  packagedClips = [CLIP_IDLE, CLIP_SIT, CLIP_SIT_ANSWER, CLIP_WALK];
  parent = new THREE.Group();
  cw = new Coworkers({
    parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1,
    seatAnchor: (id) => (id === SEAT ? anchor : null),
    releaseSeat: () => {},
  });
});

describe("a seated peer with an open Global Chat window", () => {
  it("swaps the sit for the answering loop, and swaps back when the window closes", async () => {
    await cw.sync([rosterRow(SEAT)]);
    expect(clipOf()).toBe(CLIP_SIT);

    cw.setGlobalChatActive(new Set([ALEX]));
    expect(clipOf()).toBe(CLIP_SIT_ANSWER);

    cw.setGlobalChatActive(new Set());
    expect(clipOf()).toBe(CLIP_SIT);
  });

  it("leaves a STANDING peer idling — standing plus Global Chat is an ordinary idle in V1 too", async () => {
    await cw.sync([rosterRow(null)]);
    expect(clipOf()).toBe(CLIP_IDLE);

    cw.setGlobalChatActive(new Set([ALEX]));
    expect(clipOf()).toBe(CLIP_IDLE);
  });

  it("applies it the moment that standing peer sits down, without being told again", async () => {
    await cw.sync([rosterRow(null)]);
    cw.setGlobalChatActive(new Set([ALEX]));
    expect(clipOf()).toBe(CLIP_IDLE);

    await cw.sync([rosterRow(SEAT)]);
    expect(clipOf()).toBe(CLIP_SIT_ANSWER);
  });

  it("creates a body that is ALREADY seated and already answering in the right clip", async () => {
    // The first sync of a session finds most people wherever V1 last saw them, chairs included — and the
    // presence snapshot may well have arrived first.
    cw.setGlobalChatActive(new Set([ALEX]));
    await cw.sync([rosterRow(SEAT)]);
    expect(clipOf()).toBe(CLIP_SIT_ANSWER);
  });

  it("touches nobody the snapshot does not name", async () => {
    await cw.sync([rosterRow(SEAT)]);
    cw.setGlobalChatActive(new Set(["someone-else@offshorly.com"]));
    expect(clipOf()).toBe(CLIP_SIT);
  });

  it("falls back to the ordinary sit for a package that predates the clip, rather than freezing", async () => {
    packagedClips = [CLIP_IDLE, CLIP_SIT, CLIP_WALK];
    await cw.sync([rosterRow(SEAT)]);
    cw.setGlobalChatActive(new Set([ALEX]));
    expect(clipOf()).toBe(CLIP_SIT);
  });
});
