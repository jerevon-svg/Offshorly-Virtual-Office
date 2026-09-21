// vo3d adapter — THE ONE PLACE V2 WRITES INTO V1. Phase 5, and the first write this route has ever done.
//
// Phases 4A/4B were read-only in both directions and said so at length. This module is the deliberate,
// bounded exception, and every bound is here rather than spread across the world:
//
//   • IT EMITS V1'S OWN TWO EVENTS ON V1'S OWN SOCKET and nothing else. services/presence/movementSync
//     owns a MODULE-LEVEL singleton connection (app/Vo3dHost.tsx already joins it read-only through
//     usePeerMovements), and emitWalkStarted/emitWalkArrived are the same functions V1's own office calls.
//     No new event name, no new endpoint, no second socket, no HTTP.
//   • V1'S RULES BELOW THE WALK ARE REUSED, NOT RESTATED. The movement-id rule (makeMovementId), the
//     64-point path cap (capPath, inside emitWalkStarted), the backend's [100, 20000] duration window
//     (sanitizeDurationMs, also inside emitWalkStarted), the server-issued revision ordering and the
//     sprite-facing vocabulary (v1Facing) are all V1's. What this file adds is one coordinate conversion
//     and one refusal.
//   • IT PUBLISHES ONLY WHAT IS EXPRESSIBLE AS A V1 POSITION. V2's world extends far outside the V1
//     frame — the campus, the AI Lab, and the Championship CAVE out at x 2600 — and V1 has no floor
//     there. adapters/v1CoworkerPositions' own isUsablePosition is the predicate, used here in the
//     opposite direction: a movement whose origin or any waypoint is not a believable V1 position is
//     REFUSED WHOLE and counted, never clamped into the frame. While the employee is out there, peers
//     keep the last position V2 actually published, which is the same "they stayed where they stopped"
//     Phase 4B already shows for a peer mid-walk.
//   • IT CLAIMS A SEAT ONLY THROUGH THE VALIDATED MAPPING (Phase 6C). An arrival that names a V2 seat
//     anchor is published as V1's own `state: "sitting"` with V1's own seat key — the centroid key of the
//     ONE painted chair adapters/v1Seats resolved that anchor to — and `at` is that chair's centroid (as a
//     sprite top-left), because that is where V1 draws a sitter and what V1's own click-to-sit publishes.
//     `facing` is the V1 chair's OWN direction (V1's rule: the direction belongs to the chair), the exact
//     V2 yaw rides beside it as before. A V2-ONLY chair — one the mapping could not identify — is
//     published as SITTING too, with the namespaced `v2:<anchor>` key (adapters/v1Seats v2SeatKey) at the
//     body's true position, and counted as `v2OnlySeat`. A sitter is never published as standing; a V1
//     centroid key is never invented.
//     Attendance is still not read and not asserted: see the standing note in app/spawn.ts.
//
// WHY NOT makeMoveSelf. See the header of app/selfMovement.ts — that funnel owns V1's walker, and V2's
// body is moved by V2's controllers. This file is the half of it that is transport.
import { bonLayer, npcCharacterLayers } from "../../../data/office-layout";
import { roomOf } from "../../../data/officePathfinding";
import { makeMovementId } from "../../../components/OfficeMap/useSelfMovement";
import {
  emitWalkArrived,
  emitWalkStarted,
  emitJump,
  type PeerMovementState,
  type Pt,
} from "../../../services/presence/movementSync";
import { isUsablePosition } from "./v1CoworkerPositions";
import { facingForYaw } from "../core/coords";
import { DIRECTION_BY_FACING, FACING_BY_DIRECTION } from "./v1Facing";
import { anchorForSeatKey, v1SeatForAnchor, v2SeatKey } from "./v1Seats";
import { seatFacingFor } from "../app/seats";
import { resolveVo3dIdentity } from "./v1Identity";
import { emailKey, selfEmailKey } from "./v1Coworkers";
import type { Vo3dSelfMovementSink } from "../app/selfMovement";
import type { Facing, Vec2 } from "../core/coords";

