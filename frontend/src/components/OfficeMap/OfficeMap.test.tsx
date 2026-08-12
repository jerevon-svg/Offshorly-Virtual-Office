import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";
import type { OfficePerson } from "../../services/office/floorMerge";

// The roster's real occupants are keyed by the flat rooms/teamRooms
// namespace (e.g. "design-team"), while the room the sidebar was opened
// against is identified by the manifest namespace (e.g. "design-room").
// These two schemes coincide for 6 rooms but differ for the 4 "-team"
// rooms, which is exactly the class of bug this regression test guards
// against — see OfficeMap.tsx's flatRoomIdAt/roomSidebarFlatId bridge.
const designPerson: OfficePerson = {
  email: "designer@example.com",
  displayName: "Dana Designer",
  status: "ONLINE",
  departmentName: "Design",
  jobTitle: "Designer",
  currentActivity: null,
  lastMessage: null,
  avatarId: "bon",
  roomId: "design-team",
  atlasRoomId: null,
  inEphemeralRoom: false,
};

// Mutable so the pre-existing tests below (which assert against the
// fictional-cast manifest render) see an EMPTY roster, exactly as before
// this mock was introduced — only the new regression test below opts a
// live person in, scoped to itself via beforeEach/afterEach.
let mockRosterPeople: OfficePerson[] = [];

vi.mock("../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({
    people: mockRosterPeople,
    loading: false,
    error: null,
    live: true,
    roomNames: new Map(),
    floorCount: mockRosterPeople.length,
    presenceCount: mockRosterPeople.length,
  }),
}));

describe("OfficeMap", () => {
  it("renders without throwing", () => {
    expect(() => render(<OfficeMap />)).not.toThrow();
  });

  it("renders the layered office stage with multiple images", () => {
    const { container } = render(<OfficeMap />);
    const images = container.querySelectorAll("img");
    // 164 layers from the manifest: floor + rooms + decor + characters +
    // furniture (161 previous + 3 for the new ai-door / executive-door-left /
    // executive-door-right visual door assets from Bon's Figma redesign).
    expect(images.length).toBe(164);
  });

  it("mounts the TransformWrapper wrapper div", () => {
    const { container } = render(<OfficeMap />);
    const wrapper = container.querySelector(".react-transform-wrapper");
    expect(wrapper).not.toBeNull();
  });

  it("lists a live-roster person seated in a flat '-team' room under the sidebar for its manifest '-room' counterpart", () => {
    mockRosterPeople = [designPerson];
    try {
      const { container, getByText, queryByText } = render(<OfficeMap />);
      const designRoomLayer = container.querySelector('[data-room-id="design-room"]');
      expect(designRoomLayer).not.toBeNull();

      fireEvent.pointerDown(designRoomLayer!, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(designRoomLayer!, { clientX: 0, clientY: 0 });

      expect(getByText("Dana Designer")).not.toBeNull();
      expect(queryByText("No employees in this room")).toBeNull();
    } finally {
      mockRosterPeople = [];
    }
  });
});
