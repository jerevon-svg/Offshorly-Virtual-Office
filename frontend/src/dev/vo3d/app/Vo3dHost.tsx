// vo3d app — THE REACT HOST. The counterpart to bootstrap.ts: that file mounts the V2 world on a page
// it owns forever, this one mounts the SAME world inside V1's React tree, where it can be unmounted.
//
// Reached only through V1's DEV-only `?world=v2` route (see App.tsx). Still a FULLSCREEN technical
// preview: no V1 HUD, chat, movement or attendance is mounted alongside it.
//
// Phase 2 added exactly ONE thing to that list — READ-ONLY IDENTITY: the employee V1 has already signed
// in (adapters/v1Identity), handed to the world as their own 3D character. Phase 3 added their desk.
//
// PHASE 4A ADDS THE ROSTER, and with it the first NETWORK READ this route has ever done. That is a real
// change to this file's old promise of "no fetch, no store, no subscription", and it is deliberate and
// bounded:
//   • It is V1's OWN roster hook (services/office/useOfficeRoster) and V1's OWN offline-lineup hook, used
//     exactly as V1's office uses them. No new endpoint, no new socket, no second copy of either rule.
//   • It is READ-ONLY in both directions: nothing is emitted, published or written back.
//
// PHASE 6A MAKES THEM WALK. The same subscription, the same store, one more field read from it: each
// peer's IN-FLIGHT movement (its route and duration) alongside the arrived position Phase 4B already
// read. Still nothing is emitted for anybody but self, still no second socket, and the stable position
// stays the authority — see adapters/v1CoworkerPositions and world/Coworkers.
//
// PHASE 4B MAKES THOSE COWORKERS STAND WHERE V1 LAST SAW THEM STOP, and adds no new kind of dependency to
// the list above — one more of V1's own hooks over one more of V1's own module-level singletons:
//   • services/presence/movementSync owns ITS socket the way offlineLineupClient owns its. usePeerMovements
//     joins it; it does not open one. No second movement socket exists to be opened.
//   • Still nothing is emitted on it. Only the ARRIVED half of the feed is read (`stable`), never the
//     in-flight half, so a peer mid-walk simply stays put until they arrive: a snap, not a walk.
//   • Still non-blocking and still derived-by-default. Until V1's first positions_snapshot lands — and
//     forever, for anyone V1 holds no position for — Phase 4A's desks are exactly what renders.
//   • It is NON-BLOCKING. The world is built from the identity and desk exactly as before and never waits
//     on the roster; coworkers are pushed in afterwards, whenever and if ever they arrive. A roster that
//     fails, hangs or returns nothing leaves a fully explorable, fully working world.
//   • REACT OWNS THE SUBSCRIPTIONS (these hooks, unsubscribed on unmount) and the WORLD OWNS THE SCENE
//     OBJECTS (Coworkers.dispose). Neither reaches into the other.
// PHASE 5 IS THE FIRST WRITE THIS ROUTE HAS EVER MADE, and it is the one item that genuinely leaves the
// read-only promise above: the signed-in employee's OWN movement is published through V1's existing
// walk_started/walk_arrived pipeline, so every other employee sees them move exactly as if they were in
// V1's office. The bounds are all in adapters/v1SelfMovement.ts; the two that matter here are that it is
// still V1'S OWN SOCKET (no second connection, no new event) and that it publishes only the SELF row —
// nothing about anybody else is ever written. Its companion is the restore below: V2 now starts you where
// V1 last saw you stop, so movement is published from V1's position rather than from a desk preview.
//
// A 401 still cannot redirect this route into /login by surprise: apiFetch already navigates on its own,
// and useOfficeRoster surfaces every other failure as state rather than throwing.
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveVo3dCoworkers, selfEmailKey } from "../adapters/v1Coworkers";
import { applyLivePositions, countLivePositions, countSeated, countWalking } from "../adapters/v1CoworkerPositions";
import { createV1SelfMovementSink, resolveV1SelfPosition } from "../adapters/v1SelfMovement";
import { anchorForSeatKey } from "../adapters/v1Seats";
import { seatCentroidKey } from "../../../data/emptySeats";
import { useV1Attendance } from "../adapters/v1Attendance";
import { useOfficeRoster } from "../../../services/office/useOfficeRoster";
import { useOfflineLineup } from "../../../services/presence/offlineLineupClient";
import {
  getServerClockOffsetMs,
  subscribeSeatRejected,
  useMovementSnapshotReady,
  usePeerMovements,
} from "../../../services/presence/movementSync";
import {
  computeOfflineEmailSet,
  computeServerLineupEmailSet,
} from "../../../services/presence/offlineLineupPlacement";
import { EMPTY_COWORKER_SET } from "./coworkers";
import { Vo3dOverlay } from "./Vo3dOverlay";
import { resolveVo3dHomeDesk } from "../adapters/v1HomeDesk";
import { resolveVo3dIdentity } from "../adapters/v1Identity";
import type { Vo3dIdentity } from "./identity";
import type { Vo3dHomeDesk } from "./spawn";
import type { Vo3dWorld } from "./world";

