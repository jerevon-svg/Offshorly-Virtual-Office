import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ getAuthToken: () => "tok-1" }));
import { getAllOutfits, saveMyWardrobe, setDevIdentity } from "./wardrobeClient";

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); setDevIdentity(null); });

describe("wardrobe client (VO backend)", () => {
  it("sends the session token to the office backend and only nickname + outfit — never a person", async () => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:8002/");
    const f = vi.fn(async () => json({ nickname: "Bonbon", outfit: {}, updatedAt: "x" }));
    vi.stubGlobal("fetch", f);
    await saveMyWardrobe({ nickname: "Bonbon", outfit: { top: { assetId: "tee-offshorly", colorway: "sky" } }, updatedAt: "ignored" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8002/avatar/wardrobe/me");
    expect(init.method).toBe("PUT");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok-1");
    expect(JSON.parse(String(init.body))).toEqual({ nickname: "Bonbon", outfit: { top: { assetId: "tee-offshorly", colorway: "sky" } } });
  });
  it("uses the dev header on the bypassed rig", async () => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:8002");
    setDevIdentity("Jerevon@Offshorly.com");
    const f = vi.fn(async () => json({ outfits: {} })); vi.stubGlobal("fetch", f);
    await getAllOutfits();
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get("x-dev-email")).toBe("jerevon@offshorly.com");
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });
  it("reading every outfit never throws — a failure is nobody has one", async () => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:8002");
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "boom" }, 500)));
    expect(await getAllOutfits()).toEqual({});
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "");
    expect(await getAllOutfits()).toEqual({});
  });
});
