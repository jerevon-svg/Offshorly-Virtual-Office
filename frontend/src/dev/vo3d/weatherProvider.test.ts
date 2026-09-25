import { afterEach, describe, expect, it, vi } from "vitest";
import { Weather, WEATHER_STATES, type WeatherState } from "./env/weather";
import { OfficeWeatherProvider, WEATHER_ATTRIBUTION, officeWeatherUrl } from "./env/providers/office";
import { ManualWeatherProvider } from "./env/providers/manual";

const URL = "http://backend.test/weather/office";

const ok = (body: unknown, status = 200) =>
  vi.fn(async (_url?: unknown, _init?: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const live = (body: unknown) => ({
  source: "weatherapi", state: "rain", intensity: 0.6, label: "Light rain",
  observed_at: 1_700_000_000_000, attribution: WEATHER_ATTRIBUTION, ...(body as object),
});

afterEach(() => { vi.unstubAllGlobals(); });

/** Drain the Weather poll's in-flight promise chain. */
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("vo3d weather — AUTO reads real weather through our own backend", () => {
  it("normalizes a live reading into an observation, and never sees a key or a provider code", async () => {
    const fetchMock = ok(live({}));
    vi.stubGlobal("fetch", fetchMock);
    const p = new OfficeWeatherProvider(URL);
    const obs = await p.read();

    expect(obs.state).toBe("rain");
    expect(obs.intensity).toBeCloseTo(0.6, 6);
    expect(obs.label).toBe("Light rain");
    expect(obs.observedAt).toBe(1_700_000_000_000);
    // it asked OUR backend, with no key and no WeatherAPI host anywhere in the request
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const called = String(fetchMock.mock.calls[0][0]);
    expect(called).toBe(URL);
    expect(called).not.toMatch(/weatherapi\.com/i);
    expect(called).not.toMatch(/key=/i);
  });

  it("carries the WeatherAPI attribution the terms require", async () => {
    vi.stubGlobal("fetch", ok(live({ attribution: "Powered by WeatherAPI.com" })));
    const p = new OfficeWeatherProvider(URL);
    expect(p.attribution).toBe(WEATHER_ATTRIBUTION); // present before the first read, never blank
    await p.read();
    expect(p.attribution).toBe("Powered by WeatherAPI.com");
  });

  it("feeds AUTO, and AUTO alone", async () => {
    vi.stubGlobal("fetch", ok(live({ state: "thunderstorm" })));
    const w = new Weather(new OfficeWeatherProvider(URL), 0);
    w.state(0);
    await settle();
    expect(w.state(1)).toBe("thunderstorm"); // real weather reached AUTO
    expect(w.overridden).toBe(false);
  });
});

describe("vo3d weather — the manual overrides are untouched by any of this", () => {
  it("bypasses the provider entirely, even while it is failing", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network down"); });
    vi.stubGlobal("fetch", fetchMock);
    const w = new Weather(new OfficeWeatherProvider(URL), 0);

    for (const s of WEATHER_STATES) {
      w.mode = s;
      expect(w.state(1)).toBe(s); // every one of the five still selects exactly itself
      expect(w.overridden).toBe(true);
    }
    await settle();
    w.mode = "auto";
    expect(w.state(2)).toBe("clear"); // a dead endpoint leaves AUTO on the safe fallback
  });

  it("still works with no backend configured at all", () => {
    const w = new Weather(null);
    for (const s of WEATHER_STATES) { w.mode = s; expect(w.state(0)).toBe(s); }
    expect(officeWeatherUrl.length).toBe(0); // reads config, takes no argument
  });
});

// GET /weather/office lives on the Virtual Office backend. In production VITE_API_URL is the ATLAS
// API, which has no such route, so building the URL from it silently left AUTO on CLEAR.
describe("vo3d weather — the endpoint is on the Virtual Office backend, not Atlas", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds the URL from VITE_CHAT_SOCKET_URL even when an Atlas VITE_API_URL is also set", () => {
    vi.stubEnv("VITE_API_URL", "https://atlas-api.example.com");
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "https://vo-api.example.com");
    expect(officeWeatherUrl()).toBe("https://vo-api.example.com/weather/office");
  });

  it("strips any number of trailing slashes and surrounding whitespace", () => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "  https://vo-api.example.com///  ");
    expect(officeWeatherUrl()).toBe("https://vo-api.example.com/weather/office");
  });

  it("is null (manual provider, CLEAR) when the VO backend is not configured — never falls back to Atlas", () => {
    vi.stubEnv("VITE_API_URL", "https://atlas-api.example.com");
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "");
    expect(officeWeatherUrl()).toBeNull();
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "   ");
    expect(officeWeatherUrl()).toBeNull();
  });
});

