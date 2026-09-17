// Phase 2 — the identity JOIN, tested against V1's real stores rather than a mock of them. The point of
// these cases is that V2 gets the SAME answer V1's own office would, including the answers that are
// deliberately "nobody" and "no character".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveVo3dIdentity } from "./v1Identity";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import { __resetCurrentUserIdForTest } from "../../../auth/useAuthGate";

/** A minimal /auth/me body, in the shape currentUserStore actually parses. */
function signIn(email: string, full_name = "Test Person") {
  setCurrentUserFromMeResponse({ id: "atlas-123", email, full_name, role: "dev", team: null });
}

beforeEach(() => {
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
});
afterEach(() => {
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
  vi.unstubAllEnvs();
});

describe("resolveVo3dIdentity", () => {
  it("returns null when V1 does not know who the user is", () => {
    // currentUserStore is empty — the /auth/me body was missing or unparseable. The honest answer is
    // "no identity", which the world reads as standalone. It must NOT be a guess.
    expect(resolveVo3dIdentity()).toBeNull();
  });

  it("maps a registered employee to their own character via the email override", () => {
    // Bon's Atlas localpart ("jerevon") does not match his character id ("bon") — this is the exact case
    // data/avatarRegistry.ts's override table exists for.
    signIn("jerevon@offshorly.com", "Bon");
    const id = resolveVo3dIdentity();
    expect(id).not.toBeNull();
    expect(id!.avatarId).toBe("bon");
    expect(id!.displayName).toBe("Bon");
  });

  it("maps an employee whose localpart already matches their character id", () => {
    signIn("alex@offshorly.com", "Alex");
    expect(resolveVo3dIdentity()!.avatarId).toBe("alex");
  });

  it("returns avatarId null — never a substitute — for an employee with no registered character", () => {
    signIn("someone.new@offshorly.com", "Someone New");
    const id = resolveVo3dIdentity()!;
    expect(id.avatarId).toBeNull();
    // The whole point: the unmapped person is still IDENTIFIED, they just have no body.
    expect(id.displayName).toBe("Someone New");
  });

  it("does not let a decorative stock-art name collide into a character", () => {
    // "nicole" is a hardcoded Figma decoration in the manifest, not a pipeline avatar. V1 refuses the
    // collision; V2 must inherit that refusal rather than re-deriving it.
    signIn("nicole@offshorly.com", "Nicole");
    expect(resolveVo3dIdentity()!.avatarId).toBeNull();
  });

  it("falls back to the email localpart when /auth/me carried no name", () => {
    signIn("someone.new@offshorly.com", "");
    expect(resolveVo3dIdentity()!.displayName).toBe("someone.new");
  });

  it("discards the unverified employee-id sentinel instead of carrying it", () => {
    // getCurrentUserId() has never been assigned a real id here, so it still reads its private
    // FALLBACK_USER_ID ("bon") — which means BOTH "this is Bon" and "no id field was recognised". An id
    // that ambiguous is not an identity, so it is dropped. The character still resolves from the email.
    signIn("jerevon@offshorly.com", "Bon");
    const id = resolveVo3dIdentity()!;
    expect(id.employeeId).toBeNull();
    expect(id.avatarId).toBe("bon");
  });

  it("reports the dev bypass as its own source and carries no employee id", () => {
    vi.stubEnv("VITE_AUTH_GATE", "off");
    signIn("alex@offshorly.com", "Alex");
    const id = resolveVo3dIdentity()!;
    expect(id.source).toBe("dev-bypass");
    expect(id.employeeId).toBeNull();
    expect(id.avatarId).toBe("alex");
  });

  it("reports a real session as the atlas source", () => {
    signIn("alex@offshorly.com", "Alex");
    expect(resolveVo3dIdentity()!.source).toBe("atlas");
  });

  it("never exposes the email on the identity it returns", () => {
    // Phase 2's readout is rendered from this object; nothing in it may carry the address itself.
    signIn("jerevon@offshorly.com", "Bon");
    expect(JSON.stringify(resolveVo3dIdentity())).not.toContain("@");
  });
});
