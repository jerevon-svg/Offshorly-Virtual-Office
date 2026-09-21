// V1/V2 FINAL PARITY — GLOBAL CHAT ACTIVITY, on the SIGNED-IN EMPLOYEE'S OWN body.
//
// A peer's answering pose is pushed at the CoworkerBody (world/Coworkers.globalChat.test.ts). The
// viewer's own body has no such owner: it is driven by the seat interactions (interact/Seat,
// interact/LoungeSeat), each of which simply asks for CLIP_SIT. So the fact lives on the Avatar and is
// applied where the clip is chosen — which is what lets every seat, present and future, get the right
// pose without knowing this exists.
//
// What is pinned here is the RESOLUTION RULE, because getting it wrong is silent: a standing avatar that
// took the answering pose would read as a bug in the seating, and a sit that ignored the flag would read
// as the presence socket being down.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The clips the mocked GLB carries — re-pointed by the legacy-package case. */
let packagedClips = ["idle-9", "walking", "sit-on-chair-arms", "sitting-answering"];

vi.mock("three/examples/jsm/loaders/DRACOLoader.js", () => ({
  DRACOLoader: class { setDecoderPath(): void {} },
}));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setDRACOLoader(): void {}
    loadAsync() {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      return Promise.resolve({
        scene,
        animations: packagedClips.map((name) => new THREE.AnimationClip(name, 1, [])),
      });
    }
  },
}));

const { Avatar } = await import("./Avatar");
const { CLIP_IDLE, CLIP_SIT, CLIP_SIT_ANSWER } = await import("../adapters/v1Avatar");

async function loaded() {
  const a = new Avatar({ height: 36, lit: true });
  await a.load(1);
  return a;
}

beforeEach(() => {
  packagedClips = ["idle-9", "walking", "sit-on-chair-arms", "sitting-answering"];
});

describe("the viewer's own Global Chat pose", () => {
  it("turns a sit already in progress into the answering loop, and back again", async () => {
    const a = await loaded();
    a.play(CLIP_SIT, 0);
    expect(a.currentClip).toBe(CLIP_SIT);

    a.setGlobalChatActive(true);
    expect(a.currentClip).toBe(CLIP_SIT_ANSWER);

    a.setGlobalChatActive(false);
    expect(a.currentClip).toBe(CLIP_SIT);
  });

  it("answers a LATER sit too — the seat asks for CLIP_SIT and never learns about any of this", async () => {
    const a = await loaded();
    a.setGlobalChatActive(true);
    a.play(CLIP_IDLE, 0);
    expect(a.currentClip).toBe(CLIP_IDLE);

    a.play(CLIP_SIT, 0);
    expect(a.currentClip).toBe(CLIP_SIT_ANSWER);
  });

  it("leaves every other clip alone — standing plus Global Chat is an ordinary idle", async () => {
    const a = await loaded();
    a.setGlobalChatActive(true);
    a.play(CLIP_IDLE, 0);
    expect(a.currentClip).toBe(CLIP_IDLE);
    a.play("walking", 0);
    expect(a.currentClip).toBe("walking");
  });

  it("falls back to the ordinary sit on a package that predates the clip", async () => {
    packagedClips = ["idle-9", "walking", "sit-on-chair-arms"];
    const a = await loaded();
    a.setGlobalChatActive(true);
    a.play(CLIP_SIT, 0);
    expect(a.currentClip).toBe(CLIP_SIT);
  });
});
