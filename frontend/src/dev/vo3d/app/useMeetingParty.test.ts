import { describe, expect, it } from "vitest";
import { INSTANT_MEETING_CONTEXT, instantTarget, scheduledTarget } from "./useMeetingParty";
import type { ScheduledMeeting } from "../../../services/meetings/scheduledMeetingsClient";

// GO TOGETHER for a meeting: the destination, and who may still be invited — never somebody already in it.

describe("Go Together targets", () => {
  it("instant: the room, and the invited people who have not arrived (not the host, not self)", () => {
    const t = instantTarget("mf-foxtrot", "floor-2/foxtrot", "Foxtrot",
      { meetingId: "mf-foxtrot", participants: ["alex@x"], host: "alex@x", invited: ["Bon@x", "jan@x", "alex@x"] }, "bon@x");
    expect([...t.candidates]).toEqual(["jan@x"]);
    expect(t.destination).toMatchObject({ floor: "floor-2", roomId: "floor-2/foxtrot", context: { kind: INSTANT_MEETING_CONTEXT, id: "mf-foxtrot" } });
  });

  it("instant: nobody left to travel with → no candidates (Go Together is not offered)", () => {
    const t = instantTarget("mf-foxtrot", "floor-2/foxtrot", "Foxtrot", { meetingId: "mf-foxtrot", participants: ["alex@x"], host: "alex@x" }, "bon@x");
    expect(t.candidates.size).toBe(0);
  });

  it("scheduled: attendees minus anybody already in its live meeting (a late arrival collects nobody)", () => {
    const m = {
      id: "b-1", roomId: "floor-2/alpha", title: "Product Sync", organizerEmail: "org@x", startsAt: "", endsAt: "",
      invitees: [{ email: "alex@x", response: "accepted" }, { email: "jan@x", response: "accepted" }, { email: "micah@x", response: "declined" }],
    } as unknown as ScheduledMeeting;
    const t = scheduledTarget(m, "alex@x", { meetingId: "mf-alpha", participants: ["org@x"], host: "org@x" });
    expect([...t.candidates]).toEqual(["jan@x"]);
  });
});
