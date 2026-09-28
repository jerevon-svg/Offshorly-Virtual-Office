import { describe, expect, it } from "vitest";
import { LEAVE_GRACE_MS, JOIN_RETRY_MS, MeetingArrival, physicallyInMeeting, type ArrivalBody, type MeetingIntent } from "./meetingArrival";
import { MEETING_ROOMS, meetingRoomAt } from "../rooms/floor2Meeting";

// VO MEETINGS ARE PHYSICAL — Accept → Travel → ARRIVE → Join, and leaving the room leaves the meeting.

const FOXTROT: MeetingIntent = { meetingId: "mf-foxtrot", roomId: "floor-2/foxtrot", kind: "instant" };
const ALPHA_B: MeetingIntent = { meetingId: "mf-alpha", roomId: "floor-2/alpha", kind: "scheduled", bookingStartsAt: "2026-09-28T07:45:00Z" };

function rig() {
  const s = {
    body: { room: null, atDoor: null, travelling: false } as ArrivalBody,
    connected: null as { meetingId: string; roomId: string } | null,
    live: new Set<string>(),
    liveBooking: new Map<string, string>(),
    joins: [] as string[],
    leaves: 0,
  };
  const a = new MeetingArrival({
    body: () => s.body,
    connected: () => s.connected,
    live: (i) => (i.kind === "instant" ? s.live.has(i.meetingId) : s.liveBooking.get(i.roomId) === i.bookingStartsAt),
    join: (id) => s.joins.push(id),
    leave: () => { s.leaves += 1; s.connected = null; },
  });
  return { s, a };
}

describe("meetingArrival — accepting is intent, not participation", () => {
  it("accepting outside the room joins nothing while travelling; arrival joins", () => {
    const { s, a } = rig();
    s.live.add("mf-foxtrot");
    a.intend(FOXTROT);
    a.tick(0);
    expect(s.joins).toEqual([]); // accepted, not joined: no call, no attendance, no In Meeting, no consent
    expect(a.phase()).toBe("intending");
    s.body = { room: "floor-2/foxtrot", atDoor: null, travelling: true }; // mid-journey through the door
    a.tick(100);
    expect(s.joins).toEqual([]);
    s.body = { room: null, atDoor: "floor-2/foxtrot", travelling: false }; // Walk There's arrival spot
    a.tick(200);
    expect(s.joins).toEqual(["mf-foxtrot"]);
    s.connected = { meetingId: "mf-foxtrot", roomId: "floor-2/foxtrot" };
    a.tick(300);
    expect(a.intent).toBeNull();
    expect(a.phase()).toBe("joined");
  });

  it("already inside when accepting: joins on the next tick with no travel", () => {
    const { s, a } = rig();
    s.live.add("mf-foxtrot");
    s.body = { room: "floor-2/foxtrot", atDoor: null, travelling: false };
    a.intend(FOXTROT);
    expect(a.arrivedAt("floor-2/foxtrot")).toBe(true);
    a.tick(0);
    expect(s.joins).toEqual(["mf-foxtrot"]);
  });

  it("an instant meeting not yet heard live waits; seen live then gone drops the intent", () => {
    const { s, a } = rig();
    s.body = { room: "floor-2/foxtrot", atDoor: null, travelling: false };
    a.intend(FOXTROT);
    a.tick(0);
    expect(s.joins).toEqual([]);
    expect(a.intent).not.toBeNull(); // presence not heard yet: never dropped on an empty first look
    s.body = { room: null, atDoor: null, travelling: false };
    s.live.add("mf-foxtrot");
    a.tick(100);
    s.live.clear();
    a.tick(200);
    expect(a.intent).toBeNull();
  });

  it("a scheduled intent joins only while THIS booking is the one running in the room", () => {
    const { s, a } = rig();
    s.body = { room: "floor-2/alpha", atDoor: null, travelling: false };
    a.intend(ALPHA_B);
    s.liveBooking.set("floor-2/alpha", "2026-09-28T07:00:00Z"); // an earlier meeting overrunning in the room
    a.tick(0);
    expect(s.joins).toEqual([]);
    s.liveBooking.set("floor-2/alpha", ALPHA_B.bookingStartsAt!);
    a.tick(100);
    expect(s.joins).toEqual(["mf-alpha"]);
  });

  it("a failed join is retried, but not in a tight loop", () => {
    const { s, a } = rig();
    s.live.add("mf-foxtrot");
    s.body = { room: "floor-2/foxtrot", atDoor: null, travelling: false };
    a.intend(FOXTROT);
    a.tick(0);
    a.tick(250);
    expect(s.joins).toHaveLength(1);
    a.tick(JOIN_RETRY_MS + 1);
    expect(s.joins).toHaveLength(2);
  });
});

