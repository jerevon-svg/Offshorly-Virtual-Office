import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  getAuthToken: vi.fn(() => "fake-token"),
}));

import {
  WhiteboardConflictError,
  createWhiteboard,
  getWhiteboard,
  listWhiteboards,
  saveWhiteboard,
  setDevIdentity,
} from "./whiteboardClient";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  import.meta.env.VITE_CHAT_SOCKET_URL = "http://localhost:8002/";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setDevIdentity(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whiteboardClient", () => {
  it("lists boards for a conversation with the bearer token and a trimmed base URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ id: "b1", title: "Plan" }]));
    const boards = await listWhiteboards("conv 1");
    expect(boards).toEqual([{ id: "b1", title: "Plan" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8002/conversations/conv%201/whiteboards");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fake-token");
  });

  it("uses the dev identity header instead of the bearer token when seeded", async () => {
    setDevIdentity(" Bon@Example.com ");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "b1", document: null }));
    await getWhiteboard("b1");
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-dev-email")).toBe("bon@example.com");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("creates a board with a JSON title body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "b2", title: "Retro", version: 1 }));
    const board = await createWhiteboard("c1", "Retro");
    expect(board.id).toBe("b2");
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Retro" });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("saves document + loaded version and surfaces a 409 as WhiteboardConflictError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "b1", version: 3 }));
    const saved = await saveWhiteboard("b1", { document: {} }, 2);
    expect(saved.version).toBe(3);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ document: { document: {} }, version: 2 });

    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "stale" }));
    await expect(saveWhiteboard("b1", {}, 2)).rejects.toBeInstanceOf(WhiteboardConflictError);
  });

  it("maps other HTTP errors to a plain Error carrying the server detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: "Not a participant in this conversation" }));
    await expect(listWhiteboards("c1")).rejects.toThrow(/Not a participant/);
  });
});
