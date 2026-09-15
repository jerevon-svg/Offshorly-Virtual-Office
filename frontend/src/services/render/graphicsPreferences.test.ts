// The persisted preference: what survives a reload, what is refused, and the one product rule that
// lives in the store rather than in the panel (touching a control means Custom).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODE,
  __resetGraphicsPreferenceForTests,
  getCustomGraphics,
  getGraphicsMode,
  resetCustomGraphics,
  setCustomGraphicsControl,
  setGraphicsMode,
  subscribeGraphics,
} from "./graphicsPreferences";

const KEY = "vo:graphics:v1";

beforeEach(() => {
  window.localStorage.clear();
  __resetGraphicsPreferenceForTests();
});

describe("defaults", () => {
  it("starts on Smooth — the mode that keeps an employee's machine playable", () => {
    expect(DEFAULT_MODE).toBe("smooth");
    expect(getGraphicsMode()).toBe("smooth");
    expect(getCustomGraphics()).toEqual({});
  });
});

describe("persistence", () => {
  it("survives a reload", () => {
    setGraphicsMode("full");
    __resetGraphicsPreferenceForTests(); // what a page load does
    expect(getGraphicsMode()).toBe("full");
  });

  it("carries custom overrides across a reload", () => {
    setCustomGraphicsControl("renderScale", 0.75);
    setCustomGraphicsControl("shadows", false);
    __resetGraphicsPreferenceForTests();
    expect(getGraphicsMode()).toBe("custom");
    expect(getCustomGraphics()).toEqual({ renderScale: 0.75, shadows: false });
  });

  it("falls back to the defaults on a corrupt payload rather than throwing", () => {
    window.localStorage.setItem(KEY, "{not json");
    __resetGraphicsPreferenceForTests();
    expect(getGraphicsMode()).toBe("smooth");
  });

  it("drops a stored value no control offers", () => {
    // A hand-edited or older-build payload must not be able to put the renderer somewhere no UI could.
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "custom", custom: { renderScale: 0.05, keyIntensity: 9 } }));
    __resetGraphicsPreferenceForTests();
    expect(getCustomGraphics()).toEqual({});
  });

  it("drops an unknown mode", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "ultra", custom: {} }));
    __resetGraphicsPreferenceForTests();
    expect(getGraphicsMode()).toBe("smooth");
  });

  it("keeps working when storage throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setGraphicsMode("full")).not.toThrow();
    expect(getGraphicsMode()).toBe("full"); // in memory for this session, just not beyond it
    setItem.mockRestore();
  });
});

describe("changing a single control", () => {
  it("switches the mode to Custom, from Smooth", () => {
    expect(getGraphicsMode()).toBe("smooth");
    setCustomGraphicsControl("shadows", false);
    expect(getGraphicsMode()).toBe("custom");
  });

  it("switches the mode to Custom, from Full", () => {
    setGraphicsMode("full");
    setCustomGraphicsControl("foliageSway", false);
    expect(getGraphicsMode()).toBe("custom");
  });

  it("refuses a value the control does not offer, and does not switch mode for it", () => {
    setCustomGraphicsControl("renderScale", 0.42);
    expect(getGraphicsMode()).toBe("smooth");
    expect(getCustomGraphics()).toEqual({});
  });

  it("resets back to the Full baseline without leaving Custom", () => {
    setCustomGraphicsControl("shadows", false);
    resetCustomGraphics();
    expect(getCustomGraphics()).toEqual({});
    expect(getGraphicsMode()).toBe("custom");
  });
});

describe("subscribers", () => {
  it("are notified on a mode change and on a control change, and unsubscribe cleanly", () => {
    const seen = vi.fn();
    const off = subscribeGraphics(seen);
    setGraphicsMode("full");
    setCustomGraphicsControl("shadows", false);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    setGraphicsMode("smooth");
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("are not notified when the mode is set to the one already in force", () => {
    const seen = vi.fn();
    const off = subscribeGraphics(seen);
    setGraphicsMode("smooth");
    expect(seen).not.toHaveBeenCalled();
    off();
  });
});