// WHY THE CANVAS IS NOT JSX. Three separate reasons, all load-bearing:
//
//  1. render/Renderer.dispose() calls forceContextLoss() — a disposed world's canvas is DEAD and cannot
//     be given to a second createVo3dWorld(). React would hand back the same element on a remount.
//  2. <StrictMode> (main.tsx) deliberately double-invokes effects in dev: mount -> cleanup -> mount. That
//     is exactly the remount case in 1., on every single mount, so a JSX canvas would be broken always
//     rather than occasionally.
//  3. Renderer sizes itself from window.innerWidth/innerHeight and writes inline px onto the canvas
//     (render/Renderer.resize), so the element must fill the window; it is not a React-laid-out box.
//
// Creating it here, inside the effect, means every effect run owns a canvas nothing else has ever
// touched, and the cleanup that disposes the world takes that canvas out of the document with it.
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  return canvas;
}

// The world module is ~200KB of source plus the three.js addon graph, and it is reached ONLY through
// this dynamic import — so a normal V1 dev page load never fetches it, and `vite build` can drop it along
// with this whole DEV-only component (App.tsx's isV2WorldRoute is statically false in a build).
//
// Memoised because the mount that needs it can happen several times per session — StrictMode alone makes
// it twice per page load — and the module is a fetch-once, evaluate-once thing in every one of them. Each
// mount attaches its own continuation to the one promise rather than issuing its own import.
let worldModule: Promise<typeof import("./world")> | null = null;
function loadWorld(): Promise<typeof import("./world")> {
  worldModule ??= import("./world");
  return worldModule;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; identity: Vo3dIdentity | null; homeDesk: Vo3dHomeDesk | null }
  | { kind: "error"; message: string };

/** Drop `?world=v2` and reload into the normal V1 office. A plain location assignment rather than a
 *  router navigation: V2 has scattered listeners and GPU state across window, document and document.body,
 *  and a full document teardown is the one teardown that cannot leave anything behind. */
function backToV1(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("world");
  window.location.href = url.toString();
}

