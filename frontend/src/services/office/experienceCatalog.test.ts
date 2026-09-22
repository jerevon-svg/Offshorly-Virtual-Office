import { beforeEach, describe, expect, it, vi } from "vitest";

// The one seam this module reaches the network through. Mocked here so every case is about what the
// module does with an ANSWER, not about fetch.
// THE TRANSPORT SEAM. This module talks to the VO backend directly (VITE_CHAT_SOCKET_URL), the way
// every other VO-backend client does — NOT through apiFetch, which targets Atlas. So the seam under
// test is global fetch plus the identity the module decides to send.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", (...args: unknown[]) => fetchMock(...args));

// getAuthToken is the other half of the seam: with no dev identity and no token there is nobody to
// ask as, and the module must not issue a request at all. Defaults to "signed in".
const getAuthToken = vi.fn<() => string | null>(() => "a-token");
vi.mock("../api/client", () => ({ getAuthToken: () => getAuthToken() }));

const BASE = "http://vo-backend.test";

import {
  PERMANENT_FALLBACK,
  allowedExperiences,
  fetchExperienceCatalog,
  setDefaultExperience,
  setDevIdentity,
  setExperiencePublication,
} from "./experienceCatalog";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function failure(status: number, body?: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
  } as Response;
}

const SERVER_ANSWER = {
  available: ["v2", "classic"],
  previewable: [],
  default: "v2",
  creator: false,
  publications: [
    { experience: "halloween", published: false, implemented: false, updatedBy: null, updatedAt: null },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  getAuthToken.mockReset();
  getAuthToken.mockReturnValue("a-token");
  setDevIdentity(null);
  vi.stubEnv("VITE_CHAT_SOCKET_URL", BASE);
});

describe("reading the catalog", () => {
  it("asks the server once, at the documented path", async () => {
    fetchMock.mockResolvedValue(ok(SERVER_ANSWER));
    const catalog = await fetchExperienceCatalog();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/office/experience`, expect.anything());
    expect(catalog.status).toBe("ok");
    expect(catalog.available).toEqual(["v2", "classic"]);
    expect(catalog.publications[0].experience).toBe("halloween");
  });

  it("carries a Creator's private previews through", async () => {
    fetchMock.mockResolvedValue(
      ok({ ...SERVER_ANSWER, creator: true, previewable: ["halloween"] }),
    );
    const catalog = await fetchExperienceCatalog();
    expect(catalog.creator).toBe(true);
    expect(catalog.previewable).toEqual(["halloween"]);
    expect(allowedExperiences(catalog)).toEqual(["v2", "classic", "halloween"]);
  });

  it("DROPS a previewable set from a response that does not claim Creator", async () => {
    // Defence in depth: the server never sends this combination, and if something ever did, a
    // preview list without the capability that justifies it is not a thing this client will act on.
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, creator: false, previewable: ["halloween"] }));
    const catalog = await fetchExperienceCatalog();
    expect(catalog.previewable).toEqual([]);
    expect(allowedExperiences(catalog)).toEqual(["v2", "classic"]);
  });

  it("ignores identifiers this build does not know", async () => {
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, available: ["v2", "classic", "easter"] }));
    const catalog = await fetchExperienceCatalog();
    expect(catalog.available).toEqual(["v2", "classic"]);
  });

  it("re-adds the permanent offices to any answer that omits them", async () => {
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, available: [] }));
    const catalog = await fetchExperienceCatalog();
    // There is no response after which an employee has nowhere to go.
    expect(catalog.available).toEqual(["v2", "classic"]);
  });

  it("refuses a default naming something the caller cannot open", async () => {
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, default: "halloween" }));
    expect((await fetchExperienceCatalog()).default).toBe("v2");
  });
});

describe("a read that fails", () => {
  it("falls back to the permanent offices on a non-OK response", async () => {
    fetchMock.mockResolvedValue(failure(500));
    expect(await fetchExperienceCatalog()).toEqual(PERMANENT_FALLBACK);
  });

  it("falls back on a thrown network error rather than rejecting", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchExperienceCatalog()).toEqual(PERMANENT_FALLBACK);
  });

  it("falls back on a body that is not the shape it claims", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("html");
      },
    } as unknown as Response);
    expect(await fetchExperienceCatalog()).toEqual(PERMANENT_FALLBACK);
  });

  it("the fallback can never widen what is allowed", () => {
    expect(allowedExperiences(PERMANENT_FALLBACK)).toEqual(["v2", "classic"]);
    expect(PERMANENT_FALLBACK.creator).toBe(false);
    expect(PERMANENT_FALLBACK.default).toBe("v2");
    expect(PERMANENT_FALLBACK.status).toBe("unavailable");
  });
});

describe("Creator writes", () => {
  it("sends a publication change as a PUT on the experience's own path", async () => {
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, creator: true, available: ["v2", "classic", "halloween"] }));
    const catalog = await setExperiencePublication("halloween", true, "October");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/office/experience/halloween/publication`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ published: true, note: "October" }));
    expect(catalog.available).toContain("halloween");
  });

  it("sends a default change as a PUT with the experience in the body", async () => {
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, creator: true, default: "classic" }));
    const catalog = await setDefaultExperience("classic");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/office/experience/default`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ experience: "classic" }));
    expect(catalog.default).toBe("classic");
  });

  it("REJECTS on failure, unlike a read, and surfaces the server's own words", async () => {
    // A failed read has a correct silent fallback. A failed write must never look like it worked.
    fetchMock.mockResolvedValue(
      failure(400, { error: "'halloween' has no decoration layer in this build and cannot be published yet." }),
    );
    await expect(setExperiencePublication("halloween", true)).rejects.toThrow("no decoration layer");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(failure(403));
    await expect(setDefaultExperience("classic")).rejects.toThrow("403");
  });
});

// ══ REGRESSION: THIS READ MUST NEVER SEND ANYBODY TO THE LOGIN PAGE ══
//
// apiFetch navigates the document to the Atlas login path when there is no token, BEFORE it throws —
// right for the auth gate, wrong for an optional background read, and impossible to undo from a
// catch. It took the local mock rig off the air: VITE_AUTH_GATE=off seeds a dev identity without a
// token, so every load bounced out of Vite's /virtual-office/ base to /login.
//
// The same rule every other session-optional client already documents in its own header
// (dev/vo3d/adapters/v1Identity and friends: "issues no request, and cannot trigger apiFetch's
// 401 -> /login redirect").
describe("with no auth token", () => {
  beforeEach(() => {
    getAuthToken.mockReturnValue(null);
  });

  it("does not call apiFetch at all", async () => {
    await fetchExperienceCatalog();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers with the permanent offices, exactly as a failed read does", async () => {
    expect(await fetchExperienceCatalog()).toEqual(PERMANENT_FALLBACK);
  });

  it("still asks when a token IS present — the guard is about absence, not about caution", async () => {
    getAuthToken.mockReturnValue("a-token");
    fetchMock.mockResolvedValue(ok(SERVER_ANSWER));
    expect((await fetchExperienceCatalog()).status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/office/experience`, expect.anything());
  });

  it("leaves a 401 mid-session to apiFetch, which is the authority on a session ending", async () => {
    // A token that exists but is stale is a DIFFERENT fact from no token at all, and apiFetch's own
    // 401 handling is untouched by the guard.
    getAuthToken.mockReturnValue("a-stale-token");
    fetchMock.mockResolvedValue(failure(401));
    expect(await fetchExperienceCatalog()).toEqual(PERMANENT_FALLBACK);
    expect(fetchMock).toHaveBeenCalled();
  });
});

