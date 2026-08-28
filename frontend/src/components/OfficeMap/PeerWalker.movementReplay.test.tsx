import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerWalker } from "./PeerWalker";
import type { AvatarSpriteSet } from "../../services/avatar/types";
import type { PeerMovementState } from "../../services/presence/movementSync";

// This file isolates the replay-orchestration bug fix (double-play /
// teleport-to-origin-then-glide, see PeerWalker.tsx's useEffect doc
// comments) behind a fully-mocked useCharacterWalk, so call counts into
// walkTo/resetPos/cancel can be asserted precisely regardless of the real
// hook's rAF-driven animation timing — PeerWalker.test.tsx covers the real
// hook's rendered src/pos/isWalking behavior instead.
const walkTo = vi.fn();
const resetPos = vi.fn();
const cancel = vi.fn();
const face = vi.fn();

vi.mock("./useCharacterWalk", () => ({
  useCharacterWalk: vi.fn((initial: { x: number; y: number }) => ({
    pos: initial,
    isWalking: false,
    direction: "front" as const,
    frameIndex: 0 as const,
    walkTo,
    resetPos,
    face,
    cancel,
  })),
}));

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
  idle: { front: "idle-front.png", back: "idle-back.png", left: "idle-left.png", right: "idle-right.png" },
  sitType: { front: "sit-front.png", back: "sit-back.png", left: "sit-left.png", right: "sit-right.png" },
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
  walkTo.mockClear();
  resetPos.mockClear();
  cancel.mockClear();
  face.mockClear();
});

describe("PeerWalker movement-replay orchestration", () => {
  it("plays a given movementId's walk exactly once, even under StrictMode's dev double-invoke of the mount effect", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m-strict",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now(),
        serverTime: Date.now(),
      },
    });

    render(
      <StrictMode>
        <PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />
      </StrictMode>,
    );

    // StrictMode double-invokes the mount effect (mount -> cleanup -> mount
    // again) on the SAME component instance — before the fix, walkTo was
    // called unconditionally every invocation, replaying the walk from
    // origin twice. The movementId-keyed ref makes the second invocation a
    // no-op.
    expect(walkTo).toHaveBeenCalledTimes(1);
  });

  it("a snapshot with elapsedMs>0 starts mid-path WITHOUT snapping to origin first", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m-midflight",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now() - 500, // already half elapsed
        serverTime: Date.now() - 500,
      },
    });

    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);

    // The fast-forward opts still reach walkTo...
    expect(walkTo).toHaveBeenCalledTimes(1);
    const [, , opts] = walkTo.mock.calls[0] as [unknown, unknown, { durationMs: number; elapsedMs: number }];
    expect(opts.elapsedMs).toBeGreaterThan(0);
    // ...but resetPos(origin) must NOT have been called — snapping to origin
    // first is exactly the teleport-to-origin-then-glide bug being fixed.
    expect(resetPos).not.toHaveBeenCalled();
  });

  it("a fresh movement caught at its start (elapsedMs ~0) still resets to origin before walking", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m-fresh",
        origin: { x: 5, y: 5 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now(),
        serverTime: Date.now(),
      },
    });

    render(<PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);

    expect(resetPos).toHaveBeenCalledWith({ x: 5, y: 5 });
    expect(walkTo).toHaveBeenCalledTimes(1);
  });

  it("unmounting cancels the in-flight walk instead of leaving a duplicate running", () => {
    const onUpdate = vi.fn();
    const state = standingState({
      active: {
        movementId: "m-unmount",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now(),
        serverTime: Date.now(),
      },
    });

    const { unmount } = render(
      <PeerWalker layerId="peer@example.com" state={state} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />,
    );
    expect(cancel).not.toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("a NEW movementId (superseding revision) replays again — the guard is per-movementId, not a permanent lock", () => {
    const onUpdate = vi.fn();
    const first = standingState({
      active: {
        movementId: "m-1",
        origin: { x: 0, y: 0 },
        path: [{ x: 100, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now(),
        serverTime: Date.now(),
      },
    });
    const { rerender } = render(
      <PeerWalker layerId="peer@example.com" state={first} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />,
    );
    expect(walkTo).toHaveBeenCalledTimes(1);

    const second = standingState({
      active: {
        movementId: "m-2",
        origin: { x: 100, y: 0 },
        path: [{ x: 200, y: 0 }],
        roomId: null,
        durationMs: 1000,
        startedAt: Date.now(),
        serverTime: Date.now(),
      },
    });
    rerender(<PeerWalker layerId="peer@example.com" state={second} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />);
    expect(walkTo).toHaveBeenCalledTimes(2);
  });

  it("the arrived branch (active -> null) snaps to stable pos/facing exactly once per revision, idempotent under StrictMode's double-invoke of the same revision", () => {
    const onUpdate = vi.fn();
    const arrivedState = standingState({
      revision: 7,
      active: null,
      stable: { pos: { x: 40, y: 50 }, facing: "left", state: "standing", seatKey: null, roomId: null },
    });

    render(
      <StrictMode>
        <PeerWalker layerId="peer@example.com" state={arrivedState} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />
      </StrictMode>,
    );

    // StrictMode double-invokes this effect (same revision both times) —
    // the revision-keyed ref makes the second invocation a no-op, so the
    // snap-to-stable animation only plays once.
    expect(resetPos).toHaveBeenCalledTimes(1);
    expect(resetPos).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(face).toHaveBeenCalledTimes(1);
    expect(face).toHaveBeenCalledWith("left");
  });

  it("a rerender with an unchanged revision does not re-run the arrived snap at all (React skips the effect — unchanged deps)", () => {
    const onUpdate = vi.fn();
    const arrivedState = standingState({
      revision: 3,
      active: null,
      stable: { pos: { x: 1, y: 2 }, facing: "back", state: "standing", seatKey: null, roomId: null },
    });

    const { rerender } = render(
      <PeerWalker layerId="peer@example.com" state={arrivedState} spriteSet={FAKE_SPRITE_SET} onUpdate={onUpdate} />,
    );
    expect(resetPos).toHaveBeenCalledTimes(1);

    rerender(
      <PeerWalker
        layerId="peer@example.com"
        state={{ ...arrivedState }}
        spriteSet={FAKE_SPRITE_SET}
        onUpdate={onUpdate}
      />,
    );
    expect(resetPos).toHaveBeenCalledTimes(1);
    expect(face).toHaveBeenCalledTimes(1);
  });
});
