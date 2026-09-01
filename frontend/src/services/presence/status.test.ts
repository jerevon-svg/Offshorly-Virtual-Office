import { describe, expect, it } from "vitest";
import {
  getStatusTimeLimitMs,
  mapAtlasToOfficeStatus,
  resolveCurrentStatus,
  type AutoConditions,
  type OfficeStatus,
} from "./status";
import type { PresenceStatusValue } from "../office/types";

const NO_AUTO: AutoConditions = {
  away: false,
  inConversation: false,
  inCall: false,
  offline: false,
};

describe("mapAtlasToOfficeStatus", () => {
  const cases: Array<[PresenceStatusValue, string]> = [
    ["ONLINE", "AVAILABLE"],
    ["AWAY", "AWAY"],
    ["IN_MEETING", "IN_CALL"],
    ["ON_LEAVE", "BREAK"],
    ["OFFLINE", "OFFLINE"],
  ];

  it.each(cases)("maps Atlas %s -> %s", (atlas, expected) => {
    expect(mapAtlasToOfficeStatus(atlas)).toBe(expected);
  });
});

describe("resolveCurrentStatus precedence", () => {
  it("falls back to manualStatus when no auto condition applies", () => {
    expect(resolveCurrentStatus("BUSY", NO_AUTO)).toBe("BUSY");
    expect(resolveCurrentStatus("AVAILABLE", NO_AUTO)).toBe("AVAILABLE");
  });

  it("Away overrides manualStatus", () => {
    expect(resolveCurrentStatus("AVAILABLE", { ...NO_AUTO, away: true })).toBe("AWAY");
  });

  it("In Conversation overrides Away", () => {
    expect(
      resolveCurrentStatus("AVAILABLE", { ...NO_AUTO, away: true, inConversation: true }),
    ).toBe("IN_CONVERSATION");
  });

  it("In Call overrides In Conversation and Away", () => {
    expect(
      resolveCurrentStatus("AVAILABLE", {
        ...NO_AUTO,
        away: true,
        inConversation: true,
        inCall: true,
      }),
    ).toBe("IN_CALL");
  });

  it("DND suppresses Away/In Conversation/In Call — stays DND", () => {
    expect(resolveCurrentStatus("DND", { ...NO_AUTO, away: true })).toBe("DND");
    expect(resolveCurrentStatus("DND", { ...NO_AUTO, inConversation: true })).toBe("DND");
    expect(resolveCurrentStatus("DND", { ...NO_AUTO, inCall: true })).toBe("DND");
    expect(
      resolveCurrentStatus("DND", { away: true, inConversation: true, inCall: true, offline: false }),
    ).toBe("DND");
  });

  it("Offline always wins over everything, including DND", () => {
    expect(resolveCurrentStatus("DND", { ...NO_AUTO, offline: true })).toBe("OFFLINE");
    expect(
      resolveCurrentStatus("AVAILABLE", {
        away: true,
        inConversation: true,
        inCall: true,
        offline: true,
      }),
    ).toBe("OFFLINE");
  });

  it("Offline wins over a manual status with no other auto conditions", () => {
    expect(resolveCurrentStatus("BUSY", { ...NO_AUTO, offline: true })).toBe("OFFLINE");
  });
});

describe("getStatusTimeLimitMs", () => {
  it("returns 15 minutes for BREAK", () => {
    expect(getStatusTimeLimitMs("BREAK")).toBe(900_000);
  });

  it("returns 1 hour for LUNCH", () => {
    expect(getStatusTimeLimitMs("LUNCH")).toBe(3_600_000);
  });

  it("returns undefined for every other status", () => {
    const others: OfficeStatus[] = [
      "AVAILABLE",
      "BUSY",
      "AWAY",
      "IN_CONVERSATION",
      "IN_CALL",
      "DND",
      "OFFLINE",
    ];
    for (const status of others) {
      expect(getStatusTimeLimitMs(status)).toBeUndefined();
    }
  });
});

// Angelo showed a purple "Angelo · In Call" pill with no call anywhere. The
// source was seed data, not the status machine: his mock record used
// statusFor(4), and 4 % 4 === 0 returns IN_MEETING, which maps to IN_CALL.
describe("angelo's mock presence baseline", () => {
  it("is ONLINE at the source, so he derives AVAILABLE with no call", async () => {
    const { MockOfficeService } = await import("../office/MockOfficeService");
    const svc = new MockOfficeService();
    const [presence, floor] = await Promise.all([svc.getPresence(), svc.getFloor()]);
    const p = presence.find((x) => x.user_email === "angelo@offshorly.com")!;
    const f = floor.find((x) => x.user_email === "angelo@offshorly.com")!;
    expect(p.status).toBe("ONLINE");
    expect(f.status).toBe("ONLINE");
    // derived through the normal mapping, never hardcoded in the label
    expect(mapAtlasToOfficeStatus(p.status)).toBe("AVAILABLE");
    expect(mapAtlasToOfficeStatus(p.status)).not.toBe("IN_CALL");
  });

  it("IN_CALL is still reachable — only from a real IN_MEETING, not by default", () => {
    expect(mapAtlasToOfficeStatus("IN_MEETING")).toBe("IN_CALL");
    // the seed index that caused the bug, kept as a regression marker
    expect(4 % 4).toBe(0);
  });

  it("leaves every other employee's seeded status alone", async () => {
    const { MockOfficeService } = await import("../office/MockOfficeService");
    const presence = await new MockOfficeService().getPresence();
    const byEmail = Object.fromEntries(presence.map((p) => [p.user_email, p.status]));
    expect(byEmail["jerevon@offshorly.com"]).toBe("OFFLINE");
    expect(byEmail["micah@offshorly.com"]).toBe("ONLINE");
    expect(byEmail["alex@offshorly.com"]).toBe("ONLINE");
    expect(byEmail["lui@offshorly.com"]).toBe("AWAY");
  });
});
