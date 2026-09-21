// vo3d app — PHASE 7E: THE EXIT, AND THE PROMISES AROUND IT.
//
// Leaving the building is held by the SAME Walkability reservation Reception's gates use, so the geometry
// half of this is tested the way the gate's is — against the real door band, the real grid and the real
// derived navigation, through the player's own stand test. The rest are promises about what may and may
// not happen on the way out, and those are asserted against the source, because a behavioural test cannot
// show an absence (the same exemption app/spawn.phase5.test.ts takes).
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WorldState } from "../world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "../rooms/ground-floor";
import { makeStandTest } from "../player/standTest";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "../rooms/design-room";
import { ENTRY_ZONE, FACADE, RECEPTION_ROOM, receptionEntities } from "../rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "../rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "../rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "../rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "../rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "../rooms/cms";
import { AI_ROOM, aiRoomEntities } from "../rooms/ai";
import { DEV_ROOM, devRoomEntities } from "../rooms/dev";
import { QA_ROOM, qaRoomEntities } from "../rooms/qa";
import { Walkability, composeStatic } from "../nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "../nav/clearance";
import { DerivedNav } from "../nav/derived";
import { openedLayer, v2Static } from "../nav/v2Open";
import { CELL, v1Static, type Cell } from "../adapters/v1Grid";
import { pointInRect } from "../core/coords";
import type { Rect, Vec2 } from "../core/coords";

const ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];

function rig() {
  const world = new WorldState();
  for (const r of ROOMS) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ROOMS.map((r) => r.id)) });
  walkability.attachDerived(derived, world);
  return { walkability, stand: makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true }) };
}

/** THE DOORWAY — the V1 door span, two cell rows deep from the façade plane. Rasterised exactly as
 *  app/world.ts does it, and deliberately NOT the door's `clearance.band`: that is five rows deep and
 *  reaches sixty units out onto the public pavement, which is not this gate's to hold. */
const EXIT_BAND: Rect = { x: FACADE.door.x0, z: FACADE.z, w: FACADE.door.x1 - FACADE.door.x0, d: 2 * CELL };
function exitCells(): Cell[] {
  const b = EXIT_BAND;
  const out: Cell[] = [];
  for (let cy = Math.floor(b.z / CELL); cy <= Math.floor((b.z + b.d - 0.001) / CELL); cy++)
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w - 0.001) / CELL); cx++) out.push({ cx, cy });
  return out;
}
const EXIT_RESERVATION = "office-exit-door";

/** A real way through the doorway, discovered with the exit open rather than assumed. */
function doorCrossings(stand: (p: Vec2) => boolean): Vec2[] {
  const b = EXIT_BAND;
  const z = b.z + b.d / 2;
  const out: Vec2[] = [];
  for (let x = b.x + 2; x <= b.x + b.w - 2; x += 2) if (stand({ x, z })) out.push({ x, z });
  return out;
}
/** Reception's public floor, well north of the doors. */
const RECEPTION_PUBLIC: Vec2 = { x: 600, z: 1050 };
/** The sidewalk outside. */
const STREET: Vec2 = { x: 720, z: 1210 };

