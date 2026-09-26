import { describe, expect, it } from "vitest";
import { destinationFor, iconFor } from "./NotificationCenter";
import type { AppNotification } from "../../services/notifications/notificationsClient";

const n = (over: Partial<AppNotification>): AppNotification => ({
  id: "1", type: "meeting_reminder", title: "Starting soon: Design Sync", body: "Room Alpha · Meeting Floor",
  navKind: "meeting", navPayload: { meetingId: "m-1" }, readAt: null, createdAt: "2026-10-01T00:00:00Z", ...over,
});

describe("meeting notifications", () => {
  it("route to the meeting by id alone", () => {
    expect(destinationFor(n({}))).toEqual({ kind: "meeting", meetingId: "m-1" });
    expect(destinationFor(n({ navPayload: {} }))).toBeNull();
  });
  it("use the clock icon", () => {
    for (const type of ["meeting_invited", "meeting_updated", "meeting_cancelled", "meeting_reminder"]) {
      expect(iconFor(n({ type }))).toBe("clock");
    }
  });
});
