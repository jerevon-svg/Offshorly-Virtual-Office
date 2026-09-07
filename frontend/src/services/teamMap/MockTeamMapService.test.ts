import { beforeEach, describe, expect, it } from "vitest";
import { characterLayers } from "../../data/office-layout";
import { mockOfficeService } from "../office/MockOfficeService";
import {
  MOCK_SHARE_STORAGE_KEY,
  MOCK_VIEWER_EMAIL,
  MockTeamMapService,
  buildMockTeamMapPeople,
  mockTeamMapService,
  snapMockCoarse,
} from "./MockTeamMapService";

describe("MockTeamMapService", () => {
  const people = buildMockTeamMapPeople();

  it("covers the whole manifest cast with unique emails", () => {
    expect(people).toHaveLength(characterLayers.length);
    expect(new Set(people.map((p) => p.email)).size).toBe(people.length);
    expect(people.find((p) => p.display_name === "Bon")?.email).toBe("jerevon@offshorly.com");
  });

  it("takes each department from the mock office roster by email, never by cast position", async () => {
    const floor = await mockOfficeService.getFloor();
    expect(floor.length).toBeGreaterThan(0);
    for (const rosterPerson of floor) {
      const mapPerson = people.find((p) => p.email.toLowerCase() === rosterPerson.user_email.toLowerCase());
      expect(mapPerson, rosterPerson.user_email).toBeDefined();
      expect(mapPerson!.department_name).toBe(rosterPerson.department_name);
    }
    // Cast members the roster does not know carry no department rather than a guessed one.
    const rosterEmails = new Set(floor.map((p) => p.user_email.toLowerCase()));
    for (const p of people.filter((x) => !rosterEmails.has(x.email.toLowerCase()))) {
      expect(p.department_name).toBeNull();
    }
  });

  it("exercises all three buckets", () => {
    const buckets = new Set(people.map((p) => p.bucket));
    expect(buckets).toEqual(new Set(["ph", "elsewhere", "none"]));
    expect(people.filter((p) => p.bucket === "none").length).toBeGreaterThanOrEqual(2);
    expect(people.filter((p) => p.bucket === "elsewhere").length).toBeGreaterThanOrEqual(3);
  });

  it("carries only coarse coordinates and the wire allowlist", () => {
    const allowed = [
      "email",
      "display_name",
      "department_name",
      "status",
      "bucket",
      "latitude",
      "longitude",
      "country_code",
      "location_label",
      "timezone",
      "working_today",
    ].sort();
    for (const p of people) {
      expect(Object.keys(p).sort()).toEqual(allowed);
      if (p.bucket === "none") {
        expect(p.latitude).toBeNull();
        expect(p.longitude).toBeNull();
        expect(p.timezone).toBeNull();
      } else {
        expect(Number((p.latitude as number).toFixed(2))).toBe(p.latitude);
        expect(Number((p.longitude as number).toFixed(2))).toBe(p.longitude);
        expect(p.timezone).toBeTruthy();
        expect(p.country_code === "PH").toBe(p.bucket === "ph");
      }
    }
  });

  it("reports itself as mock data", async () => {
    const snapshot = await mockTeamMapService.getPeople();
    expect(snapshot.source).toBe("mock");
    expect(snapshot.people.length).toBe(people.length);
  });

  describe("Working Today (mock)", () => {
    const FIX = { latitude: 14.551234, longitude: 121.027654 }; // inside Makati, not its centroid
    const T0 = Date.parse("2026-09-07T08:00:00Z");

    beforeEach(() => {
      window.localStorage.clear();
    });

    it("stores the exact fix the user chose to share, with nearest-city context", async () => {
      const svc = new MockTeamMapService(() => T0);
      const share = await svc.shareWorkingToday(FIX);
      expect([share.latitude, share.longitude]).toEqual([FIX.latitude, FIX.longitude]);
      expect(share.location_label).toBe("Makati, Philippines");
      expect(share.timezone).toBe("Asia/Manila");
      const stored = JSON.parse(window.localStorage.getItem(MOCK_SHARE_STORAGE_KEY) ?? "{}");
      expect([stored.latitude, stored.longitude]).toEqual([FIX.latitude, FIX.longitude]);
      expect(Date.parse(share.expires_at) - Date.parse(share.shared_at)).toBe(12 * 3600_000);
    });

    it("derives grid-cell context far from any fixture city", () => {
      const place = snapMockCoarse({ latitude: 10.123456, longitude: -150.654321 });
      expect([place.latitude, place.longitude]).toEqual([10.5, -150.5]);
      expect(place.location_label).toBe("Unknown region");
    });

    it("overrides the viewer's base location and survives a fresh service instance", async () => {
      await new MockTeamMapService(() => T0).shareWorkingToday(FIX);
      // "Refresh": a brand-new instance reads the persisted share back.
      const fresh = new MockTeamMapService(() => T0 + 60_000);
      const snap = await fresh.getPeople();
      expect([snap.me?.latitude, snap.me?.longitude]).toEqual([FIX.latitude, FIX.longitude]);
      expect(snap.me?.active).toBe(true);
      const me = snap.people.find((p) => p.email === MOCK_VIEWER_EMAIL)!;
      expect([me.latitude, me.longitude]).toEqual([FIX.latitude, FIX.longitude]);
      expect(me.working_today?.active).toBe(true);
    });

    it("stop keeps the last shared point as inactive; forget removes it and restores the base", async () => {
      const svc = new MockTeamMapService(() => T0);
      await svc.shareWorkingToday(FIX);
      await svc.stopWorkingToday();
      const stopped = await new MockTeamMapService(() => T0 + 1000).getPeople();
      expect(stopped.me?.active).toBe(false);
      expect(stopped.me?.stopped_at).toBeTruthy();
      const me = stopped.people.find((p) => p.email === MOCK_VIEWER_EMAIL)!;
      expect([me.latitude, me.longitude]).toEqual([FIX.latitude, FIX.longitude]);
      expect(me.working_today?.active).toBe(false);

      await svc.forgetWorkingToday();
      const after = await svc.getPeople();
      const base = buildMockTeamMapPeople().find((p) => p.email === MOCK_VIEWER_EMAIL)!;
      expect(after.me).toBeNull();
      expect(after.people.find((p) => p.email === MOCK_VIEWER_EMAIL)!.location_label).toBe(base.location_label);
      expect(window.localStorage.getItem(MOCK_SHARE_STORAGE_KEY)).toBeNull();
    });

    it("a new share replaces the saved location and goes live again", async () => {
      const svc = new MockTeamMapService(() => T0);
      await svc.shareWorkingToday(FIX);
      await svc.stopWorkingToday();
      const second = { latitude: 14.581111, longitude: 121.088888 };
      const share = await svc.shareWorkingToday(second);
      expect([share.latitude, share.longitude]).toEqual([second.latitude, second.longitude]);
      expect(share.active).toBe(true);
      expect(share.stopped_at).toBeNull();
      expect(share.location_label).toBe("Pasig, Philippines");
    });

    it("expires after 12 hours into a saved, inactive last location", async () => {
      await new MockTeamMapService(() => T0).shareWorkingToday(FIX);
      const still = await new MockTeamMapService(() => T0 + 12 * 3600_000 - 1000).getPeople();
      expect(still.me?.active).toBe(true);
      const gone = await new MockTeamMapService(() => T0 + 12 * 3600_000 + 1000).getPeople();
      expect(gone.me?.active).toBe(false);
      expect(gone.me?.stopped_at).toBe(gone.me?.expires_at);
      const me = gone.people.find((p) => p.email === MOCK_VIEWER_EMAIL)!;
      expect([me.latitude, me.longitude]).toEqual([FIX.latitude, FIX.longitude]);
      expect(me.working_today?.active).toBe(false);
      expect(window.localStorage.getItem(MOCK_SHARE_STORAGE_KEY)).not.toBeNull();
    });
  });
});
