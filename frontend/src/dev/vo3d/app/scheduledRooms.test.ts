import { describe, expect, it } from "vitest";
import { deriveRoomSchedule, type ScheduledBooking } from "./scheduledRooms";

// The Meeting Floor's scheduled-room rules, one room at a time. Times are minutes from a fixed
// 14:00 UTC anchor; the formatter prints "HH:MM" UTC so assertions do not depend on the machine's zone.

const T0 = Date.parse("2026-10-01T14:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const fmt = { time: (iso: string) => iso.slice(11, 16) };

function booking(start: number, end: number, over: Partial<ScheduledBooking> = {}): ScheduledBooking {
  return { startsAt: at(start), endsAt: at(end), isPrivate: false, title: "Product Sync", viewerIsInvitee: true, ...over };
}
const idle = { live: false };
const derive = (b: ScheduledBooking[], live: Parameters<typeof deriveRoomSchedule>[1], nowMin: number) =>
  deriveRoomSchedule(b, live, T0 + nowMin * 60_000, fmt);

describe("door sign", () => {
  it("is Available with no booking in reach", () => {
    expect(derive([], idle, 0).sign).toEqual({ state: "available" });
    expect(derive([booking(60, 120)], idle, 0).sign).toEqual({ state: "available" });
  });

  it("shows Upcoming with the title from 15 minutes out", () => {
    expect(derive([booking(15, 75)], idle, 0).sign).toEqual({ state: "upcoming", line2: "Product Sync · 14:15" });
  });

  it("never shows a private title it was not given", () => {
    const hidden = booking(10, 70, { isPrivate: true, title: null, viewerIsInvitee: false });
    expect(derive([hidden], idle, 0).sign.line2).toBe("Private meeting · 14:10");
    expect(JSON.stringify(derive([hidden], idle, 8))).not.toContain("Product");
  });

  it("says Starting Soon · Private · DND inside a private access window", () => {
    const s = derive([booking(4, 64, { isPrivate: true })], idle, 0).sign;
    expect(s).toEqual({ state: "starting", text: "Starting Soon", line2: "Product Sync · 14:04", sub: "Private · DND" });
    expect(derive([booking(-2, 58)], idle, 0).sign.text).toBe("Ready to start");
  });

  it("goes In Meeting when the booked meeting is live, and back to Available after", () => {
    const b = booking(0, 60, { isPrivate: true });
    const live = { live: true, booking: { startsAt: b.startsAt, endsAt: b.endsAt, isPrivate: true } };
    expect(derive([b], live, 5).sign.state).toBe("private");
    expect(derive([booking(0, 60)], { live: true, booking: { startsAt: at(0), endsAt: at(60), isPrivate: false } }, 5).sign.state).toBe("in-meeting");
    expect(derive([b], idle, 61).sign).toEqual({ state: "available" });
  });
});

describe("occupied / overrun", () => {
  const earlier = booking(0, 60, { title: "Design Review" });
  const next = booking(60, 120, { title: "Product Sync", isPrivate: true });
  const earlierLive = { live: true, booking: { startsAt: earlier.startsAt, endsAt: earlier.endsAt, isPrivate: false } };

  it("keeps the overrunning meeting In Meeting and names the next booking", () => {
    const v = derive([earlier, next], earlierLive, 62);
    expect(v.sign).toEqual({ state: "in-meeting", line2: "Next: Product Sync · 15:00" });
    // The next (private) booking does not take the room over: its door rule is not applied yet.
    expect(v.access).toEqual({ state: "available", selfAuthorized: false });
    expect(v.context?.phase).toBe("occupied");
  });

  it("does not let a private window take over an ad-hoc session, then applies once it empties", () => {
    const priv = booking(0, 60, { isPrivate: true, title: null, viewerIsInvitee: false });
    const adHoc = derive([priv], { live: true, booking: null }, 2);
    expect(adHoc.access.state).toBe("available");
    expect(adHoc.sign).toEqual({ state: "in-meeting", line2: "Next: Private meeting · 14:00" });
    expect(derive([priv], idle, 2).access).toEqual({ state: "active", selfAuthorized: false });
  });

  it("keeps an overrunning PRIVATE meeting shut after its end", () => {
    const priv = booking(0, 60, { isPrivate: true, viewerIsInvitee: false, title: null });
    const v = derive([priv], { live: true, booking: { startsAt: priv.startsAt, endsAt: priv.endsAt, isPrivate: true } }, 75);
    expect(v.access).toEqual({ state: "active", selfAuthorized: false });
    expect(v.sign.state).toBe("private");
  });
});

describe("room access", () => {
  it("shuts a private window to non-invitees and opens it to invitees", () => {
    expect(derive([booking(3, 63, { isPrivate: true, viewerIsInvitee: false })], idle, 0).access).toEqual({ state: "active", selfAuthorized: false });
    expect(derive([booking(3, 63, { isPrivate: true })], idle, 0).access).toEqual({ state: "active", selfAuthorized: true });
    expect(derive([booking(6, 66, { isPrivate: true, viewerIsInvitee: false })], idle, 0).access.state).toBe("available");
    expect(derive([booking(3, 63)], idle, 0).access.state).toBe("available");
  });
});

describe("panel context", () => {
  it("is only for the viewer's own meetings", () => {
    expect(derive([booking(10, 70, { viewerIsInvitee: false })], idle, 0).context).toBeNull();
    expect(derive([booking(10, 70)], idle, 0).context).toMatchObject({ title: "Product Sync", phase: "upcoming" });
    expect(derive([booking(3, 63)], idle, 0).context?.phase).toBe("window");
    const live = { live: true, booking: { startsAt: at(0), endsAt: at(60), isPrivate: false } };
    expect(derive([booking(0, 60)], live, 5).context?.phase).toBe("live");
  });
});
