import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../auth/currentUserStore";
import type { OfficePerson } from "../../services/office/floorMerge";
import { OfficeMap } from "./OfficeMap";

// Regression coverage for the duplicate-Bon bug (2026-08-28): a non-Bon viewer
// with a REAL roster Bon (jerevon@offshorly.com -> avatar id "bon") used to see
// both the static manifest "bon" layer and the roster layer. Exactly one Bon
// must render, and it must be the roster (email-keyed) layer.

vi.mock("../../render3d/CharacterCanvas", async () => {
  const actual = await vi.importActual<typeof import("../../render3d/CharacterCanvas")>("../../render3d/CharacterCanvas");
  return {
    ...actual,
    CharacterCanvas: (props: { glbUrl: string; isWalking?: boolean }) => (
      <div data-testid="character-canvas-stub" data-glb-url={props.glbUrl} data-is-walking={props.isWalking} />
    ),
  };
});

vi.mock("../../services/render/deviceTier", async () => {
  const actual = await vi.importActual<typeof import("../../services/render/deviceTier")>("../../services/render/deviceTier");
  return { ...actual, detectDeviceTier: () => "T2" };
});

const { peerMovementSnapshotState } = vi.hoisted(() => ({
  peerMovementSnapshotState: { entries: [] as import("../../services/presence/movementSync").PeerMovementState[] },
}));
vi.mock("../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/movementSync")>(
    "../../services/presence/movementSync",
  );
  return { ...actual, getPeerMovementSnapshot: () => peerMovementSnapshotState.entries };
});

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

function person(email: string, displayName: string, avatarId: string): OfficePerson {
  return {
    email,
    displayName,
    status: "ONLINE",
    departmentName: "Design",
    jobTitle: "Designer",
    currentActivity: null,
    lastMessage: null,
    avatarId,
    roomId: "design-team",
    atlasRoomId: null,
    inEphemeralRoom: false,
  } as OfficePerson;
}
const BON = person("jerevon@offshorly.com", "Bon", "bon");
const ALEX = person("alex@offshorly.com", "Alex", "alex");
const DANA = person("designer@example.com", "Dana Designer", "bon");

function signInAs(email: string, name: string) {
  setCurrentUserFromMeResponse({ id: `${name}-id`, email, full_name: name, role: "", team: null });
}

// Every render of Bon: live-3D canvas stubs whose GLB is Bon's (shipped jerevon set or the
// bon-v2 candidate) plus any 2D Bon sprite <img>.
function bonRenders(container: HTMLElement) {
  const canvases = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="character-canvas-stub"]')).filter((el) =>
    /jerevon-lod|bon-v2-lod/.test(el.getAttribute("data-glb-url") ?? ""),
  );
  const sprites = Array.from(container.querySelectorAll("img")).filter((img) => /chibi-bon|\/bon-/.test(img.getAttribute("src") ?? ""));
  return { canvases, sprites, total: canvases.length + sprites.length };
}

describe("OfficeMap: single authoritative Bon layer", () => {
  afterEach(() => {
    mockRosterPeople = [];
    peerMovementSnapshotState.entries = [];
    resetCurrentUserForTests();
    window.history.pushState({}, "", "/");
  });

  it("1. peer viewer (alex) + roster Bon -> exactly one Bon (the roster layer), manifest bon hidden", () => {
    mockRosterPeople = [BON, ALEX];
    signInAs("alex@offshorly.com", "Alex");
    const { container } = render(<OfficeMap />);
    const r = bonRenders(container);
    expect(r.total, `canvases=${r.canvases.length} sprites=${r.sprites.length}`).toBe(1);
  });

  it("2. roster active but no roster Bon -> the static manifest Bon remains (mock-cast behavior preserved)", () => {
    mockRosterPeople = [ALEX];
    signInAs("alex@offshorly.com", "Alex");
    const { container } = render(<OfficeMap />);
    expect(bonRenders(container).total).toBe(1);
  });

  it("3. self Bon viewer -> own character visible exactly once", () => {
    mockRosterPeople = [BON, ALEX];
    signInAs("jerevon@offshorly.com", "Bon");
    const { container } = render(<OfficeMap />);
    expect(bonRenders(container).total).toBe(1);
  });

  it("4. ?live3d=bon-v2 for a peer viewer -> exactly one candidate canvas, no second Bon", () => {
    window.history.pushState({}, "", "/?live3d=bon-v2");
    mockRosterPeople = [BON, ALEX];
    signInAs("alex@offshorly.com", "Alex");
    const { container } = render(<OfficeMap />);
    const r = bonRenders(container);
    expect(r.total).toBe(1);
    expect(r.canvases.length).toBe(1);
    expect(r.canvases[0].getAttribute("data-glb-url")).toMatch(/bon-v2-lod0\.glb$/);
  });

  it("does not hide the manifest Bon for a NON-Bon roster person who merely uses the bon sprite id", () => {
    // Dana's avatarId is "bon" (sprite reuse) but her EMAIL does not resolve to avatar id
    // "bon" — only Bon/Jerevon's real roster identity hides the manifest layer.
    mockRosterPeople = [DANA, ALEX];
    signInAs("alex@offshorly.com", "Alex");
    const { container } = render(<OfficeMap />);
    // Manifest Bon + Dana (rendered with Bon's sprite/GLB) = 2 Bon-looking renders, unchanged
    // from the pre-fix behavior for this unrelated case.
    expect(bonRenders(container).total).toBe(2);
  });
});
