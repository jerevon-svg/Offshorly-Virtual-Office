import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComment,
  createFeedPost,
  fetchFeed,
  giveKudos,
  reactToPost,
  removeReaction,
  resetFeedClientForTests,
  setDevIdentity,
} from "./feedClient";

describe("feedClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    resetFeedClientForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetFeedClientForTests();
  });

  function mockJsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: () => Promise.resolve(body) } as Response;
  }

  it("fetchFeed GETs /feed/{email} with the dev-email header when set", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse([]));

    await fetchFeed("alex@example.com");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/feed/alex%40example.com");
    expect((init?.headers as Headers).get("x-dev-email")).toBe("bon@example.com");
  });

  it("createFeedPost POSTs content as JSON", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ id: "p1" }));

    await createFeedPost("alex@example.com", "Great work!");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/feed/alex%40example.com/posts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ content: "Great work!" });
  });

  it("reactToPost and removeReaction hit the same /react endpoint with POST/DELETE", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ id: "p1" }));

    await reactToPost("p1", "❤️");
    await removeReaction("p1");

    const [, postInit] = vi.mocked(fetch).mock.calls[0];
    const [, deleteInit] = vi.mocked(fetch).mock.calls[1];
    expect(postInit?.method).toBe("POST");
    expect(deleteInit?.method).toBe("DELETE");
  });

  it("createComment includes parentCommentId when replying", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ id: "p1" }));

    await createComment("p1", "Thank you!!", "c1");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({ content: "Thank you!!", parentCommentId: "c1" });
  });

  it("throws with the server's error message on a non-ok response", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ detail: "Post not found" }, false, 404));

    await expect(fetchFeed("alex@example.com")).rejects.toThrow("Post not found");
  });

  // Give Kudos is a Feed write like any other: it MUST carry the same identity the rest of the
  // Feed calls carry, by both mechanisms (dev header locally, bearer token against Atlas).
  // A Kudos that skips this is what produced "Missing Authorization bearer token".
  it("giveKudos sends the same auth headers as createFeedPost, on both mechanisms", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ id: "k1" }));

    setDevIdentity("bon@example.com");
    await giveKudos("alex@example.com", "Saved the release");
    await createFeedPost("alex@example.com", "hi");
    const [kudosDev, postDev] = vi.mocked(fetch).mock.calls;
    expect(String(kudosDev[0])).toContain("/feed/alex%40example.com/kudos");
    expect(kudosDev[1]?.method).toBe("POST");
    expect(JSON.parse(kudosDev[1]?.body as string)).toEqual({ message: "Saved the release" });
    expect((kudosDev[1]?.headers as Headers).get("x-dev-email")).toBe(
      (postDev[1]?.headers as Headers).get("x-dev-email"),
    );
    expect((kudosDev[1]?.headers as Headers).get("Content-Type")).toBe("application/json");

    // Token path: no dev identity, a token in localStorage — the Atlas-authenticated shape.
    vi.mocked(fetch).mockClear();
    setDevIdentity(null);
    window.localStorage.setItem("token", "atlas-token");
    try {
      await giveKudos("alex@example.com", "again");
      await createFeedPost("alex@example.com", "hi");
    } finally {
      window.localStorage.removeItem("token");
    }
    const [kudosTok, postTok] = vi.mocked(fetch).mock.calls;
    expect((kudosTok[1]?.headers as Headers).get("Authorization")).toBe("Bearer atlas-token");
    expect((kudosTok[1]?.headers as Headers).get("Authorization")).toBe(
      (postTok[1]?.headers as Headers).get("Authorization"),
    );
  });
});