/** THE SIGNED-IN EMPLOYEE'S OWN SPRITE BOX, by exactly V1's rule.
 *
 *  components/OfficeMap/OfficeMap.tsx resolves `playerCharacterLayer` as "bonLayer when the character id
 *  is bon, otherwise that id's own manifest character layer, otherwise bonLayer" — and the box matters
 *  because every position on V1's wire is a sprite TOP-LEFT, so undoing it needs THIS person's own
 *  width/height. micah and angelo are deliberately taller for raised-arm headroom (data/rosterLayers.ts
 *  says so, and adapters/v1CoworkerPositions leans on the same fact for everybody else), so reusing
 *  bon's halves would offset them by several units on every peer's screen and in the DB.
 *
 *  adapters/v1Pathfinding.ts converts through bonLayer's halves unconditionally and is a TESTS-ONLY
 *  oracle for precisely this reason; it must not be reached for here. */
export function selfSpriteBox(avatarId: string | null): { width: number; height: number } {
  if (avatarId && avatarId !== "bon") {
    const layer = npcCharacterLayers.find((l) => l.id === avatarId);
    if (layer) return { width: layer.width, height: layer.height };
  }
  return { width: bonLayer.width, height: bonLayer.height };
}

/** V1 frame-unit CENTRE point → the sprite top-left V1's wire and DB speak. */
const toTopLeft = (centre: Vec2, box: { width: number; height: number }): Pt => ({
  x: centre.x - box.width / 2,
  y: centre.z - box.height / 2,
});

/** The manifest/roomLayers-namespace room id V1's walk events carry, resolved by V1's OWN lookup against
 *  the body's CENTRE — the same call, with the same argument, that every moveSelf call site in
 *  OfficeMap.tsx makes (`roomOf(bc)?.id ?? null`). Not the flat rooms/teamRooms namespace: those two id
 *  schemes are different tables and V1's wire carries this one. */
/** PHASE 7D. The movement protocol's own floor for a published duration — the same one the feed uses for
 *  every snap. A "they are here now" statement still has to be a movement on this wire. */
const SNAP_DURATION_MS = 100;

const roomIdAt = (centre: Vec2): string | null => roomOf({ x: centre.x, y: centre.z })?.id ?? null;

/**
 * THE SINK V2's world publishes the signed-in employee's movement through, or NULL when there is nobody
 * to publish as.
 *
 * Null — not a guess and not a default identity — whenever V1 could not parse a signed-in employee
 * (currentUserStore empty, a malformed /auth/me). app/world.ts then builds exactly the world the
 * standalone dev page builds: nothing is emitted, and no movement leaves the browser.
 *
 * The identity is read ONCE, here, per mount, the same way adapters/v1Identity and adapters/v1HomeDesk are
 * read once per mount by app/Vo3dHost.tsx — this is a value taken at mount, never a subscription.
 */
