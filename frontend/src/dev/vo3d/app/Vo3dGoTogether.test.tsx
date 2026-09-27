import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ScheduledMeeting } from "../../../services/meetings/scheduledMeetingsClient";

// Go Together × the meeting reminder — Bon's Phase 2 live test: ONE travel decision per meeting journey.
//   • an invitation for a meeting reads Join / I'll walk there, and "I'll walk there" declines the WALK only
//   • while that invitation (or a party) owns the meeting's journey, the reminder steps aside for it
//   • the party card shows one face per person, its state carried by colour and a badge

const NOW = Date.parse("2026-09-27T10:00:00Z");
const MEETING: ScheduledMeeting = {
  id: "m1", title: "Product sync", roomId: "floor-2/foxtrot", organizerEmail: "alex@x.com",
  startsAt: new Date(NOW + 3 * 60_000).toISOString(), endsAt: new Date(NOW + 33 * 60_000).toISOString(),
  isPrivate: false, status: "scheduled",
  invitees: [{ email: "bon@x.com", response: "accepted" as never }, { email: "jan@x.com", response: "accepted" as never }],
  createdAt: "", updatedAt: "",
};
vi.mock("../../../services/notifications/notificationsStore", () => ({
  useNotifications: () => ({ notifications: [{ id: "n1", type: "meeting_reminder", title: "", body: null, navKind: null, navPayload: { meetingId: "m1" }, readAt: null, createdAt: "" }] }),
  markRead: vi.fn(),
}));
vi.mock("../../../services/meetings/scheduledMeetingsStore", () => ({
  useScheduledMeetings: () => ({ mine: [MEETING], presence: {}, loading: false, error: null }),
  useNow: () => NOW,
}));
const decline = vi.fn();
vi.mock("../../../services/party/travelPartyStore", async (orig) => ({
  ...(await orig<typeof import("../../../services/party/travelPartyStore")>()),
  declinePartyInvite: (id: string) => decline(id),
}));

const { Vo3dMeetingReminder } = await import("./Vo3dMeetingReminder");
const { Vo3dGoTogether } = await import("./Vo3dGoTogether");
const store = await import("../../../services/party/travelPartyStore");

const world = { current: { goTogether: {}, walkToMeetingRoom: () => "walking" } as never };
const nameOf = (e: string) => e.split("@")[0];
const partyFor = (over: object = {}) => ({
  partyId: "p1", leaderEmail: "alex@x.com", leaderFollowing: true,
  destination: { floor: "floor-2", roomId: "floor-2/foxtrot", label: "Product sync · Foxtrot", context: { kind: "scheduled_meeting", id: "m1" } },
  members: [], pending: ["bon@x.com", "jan@x.com"], declined: [], stage: "forming" as const, rendezvous: null, leg: null, ...over,
});

afterEach(() => {
  cleanup();
  store.resetTravelPartyStoreForTests();
  decline.mockClear();
});

describe("the meeting reminder steps aside for Go Together", () => {
  it("shows Walk There and Go together when Go Together has no say in this meeting", () => {
    render(<Vo3dMeetingReminder worldRef={world} ready selfId="bon@x.com" onOpen={() => {}} onGoTogether={() => {}} travelDecided={new Set()} />);
    expect(screen.getByTestId("meeting-reminder-walk-there")).toBeTruthy();
    expect(screen.getByTestId("meeting-reminder-go-together")).toBeTruthy();
  });

  it("is not drawn for a meeting an invitation or a party already owns — no competing Walk There", () => {
    render(<Vo3dMeetingReminder worldRef={world} ready selfId="bon@x.com" onOpen={() => {}} onGoTogether={() => {}} travelDecided={new Set(["m1"])} />);
    expect(screen.queryByTestId("meeting-reminder")).toBeNull();
  });

  it("never offers a second, competing Go together while one is under way or waiting for an answer", () => {
    render(<Vo3dMeetingReminder worldRef={world} ready selfId="bon@x.com" onOpen={() => {}} onGoTogether={() => {}} inParty travelDecided={new Set()} />);
    expect(screen.getByTestId("meeting-reminder-walk-there")).toBeTruthy();
    expect(screen.queryByTestId("meeting-reminder-go-together")).toBeNull();
  });
});

describe("the Go Together invitation and party card", () => {
  it("a meeting invitation is Join / I'll walk there — the latter declines only the walk", () => {
    act(() => store.__setTravelPartySnapshotForTests({
      invites: [{ inviteId: "i1", fromEmail: "alex@x.com", toEmail: "bon@x.com", partyId: "p1", party: partyFor() }],
    }));
    render(<Vo3dGoTogether worldRef={{ current: null }} ready={false} selfId="bon@x.com" nameOf={nameOf} />);
    expect(screen.getByText("alex wants to go together")).toBeTruthy();
    expect(screen.getByText("Product sync · Foxtrot")).toBeTruthy();
    fireEvent.click(screen.getByText("I'll walk there"));
    expect(decline).toHaveBeenCalledWith("i1");
  });

  it("the party card shows one face per person: joined in colour with ✓, waiting muted, I'll-walk-there muted with ✕, leader ringed", () => {
    const port = {
      self: () => ({ floor: "floor-1", pos: { x: 0, z: 0 }, riding: false, holding: false, moving: false, player: true, room: null }),
      hub: () => ({ floor: "floor-1", point: { x: 0, z: 0 } }), liftLobby: () => null, arrival: () => null,
      walkNear: () => true, ride: () => true, setHooks: () => {}, setGuided: () => {}, riders: () => [], peer: () => null,
    };
    act(() => store.__setTravelPartySnapshotForTests({
      party: partyFor({ members: [{ email: "bon@x.com", following: true, connected: true }], pending: ["jan@x.com"], declined: ["sam@x.com"] }),
      controllerSid: "s1", socketId: "s1",
    }));
    render(<Vo3dGoTogether worldRef={{ current: { goTogether: port } as never }} ready selfId="alex@x.com" nameOf={nameOf} />);
    const faces = [...screen.getByTestId("go-together-people").querySelectorAll("li")];
    expect(faces.map((f) => [f.getAttribute("data-email"), f.getAttribute("data-state")])).toEqual([
      ["alex@x.com", "joined"], ["bon@x.com", "joined"], ["jan@x.com", "waiting"], ["sam@x.com", "declined"],
    ]);
    expect(faces[0].className).toMatch(/faceLeader/);
    expect(faces[1].className).not.toMatch(/faceMuted/);
    expect(faces[2].className).toMatch(/faceMuted/);
    expect(faces[3].className).toMatch(/faceMuted/);
    expect(faces[1].textContent).toContain("✓");
    expect(faces[3].textContent).toContain("✕");
    expect(faces[2].getAttribute("title")).toBe("jan · Waiting");
    expect(screen.getByTestId("go-together-start")).toBeTruthy();
  });
});
