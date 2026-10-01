import { describe, expect, it } from "vitest";
import { inTravelChat } from "./travelChat";
import type { PartyWire } from "./goTogether";

// GO TOGETHER PHASE 5 — the client MIRROR of the server's chat_members rule: it only decides whether this
// tab shows the Travel Chat and routes `/` to it; the server still decides who speaks and hears.

const LEAD = "bon@x.com";
const ALEX = "alex@x.com";
const JAN = "jan@x.com";
const IN = "micah@x.com";

function party(stage: PartyWire["stage"], over: Partial<PartyWire> = {}): PartyWire {
  return {
    partyId: "p1",
    leaderEmail: LEAD,
    leaderFollowing: true,
    destination: { floor: "floor-2", label: "Foxtrot", roomId: "floor-2/foxtrot" },
    members: [ALEX, JAN, IN].map((email) => ({ email, following: true, connected: true })),
    pending: [],
    declined: [],
    stage,
    rendezvous: stage === "forming" ? null : { stageId: "p1:rv", kind: "hub", participants: [LEAD, ALEX, JAN, IN], ready: [] },
    leg: null,
    roles: { [LEAD]: "travel", [ALEX]: "travel", [JAN]: "wait", [IN]: "arrived" },
    ...over,
  };
}

describe("inTravelChat", () => {
  it("is on for travellers from Start Walking through every leg, never while forming", () => {
    expect(inTravelChat(party("forming"), ALEX, true)).toBe(false);
    for (const stage of ["gathering", "ready", "to_lift", "ride", "to_room"] as const) {
      expect(inTravelChat(party(stage), ALEX, true)).toBe(true);
      expect(inTravelChat(party(stage), LEAD, true)).toBe(true);
    }
  });

  it("lets the upstairs waiter in only at the merge, and never the one already in the room", () => {
    expect(inTravelChat(party("ride"), JAN, true)).toBe(false);
    expect(inTravelChat(party("to_room"), JAN, true)).toBe(true);
    expect(inTravelChat(party("to_room"), IN, true)).toBe(false);
  });

  it("is off for a paused person, a non-driving tab, someone who left, and outsiders", () => {
    const paused = party("to_lift", { members: [{ email: ALEX, following: false, connected: true }] });
    expect(inTravelChat(paused, ALEX, true)).toBe(false);
    expect(inTravelChat(party("to_lift", { leaderFollowing: false }), LEAD, true)).toBe(false);
    expect(inTravelChat(party("to_lift"), ALEX, false)).toBe(false);
    expect(inTravelChat(party("to_lift", { members: [] }), ALEX, true)).toBe(false);
    expect(inTravelChat(party("to_lift"), "eve@x.com", true)).toBe(false);
    expect(inTravelChat(null, ALEX, true)).toBe(false);
  });
});
