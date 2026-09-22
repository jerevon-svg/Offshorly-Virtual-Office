// Phase 5 — the coordinate inverse, and the structural promises no runtime test can make.
//
// Same split as spawn.phase3.test.ts: the arithmetic is tested for real, and the things that must NOT be
// there (a V1 import inside the world, a second socket, a seat claim, an argument the standalone page
// would have to pass) are asserted against the source, because a behavioural test cannot show an absence.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) — the same
// exemption spawn.phase3.test.ts and identity.phase2.test.ts take. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeDeskWorldPoint, v1FramePoint, type V1ArtBox } from "./spawn";

const world = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
const bootstrap = readFileSync("src/dev/vo3d/app/bootstrap.ts", "utf8");
const feed = readFileSync("src/dev/vo3d/app/selfMovement.ts", "utf8");
const adapter = readFileSync("src/dev/vo3d/adapters/v1SelfMovement.ts", "utf8");

/** Source with its comments removed — these files explain themselves at length, and a prose mention of
 *  the thing is the documentation doing its job, not the module doing it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// The Design Room's real numbers: the only room in the table with a declared shift.
const DESIGN: V1ArtBox = { id: "design-room", rect: { x: 9.47, z: 316.19, w: 310.64, d: 264.04 } };
const HUB: V1ArtBox = { id: "central-hub", rect: { x: 400, z: 427.5, w: 300, d: 323.4 } };
const SHIFTS = { "design-room": 16 };

describe("v1FramePoint", () => {
  it("undoes the shift a room was BUILT with, so a world point comes back in V1 units", () => {
    const v1 = { x: 100, z: 400 }; // inside the Design Room's art box
    const inWorld = homeDeskWorldPoint(v1, [DESIGN, HUB], SHIFTS);
    expect(inWorld).toEqual({ x: 100, z: 416 });
    expect(v1FramePoint(inWorld, [DESIGN, HUB], SHIFTS)).toEqual(v1);
  });

  it("round-trips every point a body can stand on inside a shifted room", () => {
    for (let z = DESIGN.rect.z + 20; z < DESIGN.rect.z + DESIGN.rect.d - 20; z += 17) {
      const v1 = { x: 150, z };
      const back = v1FramePoint(homeDeskWorldPoint(v1, [DESIGN, HUB], SHIFTS), [DESIGN, HUB], SHIFTS);
      expect(back.x).toBe(v1.x);
      expect(back.z).toBeCloseTo(v1.z, 9);
    }
  });

  it("leaves an unshifted room, and the corridor, exactly alone in both directions", () => {
    const hub = { x: 500, z: 500 };
    expect(homeDeskWorldPoint(hub, [DESIGN, HUB], SHIFTS)).toEqual(hub);
    expect(v1FramePoint(hub, [DESIGN, HUB], SHIFTS)).toEqual(hub);
    const corridor = { x: 800, z: 300 };
    expect(v1FramePoint(corridor, [DESIGN, HUB], SHIFTS)).toEqual(corridor);
  });

  it("leaves a point far outside the frame alone rather than inventing a room for it", () => {
    // The CAVE, out at x 2600. It is refused later, by the adapter's usable-position check — this
    // function's job is arithmetic, not policy, and it must not silently move an out-of-frame point.
    expect(v1FramePoint({ x: 2600, z: 400 }, [DESIGN, HUB], SHIFTS)).toEqual({ x: 2600, z: 400 });
  });
});

describe("the standalone world is still untouched", () => {
  it("takes every parameter after the canvas OPTIONALLY", () => {
    // THE PROPERTY, not the exact spelling of the signature. What must hold is that the standalone
    // dev page can still call createVo3dWorld(canvas) with nothing else — every later parameter is
    // either `?`-optional or defaulted. Phase 9B added a fifth (`season`, defaulted to "none"), and
    // an exact-string assertion failed on it while the property it was written to protect was intact.
    expect(world).toContain("homeDesk?: Vo3dHomeDesk");
    expect(world).toContain("selfMovement?: Vo3dSelfMovementSink");
    expect(world).toContain('season: SeasonTheme = "none"');
  });

  it("still lets the dev page build a world with no arguments at all", () => {
    expect(bootstrap).toContain('createVo3dWorld(document.getElementById("stage") as HTMLCanvasElement)');
  });

  it("builds no feed, and so publishes nothing, when no sink was handed over", () => {
    expect(code(world)).toContain("const selfFeed = selfMovement");
    // Every call into the feed is optional-chained, so the no-sink world runs the same statements it
    // always did with a null check in front of them.
    expect(code(world)).toContain("selfFeed?.frame(");
    expect(code(world)).toContain("selfFeed?.planned(");
    expect(code(world)).toContain("selfFeed?.dispose()");
  });
});

describe("the world never learns about V1's services", () => {
  it("imports no V1 socket, store or auth module", () => {
    // The whole point of the app/selfMovement.ts contract: world.ts speaks its own coordinates to an
    // interface, and the adapter is the only thing that knows movementSync exists.
    expect(code(world)).not.toContain("movementSync");
    expect(code(world)).not.toContain("emitWalk");
    expect(code(world)).not.toContain("currentUserStore");
  });

  it("keeps the feed itself free of every V1 import", () => {
    // app/selfMovement.ts must stay loadable by the standalone page, exactly like app/spawn.ts.
    const imports = code(feed).match(/from "[^"]+"/g) ?? [];
    expect(imports).toEqual(['from "../core/coords"']);
  });
});

describe("what the adapter is not allowed to do", () => {
  it("opens no socket and issues no request of its own", () => {
    const src = code(adapter);
    expect(src).not.toContain("io(");
    expect(src).not.toContain("apiFetch");
    expect(src).not.toContain("fetch(");
  });

  it("emits only V1's own two movement events", () => {
    const src = code(adapter);
    expect(src).toContain("emitWalkStarted(");
    expect(src).toContain("emitWalkArrived(");
    // No third event, and no re-implementation of V1's own path cap or duration window.
    expect(src).not.toContain("capPath");
    expect(src).not.toContain("20000");
  });

  it("claims a seat ONLY through the validated V1 mapping (Phase 6C), and never attendance", () => {
    const src = code(adapter);
    // standing, seat-less, is still the default arrival...
    expect(src).toContain('state: "standing"');
    expect(src).toContain("seatKey: null");
    // ...and the ONE sitting arrival is gated on adapters/v1Seats resolving the anchor to a V1 seat,
    // with V1's own key — never an invented one.
    expect(src).toContain('state: "sitting"');
    expect(src).toContain("v1SeatForAnchor");
    expect(src).toContain("seatKey: v1Seat.key");
    expect(src).not.toContain("attendance");
    expect(src).not.toContain("CHECKED_IN");
  });

  it("reuses V1's movement-id rule rather than carrying a second copy", () => {
    expect(code(adapter)).toContain("makeMovementId");
    expect(code(adapter)).not.toContain("randomUUID");
  });
});

describe("what the world must do around the feed", () => {
  it("tells the feed the V1 restore was a PLACEMENT, so it is never published as a walk", () => {
    const src = code(world);
    const i = src.indexOf("function restoreSelf");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, src.indexOf("\n  }", i))).toContain("selfFeed?.placed(");
  });

  it("flushes the feed on pagehide, because a navigation never unmounts React", () => {
    // dispose() covers leaving the route inside the SPA; a reload or a tab close does not run it at all,
    // and the leg in flight would be lost with the position V1 would restore them to.
    expect(code(world)).toContain('onWindow("pagehide", () => selfFeed?.dispose())');
  });
});

const access = readFileSync("src/dev/vo3d/app/access.ts", "utf8");
const attendance = readFileSync("src/dev/vo3d/adapters/v1Attendance.ts", "utf8");

describe("there is exactly one attendance authority, and it is V1's", () => {
  it("asks V1's own service and writes nothing back", () => {
    const src = code(attendance);
    expect(src).toContain("attendanceService");
    expect(src).toContain("getMine");
    // No check-in, no check-out, no time log, no status write — any of those would be a second authority.
    expect(src).not.toContain("checkIn");
    expect(src).not.toContain("checkOut");
    expect(src).not.toContain("emitGoOffline");
    expect(src).not.toContain("emitComeOnline");
  });

  it("never treats the offline lineup as the answer", () => {
    // The lineup is in-memory and per-process on the backend and fails OPEN across a restart. It is used
    // by the host only as a refresh key; the adapter must not read it at all.
    expect(code(attendance)).not.toContain("offlineLineup");
    expect(code(attendance)).not.toContain("OfflineLineup");
  });

  it("keeps the boundary model free of every V1 import", () => {
    // app/access.ts must stay loadable by the standalone dev page, exactly like app/spawn.ts.
    const imports = code(access).match(/from "[^"]+"/g) ?? [];
    expect(imports).toEqual(['from "../core/coords"']);
  });

  it("decides no work session inside the world", () => {
    const src = code(world);
    expect(src).not.toContain("attendanceService");
    expect(src).not.toContain("CHECKED_IN");
    expect(src).not.toContain("CHECKED_OUT");
  });
});

describe("the working-office boundary is enforced on every way in", () => {
  const src = code(world);

  it("closes the gate through Walkability's OWN reservation, so one predicate covers walk + A* + Player", () => {
    expect(src).toContain('const GATE_RESERVATION = "office-access-gate"');
    expect(src).toContain("walkability.reserve(GATE_RESERVATION, gateCells)");
    expect(src).toContain("walkability.release(GATE_RESERVATION)");
  });

  it("starts CLOSED, before V1 has answered", () => {
    // The world is built before the attendance read resolves. Being wrong in this direction for half a
    // second is harmless; being wrong the other way is the bypass.
    const i = src.indexOf("walkability.reserve(GATE_RESERVATION, gateCells);");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(src.indexOf("function setOfficeAccess"));
  });

  it("asks the boundary on every PLACEMENT, because nothing routes a teleport", () => {
    for (const site of ["function restoreSelf", "function placeBonAtPortal", "function placeBonAtEntrance"]) {
      const i = src.indexOf(site);
      expect(i).toBeGreaterThan(-1);
      expect(src.slice(i, i + 700)).toContain("mayPlaceAt");
    }
    // the CAVE portal's own placement callback
    expect(src).toContain("if (!mayPlaceAt(p)) return false;");
  });

  it("drops a walk already queued when V1's answer changes underneath it", () => {
    const i = src.indexOf("function setOfficeAccess");
    const body = src.slice(i, src.indexOf("\n  }", i));
    expect(body).toContain("routeEntersOffice(navCtl.path, accessGeom)");
    expect(body).toContain("navCtl.stop()");
  });

  it("moves a body only on a CONFIRMED checkout, never on an unresolved read", () => {
    const i = src.indexOf("function setOfficeAccess");
    const body = src.slice(i, src.indexOf("\n  }", i));
    expect(body).toContain('if (next === "denied") ejectFromOffice()');
    expect(body).not.toContain('"unknown") ejectFromOffice');
  });

  it("treats the ejection as a PLACEMENT, so it is never published as a walk", () => {
    const i = src.indexOf("function ejectFromOffice");
    expect(src.slice(i, src.indexOf("\n  }", i))).toContain("selfFeed?.placed(placed)");
  });

  it("resolves the in-flight walk BEFORE the ejection moves the body", () => {
    // Order is the whole point: stopping the walker and moving the body in one tick never gives frame()
    // its chance to answer the walk_started already sent.
    const i = src.indexOf("function ejectFromOffice");
    const body = src.slice(i, src.indexOf("\n  }", i));
    expect(body.indexOf("selfFeed?.interrupt(")).toBeGreaterThan(-1);
    expect(body.indexOf("selfFeed?.interrupt(")).toBeLessThan(body.indexOf("placeNear(OFFICE_EXIT_STAND)"));
  });

  it("implements none of the later attendance phase", () => {
    // Phase 5 is the boundary only: no Reception dialog, no kiosk, no sensor visuals, no status
    // transitions and no time logging.
    for (const forbidden of ["Visit AI Lab", "kiosk flow", "logTime", "setStatus", "AWAY", "Away"]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe("attendance freshness", () => {
  const src = code(attendance);

  it("reuses V1's own service for every read — there is nothing else to reuse", () => {
    // Checked before this was built: backend/app/routers/attendance.py emits only `offline_lineup`, and
    // backend/app/realtime/socket.py has no attendance event at all. V1's office reads GET /attendance/me
    // once per identity and is correct only because it OWNS the transitions; V2 observes them.
    expect(src).toContain("attendanceService");
    expect(src).toContain("getMine");
    expect(src).not.toContain("checkIn");
    expect(src).not.toContain("checkOut");
  });

  it("refreshes on focus, on visibility and on a bounded visible-only interval", () => {
    expect(src).toContain('window.addEventListener("focus"');
    expect(src).toContain('document.addEventListener("visibilitychange"');
    expect(src).toContain("window.setInterval(");
    // The interval must be gated on visibility, or a backgrounded preview polls forever.
    const i = src.indexOf("window.setInterval(");
    expect(src.slice(i, i + 200)).toContain('document.visibilityState === "visible"');
  });

  it("removes every listener and the interval on unmount", () => {
    expect(src).toContain("window.clearInterval(timer)");
    expect(src).toContain('window.removeEventListener("focus"');
    expect(src).toContain('document.removeEventListener("visibilitychange"');
  });

  it("holds at most one request, coalescing extra triggers instead of dropping them", () => {
    expect(src).toContain("if (inFlight)");
    expect(src).toContain("again = true");
    // A generation guard, so a slow answer cannot overwrite a newer one.
    expect(src).toContain("gen === generation");
  });

  it("does NOT downgrade a confirmed answer when a refresh fails", () => {
    // `unknown` is fail-closed for entry and correct while nothing is known; turning a confirmed
    // `permitted` into `unknown` over one timeout would shut a checked-in employee out of their office.
    const i = src.indexOf(".catch(");
    const body = src.slice(i, i + 300);
    expect(body).not.toContain("setAccess");
  });
});

describe("the focus path is floored, the attendance-triggered path is not", () => {
  const src = code(attendance);

  it("floors only focus/visibility", () => {
    expect(src).toContain("FOCUS_MIN_GAP_MS");
    const i = src.indexOf("const readOnFocus");
    const body = src.slice(i, i + 200);
    expect(body).toContain("Date.now() - lastAt < FOCUS_MIN_GAP_MS");
    // The doorbell effect calls the UNFLOORED read, so a confirmed check-out is never delayed.
    const doorbell = src.slice(src.lastIndexOf("readRef.current()") - 200);
    expect(doorbell).toContain("readRef.current()");
    expect(doorbell).not.toContain("FOCUS_MIN_GAP_MS");
  });
});