export function Vo3dHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // The live world, for the coworker effect below. A ref rather than state on purpose: the world is not
  // rendered by React and must not re-render anything when it appears.
  const worldRef = useRef<Vo3dWorld | null>(null);
  // PHASE 5 verification flags — two booleans, for the redacted readout at the bottom of this file. They
  // say whether this session is publishing movement at all and whether V1's position restore has landed,
  // which is what an outside check (automated or human) needs in order to trust the rest. Never a
  // coordinate: the world's own dev panel is where geometry is read from.
  const [selfPublishing, setSelfPublishing] = useState(false);
  const [selfRestored, setSelfRestored] = useState(false);

  // V1's roster, exactly as V1's own office reads it. Both hooks are safe to hold here: useOfficeRoster
  // fetches once and then follows an SSE stream (real mode only — it does not open one in mock), and
  // useOfflineLineup joins the app's existing lineup socket read-only. Neither is ever emitted to.
  const roster = useOfficeRoster();
  const offlineLineup = useOfflineLineup();

  // PHASE 4B — V1'S OWN MOVEMENT STORE, read through V1's own hooks. Two reads, both subscriptions and
  // neither a connection of ours: services/presence/movementSync.ts holds a MODULE-LEVEL singleton socket
  // (exactly like offlineLineupClient above), so mounting these joins the one connection that module
  // already owns rather than opening a second movement socket. Nothing is ever emitted on it — no
  // walk_started, no walk_arrived, no position write of any kind — so this route still cannot change a
  // single fact about where V1 thinks anybody is.
  //
  // `snapshotReady` is the gate, not an optimisation. Before the first positions_snapshot the store is
  // empty, and an empty store is indistinguishable from "nobody has ever moved" — reading it then would
  // silently claim everyone is at their desk. Until it flips, Phase 4A's derived desks are what render.
  const peerMovements = usePeerMovements();
  const snapshotReady = useMovementSnapshotReady();

  // V1'S OWN VISIBILITY PREDICATE, INCLUDING THE MODE SWITCH — not a V2 re-reading of it.
  // services/presence/offlineLineupPlacement.ts owns both halves and OfficeMap.tsx picks between them the
  // same way: real mode trusts Atlas presence, mock mode does NOT, because MockOfficeService's statuses
  // are a fixed deterministic spread that check-in never updates (Bon is hard-coded OFFLINE there), so
  // the app's own server lineup is the only truthful offline signal in mock. Getting this backwards
  // parks a checked-in employee on the sidewalk — the exact bug that fix was written for.
  const offlineEmails = useMemo(
    () =>
      import.meta.env.VITE_OFFICE_INTEGRATION_MODE === "real"
        ? computeOfflineEmailSet(roster.people)
        : computeServerLineupEmailSet(offlineLineup),
    [roster.people, offlineLineup],
  );

  // Resolved OUTSIDE the mount effect so a roster change re-runs this and nothing else — the world is
  // never rebuilt for it. Self is excluded by email here, which is why the viewer never gets a second
  // body: their own avatar is already the one the world spawned at their desk in Phase 3.
  const rosterSet = useMemo(
    () => (roster.people.length > 0 ? resolveVo3dCoworkers(roster.people, offlineEmails, selfEmailKey()) : EMPTY_COWORKER_SET),
    [roster.people, offlineEmails],
  );

  // THE LIVE OVERLAY, AND THE ORDER IT RUNS IN. Positions are applied to the roster set AFTER
  // resolveVo3dCoworkers has already dropped self, everyone V1 counts as offline/checked-out, and everyone
  // with no 3D character. That order is load-bearing: employee_positions is NOT attendance-gated and keeps
  // a stale row for somebody who checked out hours ago, so applying positions first would stand a
  // checked-out employee back at a desk on the strength of movement data alone. Filtering first means a
  // position can only ever move somebody V1 is already showing — it can never add anybody.
  //
  // Anyone V1 holds no usable position for keeps the desk resolveVo3dCoworkers gave them. Nothing is
  // fabricated, and the two facts stay distinguishable through Vo3dCoworker.posSource.
  const coworkerSet = useMemo(
    // PHASE 6A — the same call, now also carrying each peer's IN-FLIGHT walk. `getServerClockOffsetMs()`
    // is V1's own last-snapshot clock offset, read (not subscribed to) at exactly the moment this memo
    // runs, which is exactly when a movement event arrived: the adapter needs it to say how far into a
    // walk we are, and V1's PeerWalker fast-forwards with the same value.
    //
    // THIS MEMO STILL RUNS ONLY ON AN EVENT, never per frame. `usePeerMovements` notifies on
    // walk_started, walk_arrived and positions_snapshot and on nothing else, and the walk it produces
    // carries a movement id rather than a live clock — so the world can tell a new movement from the same
    // one being handed over again, and a re-render caused by somebody else cannot restart a walk.
    () => applyLivePositions(rosterSet, peerMovements, snapshotReady, getServerClockOffsetMs()),
    [rosterSet, peerMovements, snapshotReady],
  );
  // PHASE 7A — who the overlay's Search may offer: exactly the people this world draws a body for.
  // Sorted and joined from the set that already decided it, so no second filter exists to disagree.
  const drawnEmails = useMemo(() => coworkerSet.coworkers.map((c) => c.email), [coworkerSet]);
  const livePositionCount = useMemo(() => countLivePositions(coworkerSet), [coworkerSet]);
  const walkingCount = useMemo(() => countWalking(coworkerSet), [coworkerSet]);
  const seatedCount = useMemo(() => countSeated(coworkerSet), [coworkerSet]);

  // PHASE 6C — WHICH CHAIRS ARE TAKEN, by V1's own two occupancy rules (OfficeMap.tsx occupiedCentroidKeys)
  // translated through the validated seat mapping into V2 anchor ids:
  //   • a synced peer occupies a seat exactly when their stable state says "sitting" with a seat key and no
  //     walk is in flight — self's own row excluded, since one's own chair is not "occupied by another";
  //   • a roster person with NO movement entry occupies the desk seat V1 seated them at (their derived
  //     point IS that seat's centroid), which goes stale the instant a walk of theirs is published — exactly
  //     as V1 reads it. Only people V2 actually draws are counted here (rosterSet has already dropped the
  //     offline and the avatar-less), which is narrower than V1's full roster by construction.
  // Sorted, so an unchanged set is an unchanged array and the world is not pushed for nothing.
  const occupiedSeatIds = useMemo(() => {
    const self = selfEmailKey();
    const synced = new Set(peerMovements.map((p) => p.email));
    const ids = new Set<string>();
    for (const c of rosterSet.coworkers) {
      if (synced.has(c.email)) continue;
      const anchor = anchorForSeatKey(seatCentroidKey(c.point.x, c.point.z));
      if (anchor) ids.add(anchor.id);
    }
    for (const p of peerMovements) {
      if (p.email === self || p.active || p.stable.state !== "sitting" || !p.stable.seatKey) continue;
      const anchor = anchorForSeatKey(p.stable.seatKey);
      if (anchor) ids.add(anchor.id);
    }
    return [...ids].sort();
  }, [rosterSet, peerMovements]);

  // PHASE 5 — WHERE V1 SAYS *THIS* EMPLOYEE IS. The same store Phase 4B reads for everybody else, read
  // for the one row it deliberately excludes: self. positions_snapshot carries it, which is why V1's own
  // office waits on `snapshotReady` before deciding a spawn, and why this is gated on the same flag.
  //
  // Null is the common, correct answer — no snapshot yet, no identity, or V1 has never recorded a
  // position for this employee — and the world then keeps Phase 3's home-desk preview.
  const selfPosition = useMemo(
    () => resolveV1SelfPosition(peerMovements, snapshotReady),
    [peerMovements, snapshotReady],
  );

  // PHASE 5 — V1'S ATTENDANCE, AS THE ONE AUTHORITY OVER THE WORKING-OFFICE BOUNDARY.
  //
  // Read through V1's own services/attendance (adapters/v1Attendance), never re-decided here and never
  // written. The refresh key is the pair of live signals this host already holds: the offline lineup and
  // the movement-snapshot flag. The backend broadcasts the lineup on every check-in/check-out transition
  // and re-sends the snapshot on every (re)connect, so between them they are a reliable HINT that
  // something may have changed — which is all they are used for. Neither is the answer: the lineup is
  // in-memory and per-process on the backend and would fail OPEN across a restart (see the adapter).
  const accessRefreshKey = useMemo(
    () => `${offlineLineup.map((e) => e.email).join(",")}|${snapshotReady}`,
    [offlineLineup, snapshotReady],
  );
  // PHASE 7A — the SAME single read, now also carrying V1's attendance record: the branded HUD's
  // availability pill and working-time clock are two more facts off it, and a second hook would mean a
  // second poller and two answers that can disagree by an interval.
  const attendance = useV1Attendance(accessRefreshKey);
  const officeAccess = attendance.access;

  // The roster, readable at world-creation time without making the creation effect depend on it.
  const coworkerSetRef = useRef(coworkerSet);
  coworkerSetRef.current = coworkerSet;
  // Same trick for the restore: the snapshot may land before the world module has finished loading, in
  // which case the creation effect applies what we already have rather than waiting for a change that
  // may never come.
  const selfPositionRef = useRef(selfPosition);
  selfPositionRef.current = selfPosition;
  const occupiedSeatIdsRef = useRef(occupiedSeatIds);
  occupiedSeatIdsRef.current = occupiedSeatIds;
  // Same again for the access answer: the world's gate starts CLOSED, so a world built after the read has
  // already resolved must be told at once rather than waiting for the answer to change.
  const officeAccessRef = useRef(officeAccess);
  officeAccessRef.current = officeAccess;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = makeCanvas();
    host.appendChild(canvas);

    let world: Vo3dWorld | null = null;
    let cancelled = false;

    // RESOLVED HERE, PER MOUNT, and never hoisted to module scope. Two reasons: App.tsx renders this
    // component only after useAuthGate reaches "allowed", so inside the effect the answer is already
    // known and synchronous — there is no loading state to model; and StrictMode's mount -> cleanup ->
    // mount re-runs this effect, which must re-read rather than reuse a value captured at import time.
    // `null` is a legitimate answer (V1 could not parse an identity) and is passed through as "no
    // identity" — NOT as a guess that this is Bon.
    const identity = resolveVo3dIdentity();
    // Phase 3, and read exactly like the identity above: a synchronous look at data V1 already had —
    // the painted seats, the room table, the signed-in user — and not a request, a socket or a session.
    // Null means V1 knows of no desk for this person, and the world then keeps its own default spawn.
    //
    // A DESK IS NOT AN ARRIVAL. Nothing here says the employee is checked in, at work, or anywhere at
    // all; V1's attendance gate (spawnPlacement.ts) is the only thing that may say that, and V2 does not
    // ask it. The preview stands you where your desk is, which is why the readout below names the room
    // rather than announcing a status.
    const homeDesk = resolveVo3dHomeDesk();
    // PHASE 5, and read exactly like the two above: a synchronous look at the identity V1 already had.
    // NULL when V1 could not parse a signed-in employee, and the world then publishes nothing at all —
    // the standalone behaviour. It opens no socket of its own: emitWalkStarted/emitWalkArrived join the
    // module-level connection services/presence/movementSync already owns and the hooks above already use.
    const selfMovement = createV1SelfMovementSink();
    setSelfPublishing(selfMovement !== null);

    void loadWorld()
      .then(({ createVo3dWorld }) => {
        // The unmount may have already run — StrictMode's cleanup fires within the same tick that this
        // import was started in. Building a world now would be building one nobody will ever dispose.
        if (cancelled) return;
        world = createVo3dWorld(canvas, identity ?? undefined, homeDesk ?? undefined, selfMovement ?? undefined);
        worldRef.current = world;
        // V1's snapshot may have resolved while the world module was loading — apply it now, or this
        // employee stands at their desk preview until a movement change that may never arrive.
        // ACCESS BEFORE THE RESTORE, deliberately: the restore is refused while the gate is shut and the
        // persisted position is inside the working office, so telling the world who this employee is
        // first is what lets a checked-in one land on their own desk on the first attempt.
        if (selfMovement) world.setOfficeAccess(officeAccessRef.current);
        world.setOccupiedSeats(occupiedSeatIdsRef.current);
        const restore = selfPositionRef.current;
        if (restore && world.restoreSelf(restore.point, restore.facing, restore.seat)) setSelfRestored(true);
        // The roster may have resolved while the world module was still loading — push what we have now,
        // or those coworkers wait for the next roster change that may never come.
        world.setCoworkers(coworkerSetRef.current.coworkers, coworkerSetRef.current.missingAvatar);
        setPhase({ kind: "ready", identity, homeDesk });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // A failure in here is a failure of the PREVIEW, not of V1: the boundary in App.tsx would blank
        // the page, so the error is caught and rendered as a way back instead.
        console.error("Vo3dHost: failed to mount the V2 world", e);
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });

    return () => {
      cancelled = true;
      // Idempotent by construction: this cleanup runs once per effect run, and Vo3dWorld.dispose() is
      // itself guarded (app/world.ts), so a double call is a no-op rather than a teardown of a dead world.
      // Only if it is still OURS. StrictMode runs mount -> cleanup -> mount, and a cleanup that cleared
      // the ref unconditionally would blank the ref the SECOND mount had just filled.
      if (worldRef.current === world) worldRef.current = null;
      world?.dispose();
      world = null;
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the world is built ONCE per mount; the
    // roster is delivered through the effect below and through coworkerSetRef, never by rebuilding it.
  }, []);

  // THE ONE WRITE INTO THE WORLD. Runs on every roster change and on nothing else; a world that is not
  // built yet is simply skipped (the creation effect pushes the current set itself when it finishes).
  useEffect(() => {
    worldRef.current?.setCoworkers(coworkerSet.coworkers, coworkerSet.missingAvatar);
  }, [coworkerSet]);

  // THE RESTORE, pushed in the same way and with the same shape: React owns the subscription, the world
  // owns the body. Safe to run on every movement change — restoreSelf is a one-shot that refuses once it
  // has landed or once the player has taken control (see its contract), so a repeated call is a no-op
  // rather than a body being yanked back mid-walk.
  useEffect(() => {
    if (!selfPosition) return;
    if (worldRef.current?.restoreSelf(selfPosition.point, selfPosition.facing, selfPosition.seat)) setSelfRestored(true);
  }, [selfPosition]);

  // PHASE 6C — THE OCCUPANCY PUSH. Same shape again: React derives, the world refuses. Runs on every
  // movement or roster change; the creation effect pushes the current set itself when the world lands.
  useEffect(() => {
    worldRef.current?.setOccupiedSeats(occupiedSeatIds);
  }, [occupiedSeatIds]);

  // PHASE 6C — THE BACKEND'S VERDICT ON A SEAT CLAIM. When this session's own walk_arrived named a seat
  // somebody else already held, the server accepted it as STANDING and tells only this client; the body
  // stands up so what the employee sees matches what everybody else was told. Only for a publishing
  // session — a session with no identity never claims a seat.
  useEffect(() => {
    if (!selfPublishing) return;
    return subscribeSeatRejected(() => worldRef.current?.standUp());
  }, [selfPublishing]);

  // THE ACCESS PUSH. Same shape as the two writes above — React owns the read, the world owns the gate —
  // and pushed only for a session with a real identity: the standalone-equivalent case (no identity, no
  // publishing) is left with the world's own default, which is a gate nobody is asking to cross.
  useEffect(() => {
    if (!selfPublishing) return;
    worldRef.current?.setOfficeAccess(officeAccess);
  }, [officeAccess, selfPublishing]);

  return (
    <div
      ref={hostRef}
      data-testid="vo3d-host"
      style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#e7ded4" }}
    >
      {phase.kind !== "ready" && (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "#5b5048",
            font: "14px/1.5 system-ui, sans-serif",
            textAlign: "center",
            padding: 24,
          }}
        >
          {phase.kind === "loading" ? (
            <span>Loading VO 3D V2…</span>
          ) : (
            <>
              <span>VO 3D V2 failed to start.</span>
              <span style={{ opacity: 0.7, maxWidth: 520 }}>{phase.message}</span>
            </>
          )}
          <button type="button" onClick={backToV1} style={{ font: "inherit", padding: "6px 12px" }}>
            Back to V1
          </button>
        </div>
      )}
      {/* PHASES 6D + 7A — EVERY PIECE OF DOM OVER THE WORLD: the employee interaction card and its
          services, and the branded HUD. Mounted only once the world exists (the overlay subscribes to it)
          and only for a session V1 could identify: a preview with no signed-in employee has nobody to
          chat, call or walk up to, no progression to show and no work session to clock. Everything it
          renders is V1's own — see Vo3dOverlay.tsx. */}
      {phase.kind === "ready" && phase.identity && (
        <Vo3dOverlay
          worldRef={worldRef}
          ready
          people={roster.people}
          drawnEmails={drawnEmails}
          attendance={attendance}
        />
      )}
      {phase.kind === "ready" && phase.identity && (
        // THE REDACTED READOUT. Deliberately carries the display name, the resolved character id and
        // where the identity came from — and NOTHING else. No email, no employee id, no token, nothing
        // derived from the session. It exists so a real signed-in session can be verified from the
        // outside (including by an automated check) without anything sensitive being on screen.
        <div
          data-testid="vo3d-identity"
          data-display-name={phase.identity.displayName}
          data-avatar-id={phase.identity.avatarId ?? ""}
          data-avatar-missing={phase.identity.avatarId === null ? "true" : "false"}
          data-source={phase.identity.source}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
            pointerEvents: "none",
          }}
        >
          {phase.identity.displayName}
          <span style={{ opacity: 0.7 }}>
            {" · "}
            {phase.identity.avatarId ?? "no 3D avatar"}
          </span>
        </div>
      )}
      {phase.kind === "ready" && phase.homeDesk && (
        // THE DESK READOUT. Room, seat point and facing — the three values the spawn was computed from,
        // so a real session can be checked from the outside without opening the dev panel. The point is
        // in V1 FRAME UNITS, which is the basis the adapter works in; the world applies its own room
        // shift on top (app/spawn.ts homeDeskWorldPoint), so this is the INPUT to the placement, not the
        // body's final position — that one is in the avatar panel, where it updates as you walk.
        <div
          data-testid="vo3d-home-desk"
          data-room-id={phase.homeDesk.roomId}
          data-seat-x={String(phase.homeDesk.point.x)}
          data-seat-z={String(phase.homeDesk.point.z)}
          data-facing={phase.homeDesk.facing}
          style={{
            position: "absolute",
            top: 44,
            right: 12,
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
            pointerEvents: "none",
          }}
        >
          desk preview
          <span style={{ opacity: 0.7 }}>
            {" · "}
            {phase.homeDesk.roomId}
          </span>
        </div>
      )}
      {phase.kind === "ready" && (roster.people.length > 0 || roster.error !== null) && (
        // THE COWORKER READOUT. How many real employees are standing in the world, how many of them stand
        // on a LIVE persisted position rather than their derived desk, whether V1's movement snapshot has
        // arrived at all — and, just as important, how many V1 lists that V2 could not draw, so a smaller
        // office is never silently smaller.
        //
        // COUNTS AND FLAGS ONLY, never an email, a position or a status. Phase 4B reads where real people
        // are standing, which makes the redaction rule here stricter rather than looser: a readout that
        // printed a coordinate would be publishing one employee's location into another's DOM. The
        // nameplates in the world already say who is present; `__vo3d.coworkers` (dev console, name +
        // position, still no email) is where a verification run reads the geometry from.
        <div
          data-testid="vo3d-coworkers"
          data-count={String(coworkerSet.coworkers.length)}
          data-live-positions={String(livePositionCount)}
          data-walking={String(walkingCount)}
          data-seated={String(seatedCount)}
          data-occupied-seats={String(occupiedSeatIds.length)}
          data-snapshot-ready={snapshotReady ? "true" : "false"}
          data-missing-avatar={String(coworkerSet.missingAvatar.length)}
          data-roster-error={roster.error ? "true" : "false"}
          style={{
            position: "absolute",
            top: 76,
            right: 12,
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
            pointerEvents: "none",
          }}
        >
          {roster.error
            ? "roster unavailable — no coworkers shown"
            : `${coworkerSet.coworkers.length} coworker${coworkerSet.coworkers.length === 1 ? "" : "s"}`}
          {!roster.error && coworkerSet.missingAvatar.length > 0 && (
            <span style={{ opacity: 0.7 }}>
              {" · "}
              {coworkerSet.missingAvatar.length} without a 3D avatar
            </span>
          )}
        </div>
      )}
      {phase.kind === "ready" && (
        // THE MOVEMENT READOUT (Phase 5). Two facts and nothing else: is this session publishing the
        // employee's own movement into V1 at all, and did V1's own persisted position land before they
        // started walking. Both are booleans by design — the position itself is this employee's location,
        // and the rule the coworker readout above states applies to their own row just as strictly.
        <div
          data-testid="vo3d-self-movement"
          data-publishing={selfPublishing ? "true" : "false"}
          data-restored={selfRestored ? "true" : "false"}
          data-office-access={officeAccess}
          style={{
            position: "absolute",
            top: 108,
            right: 12,
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
            pointerEvents: "none",
          }}
        >
          {selfPublishing ? "movement → V1" : "movement not published"}
          {selfPublishing && (
            <span style={{ opacity: 0.7 }}>
              {" · "}
              {selfRestored ? "restored from V1" : "desk preview"}
              {" · "}
              {officeAccess === "permitted"
                ? "office open"
                : officeAccess === "denied"
                  ? "checked out — Reception, outdoors and the Lab only"
                  : "checking attendance…"}
            </span>
          )}
        </div>
      )}
      {phase.kind === "ready" && phase.identity?.avatarId === null && (
        // The explicit missing-avatar state. It says the character is absent, names the person it is
        // absent FOR, and offers nothing that looks like a retry — there is no asset to fetch. The one
        // thing it must never do is imply the empty world is somebody else's body.
        <div
          role="status"
          data-testid="vo3d-missing-avatar"
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1003,
            maxWidth: 520,
            textAlign: "center",
            font: "12px/1.5 system-ui, sans-serif",
            padding: "8px 14px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.82)",
            color: "#f4ede4",
          }}
        >
          No 3D avatar is registered for {phase.identity.displayName} yet, so no character is shown. The
          world is fully explorable.
        </div>
      )}
      {phase.kind === "ready" && (
        // TOP-CENTRE, above everything. V2's world claims three corners of the window with panels it
        // parks on document.body — the bench readout top-left (devtools/Bench.ts, z-index 10), the
        // editor panel bottom-left (editor/EditorPanel.ts, z-index 1002) and lil-gui down the whole
        // right edge (z-index 1001) — and the one way out of the preview must not sit under any of them.
        <button
          type="button"
          onClick={backToV1}
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
          }}
        >
          Back to V1
        </button>
      )}
    </div>
  );
}
