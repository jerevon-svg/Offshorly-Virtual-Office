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
