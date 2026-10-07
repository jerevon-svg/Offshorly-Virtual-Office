import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GO TOGETHER PHASE 5 — the Travel Chat's client side: this journey's lines only, a small rolling window,
// no recipient list on the wire, and nothing left behind when the party ends or changes.

const handlers = new Map<string, (p: unknown) => void>();
const emitted: Array<{ event: string; payload: unknown }> = [];

vi.mock("socket.io-client", () => ({
  io: () => ({
    id: "sock-1",
    on: (event: string, cb: (p: unknown) => void) => { handlers.set(event, cb); },
    emit: (event: string, payload?: unknown) => { emitted.push({ event, payload }); },
    disconnect: () => {},
  }),
}));
vi.mock("../api/client", () => ({ getAuthToken: () => "token" }));

const fire = (event: string, payload: unknown) => handlers.get(event)?.(payload);
const party = (partyId: string) => ({ party: { partyId, destination: { floor: "floor-2", label: "Foxtrot" } }, controllerSid: "sock-1" });
const line = (partyId: string, id: string, text = id) => ({ partyId, id, email: "Alex@X.com", text, atMs: 1 });

async function load() {
  vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:9999");
  const mod = await import("./travelPartyStore");
  mod.resetTravelPartyStoreForTests();
  renderHook(() => mod.useTravelParty());
  return mod;
}

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  vi.resetModules();
});

describe("travel chat in the party store", () => {
  it("keeps only this party's lines, once each, in a small rolling window", async () => {
    const m = await load();
    fire("travel_party", party("p1"));
    fire("party_chat", line("other", "x"));
    fire("party_chat", line("p1", "a"));
    fire("party_chat", line("p1", "a"));
    expect(m.getTravelPartySnapshot().chat.map((c) => c.id)).toEqual(["a"]);
    expect(m.getTravelPartySnapshot().chat[0].email).toBe("alex@x.com");
    for (let i = 0; i < 10; i++) fire("party_chat", line("p1", `n${i}`));
    expect(m.getTravelPartySnapshot().chat).toHaveLength(m.TRAVEL_CHAT_WINDOW);
    expect(m.getTravelPartySnapshot().chat.at(-1)?.id).toBe("n9");
  });

  it("sends text only — the server picks the party and the recipients", async () => {
    const m = await load();
    m.sendTravelChat("  hello  ");
    m.sendTravelChat("   ");
    expect(emitted.filter((e) => e.event === "party_chat_send")).toEqual([{ event: "party_chat_send", payload: { text: "hello" } }]);
  });

  it("forgets the conversation when the party ends, changes, or the overlay clears it", async () => {
    const m = await load();
    fire("travel_party", party("p1"));
    fire("party_chat", line("p1", "a"));
    fire("party_updated", party("p1"));
    expect(m.getTravelPartySnapshot().chat).toHaveLength(1); // same journey, stage change: kept
    fire("party_ended", { partyId: "p1", reason: "arrived" });
    expect(m.getTravelPartySnapshot().chat).toEqual([]);

    fire("travel_party", party("p2"));
    fire("party_chat", line("p2", "b"));
    fire("party_updated", party("p3"));
    expect(m.getTravelPartySnapshot().chat).toEqual([]);

    fire("party_chat", line("p3", "c"));
    m.clearTravelChat();
    expect(m.getTravelPartySnapshot().chat).toEqual([]);
  });
});
