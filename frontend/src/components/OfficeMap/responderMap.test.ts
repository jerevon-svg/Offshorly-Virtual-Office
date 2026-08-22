import { describe, expect, it } from "vitest";
import { buildCharacterIsResponderById, remapSelfKey } from "./responderMap";

describe("buildCharacterIsResponderById", () => {
  // Regression test: talkingTextById is keyed by chat senderId (an email,
  // e.g. selfChatId), never by playerLayerId/currentUserId (an avatar id
  // like "bon"). A direct talkingTextById[layer.id] lookup for the self
  // layer therefore always misses, silently making the self avatar's
  // "responder" gesture (agree-gesture) permanently unreachable — see
  // OfficeStage.tsx's characterIsResponderById doc comment.
  it("remaps the self entry from selfChatId (email) to playerLayerId (avatar id)", () => {
    const selfChatId = "jerevon@offshorly.com";
    const playerLayerId = "bon";
    const talkingTextById = { [selfChatId]: "hey team" };

    const result = buildCharacterIsResponderById(talkingTextById, selfChatId, playerLayerId);

    expect(result[playerLayerId]).toBe(true);
    // The broken lookup (talkingTextById[playerLayerId]) must not resurface
    // as a real key here — only the remapped key should be present.
    expect(result[selfChatId]).toBeUndefined();
  });

  it("passes peer entries through unchanged, since layer.id already equals their senderId/email", () => {
    const selfChatId = "jerevon@offshorly.com";
    const playerLayerId = "bon";
    const peerEmail = "arisha@offshorly.com";
    const talkingTextById = { [peerEmail]: "on my way" };

    const result = buildCharacterIsResponderById(talkingTextById, selfChatId, playerLayerId);

    expect(result[peerEmail]).toBe(true);
    expect(result[playerLayerId]).toBeUndefined();
  });

  it("omits entries whose text has been cleared (expired bubble)", () => {
    const talkingTextById = { "someone@offshorly.com": "" };

    const result = buildCharacterIsResponderById(talkingTextById, "self@offshorly.com", "bon");

    expect(result["someone@offshorly.com"]).toBeUndefined();
  });

  it("returns an empty map when nobody has recently sent a message", () => {
    const result = buildCharacterIsResponderById({}, "self@offshorly.com", "bon");
    expect(result).toEqual({});
  });
});

describe("remapSelfKey", () => {
  it("rekeys a selfChatId entry to playerLayerId", () => {
    const selfChatId = "jerevon@offshorly.com";
    const playerLayerId = "bon";
    const map = { [selfChatId]: "hey team" };

    const result = remapSelfKey(map, selfChatId, playerLayerId);

    expect(result[playerLayerId]).toBe("hey team");
    expect(result[selfChatId]).toBeUndefined();
  });

  it("passes non-self entries through unchanged", () => {
    const selfChatId = "jerevon@offshorly.com";
    const playerLayerId = "bon";
    const peerEmail = "arisha@offshorly.com";
    const map = { [peerEmail]: "on my way" };

    const result = remapSelfKey(map, selfChatId, playerLayerId);

    expect(result).toEqual({ [peerEmail]: "on my way" });
  });

  it("returns an empty map for an empty input map", () => {
    const result = remapSelfKey({}, "self@offshorly.com", "bon");
    expect(result).toEqual({});
  });
});
