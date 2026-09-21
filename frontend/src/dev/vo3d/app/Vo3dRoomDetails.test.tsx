// ROOM DETAILS — V1/V2 parity for components/OfficeMap/RoomSidebar.
//
// Two subjects, and they are deliberately separate:
//   app/roomDetails.ts   WHAT the panel is allowed to say — which V1 feed each field comes from, which
//                        room id namespace each side speaks, and what happens when a fact is missing.
//                        That is where an invented role or a fabricated project would show up.
//   Vo3dRoomDetails.tsx  that it renders V1's answer and dispatches V1's interactions, and nothing else.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Vo3dRoomDetails } from "./Vo3dRoomDetails";
import { resolveRoomDetails, roomSubtitle } from "./roomDetails";
import type { OfficePerson } from "../../../services/office/floorMerge";
import { roomMembersById } from "../../../data/office-layout";

const SELF = "bon@offshorly.com";

/** A roster row, in OfficePerson's own shape. Only the fields the panel reads are spelled out. */
function person(over: Partial<OfficePerson> & Pick<OfficePerson, "email" | "roomId">): OfficePerson {
  return {
    displayName: over.email.split("@")[0],
    status: "ONLINE",
    departmentName: null,
    jobTitle: null,
    currentActivity: null,
    lastMessage: null,
    avatarId: null,
    atlasRoomId: null,
    inEphemeralRoom: false,
    ...over,
  } as OfficePerson;
}

describe("resolveRoomDetails — the room identity", () => {
  it("names the room with V1's own formatRoomName, over the MANIFEST id the world reports", () => {
    const d = resolveRoomDetails({ roomId: "design-room", people: [person({ email: SELF, roomId: "design-team" })] });
    expect(d?.roomName).toBe("Design Room");
    // …including V1's overrides, which are not plain title-casing.
    expect(resolveRoomDetails({ roomId: "qa-room", people: [person({ email: SELF, roomId: "qa-room" })] })?.roomName).toBe("QA Room");
  });

  it("bridges the manifest id to the FLAT id a roster row carries, which is the whole join", () => {
    // "design-room" (art) and "design-team" (roster) are different strings for the same floor; a naive
    // id comparison matches nobody and the room silently reads as empty.
    const people = [person({ email: "alex@offshorly.com", roomId: "design-team" })];
    const d = resolveRoomDetails({ roomId: "design-room", people });
    expect(d?.kind).toBe("roster");
    expect(d?.kind === "roster" && d.occupants.map((o) => o.email)).toEqual(["alex@offshorly.com"]);
  });

  it("returns null when nothing is selected", () => {
    expect(resolveRoomDetails({ roomId: null, people: [] })).toBeNull();
  });

  it("says so for a manifest room with no flat twin, instead of claiming it is empty", () => {
    // The wall-less central hub has art but no flat rect, so no roster row can ever be keyed to it.
    const d = resolveRoomDetails({ roomId: "central-hub", people: [person({ email: SELF, roomId: "design-team" })] });
    expect(d?.kind).toBe("untracked");
  });
});

describe("resolveRoomDetails — who is in the room", () => {
  const people = [
    person({ email: "alex@offshorly.com", displayName: "Alex Cruz", roomId: "dev-team", jobTitle: "Engineer" }),
    person({ email: "micah@offshorly.com", displayName: "Micah", roomId: "design-team" }),
    person({ email: SELF, displayName: "Bon", roomId: "dev-team" }),
  ];

  it("lists only the people whose live roomId is this room", () => {
    const d = resolveRoomDetails({ roomId: "dev-room", people });
    // No viewer named, so the order is purely alphabetical — "who is here", not "who is here and me".
    expect(d?.kind === "roster" && d.occupants.map((o) => o.displayName)).toEqual(["Alex Cruz", "Bon"]);
  });

  it("re-derives occupancy when the roster moves somebody, which is how presence stays accurate", () => {
    const moved = people.map((p) => (p.email === "alex@offshorly.com" ? { ...p, roomId: "design-team" } : p));
    expect((resolveRoomDetails({ roomId: "dev-room", people: moved }) as { occupants: unknown[] }).occupants).toHaveLength(1);
    expect((resolveRoomDetails({ roomId: "design-room", people: moved }) as { occupants: unknown[] }).occupants).toHaveLength(2);
  });

  it("puts the viewer first and tags them, then sorts the rest by name", () => {
    const d = resolveRoomDetails({ roomId: "dev-room", people, selfEmail: SELF });
    expect(d?.kind === "roster" && d.occupants[0].isSelf).toBe(true);
    expect(d?.kind === "roster" && d.occupants[1].isSelf).toBe(false);
  });

  it("counts the room in V1's own wording", () => {
    expect(roomSubtitle(resolveRoomDetails({ roomId: "dev-room", people })!)).toBe("2 people in the room");
    expect(roomSubtitle(resolveRoomDetails({ roomId: "design-room", people })!)).toBe("1 person in the room");
  });
});