describe("meetingArrival — overtime and the physical leave", () => {
  it("in overrunning meeting A with an accepted meeting B: stays in A, joins nothing, moves nobody", () => {
    const { s, a } = rig();
    s.connected = { meetingId: "mf-foxtrot", roomId: "floor-2/foxtrot" };
    s.body = { room: "floor-2/foxtrot", atDoor: null, travelling: false };
    s.liveBooking.set("floor-2/alpha", ALPHA_B.bookingStartsAt!); // B has started
    a.intend(ALPHA_B);
    for (let t = 0; t < 20_000; t += 250) a.tick(t);
    expect(s.joins).toEqual([]);
    expect(s.leaves).toBe(0);
    expect(a.phase()).toBe("intending");
    // A ends (the ordinary leave), Alex walks over; B joins only on arrival
    s.connected = null;
    s.body = { room: null, atDoor: null, travelling: true };
    a.tick(20_250);
    expect(s.joins).toEqual([]);
    s.body = { room: "floor-2/alpha", atDoor: null, travelling: false };
    a.tick(20_500);
    expect(s.joins).toEqual(["mf-alpha"]);
  });

  it("leaving the room leaves the meeting after the grace; the doorway counts as in", () => {
    const { s, a } = rig();
    s.connected = { meetingId: "mf-foxtrot", roomId: "floor-2/foxtrot" };
    s.body = { room: null, atDoor: "floor-2/foxtrot", travelling: false };
    a.tick(0);
    a.tick(LEAVE_GRACE_MS * 2);
    expect(s.leaves).toBe(0);
    s.body = { room: null, atDoor: null, travelling: false };
    a.tick(10_000);
    a.tick(10_000 + LEAVE_GRACE_MS - 1);
    expect(s.leaves).toBe(0);
    s.body = { room: "floor-2/foxtrot", atDoor: null, travelling: false }; // stepped back in: grace resets
    a.tick(10_000 + LEAVE_GRACE_MS);
    s.body = { room: null, atDoor: null, travelling: true }; // a lift ride away is leaving too
    a.tick(20_000);
    a.tick(20_000 + LEAVE_GRACE_MS);
    expect(s.leaves).toBe(1);
  });
});

describe("physicallyInMeeting", () => {
  it("needs BOTH participation and the body in that meeting's room", () => {
    const where: Record<string, string | null> = { "alex@x": "floor-2/foxtrot", "bon@x": null, "jan@x": "floor-2/alpha", "eve@x": "floor-2/foxtrot" };
    const out = physicallyInMeeting(
      [{ meetingId: "mf-foxtrot", participants: ["Alex@x", "bon@x", "jan@x"] }],
      (id) => (id === "mf-foxtrot" ? "floor-2/foxtrot" : null),
      (e) => where[e] ?? null,
    );
    // Bon is connected but not in the room; Jan is in another room; Eve is in the room but not participating
    expect([...out]).toEqual(["alex@x"]);
  });
});

describe("the physical-leave rule never evicts a seated or presenting attendee", () => {
  it("every chair, armchair and sofa of every meeting room is inside that room", () => {
    for (const r of MEETING_ROOMS) {
      for (const seat of r.seats) expect(meetingRoomAt(seat)?.id, `${r.id} chair`).toBe(r.id);
      for (const seat of r.lounge?.armchairs ?? []) expect(meetingRoomAt(seat)?.id, `${r.id} armchair`).toBe(r.id);
      for (const seat of r.corner?.armchairs ?? []) expect(meetingRoomAt(seat)?.id, `${r.id} corner armchair`).toBe(r.id);
      const sofa = r.lounge?.sofa.rect;
      if (sofa) expect(meetingRoomAt({ x: sofa.x + sofa.w / 2, z: sofa.z + sofa.d / 2 })?.id, `${r.id} sofa`).toBe(r.id);
    }
  });
});
