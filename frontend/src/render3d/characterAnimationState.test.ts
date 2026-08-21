import { describe, expect, it } from "vitest";
import { resolveCharacterAnimState, type CharacterAnimInput } from "./characterAnimationState";

const BASE: CharacterAnimInput = {
  isWalking: false,
  isSitting: false,
  isChatting: false,
  isResponder: false,
};

describe("resolveCharacterAnimState", () => {
  it("defaults to idle-9 when nothing else applies", () => {
    expect(resolveCharacterAnimState(BASE)).toBe("idle-9");
  });

  it("resolves to walking when isWalking is true and not seated", () => {
    expect(resolveCharacterAnimState({ ...BASE, isWalking: true })).toBe("walking");
  });

  it("resolves to agree-gesture when chatting as the responder while standing", () => {
    expect(
      resolveCharacterAnimState({ ...BASE, isChatting: true, isResponder: true }),
    ).toBe("agree-gesture");
  });

  it("resolves to listening-gesture when chatting but not the responder while standing", () => {
    expect(
      resolveCharacterAnimState({ ...BASE, isChatting: true, isResponder: false }),
    ).toBe("listening-gesture");
  });

  it("resolves to sit-on-chair-arms when seated and not chatting", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSitting: true })).toBe("sit-on-chair-arms");
  });

  it("resolves to sit-on-chair-arms when seated, chatting, but listening (not the responder)", () => {
    expect(
      resolveCharacterAnimState({ ...BASE, isSitting: true, isChatting: true, isResponder: false }),
    ).toBe("sit-on-chair-arms");
  });

  it("resolves to sitting-answering when seated AND responding", () => {
    expect(
      resolveCharacterAnimState({ ...BASE, isSitting: true, isChatting: true, isResponder: true }),
    ).toBe("sitting-answering");
  });

  it("prioritizes seated over walking (can't be both, but seated wins if both flags are somehow set)", () => {
    expect(resolveCharacterAnimState({ ...BASE, isSitting: true, isWalking: true })).toBe(
      "sit-on-chair-arms",
    );
  });

  it("prioritizes walking over chat state while standing", () => {
    expect(
      resolveCharacterAnimState({ ...BASE, isWalking: true, isChatting: true, isResponder: true }),
    ).toBe("walking");
  });

  it("ignores isResponder when isChatting is false (standing, idle)", () => {
    expect(resolveCharacterAnimState({ ...BASE, isResponder: true })).toBe("idle-9");
  });

  it("is a pure function: same input always produces the same output (no-restart-on-same-state contract)", () => {
    const input: CharacterAnimInput = { ...BASE, isChatting: true, isResponder: true };
    const a = resolveCharacterAnimState(input);
    const b = resolveCharacterAnimState(input);
    expect(a).toBe(b);
    expect(a).toBe("agree-gesture");
  });

  // Exhaustive coverage of every one of the 16 boolean combinations, so any
  // future change to the priority order gets caught by a concrete assertion
  // rather than relying only on the hand-picked cases above.
  it("covers every boolean combination with a deterministic, documented result", () => {
    const expectedByKey: Record<string, ReturnType<typeof resolveCharacterAnimState>> = {
      "0000": "idle-9",
      "0001": "idle-9", // isResponder ignored without isChatting
      "0010": "listening-gesture",
      "0011": "agree-gesture",
      "0100": "walking",
      "0101": "walking",
      "0110": "walking",
      "0111": "walking",
      "1000": "sit-on-chair-arms",
      "1001": "sit-on-chair-arms",
      "1010": "sit-on-chair-arms",
      "1011": "sitting-answering",
      "1100": "sit-on-chair-arms", // seated wins over walking
      "1101": "sit-on-chair-arms",
      "1110": "sit-on-chair-arms",
      "1111": "sitting-answering",
    };
    for (const [key, expected] of Object.entries(expectedByKey)) {
      const [isSitting, isWalking, isChatting, isResponder] = key.split("").map((c) => c === "1");
      const result = resolveCharacterAnimState({ isSitting, isWalking, isChatting, isResponder });
      expect(result, `key=${key}`).toBe(expected);
    }
  });
});