describe("vo3d weather — nothing about the endpoint can break the office", () => {
  const failures: [string, () => void][] = [
    ["missing/invalid key (backend says unavailable)", () => vi.stubGlobal("fetch", ok({ source: "unavailable", state: "clear", attribution: WEATHER_ATTRIBUTION }))],
    ["HTTP 500", () => vi.stubGlobal("fetch", ok({}, 500))],
    ["HTTP 404", () => vi.stubGlobal("fetch", ok({}, 404))],
    ["body is not JSON", () => vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 200 })))],
    ["unknown state string", () => vi.stubGlobal("fetch", ok(live({ state: "hail" })))],
    ["transport error", () => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }))],
  ];

  for (const [name, arrange] of failures) {
    it(`rejects rather than throwing into the frame: ${name}`, async () => {
      arrange();
      const p = new OfficeWeatherProvider(URL);
      await expect(p.read()).rejects.toBeInstanceOf(Error);
    });
  }

  it("keeps the LAST GOOD reading when the endpoint later fails — no flicker back to clear", async () => {
    vi.stubGlobal("fetch", ok(live({ state: "heavy_rain" })));
    const w = new Weather(new OfficeWeatherProvider(URL), 0);
    w.state(0);
    await settle();
    expect(w.state(1)).toBe("heavy_rain");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    w.invalidate();
    w.state(2);
    await settle();
    expect(w.state(3)).toBe("heavy_rain"); // the storm did not blink out mid-outage
  });

  it("clamps a nonsense intensity instead of trusting it", async () => {
    vi.stubGlobal("fetch", ok(live({ intensity: 42 })));
    expect((await new OfficeWeatherProvider(URL).read()).intensity).toBe(1);
    vi.stubGlobal("fetch", ok(live({ intensity: null })));
    expect((await new OfficeWeatherProvider(URL).read()).intensity).toBe(1);
  });
});

describe("vo3d weather — one shared server reading, not per-user polling", () => {
  it("polls on the throttle, not per frame: 10 minutes of frames is at most one request", async () => {
    const fetchMock = ok(live({}));
    vi.stubGlobal("fetch", fetchMock);
    const w = new Weather(new OfficeWeatherProvider(URL), 600_000);
    for (let f = 0; f < 2000; f++) w.state(f * 16); // ~32s of frames
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    w.state(300_000); // still inside the window
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    w.state(600_001); // window elapsed
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never starts a second request while one is still in flight", async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal("fetch", fetchMock);
    const w = new Weather(new OfficeWeatherProvider(URL), 0); // "poll every time you are asked"
    for (let f = 0; f < 50; f++) w.state(f);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify(live({})), { status: 200, headers: { "Content-Type": "application/json" } }));
    await settle();
  });
});

describe("vo3d weather — the manual provider still stands in with no backend", () => {
  it("reports what it is told and reaches no network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const m = new ManualWeatherProvider("cloudy");
    expect((await m.read()).state).toBe("cloudy");
    m.state = "rain" as WeatherState;
    expect((await m.read()).state).toBe("rain");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
