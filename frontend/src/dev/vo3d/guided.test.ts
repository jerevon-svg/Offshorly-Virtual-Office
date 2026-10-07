import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { PlayerMode } from "./player/PlayerMode";
import { WorldState } from "./world/WorldState";

// GUIDED TRAVEL (Go Together, Phase 1): the system walks the body while PLAYER stays on screen and keeps
// its camera. The stack's Guided base outranks Player, is what an Interaction falls back to, and the walker
// drives under it without taking the body.

describe("ControllerStack — the Guided base", () => {
  it("takes the body from Player and from a routed walk, and is outranked by Interaction", () => {
    const stack = new ControllerStack();
    stack.acquire("Player");
    stack.setBase("Guided");
    expect(stack.owner).toBe("Guided");
    expect(stack.acquire("Player")).toBe(false);
    expect(stack.acquire("Navigation")).toBe(false);
    expect(stack.acquire("Interaction")).toBe(true);
  });

  it("an Interaction mid-journey (the lift, a seat) falls back to Guided, not Idle", () => {
    const stack = new ControllerStack();
    stack.setBase("Guided");
    stack.acquire("Interaction");
    stack.release("Interaction");
    expect(stack.owner).toBe("Guided");
    stack.release("Guided"); // only setBase ends a journey
    expect(stack.owner).toBe("Guided");
  });

  it("ending the journey hands a held body back to Idle and leaves an Interaction alone", () => {
    const stack = new ControllerStack();
    stack.setBase("Guided");
    stack.setBase("Idle");
    expect(stack.owner).toBe("Idle");
    stack.setBase("Guided");
    stack.acquire("Interaction");
    stack.setBase("Idle");
    expect(stack.owner).toBe("Interaction");
    stack.release("Interaction");
    expect(stack.owner).toBe("Idle");
  });
});

describe("NavigationController under Guided", () => {
  it("walks without taking the body, stands at the end, and keeps Guided", () => {
    const av = new Avatar({ height: 36, lit: true });
    const stack = new ControllerStack();
    const nav = new NavigationController(av, stack);
    stack.acquire("Player");
    stack.setBase("Guided");
    expect(nav.setPath([{ x: 0, z: 0 }, { x: 10, z: 0 }])).toBe(true);
    for (let i = 0; i < 60 && nav.moving; i++) nav.update(0.05);
    expect(nav.moving).toBe(false);
    expect(av.position.x).toBeCloseTo(10);
    expect(stack.owner).toBe("Guided");
  });

  it("is still refused while an Interaction holds the body mid-journey", () => {
    const av = new Avatar({ height: 36, lit: true });
    const stack = new ControllerStack();
    const nav = new NavigationController(av, stack);
    stack.setBase("Guided");
    stack.acquire("Interaction");
    expect(nav.setPath([{ x: 5, z: 0 }])).toBe(false);
  });
});

function player(stack: ControllerStack, guided: () => boolean) {
  const av = new Avatar({ height: 36, lit: true });
  const yieldAvatar = vi.fn();
  const activate = vi.fn(() => true);
  const pm = new PlayerMode({
    avatar: av, stack, world: new WorldState(), canStand: () => true, cameraProbe: () => true,
    camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
    radius: 8, avatarHeight: 36, speed: () => 70, activate, canStandUp: () => false, standUp: () => {},
    yieldAvatar, guided, freeLook: guided,
  });
  return { av, pm, yieldAvatar, activate };
}

describe("PlayerMode during a guided journey", () => {
  it("enters without yielding the walk or taking the body", () => {
    const stack = new ControllerStack();
    stack.setBase("Guided");
    const { pm, yieldAvatar } = player(stack, () => stack.guided);
    expect(pm.enter()).toBe(true);
    expect(yieldAvatar).not.toHaveBeenCalled();
    expect(stack.owner).toBe("Guided");
    pm.dispose();
  });

  it("the mouse still turns the camera and the camera stays on the walked body", () => {
    const stack = new ControllerStack();
    const { av, pm } = player(stack, () => stack.guided);
    pm.enter();
    stack.setBase("Guided");
    const yaw = pm.camera.yaw;
    (pm as unknown as { input: { dx: number; dy: number } }).input.dx = 200;
    av.setPosition({ x: 40, z: 12 });
    const at = pm.update(1 / 60);
    expect(pm.camera.yaw).not.toBeCloseTo(yaw);
    expect(at).toEqual({ x: 40, z: 12 });
    expect(stack.owner).toBe("Guided");
    pm.dispose();
  });

  it("gets the body back on the first frame after the journey ends", () => {
    const stack = new ControllerStack();
    const { pm } = player(stack, () => stack.guided);
    pm.enter();
    stack.setBase("Guided");
    pm.update(1 / 60);
    stack.setBase("Idle");
    pm.update(1 / 60);
    expect(stack.owner).toBe("Player");
    pm.dispose();
  });
});
