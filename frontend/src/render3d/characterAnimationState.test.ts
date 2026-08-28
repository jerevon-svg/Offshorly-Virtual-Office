import { describe, expect, it } from "vitest";
import { resolveCharacterAnimState, type CharacterAnimInput } from "./characterAnimationState";

const BASE: CharacterAnimInput = {
  isWalking: false,
  isSitting: false,
  isGlobalChatActive: false,
  isSpatialConversation: false,
  isTyping: false,
};

describe("resolveCharacterAnimState (locked semantics 2026-08-28)", () => {
  it("1. standing and inactive -> idle-9", () => {
    expect(resolveCharacterAnimState(BASE)).toBe("idle-9");
  });

  it("2. walking overrides every other state, regardless of prior state", () => {
    expect(resolveCharacterAnimState({ ...BASE, isWalking: true })).toBe("walking");
    expect(
      resolveCharacterAnimState({
        isWalking: true,
        isSitting: true,
        isGlobalChatActive: true,
        isSpatialConversation: true,
        isTyping: true,
      }),
    ).toBe("walking");
  });

  it("3. spatial conversation + real typing -> agree-gesture", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSpatialConversation: true, isTyping: true })).toBe(
      "agree-gesture",
    );
  });

  it("4. spatial conversation + typing timed out -> listening-gesture", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSpatialConversation: true, isTyping: false })).toBe(
      "listening-gesture",
    );
  });

  it("5. spatial conversation ends -> idle-9 unless sitting or walking", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSpatialConversation: false, isTyping: true })).toBe("idle-9");
    expect(resolveCharacterAnimState({ ...BASE, isSitting: true })).toBe("sit-on-chair-arms");
    expect(resolveCharacterAnimState({ ...BASE, isWalking: true })).toBe("walking");
  });

  it("6. sitting without active Global Chat -> sit-on-chair-arms (even while in a spatial conversation)", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSitting: true })).toBe("sit-on-chair-arms");
    expect(
      resolveCharacterAnimState({ ...BASE, isSitting: true, isSpatialConversation: true, isTyping: true }),
    ).toBe("sit-on-chair-arms");
  });

  it("7/8. sitting + active Global Chat (remote DM or group window) -> sitting-answering", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSitting: true, isGlobalChatActive: true })).toBe(
      "sitting-answering",
    );
  });

  it("9. remote window minimized/closed (isGlobalChatActive false) -> back to sit-on-chair-arms", () => {
    const seatedActive = { ...BASE, isSitting: true, isGlobalChatActive: true };
    expect(resolveCharacterAnimState(seatedActive)).toBe("sitting-answering");
    expect(resolveCharacterAnimState({ ...seatedActive, isGlobalChatActive: false })).toBe("sit-on-chair-arms");
  });

  it("10. standing + active Global Chat stays idle-9 (never a seated animation)", () => {
    expect(resolveCharacterAnimState({ ...BASE, isGlobalChatActive: true })).toBe("idle-9");
  });

  it("11. spatial panel open without typing -> listening-gesture, never agree", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSpatialConversation: true })).toBe("listening-gesture");
  });

  it("12. no input other than real typing can produce agree-gesture (no responder heuristic exists)", () => {
    const keys = Object.keys(BASE) as (keyof CharacterAnimInput)[];
    expect(keys).not.toContain("isResponder");
    expect(keys).not.toContain("isChatting");
    // Only the (spatial && typing) pair yields agree-gesture.
    for (const isTyping of [false, true]) {
      for (const isSpatialConversation of [false, true]) {
        const r = resolveCharacterAnimState({ ...BASE, isSpatialConversation, isTyping });
        expect(r === "agree-gesture").toBe(isSpatialConversation && isTyping);
      }
    }
  });

  it("is a pure function: same input always produces the same output (no-restart-on-same-state contract)", () => {
    const input: CharacterAnimInput = { ...BASE, isSpatialConversation: true, isTyping: true };
    expect(resolveCharacterAnimState(input)).toBe(resolveCharacterAnimState(input));
  });

  // Exhaustive coverage of all 32 boolean combinations, so any future change to the
  // priority order is caught by a concrete assertion. Key order:
  // isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping.
  it("covers every boolean combination with the documented priority", () => {
    const expected = (i: CharacterAnimInput) =>
      i.isWalking
        ? "walking"
        : i.isSitting
          ? i.isGlobalChatActive
            ? "sitting-answering"
            : "sit-on-chair-arms"
          : i.isSpatialConversation
            ? i.isTyping
              ? "agree-gesture"
              : "listening-gesture"
            : "idle-9";
    for (let n = 0; n < 32; n++) {
      const bits = n.toString(2).padStart(5, "0").split("").map((c) => c === "1");
      const [isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping] = bits;
      const input = { isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping };
      expect(resolveCharacterAnimState(input), `bits=${bits.map(Number).join("")}`).toBe(expected(input));
    }
  });
});