export function createV1SelfMovementSink(): Vo3dSelfMovementSink | null {
  const identity = resolveVo3dIdentity();
  if (!identity) return null;
  const box = selfSpriteBox(identity.avatarId);
  const state = { started: 0, arrived: 0, refused: 0, wire: [] as string[], movementId: null as string | null, seated: 0, v2OnlySeat: 0, jumps: 0 };
  /** Append to the bounded wire log. SHAPES ONLY — never a position: this array is read from the dev
   *  console and the verification harness, and one employee's coordinates do not belong in either. */
  const note = (line: string): void => {
    state.wire.push(line);
    if (state.wire.length > 24) state.wire.shift();
  };
  /** The movement currently in flight, and the room it was started in. Held so the arrival carries the
   *  SAME movementId (the backend accepts an arrival only against the active one) and so an arrival for a
   *  movement that was never published is never sent — an unpaired walk_arrived is rejected server-side,
   *  and sending one would be a lie about a walk that did not happen. */
  let active: { movementId: string; roomId: string | null } | null = null;

  return {
    state,
    /** THE ONE WRITE ON THIS ROUTE THAT IS NOT A MOVEMENT. No position leaves the browser and nothing
     *  is persisted: the server stamps the identity and the time and relays it, peers draw an arc from
     *  their own physics, and the employee's V1 position is untouched throughout. Deliberately NOT run
     *  through isUsablePosition — there is no position in it to judge. */
    jumped() {
      state.jumps = (state.jumps ?? 0) + 1;
      note("jump");
      emitJump();
    },
    started(origin, path, durationMs, pacing) {
      const originTopLeft = toTopLeft(origin, box);
      const pathTopLeft = path.map((p) => toTopLeft(p, box));
      // REFUSED WHOLE, never trimmed. A walk that leaves the V1 frame is not a V1 walk, and publishing
      // the part of it that happens to be inside would broadcast a route the employee did not take.
      if (!isUsablePosition(originTopLeft) || pathTopLeft.some((p) => !isUsablePosition(p))) {
        state.refused++;
        note(`refused-started pts=${path.length}`);
        return;
      }
      const movementId = makeMovementId();
      // The room the walk is FOR, taken from where it ends — the same reading V1's own call sites use
      // (they pass the goal's `roomOf`, not the origin's).
      const roomId = roomIdAt(path[path.length - 1]);
      const superseded = active ? ` supersedes=${active.movementId.slice(0, 8)}` : "";
      active = { movementId, roomId };
      state.started++;
      state.movementId = movementId;
      note(`started id=${movementId.slice(0, 8)} pts=${path.length} ms=${Math.round(durationMs)} room=${roomId ?? "-"}${pacing ? ` ${pacing}` : ""}${superseded}`);
      // capPath and the duration round+clamp both live inside this call, in V1's module.
      emitWalkStarted({ movementId, origin: originTopLeft, path: pathTopLeft, roomId, durationMs, ...(pacing ? { pacing } : {}) });
    },
    /** PHASE 7D — "THEY ARE IN THE CAVE NOW." The same minimum-duration pair a snap always uses, with the
     *  room stated OUTRIGHT instead of derived from the point: the point is the portal they stepped
     *  through (a real, in-frame position V1 keeps holding for them) and the room is where they actually
     *  went. Nothing new on the wire — `roomId` is already carried by both events and already validated
     *  server-side as any string — so no backend change and no new event.
     *
     *  Supersedes anything in flight, exactly as `started` does: arriving somewhere is the end of it. */
    /** PHASE 7D — the leg, published as the pair every movement uses. The V1 half never moves: origin,
     *  path and `at` are all the anchor, so `employee_positions` keeps the portal and the server skips
     *  the write entirely (its v1_fields_changed check). The local half is the real walk. */
    movedInPlace(anchor, from, to, yaw, room) {
      const anchorTopLeft = toTopLeft(anchor, box);
      if (!isUsablePosition(anchorTopLeft)) {
        state.refused++;
        note(`refused-inplace room=${room}`);
        return;
      }
      const movementId = makeMovementId();
      active = null;
      state.started++;
      state.arrived++;
      state.movementId = movementId;
      note(`inplace id=${movementId.slice(0, 8)} room=${room} pts=${to.length}`);
      emitWalkStarted({
        movementId,
        origin: anchorTopLeft,
        path: [anchorTopLeft],
        roomId: room,
        durationMs: SNAP_DURATION_MS,
        // The local walk, in the place's own frame. NOT run through toTopLeft: that conversion undoes
        // a V1 sprite box's origin, and these are world points in a frame V1 has no sprites in.
        localOrigin: { x: from.x, y: from.z },
        localPath: to.map((p) => ({ x: p.x, y: p.z })),
      });
      emitWalkArrived({
        movementId,
        at: anchorTopLeft,
        facing: DIRECTION_BY_FACING[facingForYaw(yaw)],
        ...(Number.isFinite(yaw) ? { yaw } : {}),
        state: "standing",
        seatKey: null,
        roomId: room,
        localAt: { x: to[to.length - 1].x, y: to[to.length - 1].z },
      });
    },
    enteredPlace(at, yaw, room, localAt) {
      const atTopLeft = toTopLeft(at, box);
      if (!isUsablePosition(atTopLeft)) {
        state.refused++;
        note(`refused-entered room=${room ?? "-"}`);
        return;
      }
      const movementId = makeMovementId();
      active = null;
      state.started++;
      state.arrived++;
      state.movementId = movementId;
      note(`entered id=${movementId.slice(0, 8)} room=${room ?? "-"} yaw=${yaw.toFixed(3)}`);
      emitWalkStarted({
        movementId, origin: atTopLeft, path: [atTopLeft], roomId: room, durationMs: SNAP_DURATION_MS,
        ...(localAt ? { localOrigin: { x: localAt.x, y: localAt.z }, localPath: [{ x: localAt.x, y: localAt.z }] } : {}),
      });
      emitWalkArrived({
        movementId,
        at: atTopLeft,
        facing: DIRECTION_BY_FACING[facingForYaw(yaw)],
        ...(Number.isFinite(yaw) ? { yaw } : {}),
        state: "standing",
        seatKey: null,
        roomId: room,
        ...(localAt ? { localAt: { x: localAt.x, y: localAt.z } } : {}),
      });
    },
    arrived(at, facing, yaw, seat) {
      const current = active;
      active = null;
      if (!current) {
        note("arrived-dropped (no movement in flight)");
        return;
      }
      // PHASE 6C — A SEAT V1 KNOWS. The position published is the V1 chair's centroid, not the 3D body's
      // root (which sits a couple of units off the cushion by the sit clip's own hip offset): V1 draws its
      // sitter centred on the centroid and its restore finds the seat by exactly this key in the room under
      // this centre (spawnPlacement.ts findSeat), so anything else would restore as "desk".
      const v1Seat = seat ? v1SeatForAnchor(seat) : null;
      if (v1Seat) {
        state.arrived++;
        state.seated++;
        // THE CONFIGURED FACING (data/seatFacing.json), which for a mapped seat was seeded from V1's own
        // table and may since have been corrected by hand; V1's direction is the fallback for an anchor the
        // table does not know. Both offices then show the sitter facing the same way.
        const seatFacing = seatFacingFor(seat!) ?? v1Seat.direction;
        note(`arrived id=${current.movementId.slice(0, 8)} sitting facing=${seatFacing} yaw=${yaw.toFixed(3)}`);
        emitWalkArrived({
          movementId: current.movementId,
          at: toTopLeft({ x: v1Seat.x, z: v1Seat.y }, box),
          facing: seatFacing,
          ...(Number.isFinite(yaw) ? { yaw } : {}),
          state: "sitting",
          seatKey: v1Seat.key,
          roomId: current.roomId,
        });
        return;
      }
      const atTopLeft = toTopLeft(at, box);
      if (seat) {
        // A V2-ONLY CHAIR: sitting, at the body's true position, under the namespaced key — see the header.
        if (!isUsablePosition(atTopLeft)) {
          state.refused++;
          note(`refused-arrived id=${current.movementId.slice(0, 8)}`);
          return;
        }
        state.arrived++;
        state.seated++;
        state.v2OnlySeat++;
        const seatFacing = seatFacingFor(seat) ?? DIRECTION_BY_FACING[facing];
        note(`arrived id=${current.movementId.slice(0, 8)} sitting v2-only facing=${seatFacing} yaw=${yaw.toFixed(3)}`);
        emitWalkArrived({
          movementId: current.movementId,
          at: atTopLeft,
          facing: seatFacing,
          ...(Number.isFinite(yaw) ? { yaw } : {}),
          state: "sitting",
          seatKey: v2SeatKey(seat),
          roomId: current.roomId,
        });
        return;
      }
      if (!isUsablePosition(atTopLeft)) {
        // The movement was published but the body ended somewhere V1 cannot hold. Leaving it unresolved
        // is the honest outcome: nothing is persisted, and the peer's replay simply runs out at the end of
        // the path it was given rather than being told a position that is not one.
        state.refused++;
        note(`refused-arrived id=${current.movementId.slice(0, 8)}`);
        return;
      }
      state.arrived++;
      // The yaw is an orientation, not a place, so it may sit in the wire log beside the facing word.
      note(`arrived id=${current.movementId.slice(0, 8)} facing=${DIRECTION_BY_FACING[facing]} yaw=${yaw.toFixed(3)}`);
      emitWalkArrived({
        movementId: current.movementId,
        at: atTopLeft,
        facing: DIRECTION_BY_FACING[facing],
        // PHASE 6B — the exact value beside V1's word. Finite by construction (wrapAngle of a finite yaw);
        // the store and the backend both refuse anything else on the way in.
        ...(Number.isFinite(yaw) ? { yaw } : {}),
        // STANDING — see the header. V2 publishes where the body is, nothing more.
        state: "standing",
        seatKey: null,
        roomId: current.roomId,
      });
    },
  };
}

