// The reverse-label verification, against the provider's REAL recorded answers.
//
// WeatherAPI answers a reverse lookup with a name it does not always stand behind: asked about Metro
// Manila it says "San Jose, Negros Occidental". The echoed coordinates always match the question, so
// proximity cannot catch that — only putting the name back through the forward search can.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stubbed at FETCH, not at the module: reverseGeocode calls searchCities internally, so a module
// mock of its own module would never be seen. This also exercises the real client on the way through.
import { reverseGeocode, distanceKm, deviceQuery } from "./forecastClient";

const ATTR = "Powered by WeatherAPI.com";
const ok = (results: unknown[]) => ({ source: "weatherapi" as const, results, attribution: ATTR });
const city = (name: string, region: string, country: string, query: string) => ({ name, region, country, query });

/** Answers each `q` with its own recorded payload, and records the order they were asked in. */
const asked: string[] = [];
let routes: Record<string, unknown> = {};


function route(map: Record<string, unknown>) {
  routes = map;
}

beforeEach(() => {
  import.meta.env.VITE_CHAT_SOCKET_URL = "http://localhost:8002";
  asked.length = 0;

  routes = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("q") || "");
    asked.push(q);

    const body = routes[q];
    if (body === "boom") throw new Error("network");
    return new Response(JSON.stringify(body ?? ok([])), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});

describe("deviceQuery", () => {
  it("coarsens a device fix to ~1.1km before anything can send it", () => {
    expect(deviceQuery(14.579412, 121.035913)).toBe("14.58,121.04");
    expect(deviceQuery(-33.8688197, 151.2092955)).toBe("-33.87,151.21");
  });
});

describe("distanceKm", () => {
  it("is close enough over the ranges this is compared at", () => {
    expect(distanceKm(14.58, 121.04, 14.58, 121.04)).toBeCloseTo(0, 5);
    // Metro Manila to Negros Occidental is ~500km, and must not read as "nearby".
    expect(distanceKm(14.58, 121.04, 10.4, 122.98)).toBeGreaterThan(400);
  });
});

describe("reverseGeocode", () => {
  it("REJECTS a name the provider cannot stand behind (the real Metro Manila case)", async () => {
    route({
      "14.58,121.04": ok([city("San Jose", "Negros Occidental", "Philippines", "14.5800,121.0400")]),
      // ...and the forward search for "San Jose" offers California, Costa Rica, Venezuela — all far.
      // The REGION is what gets checked, and Negros Occidental is ~500km from Metro Manila.
      "Negros Occidental": ok([city("Patic", "Negros Occidental", "Philippines", "10.5200,122.8200")]),
    });

    expect(await reverseGeocode("14.58,121.04")).toBeNull();
    expect(asked).toEqual(["14.58,121.04", "Negros Occidental"]);
  });

  it("ACCEPTS a neighbourhood whose REGION checks out (the real Tokyo case)", async () => {
    // Searching the neighbourhood name "Horinouchi" lands in Niigata, 210km away — which is why the
    // region, not the name, is the thing verified. This label is good and must survive.
    const hit = city("Horinouchi", "Tokyo", "Japan", "35.6900,139.6500");
    route({ "35.68,139.65": ok([hit]), Tokyo: ok([city("Tokyo", "Tokyo", "Japan", "35.6900,139.6900")]) });
    expect(await reverseGeocode("35.68,139.65")).toEqual(hit);
  });

  it("ACCEPTS a plain city answer (Bangkok)", async () => {
    const bangkok = city("Bangkok", "Krung Thep", "Thailand", "13.7500,100.5200");
    route({ "13.75,100.52": ok([bangkok]), "Krung Thep": ok([city("Krung Thep", "Krung Thep", "Thailand", "13.7500,100.5200")]) });
    expect(await reverseGeocode("13.75,100.52")).toEqual(bangkok);
  });

  it("rejects a match that is simply far from the device", async () => {
    route({ "14.58,121.04": ok([city("Somewhere", "R", "C", "9.3000,123.3000")]) });
    expect(await reverseGeocode("14.58,121.04")).toBeNull();
    expect(asked).toEqual(["14.58,121.04"]); // no round trip needed
  });

  it("returns null — never a guess — when the lookup is unavailable or empty", async () => {
    route({ "14.58,121.04": { source: "unavailable", results: [], attribution: ATTR } });
    expect(await reverseGeocode("14.58,121.04")).toBeNull();

    route({ "14.58,121.04": ok([]) });
    expect(await reverseGeocode("14.58,121.04")).toBeNull();
  });

  it("treats a FAILED round trip as unverified rather than as a pass", async () => {
    route({ "14.58,121.04": ok([city("Somewhere", "R", "C", "14.5800,121.0400")]), R: "boom" });
    expect(await reverseGeocode("14.58,121.04")).toBeNull();
  });

  it("falls back to the NAME when the provider gives no region", async () => {
    const hcmc = city("Ho Chi Minh City", "", "Vietnam", "10.7800,106.7000");
    route({ "10.78,106.70": ok([hcmc]), "Ho Chi Minh City": ok([hcmc]) });
    expect(await reverseGeocode("10.78,106.70")).toEqual(hcmc);
  });
});
