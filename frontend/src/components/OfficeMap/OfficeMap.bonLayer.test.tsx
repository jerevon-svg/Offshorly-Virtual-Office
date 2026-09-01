import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
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
  return {
    ...actual,
    getPeerMovementSnapshot: () => peerMovementSnapshotState.entries,
    usePeerMovements: () => peerMovementSnapshotState.entries,
  };
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

// Every render of Bon: live-3D canvas stubs whose GLB is Bon's (shipped bon-v3 set, the
// bon-v2 dev-override candidate, or the old jerevon rollback) plus any 2D Bon sprite <img>.
function bonRenders(container: HTMLElement) {
  const canvases = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="character-canvas-stub"]')).filter((el) =>
    /jerevon-lod|bon-v2-lod|bon-v3-lod/.test(el.getAttribute("data-glb-url") ?? ""),
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
    vi.unstubAllEnvs();
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

// Mock-mode offline predicate (2026-08-29). MockOfficeService hard-codes Bon
// (jerevon) OFFLINE and check-in never updates it, so with the Atlas-status
// predicate a checked-in Bon was moved to the sidewalk lineup and his synced
// position dropped in Alex's view. In mock mode OfficeMap now derives "offline"
// from the app's own server lineup instead (see offlineLineupPlacement.ts).
describe("OfficeMap mock mode: checked-in Bon is visible to Alex at his synchronized position", () => {
  const MOCK_OFFLINE_BON: OfficePerson = { ...BON, status: "OFFLINE" };
  const BON_SYNCED_POS = { x: 640, y: 420 };
  function bonMovement(): import("../../services/presence/movementSync").PeerMovementState {
    return {
      email: "jerevon@offshorly.com",
      revision: 3,
      stable: { pos: BON_SYNCED_POS, facing: "left", state: "standing", seatKey: null, roomId: "design-team" },
      active: null,
    };
  }
  const pct = (v: number, frame: number) => `${(v / frame) * 100}%`;

  afterEach(() => {
    mockRosterPeople = [];
    peerMovementSnapshotState.entries = [];
    resetCurrentUserForTests();
    vi.unstubAllEnvs();
  });

  it("3. Alex viewer sees exactly one roster Bon, at Bon's synchronized position (mock status OFFLINE, not in the server lineup)", () => {
    vi.stubEnv("VITE_OFFICE_INTEGRATION_MODE", "mock");
    mockRosterPeople = [MOCK_OFFLINE_BON, ALEX];
    peerMovementSnapshotState.entries = [bonMovement()];
    signInAs("alex@offshorly.com", "Alex");
    const { container } = render(<OfficeMap />);
    const r = bonRenders(container);
    expect(r.total, `canvases=${r.canvases.length} sprites=${r.sprites.length}`).toBe(1);
    const layerDiv = (r.canvases[0] ?? r.sprites[0]).parentElement as HTMLElement;
    expect(layerDiv.style.left).toBe(pct(BON_SYNCED_POS.x, FRAME_WIDTH));
    expect(layerDiv.style.top).toBe(pct(BON_SYNCED_POS.y, FRAME_HEIGHT));
  });

  it("4. manifest Bon remains hidden while the roster Bon is active in mock mode (duplicate-Bon prevention intact)", () => {
    vi.stubEnv("VITE_OFFICE_INTEGRATION_MODE", "mock");
    mockRosterPeople = [MOCK_OFFLINE_BON, ALEX];
    peerMovementSnapshotState.entries = [bonMovement()];
    signInAs("alex@offshorly.com", "Alex");
    const { container } = render(<OfficeMap />);
    // Exactly one Bon render overall, and it is the roster (email-keyed) layer — the manifest
    // "bon" layer is hidden by hiddenCharacterIds exactly as before this change.
    const r = bonRenders(container);
    expect(r.total).toBe(1);
    const stubs = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="character-canvas-stub"]'));
    expect(stubs.filter((el) => /bon-v3-lod/.test(el.getAttribute("data-glb-url") ?? "")).length).toBe(1);
  });
});
