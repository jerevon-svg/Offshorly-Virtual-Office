import { describe, expect, it } from "vitest";
import { remapSelfKey } from "./responderMap";

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