describe("the exit is held by the same mechanism the gate is", () => {
  it("the doorway is crossable while the exit is open — otherwise this proves nothing", () => {
    const { stand } = rig();
    expect(doorCrossings(stand).length).toBeGreaterThan(3);
  });

  it("NOTHING in the doorway is standable while the exit is reserved", () => {
    const { stand, walkability } = rig();
    const points = doorCrossings(stand);
    walkability.reserve(EXIT_RESERVATION, exitCells());
    for (const p of points) expect(stand(p), `x=${p.x}`).toBe(false);
  });

  it("…and it opens again the moment the authorisation lands", () => {
    const { stand, walkability } = rig();
    const points = doorCrossings(stand);
    walkability.reserve(EXIT_RESERVATION, exitCells());
    walkability.release(EXIT_RESERVATION);
    for (const p of points) expect(stand(p), `x=${p.x}`).toBe(true);
  });

  it("Reception and the street are both untouched — this holds a doorway, not a building", () => {
    const { stand, walkability } = rig();
    walkability.reserve(EXIT_RESERVATION, exitCells());
    expect(stand(RECEPTION_PUBLIC)).toBe(true);
    expect(stand(STREET)).toBe(true);
  });

  it("THE REGRESSION: the public pavement in front of the doors is NOT reserved", () => {
    // The first cut rasterised the door's `clearance.band` — five rows, z 1120…1200 — which walled off the
    // doorway plus sixty-odd units of open sidewalk. An employee walking past their own entrance was
    // stopped by it, and one returning from the AI Lab could not reach the doors at all.
    const { stand, walkability } = rig();
    walkability.reserve(EXIT_RESERVATION, exitCells());
    for (const z of [1160, 1170, 1180, 1190, 1200, 1210]) {
      const p = { x: 720, z };
      expect(walkability.isReserved(Math.floor(p.x / CELL), Math.floor(p.z / CELL)), `z=${z} reserved`).toBe(false);
      expect(stand(p), `z=${z} standable`).toBe(true);
    }
  });

  it("reserves the OPENING only: two rows at the façade, across the V1 door span", () => {
    const rows = [...new Set(exitCells().map((c) => c.cy))].sort((a, b) => a - b);
    expect(rows).toHaveLength(2);
    expect(rows[0] * CELL).toBe(FACADE.z);
    const cols = [...new Set(exitCells().map((c) => c.cx))].sort((a, b) => a - b);
    expect(cols[0] * CELL).toBe(FACADE.door.x0);
    expect((cols[cols.length - 1] + 1) * CELL).toBe(FACADE.door.x1);
  });

  it("walking the sidewalk PAST the entrance is never interrupted", () => {
    // Compared against the SAME world with the exit open, so the room's own planters and edges are not
    // mistaken for the gate's doing: every point a person could stand on out there must still be one.
    const open = rig();
    const { stand, walkability } = rig();
    walkability.reserve(EXIT_RESERVATION, exitCells());
    let compared = 0;
    for (let x = 520; x <= 940; x += 10)
      for (const z of [1160, 1180, 1200]) {
        const p = { x, z };
        if (!open.stand(p)) continue;
        compared++;
        expect(stand(p), `the pavement at ${x},${z}`).toBe(true);
      }
    expect(compared).toBeGreaterThan(20);
  });

  it("the prompt zone sits INSIDE the building, so a body is asked before it is stopped", () => {
    // ENTRY_ZONE must start north of the reserved band, or an employee would be stopped by a door they
    // were never asked about.
    expect(ENTRY_ZONE.z).toBeLessThan(EXIT_BAND.z);
    expect(pointInRect({ x: 720, z: ENTRY_ZONE.z + 4 }, ENTRY_ZONE)).toBe(true);
  });
});

