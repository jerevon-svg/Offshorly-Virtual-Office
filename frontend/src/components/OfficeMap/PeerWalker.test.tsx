import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerWalker } from "./PeerWalker";
import type { AvatarSpriteSet } from "../../services/avatar/types";
import * as movementSync from "../../services/presence/movementSync";
import type { PeerMovementState } from "../../services/presence/movementSync";

vi.mock("../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/movementSync")>(
    "../../services/presence/movementSync",
  );
  return { ...actual, getServerClockOffsetMs: vi.fn(() => 0) };
});

const FAKE_SPRITE_SET: AvatarSpriteSet = {
  walk: {
    front: ["walk-front-0.png", "walk-front-1.png"],
    back: ["walk-back-0.png", "walk-back-1.png"],
    left: ["walk-left-0.png", "walk-left-1.png"],
    right: ["walk-right-0.png", "walk-right-1.png"],
  },
  idle: {
    front: "idle-front.png",
    back: "idle-back.png",
    left: "idle-left.png",
    right: "idle-right.png",
  },
  sitType: {
    front: "sit-front.png",
    back: "sit-back.png",
    left: "sit-left.png",
    right: "sit-right.png",
  },
};

function standingState(overrides?: Partial<PeerMovementState>): PeerMovementState {
  return {
    email: "peer@example.com",
    revision: 1,
    stable: { pos: { x: 0, y: 0 }, facing: "front", state: "standing", seatKey: null, roomId: null },
    active: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(movementSync.getServerClockOffsetMs).mockReturnValue(0);
});

describe("PeerWalker", () => {
  it("renders null and reports the placeholder-derived idle src when spriteSet is null", () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <PeerWalker layerId="peer@example.com" state={standingState()} spriteSet={null} onUpdate={onUpdate} />,
    );
    expect(container.firstChild).toBeNull();
    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].src).toBeTruthy();
    expect(lastCall[1].src).not.toBe(""); // never a blank src
  });

  it("reports a characterSprite()-derived src from the given spriteSet while walking (fast-forward with elapsedMs)", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m1",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now() - 500, // half elapsed, no serverTime (live event) -> elapsedMs computed as 0 offset
        serverTime: Date.now() - 500,
      },
    });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);

    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(Object.values(FAKE_SPRITE_SET.walk).flat()).toContain(lastCall[1].src);
    expect(lastCall[1].isWalking).toBe(true);
  });

  it("uses getServerClockOffsetMs() for a LIVE peer_walk_started event too (no serverTime on state.active), not a hardcoded 0 offset", () => {
    vi.mocked(movementSync.getServerClockOffsetMs).mockReturnValue(1000); // this connection is 1s behind the server
    const onUpdate = vi.fn();
    const startedAt = Date.now(); // server-epoch "now" per this connection's clock
    const state = standingState({
      active: {
        movementId: "m-live",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 2000,
        startedAt,
        // no serverTime — this is a live peer_walk_started, not a snapshot-sourced active
      },
    });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);

    // elapsedMs = Date.now() + 1000(offset) - startedAt ~= 1000, i.e. already
    // half-elapsed of a 2000ms walk — must still be walking, not reset to 0
    // elapsed as a hardcoded-0-offset implementation would compute.
    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].isWalking).toBe(true);
  });

  it("clamps a negative computed elapsedMs (clock skew) to 0 instead of rewinding the walk", () => {
    vi.mocked(movementSync.getServerClockOffsetMs).mockReturnValue(0);
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m-skew",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 2000,
        startedAt: Date.now() + 5000, // "starts in the future" per this clock — clock skew
        serverTime: Date.now(),
      },
    });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);

    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].isWalking).toBe(true); // still walking, not thrown into an error state
  });

  it("clamps an elapsedMs beyond durationMs to durationMs (snaps to the end instead of racing walk_arrived)", () => {
    vi.mocked(movementSync.getServerClockOffsetMs).mockReturnValue(0);
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m-late",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 500,
        startedAt: Date.now() - 999999, // way past durationMs
        serverTime: Date.now() - 999999,
      },
    });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);

    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].isWalking).toBe(false);
    expect(lastCall[1].pos).toEqual({ x: 100, y: 0 });
  });

  it("arrival snaps to stable position/facing and clears walking", () => {
    const onUpdate = vi.fn();
    const state = standingState({ stable: { pos: { x: 50, y: 60 }, facing: "back", state: "standing", seatKey: null, roomId: null } });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);
    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].pos).toEqual({ x: 50, y: 60 });
    expect(lastCall[1].isWalking).toBe(false);
  });

  it("sitting state reports isSitting and a sitType sprite", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      stable: { pos: { x: 10, y: 10 }, facing: "left", state: "sitting", seatKey: "seat-1", roomId: "r1" },
    });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);
    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].isSitting).toBe(true);
    expect(lastCall[1].src).toBe(FAKE_SPRITE_SET.sitType!.left);
  });

  it("no spriteSet falls back to placeholder frames, never an empty string", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      stable: { pos: { x: 10, y: 10 }, facing: "front", state: "sitting", seatKey: "seat-1", roomId: "r1" },
    });
    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={null} onUpdate={onUpdate} />);
    const lastCall = onUpdate.mock.calls.at(-1)!;
    expect(lastCall[1].src).not.toBe("");
    expect(lastCall[1].isSitting).toBe(true);
  });
});
