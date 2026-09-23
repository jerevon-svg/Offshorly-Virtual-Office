// SETTINGS -> ENVIRONMENT, the store. What is asserted here is the CONTRACT the 3D world and the
// Settings panel both depend on: AUTO is the default, the two axes never move each other, a choice
// outlives the page, a stale or hand-edited payload falls back to AUTO rather than somewhere no
// control could have taken it, and the record belongs to the employee rather than the browser.
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = (viewer: string) => `vo:environment:v1:${viewer}`;

/** A fresh module instance, because the store reads localStorage once at import and then caches — this
 *  IS the reload under test. The identity store is pulled from the same fresh registry, so the two are
 *  the pair the running app has rather than two unrelated copies. */
async function freshStore() {
  vi.resetModules();
  const auth = await import("../../auth/currentUserStore");
  const store = await import("./environmentPreferences");
  const signIn = (email: string) =>
    auth.setCurrentUserFromMeResponse({ id: "u", email, full_name: "", role: "" });
  return Object.assign(store, { signIn });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("environment preferences", () => {
  it("defaults BOTH axes to Auto when nothing has ever been saved", async () => {
    const store = await freshStore();
    expect(store.getEnvironmentPreferences()).toEqual({ time: "auto", weather: "auto" });
  });

  it("writes each axis independently — a time choice never moves the weather", async () => {
    const store = await freshStore();
    store.setEnvironmentPreference("time", "sunset");
    expect(store.getEnvironmentPreferences()).toEqual({ time: "sunset", weather: "auto" });

    store.setEnvironmentPreference("weather", "rain");
    expect(store.getEnvironmentPreferences()).toEqual({ time: "sunset", weather: "rain" });

    // …and the reverse pairing, which is the one a "manual weather over the real clock" employee wants.
    store.setEnvironmentPreference("time", "auto");
    expect(store.getEnvironmentPreferences()).toEqual({ time: "auto", weather: "rain" });
  });

  it("survives a reload — a fresh module instance reads the same choice back", async () => {
    const first = await freshStore();
    first.setEnvironmentPreference("time", "night");
    first.setEnvironmentPreference("weather", "thunderstorm");

    const reloaded = await freshStore();
    expect(reloaded.getEnvironmentPreferences()).toEqual({ time: "night", weather: "thunderstorm" });
  });

  it("restoring Auto is itself persisted — it is a choice, not the absence of one", async () => {
    const first = await freshStore();
    first.setEnvironmentPreference("time", "day");
    first.setEnvironmentPreference("time", "auto");

    const reloaded = await freshStore();
    expect(reloaded.getEnvironmentPreferences().time).toBe("auto");
  });

  it("notifies subscribers on a real change only", async () => {
    const store = await freshStore();
    const seen = vi.fn();
    const stop = store.subscribeEnvironmentPreferences(seen);

    store.setEnvironmentPreference("weather", "cloudy");
    expect(seen).toHaveBeenCalledTimes(1);
    store.setEnvironmentPreference("weather", "cloudy"); // same value — nothing moved
    expect(seen).toHaveBeenCalledTimes(1);

    stop();
    store.setEnvironmentPreference("weather", "clear");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['{"time":"eclipse","weather":"rain"}', { time: "auto", weather: "rain" }],
    ['{"time":"night","weather":"snow"}', { time: "night", weather: "auto" }],
    ['{"time":42,"weather":null}', { time: "auto", weather: "auto" }],
    ["not json at all", { time: "auto", weather: "auto" }],
    ["null", { time: "auto", weather: "auto" }],
    ["[]", { time: "auto", weather: "auto" }],
  ])("falls back to Auto for a missing, invalid or obsolete saved value (%s)", async (stored, expected) => {
    window.localStorage.setItem(KEY("anon"), stored);
    const store = await freshStore();
    expect(store.getEnvironmentPreferences()).toEqual(expected);
  });

  it("keeps one record per employee — the next person on this browser gets their own", async () => {
    const store = await freshStore();
    store.signIn("bon@offshorly.com");
    store.setEnvironmentPreference("time", "night");

    store.signIn("alex@offshorly.com");
    expect(store.getEnvironmentPreferences()).toEqual({ time: "auto", weather: "auto" });
    store.setEnvironmentPreference("weather", "heavy_rain");

    store.signIn("bon@offshorly.com");
    expect(store.getEnvironmentPreferences()).toEqual({ time: "night", weather: "auto" });
  });

  it("picks the employee up when /auth/me lands after the store was imported", async () => {
    window.localStorage.setItem(KEY("bon@offshorly.com"), '{"time":"sunset","weather":"auto"}');
    const store = await freshStore(); // imported while nobody is signed in yet
    expect(store.getEnvironmentPreferences().time).toBe("auto");

    const seen = vi.fn();
    store.subscribeEnvironmentPreferences(seen);
    store.signIn("Bon@Offshorly.com"); // the gate's response, in whatever case Atlas sends it
    expect(seen).toHaveBeenCalled();
    expect(store.getEnvironmentPreferences().time).toBe("sunset");
  });

  it("keeps working, in memory, when storage is unavailable", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private browsing");
    });
    try {
      const store = await freshStore();
      store.setEnvironmentPreference("time", "day");
      expect(store.getEnvironmentPreferences().time).toBe("day");
    } finally {
      setItem.mockRestore();
    }
  });

  it("never reaches the Company Hub's WeatherAPI forecast — it makes no request at all", async () => {
    // The Hub slide (services/weather/forecastClient) is informational. Nothing in this store may
    // consult it, and the cheapest proof that it does not is that this store never goes to the network
    // for anything: AUTO means "let the world's own provider decide", not "go and ask WeatherAPI".
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network here"));
    try {
      const store = await freshStore();
      store.setEnvironmentPreference("weather", "auto");
      store.setEnvironmentPreference("time", "sunset");
      expect(store.getEnvironmentPreferences()).toEqual({ time: "sunset", weather: "auto" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