describe("resolveRoomDetails — only what the services actually provide", () => {
  it("carries the Zoho job title as the role, and NOTHING when there is none", () => {
    const d = resolveRoomDetails({
      roomId: "dev-room",
      people: [
        person({ email: "a@offshorly.com", roomId: "dev-team", jobTitle: "Senior Engineer", departmentName: "Dev" }),
        person({ email: "b@offshorly.com", roomId: "dev-team", departmentName: "Dev" }),
      ],
    });
    const rows = d?.kind === "roster" ? d.occupants : [];
    expect(rows.find((r) => r.email === "a@offshorly.com")?.role).toBe("Senior Engineer");
    // The department is NOT substituted for a missing job title — that would be an invented role.
    expect(rows.find((r) => r.email === "b@offshorly.com")?.role).toBeNull();
  });

  it("names the live Atlas PROJECT/CLIQ room as the project, only when the rooms feed supplied a name", () => {
    const people = [
      person({ email: "a@offshorly.com", roomId: "dev-team", inEphemeralRoom: true, atlasRoomId: "atlas-1" }),
      person({ email: "b@offshorly.com", roomId: "dev-team", inEphemeralRoom: true, atlasRoomId: "atlas-unknown" }),
      person({ email: "c@offshorly.com", roomId: "dev-team", atlasRoomId: "atlas-1" }),
    ];
    const d = resolveRoomDetails({ roomId: "dev-room", people, roomNames: new Map([["atlas-1", "Design Sprint"]]) });
    const rows = d?.kind === "roster" ? d.occupants : [];
    expect(rows.find((r) => r.email === "a@offshorly.com")?.project).toBe("Design Sprint");
    // An unnamed ephemeral room degrades to no chip rather than leaking a raw Atlas id.
    expect(rows.find((r) => r.email === "b@offshorly.com")?.project).toBeNull();
    // Somebody at their desk is not "in a project" just because they have an Atlas room id.
    expect(rows.find((r) => r.email === "c@offshorly.com")?.project).toBeNull();
  });

  it("translates Atlas presence through V1's own status mapping", () => {
    const d = resolveRoomDetails({
      roomId: "dev-room",
      people: [person({ email: "a@offshorly.com", roomId: "dev-team", status: "IN_MEETING" })],
    });
    expect(d?.kind === "roster" && d.occupants[0].status).toBe("IN_CALL");
  });
});

describe("resolveRoomDetails — empty, missing and loading", () => {
  it("distinguishes 'still loading' from 'nobody is here'", () => {
    expect(resolveRoomDetails({ roomId: "dev-room", people: [], loading: true })?.kind).toBe("loading");
  });

  it("falls back to V1's hand-drawn cast when there is no live roster at all", () => {
    const d = resolveRoomDetails({ roomId: "dev-room", people: [], loading: false });
    expect(d?.kind).toBe("manifest");
    expect(d?.kind === "manifest" && d.members).toHaveLength(roomMembersById["dev-room"].length);
    expect(roomSubtitle(d!)).toMatch(/seat/);
  });

  it("reports an empty room as empty once the roster HAS answered", () => {
    const d = resolveRoomDetails({ roomId: "gaming-room", people: [person({ email: SELF, roomId: "dev-team" })] });
    expect(d?.kind === "roster" && d.occupants).toEqual([]);
    expect(roomSubtitle(d!)).toBe("0 people in the room");
  });
});

// ---- the panel ---------------------------------------------------------------------------------------
const noop = () => {};

