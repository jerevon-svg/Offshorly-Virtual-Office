// self-auth.test.mjs — the VO ↔ Studio bridge derives the person from VO's own backend session, never from the client. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/studio/self-auth.test.mjs
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { allowedApis, claimOwner, parseAvatarRegistry, personIdForEmail, resolveSelf } from "./self-auth.mjs";

const registry = parseAvatarRegistry(fs.readFileSync("src/data/avatarRegistry.ts", "utf8"));
const allowed = new Set(["http://localhost:8002"]), me = (email, status = 200) => async () => ({ status, ok: status < 400, json: async () => ({ email }) });

describe("who is asking (studio/self-auth.mjs)", () => {
  it("uses the app's own email → avatar-id rule: registry exceptions, else the localpart", () => {
    expect(registry["jerevon@offshorly.com"]).toBe("bon"); expect(registry["louiejie@offshorly.com"]).toBe("lui");
    expect(personIdForEmail("JEREVON@offshorly.com", registry)).toBe("bon"); expect(personIdForEmail("new.hire@offshorly.com", registry)).toBe("newhire"); expect(personIdForEmail("not an email", registry)).toBeNull(); });
  it("resolves the person from VO's backend session — a client-named person is never consulted", async () => {
    const r = await resolveSelf({ authorization: "Bearer t", voApi: "http://localhost:8002/" }, { allowed, registry, fetchFn: me("louiejie@offshorly.com") }); expect(r).toEqual({ personId: "lui", email: "louiejie@offshorly.com" }); });
  it("refuses an unconfigured backend (a client cannot point the check at its own server), a missing token and an expired session", async () => {
    expect((await resolveSelf({ authorization: "Bearer t", voApi: "http://evil.example" }, { allowed, registry, fetchFn: me("x@offshorly.com") })).status).toBe(403);
    expect((await resolveSelf({ authorization: "", voApi: "http://localhost:8002" }, { allowed, registry, fetchFn: me("x@offshorly.com") })).status).toBe(401);
    expect((await resolveSelf({ authorization: "Bearer t", voApi: "http://localhost:8002" }, { allowed, registry, fetchFn: me(null, 401) })).status).toBe(401); });
  it("reads the backend URLs the app is configured with", () => { expect(allowedApis(".").size).toBeGreaterThan(0); });
  it("never hands a registry-owned id to another email, and the owner ledger refuses a second email for one id", () => {
    expect(personIdForEmail("bon@offshorly.com", registry)).toBeNull(); expect(personIdForEmail("lui@gmail.com", registry)).toBeNull();
    const a = claimOwner({}, "newhire", "new.hire@offshorly.com"); expect(a.ok).toBe(true); expect(a.ledger).toEqual({ newhire: "new.hire@offshorly.com" });
    expect(claimOwner(a.ledger, "newhire", "new.hire@offshorly.com")).toEqual({ ok: true, ledger: a.ledger });
    expect(claimOwner(a.ledger, "newhire", "newhire@offshorly.com").ok).toBe(false); });
  it("dev-user mode acts only as the person the operator configured — the request's token and backend are not consulted", async () => {
    const r = await resolveSelf({ authorization: "", voApi: "http://evil.example" }, { allowed, registry, devUser: "New.Hire@offshorly.com", fetchFn: async () => { throw new Error("must not be called"); } });
    expect(r).toEqual({ personId: "newhire", email: "new.hire@offshorly.com", dev: true }); });
});
