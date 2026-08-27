import { describe, expect, it } from "vitest";
import {
  computeClusterAnchor,
  incumbentCentersForAnchor,
  slotWalkSignature,
  resolveSelfSlotWalk,
  classifyUpgrade,
} from "./clusterFormation";

describe("computeClusterAnchor", () => {
  it("returns the exact midpoint for 2 points", () => {
    expect(computeClusterAnchor([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
  });

  it("returns the centroid for 3 points", () => {
    expect(
      computeClusterAnchor([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
      ]),
    ).toEqual({ x: 2, y: 1 });
  });

  it("returns {x:0,y:0} for an empty array", () => {
    expect(computeClusterAnchor([])).toEqual({ x: 0, y: 0 });
  });
});

describe("incumbentCentersForAnchor", () => {
  const centers: Record<string, { x: number; y: number }> = {
    "a@x.com": { x: 0, y: 0 },
    "b@x.com": { x: 10, y: 0 },
    "joiner@x.com": { x: 9999, y: 9999 },
  };
  const resolve = (m: string) => centers[m.toLowerCase()] ?? null;

  it("excludes self (the joiner) from the returned centers", () => {
    const result = incumbentCentersForAnchor(
      ["a@x.com", "b@x.com", "joiner@x.com"],
      "joiner@x.com",
      resolve,
    );
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("is case-insensitive when matching self", () => {
    const result = incumbentCentersForAnchor(
      ["a@x.com", "b@x.com", "Joiner@X.com"],
      "joiner@x.com",
      resolve,
    );
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("falls back to ALL members if no incumbent center resolves", () => {
    const resolveNone = () => null;
    const resolveJoinerOnly = (m: string) => (m.toLowerCase() === "joiner@x.com" ? { x: 5, y: 5 } : null);

    expect(
      incumbentCentersForAnchor(["a@x.com", "b@x.com", "joiner@x.com"], "joiner@x.com", resolveNone),
    ).toEqual([]);

    // Only the joiner resolves -> incumbents list is empty -> fall back to
    // ALL members (which, here, is just the joiner) rather than an empty anchor.
    expect(
      incumbentCentersForAnchor(["a@x.com", "b@x.com", "joiner@x.com"], "joiner@x.com", resolveJoinerOnly),
    ).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("slotWalkSignature", () => {
  it("is case- and order-independent", () => {
    const a = slotWalkSignature(["B@x.com", "a@x.com"]);
    const b = slotWalkSignature(["a@x.com", "B@x.com"]);
    expect(a).toBe(b);
    expect(a).toBe("a@x.com,b@x.com");
  });
});

describe("resolveSelfSlotWalk", () => {
  const selfEmail = "a@x.com";

  it("returns {reset:true} when self is in no >=2-member session", () => {
    const result = resolveSelfSlotWalk({
      sessions: [{ members: [selfEmail] }],
      selfEmail,
      lastSignature: "a@x.com,b@x.com",
      isWalking: false,
    });
    expect(result).toEqual({ reset: true });
  });

  it("returns null when the found session's signature matches lastSignature", () => {
    const result = resolveSelfSlotWalk({
      sessions: [{ members: [selfEmail, "b@x.com"] }],
      selfEmail,
      lastSignature: slotWalkSignature([selfEmail, "b@x.com"]),
      isWalking: false,
    });
    expect(result).toBeNull();
  });

  it("returns null when signature differs but a walk is already in flight", () => {
    const result = resolveSelfSlotWalk({
      sessions: [{ members: [selfEmail, "b@x.com"] }],
      selfEmail,
      lastSignature: null,
      isWalking: true,
    });
    expect(result).toBeNull();
  });

  it("returns the decision object when signature differs and not walking", () => {
    const result = resolveSelfSlotWalk({
      sessions: [{ members: [selfEmail, "b@x.com"] }],
      selfEmail,
      lastSignature: null,
      isWalking: false,
    });
    expect(result).toEqual({
      members: [selfEmail, "b@x.com"],
      signature: slotWalkSignature([selfEmail, "b@x.com"]),
    });
  });

  it("produces a new decision on a 2-member -> 3-member transition", () => {
    const twoMemberSig = slotWalkSignature([selfEmail, "b@x.com"]);
    const result = resolveSelfSlotWalk({
      sessions: [{ members: [selfEmail, "b@x.com", "c@x.com"] }],
      selfEmail,
      lastSignature: twoMemberSig,
      isWalking: false,
    });
    expect(result).toEqual({
      members: [selfEmail, "b@x.com", "c@x.com"],
      signature: slotWalkSignature([selfEmail, "b@x.com", "c@x.com"]),
    });
  });
});

describe("classifyUpgrade", () => {
  it("classifies as incumbent when openConversationId matches oldConversationId", () => {
    const role = classifyUpgrade({
      selfEmail: "a@x.com",
      openConversationId: "conv-a__b",
      payload: {
        oldConversationId: "conv-a__b",
        participantIds: ["a@x.com", "b@x.com", "c@x.com"],
      },
    });
    expect(role).toBe("incumbent");
  });

  it("classifies as joiner when openConversationId does not match oldConversationId", () => {
    const role = classifyUpgrade({
      selfEmail: "c@x.com",
      openConversationId: null,
      payload: {
        oldConversationId: "conv-a__b",
        participantIds: ["a@x.com", "b@x.com", "c@x.com"],
      },
    });
    expect(role).toBe("joiner");
  });
});