describe("Vo3dRoomDetails", () => {
  const people = [
    person({ email: "alex@offshorly.com", displayName: "Alex Cruz", roomId: "dev-team", jobTitle: "Engineer", currentActivity: "Heads down" }),
    person({ email: SELF, displayName: "Bon", roomId: "dev-team", inEphemeralRoom: true, atlasRoomId: "atlas-1" }),
  ];
  const details = (roomId: string | null = "dev-room", over = {}) =>
    resolveRoomDetails({ roomId, people, selfEmail: SELF, roomNames: new Map([["atlas-1", "Design Sprint"]]), ...over });

  it("shows the room name, the count, each role and each activity", () => {
    render(<Vo3dRoomDetails details={details()} onClose={noop} onSelectPerson={noop} />);
    expect(screen.getByText("Dev Room")).toBeTruthy();
    expect(screen.getByTestId("vo3d-room-subtitle").textContent).toBe("2 people in the room");
    expect(screen.getByText("Engineer")).toBeTruthy();
    expect(screen.getByText("Heads down")).toBeTruthy();
    expect(screen.getAllByTestId("vo3d-room-person")).toHaveLength(2);
  });

  it("shows the project chip for somebody in a named Atlas project room, and tags the viewer", () => {
    render(<Vo3dRoomDetails details={details()} onClose={noop} onSelectPerson={noop} />);
    expect(screen.getByTestId("vo3d-room-project").textContent).toContain("Design Sprint");
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("dispatches the selected person's email — the seam V1's own interactions hang off", () => {
    const onSelectPerson = vi.fn();
    render(<Vo3dRoomDetails details={details()} onClose={noop} onSelectPerson={onSelectPerson} />);
    fireEvent.click(screen.getByRole("button", { name: /Alex Cruz/ }));
    expect(onSelectPerson).toHaveBeenCalledWith("alex@offshorly.com", "Alex Cruz");
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    render(<Vo3dRoomDetails details={details()} onClose={onClose} onSelectPerson={noop} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stays mounted but closed when nothing is selected, so the slide-out can animate", () => {
    const { rerender } = render(<Vo3dRoomDetails details={details()} onClose={noop} onSelectPerson={noop} />);
    expect(screen.getByTestId("vo3d-room-details").dataset.open).toBe("true");
    rerender(<Vo3dRoomDetails details={null} onClose={noop} onSelectPerson={noop} />);
    const panel = screen.getByTestId("vo3d-room-details");
    expect(panel.dataset.open).toBe("false");
    // …and it still reads as the room it was describing, rather than blanking mid-animation.
    expect(screen.getByText("Dev Room")).toBeTruthy();
  });

  it("shows a skeleton while loading, an empty line for an empty room, and a note for the hub", () => {
    const { rerender } = render(
      <Vo3dRoomDetails details={resolveRoomDetails({ roomId: "dev-room", people: [], loading: true })} onClose={noop} onSelectPerson={noop} />,
    );
    expect(screen.getAllByTestId("vo3d-room-skeleton").length).toBeGreaterThan(0);

    rerender(<Vo3dRoomDetails details={details("gaming-room")} onClose={noop} onSelectPerson={noop} />);
    expect(screen.getByText("No employees in this room")).toBeTruthy();

    rerender(<Vo3dRoomDetails details={details("central-hub")} onClose={noop} onSelectPerson={noop} />);
    expect(screen.getByText(/isn’t tracked by the team roster/)).toBeTruthy();
  });

  it("does not make the hand-drawn fallback cast pressable — there is no employee behind those rows", () => {
    render(
      <Vo3dRoomDetails
        details={resolveRoomDetails({ roomId: "dev-room", people: [], loading: false })}
        onClose={noop}
        onSelectPerson={noop}
      />,
    );
    const rows = screen.getAllByTestId("vo3d-room-person");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.tagName).toBe("DIV");
  });

  it("docks on the left for a room on the right half of the floor, so it never covers it", () => {
    const { rerender } = render(<Vo3dRoomDetails details={details("dev-room")} side="left" onClose={noop} onSelectPerson={noop} />);
    const panel = screen.getByTestId("vo3d-room-details");
    expect(panel.className).toMatch(/left/);
    rerender(<Vo3dRoomDetails details={details("dev-room")} side="right" onClose={noop} onSelectPerson={noop} />);
    expect(screen.getByTestId("vo3d-room-details").className).not.toMatch(/left/);
  });
});