/** Where V1 last saw the SIGNED-IN employee stop, as V2 needs it, or null when V1 holds no such fact. */
export interface Vo3dSelfPosition {
  /** V1 FRAME-UNIT CENTRE point, the same basis Vo3dHomeDesk.point is in — app/world.ts applies its own
   *  room shift on top, through the same homeDeskWorldPoint every other placement goes through. */
  point: Vec2;
  facing: Facing;
  /** PHASE 7D — a named place beyond V1's coordinate frame this employee was last in (the CAVE), or
   *  absent. `point` remains the real in-frame position V1 holds for them, so a world that does not
   *  recognise the name restores them there, which is exactly what it did before this existed. */
  place?: string;
  /** PHASE 6C — the V2 seat anchor V1 says this employee is SITTING in (state "sitting" and a seat key
   *  the mapping knows), or absent. A sitting row whose seat V2 cannot identify restores as STANDING at
   *  the centroid — the honest fallback, and the same one V1's own restore takes for a seat it cannot
   *  find (spawnPlacement.ts → "desk"). */
  seat?: string;
}

/**
 * THE OTHER HALF OF PHASE 5, and the reason the write above is safe to make: V2 starts you where V1 says
 * you are, not where your desk is.
 *
 * Phase 3's home desk is a PREVIEW (app/spawn.ts says so). Publishing movement from a preview would mean
 * every entry into the V2 route silently relocated the employee to their desk and then broadcast walks
 * from it. Reading V1's own persisted position first is what keeps V1 the authority: V2 begins where V1
 * left off, and a reload — in either office — comes back to the same place.
 *
 * PURE, and given its inputs rather than fetching them, exactly like adapters/v1CoworkerPositions: the
 * host subscribes through V1's own hooks and hands the snapshot in.
 *
 * `stable` AND ONLY `stable`, for the same reason Phase 4B reads only that half: it is the position V1
 * last saw this employee ARRIVE at, which is the only one that is durable. An `active` movement belongs
 * to whichever session is walking it and is not a place to put a body.
 *
 * `snapshotReady` is the gate, not an optimisation — before the first positions_snapshot the store is
 * empty, and an empty store is indistinguishable from "this employee has never moved".
 */
