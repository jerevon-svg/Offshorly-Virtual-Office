import { describe, expect, it } from "vitest";
import type { OfficePerson } from "../office/floorMerge";
import {
  formatLocalTime,
  formatSharedAgo,
  groupByBucket,
  initialsFor,
  mappable,
  placeHintFor,
  resolveDepartment,
  resolveDisplayName,
  resolveMapStatus,
} from "./buckets";
import type { TeamMapPerson } from "./types";

const person = (over: Partial<TeamMapPerson>): TeamMapPerson => ({
  email: "a@offshorly.com",
  display_name: "Ada Lovelace",
  department_name: "Engineering",
  status: "ONLINE",
  bucket: "ph",
  latitude: 14.6,
  longitude: 120.98,
  country_code: "PH",
  location_label: "Manila, Philippines",
  timezone: "Asia/Manila",
  ...over,
});

const rosterRow = (email: string, status: OfficePerson["status"]): OfficePerson => ({
  email,
  displayName: "x",
  status,
  departmentName: null,
  jobTitle: null,
  currentActivity: null,
  lastMessage: null,
  avatarId: null,
  roomId: "lobby",
  atlasRoomId: null,
  inEphemeralRoom: false,
});

describe("groupByBucket", () => {
  it("splits PH / elsewhere / none and sorts each by name", () => {
    const grouped = groupByBucket([
      person({ email: "z@x", display_name: "Zed", bucket: "ph" }),
      person({ email: "a@x", display_name: "Amy", bucket: "ph" }),
      person({ email: "s@x", display_name: "Sam", bucket: "elsewhere", country_code: "SG" }),
      person({ email: "n@x", display_name: "Nia", bucket: "none", latitude: null, longitude: null }),
    ]);
    expect(grouped.ph.map((p) => p.display_name)).toEqual(["Amy", "Zed"]);
    expect(grouped.elsewhere.map((p) => p.display_name)).toEqual(["Sam"]);
    expect(grouped.none.map((p) => p.display_name)).toEqual(["Nia"]);
  });

  it("never lets a null coordinate pair reach a mappable bucket", () => {
    const stray = person({ bucket: "ph", latitude: null, longitude: null });
    expect(groupByBucket([stray]).none).toHaveLength(1);
    expect(mappable([stray, person({})])).toHaveLength(1);
  });
});

describe("resolveMapStatus", () => {
  it("prefers the live roster over the snapshot status", () => {
    const p = person({ status: "OFFLINE" });
    expect(resolveMapStatus(p, [rosterRow("A@offshorly.com", "IN_MEETING")])).toBe("IN_CALL");
  });

  it("maps the snapshot status through the floor's table when nobody is live", () => {
    expect(resolveMapStatus(person({ status: "ON_LEAVE" }), [])).toBe("BREAK");
    expect(resolveMapStatus(person({ status: "garbage" }), [])).toBe("OFFLINE");
  });
});

describe("formatLocalTime", () => {
  const noon = new Date("2026-09-07T12:00:00Z");
  it("renders the wall-clock time in the given zone", () => {
    expect(formatLocalTime("Asia/Manila", noon)).toMatch(/8:00/);
    expect(formatLocalTime("Europe/London", noon)).toMatch(/1:00/);
  });
  it("degrades to null for a missing or unknown zone", () => {
    expect(formatLocalTime(null, noon)).toBeNull();
    expect(formatLocalTime("Mars/Olympus_Mons", noon)).toBeNull();
  });
});

describe("initialsFor", () => {
  it("uses first and last name, falling back to the email", () => {
    expect(initialsFor(person({}))).toBe("AL");
    expect(initialsFor(person({ display_name: null, email: "kb@offshorly.com" }))).toBe("KB");
  });
});

describe("formatSharedAgo / placeHintFor", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  it("renders a coarse relative time", () => {
    expect(formatSharedAgo("2026-09-07T11:59:40Z", now)).toBe("just now");
    expect(formatSharedAgo("2026-09-07T11:55:00Z", now)).toBe("5 min ago");
    expect(formatSharedAgo("2026-09-07T09:30:00Z", now)).toBe("2 h ago");
    expect(formatSharedAgo("garbage", now)).toBeNull();
  });
  it("prefers an active Working Today share over the Atlas base", () => {
    const base = person({});
    expect(placeHintFor(base, now)).toBe("Based near Manila, Philippines");
    const shared = person({
      location_label: "Cebu City, Philippines",
      working_today: {
        shared_at: "2026-09-07T11:55:00Z",
        expires_at: "2026-09-07T23:55:00Z",
        active: true,
        stopped_at: null,
      },
    });
    expect(placeHintFor(shared, now)).toBe("Working today · Shared 5 min ago");
    const saved = person({
      working_today: {
        shared_at: "2026-09-07T09:30:00Z",
        expires_at: "2026-09-07T21:30:00Z",
        active: false,
        stopped_at: "2026-09-07T10:00:00Z",
      },
    });
    expect(placeHintFor(saved, now)).toBe("Last shared 2 h ago · not live");
    expect(placeHintFor(saved, now)).not.toMatch(/Working today/);
    expect(placeHintFor(person({ location_label: null }), now)).toBe("No location");
  });
});

describe("resolveDepartment / resolveDisplayName", () => {
  const roster: OfficePerson[] = [
    { ...rosterRow("b@x", "ONLINE"), displayName: "Bee Roster", departmentName: "Design" },
    { ...rosterRow("a@x", "ONLINE"), displayName: "Ay Roster", departmentName: "Operations" },
  ];
  const mapRows = [
    person({ email: "A@x", display_name: "Ay Map", department_name: "Wrong-A" }),
    person({ email: "b@x", display_name: "Bee Map", department_name: "Wrong-B" }),
  ];

  it("joins by email regardless of the order rows or roster arrive in", () => {
    for (const rows of [mapRows, [...mapRows].reverse()]) {
      for (const list of [roster, [...roster].reverse()]) {
        const a = rows.find((r) => r.email.toLowerCase() === "a@x")!;
        const b = rows.find((r) => r.email.toLowerCase() === "b@x")!;
        expect(resolveDepartment(a, list)).toBe("Operations");
        expect(resolveDepartment(b, list)).toBe("Design");
        expect(resolveDisplayName(a, list)).toBe("Ay Roster");
        expect(resolveDisplayName(b, list)).toBe("Bee Roster");
      }
    }
  });

  it("falls back to the map row only when the roster does not list the person", () => {
    const stranger = person({ email: "z@x", display_name: "Zed Map", department_name: "QA" });
    expect(resolveDepartment(stranger, roster)).toBe("QA");
    expect(resolveDisplayName(stranger, roster)).toBe("Zed Map");
    expect(resolveDepartment(person({ email: "z@x", department_name: null }), roster)).toBeNull();
  });
});
