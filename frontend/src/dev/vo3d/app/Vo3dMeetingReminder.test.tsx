import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const NOW = Date.parse("2026-09-27T10:56:00Z");
const START = "2026-09-27T11:00:00Z";
const meeting = {
  id: "m1", title: "Product Sync", roomId: "floor-2/foxtrot", startsAt: START, endsAt: "2026-09-27T11:30:00Z",
  status: "scheduled", isPrivate: false, organizerEmail: "alex@x.com",
  invitees: [{ email: "jan@x.com", response: "accepted" }],
};
let presence: Record<string, unknown> = {};
vi.mock("../../../services/notifications/notificationsStore", () => ({
  markRead: vi.fn(),
  useNotifications: () => ({ notifications: [{ id: "n1", type: "meeting_reminder", readAt: null, navPayload: { meetingId: "m1" } }] }),
}));
vi.mock("../../../services/meetings/scheduledMeetingsStore", () => ({
  useNow: () => NOW,
  useScheduledMeetings: () => ({ mine: [meeting], floor: [], presence, loading: false, error: null, revision: 1 }),
}));

import { Vo3dMeetingReminder } from "./Vo3dMeetingReminder";

const worldRef = { current: null };
const show = () => render(<Vo3dMeetingReminder worldRef={worldRef} ready={false} selfId="jan@x.com" onOpen={() => {}} />);

describe("Vo3dMeetingReminder — a scheduled meeting its host started early", () => {
  it("before anyone starts it: counts down", () => {
    presence = {};
    show();
    expect(screen.getByTestId("meeting-reminder-when").textContent).toMatch(/^Starts in 4 min/);
  });
  it("once THIS booking is live ahead of time: says Started early and In progress, not Starts in", () => {
    presence = { "mf-foxtrot": { live: true, booking: { startsAt: START, endsAt: "2026-09-27T11:30:00Z", isPrivate: false } } };
    show();
    expect(screen.getByTestId("meeting-reminder-when").textContent).toMatch(/^Started early/);
    expect(screen.getByTestId("meeting-reminder-room").textContent).toMatch(/^In progress in Foxtrot/);
  });
  it("another (ad-hoc) meeting in the room is not this one starting early", () => {
    presence = { "mf-foxtrot": { live: true, booking: null } };
    show();
    expect(screen.getByTestId("meeting-reminder-when").textContent).toMatch(/^Starts in/);
  });
});