export function resolveV1SelfPosition(
  peers: readonly PeerMovementState[],
  snapshotReady: boolean,
  box: { width: number; height: number } = selfSpriteBox(resolveVo3dIdentity()?.avatarId ?? null),
): Vo3dSelfPosition | null {
  if (!snapshotReady) return null;
  const self = selfEmailKey();
  if (!self) return null;
  // SELF IS IN THE SNAPSHOT. positions_snapshot replays the whole registry including the connecting
  // employee's own row, which is exactly why V1's OfficeMap waits on this flag before deciding a spawn.
  // Phase 4A's coworker set excludes self by email, so this is the only place that row is ever read.
  const peer = peers.find((p) => emailKey(p.email) === self);
  if (!peer || !isUsablePosition(peer.stable.pos)) return null;
  // SEATED ONLY WHEN V1 SAYS SO AND NO WALK IS IN FLIGHT — the same two conditions V1's own occupancy
  // reads (OfficeMap.tsx occupiedCentroidKeys: `!p.active && state === "sitting" && seatKey`).
  const anchor = !peer.active && peer.stable.state === "sitting" ? anchorForSeatKey(peer.stable.seatKey) : null;
  return {
    // The one conversion, their own box's halves and nothing else — the mirror of toTopLeft above.
    point: { x: peer.stable.pos.x + box.width / 2, z: peer.stable.pos.y + box.height / 2 },
    facing: FACING_BY_DIRECTION[peer.stable.facing],
    ...(anchor ? { seat: anchor.id } : {}),
    // PHASE 7D — THE NAMED PLACE V1 HOLDS FOR THIS EMPLOYEE, carried through exactly as the peer adapter
    // carries it. Without it a reload put the signed-in employee back at `point` — the portal — while
    // every other browser, reading the same persisted row, correctly drew them inside the CAVE. The two
    // views disagreed about one fact that was on the wire the whole time.
    //
    // The adapter still does not know what any name MEANS: it is a string from the persisted row, and the
    // world decides whether it recognises it (an unknown place simply restores at `point`).
    ...(peer.stable.roomId ? { place: peer.stable.roomId } : {}),
  };
}
