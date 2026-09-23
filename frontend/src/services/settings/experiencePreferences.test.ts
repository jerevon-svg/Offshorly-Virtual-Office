// The store the 3D world reads. The tests that matter are the ones about a payload nobody's UI could
// have written — that is the whole reason sanitize() exists — and about persistence surviving a reload.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPERIENCE,
  SENSITIVITY_RANGE,
  __resetExperiencePreferencesForTests,
  getExperiencePreferences,
  setExperiencePreference,
  subscribeExperience,
} from "./experiencePreferences";

const KEY = "vo:experience:v1";

beforeEach(() => {
  window.localStorage.clear();
  __resetExperiencePreferencesForTests();
});

describe("defaults", () => {
  it("opens in the office, at the authored look feel, with everything shown", () => {
    expect(getExperiencePreferences()).toEqual(DEFAULT_EXPERIENCE);
    expect(DEFAULT_EXPERIENCE.defaultView).toBe("office");
    expect(DEFAULT_EXPERIENCE.lookSensitivity).toBe(1);
    expect(DEFAULT_EXPERIENCE.nameplates).toBe(true);
  });
});

describe("writing", () => {
  it("persists, notifies, and hands back a new object only when something changed", () => {
    let notified = 0;
    const off = subscribeExperience(() => { notified += 1; });
    const before = getExperiencePreferences();

    setExperiencePreference("invertLook", true);
    expect(notified).toBe(1);
    expect(getExperiencePreferences().invertLook).toBe(true);
    expect(getExperiencePreferences()).not.toBe(before);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).invertLook).toBe(true);

    // A write of the value already held is not a change, so nothing is notified and nothing re-renders.
    const after = getExperiencePreferences();
    setExperiencePreference("invertLook", true);
    expect(notified).toBe(1);
    expect(getExperiencePreferences()).toBe(after);
    off();
  });

  it("clamps sensitivity and volume to the range the sliders offer", () => {
    setExperiencePreference("lookSensitivity", 99);
    expect(getExperiencePreferences().lookSensitivity).toBe(SENSITIVITY_RANGE.max);
    setExperiencePreference("lookSensitivity", -4);
    expect(getExperiencePreferences().lookSensitivity).toBe(SENSITIVITY_RANGE.min);
    setExperiencePreference("ambientVolume", 5);
    expect(getExperiencePreferences().ambientVolume).toBe(1);
  });
});

describe("reading a payload this app did not write", () => {
  it("keeps the values it recognises and defaults the rest", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ defaultView: "sideways", nameplates: false, lookSensitivity: "fast", junk: 1 }),
    );
    // A fresh module instance is the only way to exercise the read-at-import path.
    vi.resetModules();
    const fresh = await import("./experiencePreferences");
    const prefs = fresh.getExperiencePreferences();
    expect(prefs.defaultView).toBe("office");
    expect(prefs.lookSensitivity).toBe(1);
    expect(prefs.nameplates).toBe(false);
    expect(prefs).not.toHaveProperty("junk");
  });
});