// ---- the promises ------------------------------------------------------------------------------------
const worldSrc = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
const overlaySrc = readFileSync("src/dev/vo3d/app/Vo3dOverlay.tsx", "utf8");
const panelsSrc = readFileSync("src/dev/vo3d/app/Vo3dCheckoutPanels.tsx", "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the world holds the exit and decides nothing about it", () => {
  const src = code(worldSrc);

  it("holds it ONLY for a confirmed checked-in employee, and only where holding it cannot trap", () => {
    // Checked out they are exploring and were never stopped; `unknown` must never seal anybody inside.
    expect(src).toContain("const hold = mayEnterOffice(officeAccess) && !exitAuthorized && exitHoldable(at)");
  });

  it("NEVER holds the doorway against a body that is outside, or one standing in it", () => {
    // Those are the two ways a wall traps instead of stopping: somebody on the street is coming home, and
    // somebody already in the opening cannot step out of a reserved cell in ANY direction.
    expect(src).toContain('zoneOf(at) !== "outside" && !circleOverlapsRect(at, NAV_RADIUS, EXIT_BAND)');
  });

  it("says when somebody walks AWAY from the exit, once, on the edge", () => {
    // Without this the card followed them back across the room: the world raised the question and then
    // never mentioned that it had stopped being asked.
    expect(src).toContain("if (exitPrompted) coworkerInteractions?.onExitAbandoned?.();");
    // …and clearing the same flag is what makes a second approach ask again.
    expect(src).toContain("exitPrompted = false;");
  });

  it("reports the building boundary, once, on the edge", () => {
    expect(src).toContain("if (zoneNow !== accessState.zone) {");
    expect(src).toContain("coworkerInteractions?.onZoneChanged?.(zoneNow);");
  });

  it("neither signal touches attendance, the doors or the authorisation", () => {
    const scanners = src.slice(src.indexOf("function updateScanners"));
    const body = scanners.slice(0, scanners.indexOf("\n  }"));
    expect(body).not.toContain("setExitAuthorized");
    expect(body).not.toContain("walkability.release");
  });

  it("re-evaluates the hold from the body's real position, every frame", () => {
    expect(src).toContain("applyExitGate({ x: bp.x, z: bp.z });");
    // …and only writes to walkability when the answer actually changed.
    expect(src).toContain("if (hold === exitHeldNow) return;");
  });

  it("closes the doors by holding the floor, not by touching SlidingDoor", () => {
    const apply = src.slice(src.indexOf("function applyExitGate"));
    const body = apply.slice(0, apply.indexOf("\n  }"));
    expect(body).toContain("walkability.reserve(EXIT_RESERVATION, exitCells)");
    expect(body).not.toContain("entryDoor");
  });

  it("…and keeps the leaves shut for a body standing on the mat", () => {
    // Holding the floor is not enough by itself: a body on the mat overlaps the doorway's own crossing
    // rect, which is all SlidingDoor needs to open. It is shown a body that is nowhere near it instead,
    // so the leaves close on their own timing and SlidingDoor keeps no new state.
    expect(src).toContain("entryDoor.update(dt / 1000, exitHeld ? DOOR_SUPPRESSED : { x: bp.x, z: bp.z }, exitHeld ? NO_ROUTE : route, exitHeld ? NO_BODIES : peerBodies)");
    expect(src).not.toContain("entryDoor.reset()");
  });

  it("stops a walk already routed through the doorway", () => {
    expect(src).toContain("if (navCtl.path.some((p) => pointInRect(p, EXIT_BAND))) navCtl.stop()");
  });

  it("an authorisation is spent — by leaving, or by changing your mind", () => {
    // Either way it must not sit open for the rest of the session: the next departure asks again.
    expect(src).toContain('if (accessState.zone === "outside") exitUsed = true;');
    expect(src).toContain("else if (exitUsed) setExitAuthorized(false);");
    expect(src).toContain('else if (!pointInRect({ x: bp.x, z: bp.z }, ENTRY_ZONE) && !pointInRect({ x: bp.x, z: bp.z }, EXIT_BAND)) setExitAuthorized(false);');
  });

  it("DROPS ANY LOCAL GRANT the moment V1 stops saying CHECKED_IN", () => {
    // The stale-flag path: an employee who checks out and checks straight back in at the kiosk, without
    // ever leaving, would otherwise begin the new session with the doors already unheld — a permission
    // granted for a session that had ended. Costs a checked-out employee nothing, because the exit is only
    // ever held for a confirmed check-in.
    const set = src.slice(src.indexOf("function setOfficeAccess"));
    const body = set.slice(0, set.indexOf("\n  }"));
    expect(body).toContain("if (!mayEnterOffice(next)) {");
    expect(body).toContain("exitAuthorized = false;");
    expect(body).toContain("exitUsed = false;");
    // …and it happens BEFORE the gate is re-evaluated, or the release would use the stale value.
    expect(body.indexOf("exitAuthorized = false;")).toBeLessThan(body.indexOf("applyExitGate(avatar.worldPosition())"));
  });

  it("re-holds the office on anything that is not a confirmed check-in", () => {
    // `denied` AND `unknown`: the gate is reserved for both, so a lost answer cannot read as access.
    const set = src.slice(src.indexOf("function setOfficeAccess"));
    const body = set.slice(0, set.indexOf("\n  }"));
    expect(body).toContain("if (mayEnterOffice(next)) {");
    expect(body).toContain("walkability.reserve(GATE_RESERVATION, gateCells);");
  });

  it("still writes no attendance of any kind", () => {
    expect(src).not.toContain("attendanceService");
    expect(src).not.toContain("CHECKED_IN");
    expect(src).not.toContain("CHECKED_OUT");
    expect(src).not.toContain("checkOut");
  });
});

