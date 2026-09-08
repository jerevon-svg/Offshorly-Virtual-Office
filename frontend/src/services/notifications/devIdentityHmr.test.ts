// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — same
// exemption services/attendance/mockRigConfig.test.ts takes. vitest runs in Node with
// cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("socket.io-client", () => ({ io: () => ({ on: () => {}, disconnect: () => {} }) }));

// REGRESSION GUARD for "Notifications: Missing Authorization bearer token" (2026-09-08).
//
// ROOT CAUSE. Each of these modules holds the dev identity as MODULE-LEVEL state that
// useAuthGate seeds exactly once, at gate time. A Vite hot update re-executes the module and
// resets it to null; the gate never re-runs, so every later request went out with neither
// `x-dev-email` nor a bearer token and the backend answered "Missing Authorization bearer token".
//
// WHY THE EXISTING GUARD DID NOT CATCH IT. The files called `import.meta.hot.invalidate()` and
// nothing else. Vite's dev server ignores an invalidate unless the module is SELF-ACCEPTING —
// `invalidateModule()` is gated on `mod.isSelfAccepting && mod.lastHMRTimestamp > 0` — and a
// module only becomes self-accepting by calling `import.meta.hot.accept()`. With no accept() in
// the file the invalidate was a silent no-op, so the guard read as if it worked while doing
// nothing at all.
//
// `import.meta.hot` is undefined under vitest, so the guard cannot be executed here. What IS
// checkable, and what actually regressed, is its SHAPE: an hmr block that recovers a one-shot
// identity must accept() (or it is inert) and must reload (or the identity stays null).

const FILES = [
  "src/services/notifications/notificationsClient.ts",
  "src/services/notifications/notificationsStore.ts",
  // Same one-shot identity, same broken guard, same fix — feedClient is where the pattern
  // originated, so it is held to the invariant too.
  "src/services/feed/feedClient.ts",
  // Added 2026-09-08: questsClient serves /quests/me, /missions/me, /progression/me and
  // /badges/me and holds the identical one-shot devEmail, but the original fix never covered it —
  // so the badges/progression path kept 401ing after a hot update while notifications recovered.
  "src/services/quests/questsClient.ts",
];

describe.each(FILES)("%s guards its one-shot dev identity", (file) => {
  const source = readFileSync(file, "utf8");

  it("holds the dev identity as one-shot module state seeded from outside", () => {
    expect(source).toMatch(/let devEmail: string \| null = null;/);
    expect(source).toMatch(/export function setDevIdentity\(/);
  });

  it("becomes self-accepting, so its hmr block is not a silent no-op", () => {
    expect(source).toMatch(/import\.meta\.hot\.accept\(/);
  });

  it("recovers by reloading, which is the only thing that re-runs the gate", () => {
    const block = /if \(import\.meta\.hot\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    expect(block).toMatch(/window\.location\.reload\(\)/);
  });

  it("never relies on invalidate() alone", () => {
    // An `invalidate()` with no `accept()` anywhere in the file is exactly the inert guard.
    if (/import\.meta\.hot\.invalidate\(/.test(source)) {
      expect(source).toMatch(/import\.meta\.hot\.accept\(/);
    }
  });
});

describe("authenticated requests use the one established mechanism", () => {
  it("sends x-dev-email once the gate has seeded it, and a bearer token otherwise", async () => {
    vi.resetModules();
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        calls.push(init);
        return { ok: true, status: 200, json: async () => ({ notifications: [], unreadCount: 0 }) } as Response;
      }),
    );
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "token" ? "atlas-jwt" : null),
      setItem: () => {},
      removeItem: () => {},
    });

    const store = await import("./notificationsStore");
    const client = await import("./notificationsClient");

    // Real bearer-token mode: no dev identity was ever seeded (the gate ran for real).
    await client.fetchNotifications();
    expect((calls[0].headers as Headers).get("Authorization")).toBe("Bearer atlas-jwt");
    expect((calls[0].headers as Headers).get("x-dev-email")).toBeNull();

    // Dev-bypass mode: the gate seeds through the STORE, which must reach the REST client too —
    // one call, one identity, no second auth path.
    store.setDevIdentity("Alex@Offshorly.com");
    await client.fetchNotifications();
    expect((calls[1].headers as Headers).get("x-dev-email")).toBe("alex@offshorly.com");
    expect((calls[1].headers as Headers).get("Authorization")).toBeNull();

    vi.unstubAllGlobals();
  });
});
