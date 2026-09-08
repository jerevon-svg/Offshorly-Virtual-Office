import { describe, expect, it } from "vitest";
import {
  compactDistanceLabelFor,
  distanceLabelFor,
  distanceMetersFor,
  formatDistance,
  haversineMeters,
} from "./distance";
import type { TeamMapPerson, WorkingTodayShare } from "./types";

const manila = { latitude: 14.5995, longitude: 120.9842 };
const share = (over: Partial<WorkingTodayShare> = {}): WorkingTodayShare => ({
  ...manila,
  location_label: "Manila, Philippines",
  country_code: "PH",
  timezone: "Asia/Manila",
  shared_at: "2026-09-08T00:00:00Z",
  expires_at: "2026-09-08T12:00:00Z",
  active: true,
  stopped_at: null,
  ...over,
});

const person = (over: Partial<TeamMapPerson>): TeamMapPerson =>
  ({
    email: "sam@offshorly.com",
    display_name: "Sam Sy",
    bucket: "ph",
    latitude: 14.5995,
    longitude: 120.9842,
    location_label: "Manila, Philippines",
    timezone: "Asia/Manila",
    working_today: null,
    ...over,
  }) as TeamMapPerson;

describe("haversineMeters", () => {
  it("is zero for the same point and symmetric", () => {
    expect(haversineMeters(manila, manila)).toBe(0);
    const cebu = { latitude: 10.3157, longitude: 123.8854 };
    expect(haversineMeters(manila, cebu)).toBeCloseTo(haversineMeters(cebu, manila), 6);
  });

  it("matches known distances within a fraction of a percent", () => {
    // Great-circle reference values: Manila → Cebu ~571 km, Manila → Singapore ~2393 km.
    expect(haversineMeters(manila, { latitude: 10.3157, longitude: 123.8854 }) / 1000).toBeCloseTo(571, 0);
    expect(haversineMeters(manila, { latitude: 1.3521, longitude: 103.8198 }) / 1000).toBeCloseTo(2393, -1);
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre, rounded to ten", () => {
    expect(formatDistance(0)).toBe("0 m away");
    expect(formatDistance(452)).toBe("450 m away");
    expect(formatDistance(999)).toBe("1000 m away");
  });

  it("uses kilometres at and above one, one decimal until ten", () => {
    expect(formatDistance(1000)).toBe("1.0 km away");
    expect(formatDistance(2437)).toBe("2.4 km away");
    expect(formatDistance(9949)).toBe("9.9 km away");
    expect(formatDistance(15_400)).toBe("15 km away");
    expect(formatDistance(2_380_000)).toBe("2380 km away");
  });
});

describe("distanceLabelFor", () => {
  const viewer = "ada@offshorly.com";

  it("measures from the viewer's own share to any located colleague", () => {
    const nearby = person({ latitude: 14.6035, longitude: 120.9842 });
    expect(distanceLabelFor(share(), nearby, viewer)).toBe("440 m away");
  });

  it("works the same for an Atlas base, a live share and a saved last-shared location", () => {
    const marker = (active: boolean) => ({
      shared_at: "2026-09-08T00:00:00Z",
      expires_at: "2026-09-08T12:00:00Z",
      active,
      stopped_at: active ? null : "2026-09-08T01:00:00Z",
    });
    const at = { latitude: 14.6355, longitude: 120.9842 };
    const expected = "4.0 km away";
    expect(distanceLabelFor(share(), person(at), viewer)).toBe(expected);
    expect(distanceLabelFor(share(), person({ ...at, working_today: marker(true) }), viewer)).toBe(expected);
    expect(distanceLabelFor(share(), person({ ...at, working_today: marker(false) }), viewer)).toBe(expected);
  });

  it("still measures when the viewer's own share is only the saved last-shared one", () => {
    const saved = share({ active: false, stopped_at: "2026-09-08T01:00:00Z" });
    expect(distanceLabelFor(saved, person({ latitude: 14.6355 }), viewer)).toBe("4.0 km away");
  });

  it("shows nothing without a share of the viewer's own", () => {
    expect(distanceLabelFor(null, person({}), viewer)).toBeNull();
    expect(distanceLabelFor(undefined, person({}), viewer)).toBeNull();
  });

  it("shows nothing for a colleague with no location", () => {
    expect(
      distanceLabelFor(share(), person({ latitude: null, longitude: null, bucket: "none" }), viewer),
    ).toBeNull();
  });

  it("shows nothing for the viewer themselves, matched case-insensitively", () => {
    expect(distanceLabelFor(share(), person({ email: "ADA@offshorly.com" }), viewer)).toBeNull();
  });
});

describe("compactDistanceLabelFor", () => {
  const viewer = "ada@offshorly.com";

  it("is the same number as the sidebar label, without the trailing 'away'", () => {
    const sam = person({ latitude: 14.6355, longitude: 120.9842 });
    expect(distanceLabelFor(share(), sam, viewer)).toBe("4.0 km away");
    expect(compactDistanceLabelFor(share(), sam, viewer)).toBe("4.0 km");
    const near = person({ latitude: 14.6035, longitude: 120.9842 });
    expect(compactDistanceLabelFor(share(), near, viewer)).toBe("440 m");
  });

  it("goes through the same gate: no share, no location, or the viewer means no pill", () => {
    expect(compactDistanceLabelFor(null, person({}), viewer)).toBeNull();
    expect(
      compactDistanceLabelFor(share(), person({ latitude: null, longitude: null }), viewer),
    ).toBeNull();
    expect(compactDistanceLabelFor(share(), person({ email: viewer }), viewer)).toBeNull();
    expect(distanceMetersFor(null, person({}), viewer)).toBeNull();
  });
});
