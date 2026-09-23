import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  armAutoplay,
  getVolume,
  isMuted,
  setMuted,
  setVolume,
  subscribe,
} from "./backgroundMusic";

// jsdom has no real audio playback — stub the Audio constructor so
// getAudio()/armAutoplay()'s eventual .play() call resolves predictably
// instead of throwing "not implemented" from jsdom.
class FakeAudio {
  loop = false;
  volume = 1;
  muted = false;
  preload = "";
  play = vi.fn().mockResolvedValue(undefined);
  src?: string;
  constructor(src?: string) {
    this.src = src;
  }
}

beforeEach(() => {
  window.localStorage.clear();
  __testing.reset();
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("armAutoplay", () => {
  it("second call is a no-op (StrictMode double-invoke safe)", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    armAutoplay();
    const firstCallCount = addSpy.mock.calls.length;
    expect(() => armAutoplay()).not.toThrow();
    expect(addSpy.mock.calls.length).toBe(firstCallCount);
    addSpy.mockRestore();
  });
});

describe("setVolume", () => {
  it("clamps values above 1", () => {
    setVolume(1.5);
    expect(getVolume()).toBe(1);
  });

  it("clamps values below 0", () => {
    setVolume(-0.5);
    expect(getVolume()).toBe(0);
  });

  it("persists to localStorage under the documented key", () => {
    setVolume(0.42);
    expect(window.localStorage.getItem("vo:bgm:volume")).toBe("0.42");
  });

  it("value set is read back correctly", () => {
    setVolume(0.73);
    expect(getVolume()).toBe(0.73);
  });

  it("above 0 un-mutes", () => {
    setMuted(true);
    setVolume(0.5);
    expect(isMuted()).toBe(false);
  });
});

describe("setMuted", () => {
  it("persists to localStorage under the documented key", () => {
    setMuted(true);
    expect(window.localStorage.getItem("vo:bgm:muted")).toBe("true");
    expect(isMuted()).toBe(true);

    setMuted(false);
    expect(window.localStorage.getItem("vo:bgm:muted")).toBe("false");
    expect(isMuted()).toBe(false);
  });
});

describe("subscribe", () => {
  it("fires callbacks when setVolume is called", () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    setVolume(0.3);
    expect(cb).toHaveBeenCalled();
    unsubscribe();
  });

  it("fires callbacks when setMuted is called", () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    setMuted(true);
    expect(cb).toHaveBeenCalled();
    unsubscribe();
  });

  it("stops firing after unsubscribe", () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    unsubscribe();
    setVolume(0.6);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---- PHASE 7C — THE CONTROL ACTUALLY REACHES THE PLAYING ELEMENT ----------------------------------
// Everything above tests the STORE. What Settings -> Audio is judged on is whether moving its slider
// moves the sound, and whether turning it off is silence — which is a property of the element, not of
// the number. These are the assertions that were missing.
describe("the element the employee actually hears", () => {
  /** Start playback the way a real gesture does, and hand back the element the module is driving. */
  function play(): FakeAudio {
    armAutoplay();
    document.dispatchEvent(new Event("pointerdown"));
    const created = (globalThis as unknown as { Audio: typeof FakeAudio }).Audio;
    expect(created).toBe(FakeAudio);
    return __testing.element() as unknown as FakeAudio;
  }

  it("opens at the stored volume and mute, not at the element's defaults", () => {
    window.localStorage.setItem("vo:bgm:volume", "0.42");
    window.localStorage.setItem("vo:bgm:muted", "true");
    __testing.reset();
    setVolume(0.42);
    setMuted(true);
    const el = play();
    expect(el.volume).toBeCloseTo(0.42);
    expect(el.muted).toBe(true);
    expect(el.loop).toBe(true);
  });

  it("moves the sound the moment the slider moves", () => {
    const el = play();
    setVolume(0.8);
    expect(el.volume).toBeCloseTo(0.8);
    setVolume(0.1);
    expect(el.volume).toBeCloseTo(0.1);
  });

  it("is silent when switched off, and comes back at the volume it was left at", () => {
    const el = play();
    setVolume(0.65);
    setMuted(true);
    expect(el.muted).toBe(true);
    // The intended volume is NOT thrown away while it is off — that is what "restores" means.
    expect(getVolume()).toBeCloseTo(0.65);
    expect(el.volume).toBeCloseTo(0.65);
    setMuted(false);
    expect(el.muted).toBe(false);
    expect(el.volume).toBeCloseTo(0.65);
  });
});
