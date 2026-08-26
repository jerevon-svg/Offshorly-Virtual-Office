import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComment,
  createFeedPost,
  fetchFeed,
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
});