describe("attendance is the LAST thing a checkout does, and nothing else does it", () => {
  const src = code(overlaySrc);

  it("posts the check-out only on the flow's arrival at CHECKED_OUT", () => {
    // `useCheckoutFlow` reaches CHECKED_OUT only after a successful Zoho submission and the exit beat, so
    // keying on that transition is what puts the time log before the attendance write.
    expect(src).toContain('if (checkoutFlow.state !== "CHECKED_OUT" || prev === "CHECKED_OUT") return;');
    expect(src).toContain("attendanceService\n      .checkOut(employeeId)");
  });

  it("opens the exit only AFTER the server confirms it", () => {
    const effect = src.slice(src.indexOf("checkoutPostedRef"));
    const body = effect.slice(0, effect.indexOf("}, [checkoutFlow.state]);"));
    // The release sits inside the `.then`, never beside the call.
    expect(body.indexOf("setExitAuthorized(true)")).toBeGreaterThan(body.indexOf(".then((record)"));
  });

  it("NEVER checks out on a lifecycle event", () => {
    // No unmount, no visibility change, no socket state may end somebody's working day. The only
    // `checkOut` in this file is the one the transition above guards.
    expect(src.match(/\.checkOut\(/g) ?? []).toHaveLength(1);
    expect(src).not.toContain("beforeunload");
    expect(src).not.toContain("pagehide");
  });

  it("cannot double-submit the check-out", () => {
    expect(src).toContain("if (checkoutPostedRef.current) return;");
    expect(src).toContain("checkoutPostedRef.current = true;");
  });

  it("completes the flow's last two transitions, which V2 has no walk to drive", () => {
    // `useCheckoutFlow` stops at CHECKOUT_SUCCESS; reaching CHECKED_OUT takes startExitWalk + finishExit,
    // which V1 drives from its scripted walk out of the building. Without them V2's flow sat there
    // forever: no success card (it renders only at CHECKED_OUT), no attendance POST, no goodbye, no door.
    expect(src).toContain('if (checkoutFlow.state !== "CHECKOUT_SUCCESS") return;');
    const i = src.indexOf("checkoutFlow.startExitWalk();");
    expect(i).toBeGreaterThan(-1);
    expect(src.indexOf("checkoutFlow.finishExit();")).toBeGreaterThan(i);
  });

  it("the success card is still told how long the session was, after it has ended", () => {
    // `liveTimeInMs` goes null the instant attendance reads CHECKED_OUT — right for the HUD pill, wrong
    // for the card, which reported "Not checked in yet" against the day it had just logged.
    expect(src).toContain("lastSessionStartRef.current = liveTimeInMs");
    expect(src).toContain('const timeInMs = liveTimeInMs ?? (checkoutFlow.state === "IDLE" ? null : lastSessionStartRef.current)');
  });

  it("the AI Lab route touches neither attendance nor the checkout flow", () => {
    const lab = src.slice(src.indexOf("const goToAiLab"));
    const body = lab.slice(0, lab.indexOf("}, [worldRef]);"));
    expect(body).toContain('setDepartureDestination("ai-lab")');
    expect(body).toContain("setExitAuthorized(true)");
    expect(body).not.toContain("checkOut");
    expect(body).not.toContain("attendance.apply");
  });
});

// ---- V1's checkout must not move ------------------------------------------------------------------
const checkoutCss = readFileSync("src/components/OfficeMap/checkout/checkout.module.css", "utf8");
const themeCss = readFileSync("src/dev/vo3d/app/Vo3dCheckoutPanels.module.css", "utf8");

describe("the V2 theme cannot change V1's checkout", () => {
  it("every themed value keeps V1's ORIGINAL appearance as its fallback", () => {
    // V1's office defines none of the properties, so a var() without a fallback would render V1's
    // checkout unstyled. Each one must carry the value that was hard-coded there before.
    const vars = [...checkoutCss.matchAll(/var\((--vo-co-[a-z-]+)([^)]*)\)/g)];
    expect(vars.length).toBeGreaterThan(20);
    for (const [, name, rest] of vars) expect(rest.trim().startsWith(","), `${name} has no fallback`).toBe(true);
  });

  it("the theme only sets properties — it restyles no component and positions nothing", () => {
    const body = themeCss.replace(/\/\*[\s\S]*?\*\//g, "");
    // The only declarations outside the custom properties are the container's own zero box.
    const decls = [...body.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]).filter((d) => !d.startsWith("--"));
    expect(decls.sort()).toEqual(["display", "height", "width"]);
    expect(body).not.toContain("position: fixed");
    expect(body).not.toContain("@keyframes");
  });

  it("no checkout component was forked for V2", () => {
    // Everything V2 shows is imported from V1's own folder — see Vo3dCheckoutPanels.tsx.
    const imports = code(panelsSrc).match(/from "[^"]+"/g) ?? [];
    const checkoutImports = imports.filter((i) => i.includes("checkout"));
    expect(checkoutImports.length).toBeGreaterThan(5);
    // …and every one of them points at V1's folder. A local copy would be a second checkout UI.
    for (const i of checkoutImports) expect(i, i).toContain("components/OfficeMap/checkout/");
  });
});

describe("the checkout panels are V1's own, not a second flow", () => {
  const src = code(panelsSrc);

  it("owns no state machine and no submission of its own", () => {
    expect(src).not.toContain("useState");
    expect(src).not.toContain("zohoService");
    expect(src).not.toContain("attendanceService");
  });

  it("passes the two walk states through in the hook's own order", () => {
    // The employee is already at Reception — that is why they were intercepted there — so the goodbye walk
    // and the walk to the desk are transitions to step through, not animations to invent.
    const i = src.indexOf("flow.confirmStartCheckout()");
    const j = src.indexOf("flow.arrivedAtReception()");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("renders V1's components rather than copies of them", () => {
    for (const c of ["CheckoutConfirmModal", "TimeSummaryPanel", "TimeLogForm", "TimeLogReview", "SubmissionFailedPanel", "CheckoutSuccessCard"])
      expect(src).toContain(`components/OfficeMap/checkout/${c}`);
  });
});