// ══ BLOCKER REGRESSIONS: WHICH BACKEND, AND WHICH IDENTITY ══
//
// /office/experience is a VIRTUAL OFFICE backend route, not an Atlas one. The first cut of this
// module used apiFetch, which builds URLs from VITE_API_URL — Atlas in production. That would have
// 404'd into the silent permanent-offices fallback on every production load: no season publishable,
// no Creator Studio, and nothing reporting a fault, because a failed read is a legitimate state.
describe("the backend it addresses", () => {
  it("uses the VO backend base, never the Atlas one", async () => {
    fetchMock.mockResolvedValue(ok(SERVER_ANSWER));
    await fetchExperienceCatalog();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${BASE}/office/experience`);
  });

  it("degrades to the permanent offices when no VO backend is configured", async () => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "");
    expect(await fetchExperienceCatalog()).toEqual(PERMANENT_FALLBACK);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FAILS LOUDLY on a write with no backend — a Creator must never think it worked", async () => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "");
    await expect(setDefaultExperience("classic")).rejects.toThrow(/not configured/i);
  });
});

describe("the identity it sends", () => {
  it("sends the bearer token when there is one", async () => {
    fetchMock.mockResolvedValue(ok(SERVER_ANSWER));
    await fetchExperienceCatalog();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer a-token");
  });

  it("sends the dev header instead on the local rig, where no token exists", async () => {
    // VITE_AUTH_GATE=off seeds a dev identity and never writes a token. Without this the Creator
    // Studio could not be exercised locally at all — the catalog read had nobody to ask as.
    getAuthToken.mockReturnValue(null);
    setDevIdentity("Tester@Example.com ");
    fetchMock.mockResolvedValue(ok({ ...SERVER_ANSWER, creator: true }));
    const catalog = await fetchExperienceCatalog();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-dev-email")).toBe("tester@example.com");
    expect(headers.get("Authorization")).toBeNull();
    expect(catalog.creator).toBe(true);
  });

  it("carries the dev identity on writes too", async () => {
    getAuthToken.mockReturnValue(null);
    setDevIdentity("tester@example.com");
    fetchMock.mockResolvedValue(ok(SERVER_ANSWER));
    await setDefaultExperience("classic");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-dev-email")).toBe("tester@example.com");
  });
});
