import { describe, expect, it } from "vitest";
import type { OfficePerson } from "../office/floorMerge";
import { searchTeamMap } from "./search";
import type { TeamMapPerson } from "./types";

const person = (over: Partial<TeamMapPerson>): TeamMapPerson => ({
  email: "ada@offshorly.com",
  display_name: "Ada Lovelace",
  department_name: "Engineering",
  status: "ONLINE",
  bucket: "ph",
  latitude: 14.6,
  longitude: 120.98,
  country_code: "PH",
  location_label: "Manila, Philippines",
  timezone: "Asia/Manila",
  working_today: null,
  ...over,
});

const ada = person({});
const sam = person({ email: "sam@offshorly.com", display_name: "Sam Sy", bucket: "elsewhere" });
const nia = person({
  email: "nia@offshorly.com",
  display_name: "Nia None",
  bucket: "none",
  latitude: null,
  longitude: null,
  location_label: null,
});
const people = [ada, sam, nia];
const noRoster: readonly OfficePerson[] = [];

describe("searchTeamMap", () => {
  it("matches display names case-insensitively on any substring", () => {
    expect(searchTeamMap(people, noRoster, "ADA").map((m) => m.person.email)).toEqual([
      "ada@offshorly.com",
    ]);
    expect(searchTeamMap(people, noRoster, "love").map((m) => m.person.email)).toEqual([
      "ada@offshorly.com",
    ]);
  });

  it("matches nobody for an empty or whitespace query", () => {
    expect(searchTeamMap(people, noRoster, "")).toEqual([]);
    expect(searchTeamMap(people, noRoster, "   ")).toEqual([]);
  });

  it("finds people regardless of where their location comes from", () => {
    // Atlas base, a live Working Today share, a saved last-shared location, and no location at
    // all — search reads names only, so all four are findable.
    const working = person({
      email: "wes@offshorly.com",
      display_name: "Wes Worker",
      working_today: {
        shared_at: "2026-09-07T00:00:00Z",
        expires_at: "2026-09-07T12:00:00Z",
        active: true,
        stopped_at: null,
      },
    });
    const lastShared = person({
      email: "lee@offshorly.com",
      display_name: "Lee Last",
      working_today: {
        shared_at: "2026-09-07T00:00:00Z",
        expires_at: "2026-09-07T12:00:00Z",
        active: false,
        stopped_at: "2026-09-07T01:00:00Z",
      },
    });
    const pool = [ada, working, lastShared, nia];
    for (const [query, email] of [
      ["ada", "ada@offshorly.com"],
      ["wes", "wes@offshorly.com"],
      ["lee", "lee@offshorly.com"],
      ["nia", "nia@offshorly.com"],
    ]) {
      expect(searchTeamMap(pool, noRoster, query).map((m) => m.person.email)).toEqual([email]);
    }
  });

  it("ranks prefix matches above mid-name matches", () => {
    const sammy = person({ email: "sammy@offshorly.com", display_name: "Sammy Cruz" });
    const bosam = person({ email: "bo@offshorly.com", display_name: "Bo Samson" });
    expect(searchTeamMap([bosam, sam, sammy], noRoster, "sam").map((m) => m.person.email)).toEqual([
      "sam@offshorly.com",
      "sammy@offshorly.com",
      "bo@offshorly.com",
    ]);
  });

  it("flags same-named people so the row can show the email that separates them", () => {
    const twin = person({ email: "ada2@offshorly.com", display_name: "Ada Lovelace" });
    const matches = searchTeamMap([ada, twin], noRoster, "ada");
    expect(matches.map((m) => m.person.email).sort()).toEqual([
      "ada2@offshorly.com",
      "ada@offshorly.com",
    ]);
    expect(matches.every((m) => m.ambiguous)).toBe(true);
    expect(searchTeamMap([ada, sam], noRoster, "ada")[0].ambiguous).toBe(false);
  });

  it("prefers the roster display name, the same one the rows show", () => {
    const roster = [
      { email: "ada@offshorly.com", displayName: "Ada L. (Eng)" },
    ] as unknown as readonly OfficePerson[];
    expect(searchTeamMap(people, roster, "eng").map((m) => m.name)).toEqual(["Ada L. (Eng)"]);
  });

  it("caps the result list", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      person({ email: `p${i}@offshorly.com`, display_name: `Person ${i}` }),
    );
    expect(searchTeamMap(many, noRoster, "person", 8)).toHaveLength(8);
  });
});
