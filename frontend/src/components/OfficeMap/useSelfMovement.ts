import type { WalkDirection } from "../../data/bonWalkFrames";
import { walkDurationMs } from "./useCharacterWalk";
import { emitWalkArrived, emitWalkStarted, type Facing, type MovementState } from "../../services/presence/movementSync";

type Pt = { x: number; y: number };

// Generates a movementId: crypto.randomUUID() where available (all modern
// browsers + jsdom-with-polyfill), falling back to a Math.random-based id
// for any environment that lacks it (e.g. a stripped-down test runner).
function makeMovementId(): string {
  const c: { randomUUID?: () => string } | undefined =
    typeof crypto !== "undefined" ? (crypto as unknown as { randomUUID?: () => string }) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `mv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface SelfMovementArrival {
  state: MovementState;
  seatKey?: string | null;
  facing?: WalkDirection;
}

export interface MoveSelfInput {
  path: Pt[];
  roomId: string | null;
  arrival?: SelfMovementArrival;
  onArrive?: () => void;
}

// The one raw local-walk primitive moveSelf drives underneath — matches
// useCharacterWalk's walkTo signature (input, onArrive, opts).
export type RawWalkTo = (
  input: Pt | Pt[],
  onArrive?: () => void,
  opts?: { durationMs?: number; elapsedMs?: number },
) => void;

export interface UseSelfMovementDeps {
  /** The wrapped local walk primitive (OfficeMap's `walkTo` wrapper, which
   * also clears isSitting) — NOT useCharacterWalk's raw walkToRaw. */
  walkTo: RawWalkTo;
  /** Current position, read fresh at call time (a ref or getter is fine —
   * pass a function so moveSelf always sees the live value, not one
   * captured at hook-creation time). */
  getPos: () => Pt;
  /** Current walk direction, used as the default arrival facing when the
   * caller doesn't specify one explicitly. */
  getDirection: () => WalkDirection;
}

/**
 * Builds the single funnel every self-movement call site in OfficeMap.tsx
 * must go through: computes a movementId + durationMs (via walkDurationMs,
 * the SAME formula useCharacterWalk's own walkTo uses internally, applied
 * here to the FULL path so the local walk and the emitted durationMs always
 * agree), emits `walk_started`, runs the local walk for that exact duration,
 * and on arrival emits `walk_arrived` with the arrival metadata the caller
 * supplied (defaulting facing to the walker's current direction).
 *
 * Zero-length paths: emits NEITHER walk_started NOR walk_arrived — just
 * calls onArrive() directly. A path with no distance to cover isn't a real
 * movement worth broadcasting revision bumps for, and (since walkDurationMs
 * returns 0 for it) there's nothing meaningful to replay on peers anyway.
 */
export function makeMoveSelf(deps: UseSelfMovementDeps) {
  return function moveSelf(input: MoveSelfInput): void {
    const { path, roomId, arrival, onArrive } = input;
    const origin = deps.getPos();

    if (path.length === 0 || walkDurationMs([origin, ...path]) === 0) {
      onArrive?.();
      return;
    }

    const movementId = makeMovementId();
    // Backend's walk_started validator requires a Python int — an
    // un-rounded float (walkDurationMs's totalDist*3.4 is fractional for
    // almost every real path length) is silently dropped, which then makes
    // the later walk_arrived rejected too (wrong/no active movementId) —
    // every mid-distance walk would be invisible to peers. Round ONCE here
    // and use the SAME rounded value for both the local walk (so the actor
    // and replaying peers stay in lockstep) and the emitted payload.
    const durationMs = Math.round(walkDurationMs([origin, ...path]));

    emitWalkStarted({ movementId, origin, path, roomId, durationMs });

    deps.walkTo(
      path,
      () => {
        const at = path[path.length - 1] ?? origin;
        const facing: Facing = arrival?.facing ?? deps.getDirection();
        emitWalkArrived({
          movementId,
          at,
          facing,
          state: arrival?.state ?? "standing",
          seatKey: arrival?.seatKey ?? null,
          roomId,
        });
        onArrive?.();
      },
      { durationMs },
    );
  };
}
