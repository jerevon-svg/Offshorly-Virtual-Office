// PHASE 7C — Settings -> Controls, at the one place it can actually be observed: the camera's own look().
// Nothing else about PlayerCamera is exercised here; the boom, the collision probe and the smoothing are
// untouched by a preference and have their own coverage in the player suite.
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { LOOK_SENSITIVITY, PlayerCamera } from "./PlayerCamera";
import type { StandTest } from "./PlayerBody";
import {
  __resetExperiencePreferencesForTests,
  setExperiencePreference,
} from "../../../services/settings/experiencePreferences";

/** The camera's probe is only consulted while placing the boom, which look() never does. */
const probe = { canStand: () => true } as unknown as StandTest;

function makeCamera() {
  return new PlayerCamera(new THREE.PerspectiveCamera(), 37, probe);
}

beforeEach(() => {
  window.localStorage.clear();
  __resetExperiencePreferencesForTests();
});

describe("look sensitivity", () => {
  it("turns at the authored rate by default", () => {
    const cam = makeCamera();
    const pitch0 = cam.pitch;
    cam.look(100, 10);
    expect(cam.yaw).toBeCloseTo(100 * LOOK_SENSITIVITY, 6);
    expect(cam.pitch).toBeCloseTo(pitch0 - 10 * LOOK_SENSITIVITY, 6);
  });

  it("scales both axes by the employee's own multiplier", () => {
    setExperiencePreference("lookSensitivity", 2);
    const cam = makeCamera();
    cam.look(100, 0);
    expect(cam.yaw).toBeCloseTo(200 * LOOK_SENSITIVITY, 6);
  });

  it("takes effect on the very next mouse move, with no camera rebuild", () => {
    const cam = makeCamera();
    cam.look(100, 0);
    const afterFirst = cam.yaw;
    setExperiencePreference("lookSensitivity", 0.5);
    cam.look(100, 0);
    expect(cam.yaw - afterFirst).toBeCloseTo(50 * LOOK_SENSITIVITY, 6);
  });
});

describe("invert vertical look", () => {
  it("flips the pitch sign and leaves yaw alone", () => {
    setExperiencePreference("invertLook", true);
    const cam = makeCamera();
    const pitch0 = cam.pitch;
    cam.look(50, 10);
    expect(cam.pitch).toBeCloseTo(pitch0 + 10 * LOOK_SENSITIVITY, 6);
    expect(cam.yaw).toBeCloseTo(50 * LOOK_SENSITIVITY, 6);
  });

  it("still respects the per-view pitch clamp", () => {
    setExperiencePreference("invertLook", true);
    setExperiencePreference("lookSensitivity", 2.5);
    const cam = makeCamera();
    cam.look(0, 100000);
    // third-person's upper limit; an inverted axis must not be a way past it
    expect(cam.pitch).toBeCloseTo(1.05, 6);
  });
});
