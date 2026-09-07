import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealTeamMapService,
  resetRealTeamMapServiceForTests,
  setDevIdentity,
} from "./RealTeamMapService";

const snapshot = { people: [], source: "atlas", generated_at: "2026-09-07T00:00:00Z" };

describe("RealTeamMapService", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:8002/");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetRealTeamMapServiceForTests();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("calls the VO backend (never Atlas) with the Atlas bearer token", async () => {
    window.localStorage.setItem("token", "atlas-jwt");
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(snapshot) });
    const result = await new RealTeamMapService().getPeople();
    expect(result).toEqual(snapshot);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8002/team-map/people");
    expect((init.headers as Headers).get("authorization")).toBe("Bearer atlas-jwt");
  });

  it("sends x-dev-email instead of a token under the dev bypass", async () => {
    setDevIdentity("Bon@Offshorly.com");
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(snapshot) });
    await new RealTeamMapService().getPeople();
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("x-dev-email")).toBe("bon@offshorly.com");
    expect(headers.has("authorization")).toBe(false);
  });

  it("POSTs a Working Today fix to the VO backend only, POSTs stop, and DELETEs to forget", async () => {
    window.localStorage.setItem("token", "atlas-jwt");
    const share = { latitude: 14.55, longitude: 121.02, location_label: "Makati, Philippines" };
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(share) });
    const svc = new RealTeamMapService();
    const result = await svc.shareWorkingToday({ latitude: 14.551234, longitude: 121.027654 });
    expect(result).toEqual(share);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8002/team-map/working-today");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ latitude: 14.551234, longitude: 121.027654 });
    expect((init.headers as Headers).get("authorization")).toBe("Bearer atlas-jwt");
    expect(String(url)).not.toMatch(/atlas/);

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(null) });
    await svc.stopWorkingToday();
    const [stopUrl, stopInit] = fetchMock.mock.calls[1];
    expect(stopUrl).toBe("http://localhost:8002/team-map/working-today/stop");
    expect(stopInit.method).toBe("POST");

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(null) });
    await svc.forgetWorkingToday();
    const [forgetUrl, forgetInit] = fetchMock.mock.calls[2];
    expect(forgetUrl).toBe("http://localhost:8002/team-map/working-today");
    expect(forgetInit.method).toBe("DELETE");
  });

  it("throws on a non-OK response so the panel can show an error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    await expect(new RealTeamMapService().getPeople()).rejects.toThrow(/503/);
  });
});
