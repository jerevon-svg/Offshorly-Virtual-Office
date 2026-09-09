// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — same
// exemption services/attendance/mockRigConfig.test.ts takes. vitest runs in Node with
// cwd = frontend/, so the read below is a plain relative path.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { makeMoveSelf } from "./useSelfMovement";
import { selfPathLeavesOffice } from "./spawnPlacement";
import { computeCenterTransform } from "./panMath";
import { FRAME_HEIGHT, FRAME_WIDTH, roomLayers } from "../../data/office-layout";

vi.mock("../../services/presence/movementSync", () => ({
  emitWalkStarted: vi.fn(),
  emitWalkArrived: vi.fn(),
}));

// REGRESSION: checkout used to stall forever in WALKING_TO_EXIT with the avatar frozen inside
// Reception, never reaching CHECKED_OUT.
//
// Mechanism: OfficeMap's `checkoutBusyRef` is assigned during RENDER, but proceedWithExitWalk()
// calls checkoutFlow.startExitWalk() (a setState) and then starts the walk SYNCHRONOUSLY in the
// same tick — before React re-renders. The exit walk therefore read the previous render's
// `false`, so moveSelf's allowMove gate (selfPathLeavesOffice) classified the legitimate walk out
// to the sidewalk as an illegal office-boundary crossing and returned WITHOUT calling onArrive —
// so finishExit() (WALKING_TO_EXIT -> CHECKED_OUT) never ran.
//
// These tests use the REAL makeMoveSelf and the REAL selfPathLeavesOffice, wired exactly as
// OfficeMap wires them, so they pin the mechanism rather than a model of it.

type Pt = { x: number; y: number };

const INSIDE = { x: 500, y: 500 };
const OUTSIDE = { x: 40, y: 40 };
const AVATAR = { w: 40, h: 60 };

/** The office is the box x/y in [100, 900); "outside" is anything beyond it. */
const isInsideOffice = (c: { x: number; y: number }) =>
  c.x >= 100 && c.x < 900 && c.y >= 100 && c.y < 900;

/** OfficeMap's exact allowMove wiring (see OfficeMap.tsx's makeMoveSelf call). */
function buildMoveSelf(attendance: "CHECKED_IN" | "CHECKED_OUT", checkoutBusyRef: { current: boolean }) {
  const walkTo = vi.fn();
  const onArrive = vi.fn();
  const moveSelf = makeMoveSelf({
    walkTo,
    getPos: () => INSIDE,
    getDirection: () => "front",
    face: vi.fn(),
    allowMove: (origin: Pt, path: Pt[]) =>
      !selfPathLeavesOffice(attendance, checkoutBusyRef.current, isInsideOffice, AVATAR, origin, path),
  } as unknown as Parameters<typeof makeMoveSelf>[0]);
  return { moveSelf, walkTo, onArrive };
}

describe("the checkout exit walk may cross the office boundary", () => {
  it("walks out and arrives when the ref is primed at the WALKING_TO_EXIT transition", () => {
    const checkoutBusyRef = { current: false };
    const { moveSelf, walkTo, onArrive } = buildMoveSelf("CHECKED_IN", checkoutBusyRef);

    // What proceedWithExitWalk does now: prime the ref in the same tick as startExitWalk(),
    // BEFORE the walk, because the render that would set it has not happened yet.
    checkoutBusyRef.current = true;
    moveSelf({ path: [OUTSIDE], roomId: null, onArrive });

    expect(walkTo).toHaveBeenCalledTimes(1);
    // onArrive is what calls finishExit() -> CHECKED_OUT; it runs on the walk's completion.
    walkTo.mock.calls[0][1]();
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it("is silently blocked with no arrival when the ref is still stale — the original bug", () => {
    const checkoutBusyRef = { current: false }; // the pre-fix state at this exact moment
    const { moveSelf, walkTo, onArrive } = buildMoveSelf("CHECKED_IN", checkoutBusyRef);

    moveSelf({ path: [OUTSIDE], roomId: null, onArrive });

    // No walk, no error, and above all NO onArrive — this is why the flow sat in
    // WALKING_TO_EXIT forever.
    expect(walkTo).not.toHaveBeenCalled();
    expect(onArrive).not.toHaveBeenCalled();
  });

  it("wires the priming immediately after startExitWalk(), where the race actually is", () => {
    // Source-level, because the ordering IS the fix: priming anywhere later (an effect, the next
    // render) is exactly the bug. Guards the two lines staying adjacent.
    const source = readFileSync("src/components/OfficeMap/OfficeMap.tsx", "utf8");
    expect(source).toMatch(/checkoutFlow\.startExitWalk\(\);[\s\S]{0,900}?checkoutBusyRef\.current = true;/);
  });
});

describe("normal office-boundary protection is unchanged", () => {
  it("still blocks a checked-in viewer from walking out of the office", () => {
    const checkoutBusyRef = { current: false };
    const { moveSelf, walkTo, onArrive } = buildMoveSelf("CHECKED_IN", checkoutBusyRef);

    moveSelf({ path: [OUTSIDE], roomId: null, onArrive });

    expect(walkTo).not.toHaveBeenCalled();
    expect(onArrive).not.toHaveBeenCalled();
  });

  it("still allows a checked-in viewer to walk anywhere inside the office", () => {
    const checkoutBusyRef = { current: false };
    const { moveSelf, walkTo } = buildMoveSelf("CHECKED_IN", checkoutBusyRef);

    moveSelf({ path: [{ x: 700, y: 700 }], roomId: null });

    expect(walkTo).toHaveBeenCalledTimes(1);
  });

  it("still leaves a checked-out viewer unrestricted, as before", () => {
    const checkoutBusyRef = { current: false };
    const { moveSelf, walkTo } = buildMoveSelf("CHECKED_OUT", checkoutBusyRef);

    moveSelf({ path: [OUTSIDE], roomId: null });

    expect(walkTo).toHaveBeenCalledTimes(1);
  });

  it("keeps the gate itself untouched: only checkoutBusy exempts a boundary crossing", () => {
    const crossing = [OUTSIDE];
    expect(selfPathLeavesOffice("CHECKED_IN", false, isInsideOffice, AVATAR, INSIDE, crossing)).toBe(true);
    expect(selfPathLeavesOffice("CHECKED_IN", true, isInsideOffice, AVATAR, INSIDE, crossing)).toBe(false);
  });
});

// The checkout PRESENTATION sequence. Ordering is the whole feature here — the camera's overview
// pull-back and the character's walk used to be fired in the same beat, so movement began while
// the view was still sliding out of its previous close framing and the walk was half-missed.
// These are source-order assertions on purpose: what is being pinned is the ORDER of existing
// calls inside two functions, which no rendered-output assertion can express.
describe("checkout presentation sequencing", () => {
  const source = readFileSync("src/components/OfficeMap/OfficeMap.tsx", "utf8");

  /** The body of `function name(...) { … }` in OfficeMap.tsx, brace-matched so it never bleeds
   *  into whatever function happens to follow it. */
  function body(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let seenOpen = false;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") {
        depth += 1;
        seenOpen = true;
      } else if (source[i] === "}") {
        depth -= 1;
        if (seenOpen && depth === 0) return source.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces reading ${name}`);
  }

  it("one shared sequence serves every checkout entry point", () => {
    // The HUD Check out button, the 8h reminder toast and Reception's Check Out all reach
    // checkout through CHECKOUT_CONFIRMATION, whose single confirm handler owns the sequence —
    // so no entry point can drift out of step with another.
    expect(source).toMatch(/confirmStartCheckout=\{handleConfirmStartCheckout\}/);
  });

  it("start: overview transition -> goodbye -> walk, never camera and walk together", () => {
    const fn = body("handleConfirmStartCheckout");
    const camera = fn.indexOf("resetToInitialView(CHECKOUT_CAMERA_MS)");
    const goodbye = fn.indexOf("Bye, everyone!");
    const walk = fn.indexOf("beginWalkToReception()");
    expect(camera).toBeGreaterThan(-1);
    expect(goodbye).toBeGreaterThan(camera);
    expect(walk).toBeGreaterThan(goodbye);
    // The walk is deferred, and by longer than the camera transition it is waiting on.
    expect(fn).toMatch(/beginWalkToReception\(\);\s*\n\s*\}, CHECKOUT_GOODBYE_MS\);/);
    expect(CHECKOUT_GOODBYE_MS_VALUE).toBeGreaterThan(CHECKOUT_CAMERA_MS_VALUE);
  });

  it("start: the walk itself moves no camera, so the view stays put for the whole walk", () => {
    expect(body("beginWalkToReception")).not.toContain("resetToInitialView");
  });

  it("success: Ciao ciao -> overview transition -> exit walk, in that order", () => {
    const fn = body("proceedWithExitWalk");
    const signOff = fn.indexOf("Ciao ciao!");
    const camera = fn.indexOf("frameCheckoutExitView()");
    const walk = fn.indexOf("walkOutOfRoomThenTo(");
    expect(signOff).toBeGreaterThan(-1);
    expect(camera).toBeGreaterThan(signOff);
    expect(walk).toBeGreaterThan(camera);
    // …and the exit-race fix still comes first of all.
    expect(fn.indexOf("checkoutBusyRef.current = true")).toBeLessThan(signOff);
  });

  it("success: the exit walk waits for the overview to settle before it starts", () => {
    expect(body("proceedWithExitWalk")).toMatch(
      /checkoutCameraTimerRef\.current = window\.setTimeout\([\s\S]*?walkOutOfRoomThenTo\([\s\S]*?\}, CHECKOUT_CAMERA_SETTLE_MS\);/,
    );
    expect(CHECKOUT_CAMERA_SETTLE_MS_VALUE).toBeGreaterThan(CHECKOUT_CAMERA_MS_VALUE);
  });

  it("the sign-off never holds CHECKED_OUT open", () => {
    // finishExit() is the only transition into CHECKED_OUT. It is the arrival callback's whole
    // body — no bubble timer in front of it (it used to sit behind a 1.5s setTimeout).
    expect(body("proceedWithExitWalk")).toMatch(/\(\) => checkoutFlow\.finishExit\(\),/);
  });

  it("the deferred walk timer is cancelled everywhere a checkout walk is cancelled", () => {
    // Unmount, "Cancel" on the walk indicator, and the DEV hours reset.
    expect(source.match(/window\.clearTimeout\(checkoutCameraTimerRef\.current\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});

// Read straight out of the source so the thresholds asserted above cannot silently drift apart
// from the constants the component actually uses.
const CONSTS = readFileSync("src/components/OfficeMap/OfficeMap.tsx", "utf8");
const num = (name: string): number => Number(new RegExp(`const ${name} = (\\d+);`).exec(CONSTS)?.[1]);
const CHECKOUT_CAMERA_MS_VALUE = num("CHECKOUT_CAMERA_MS");
const CHECKOUT_CAMERA_SETTLE_MS_VALUE = num("CHECKOUT_CAMERA_SETTLE_MS");
const CHECKOUT_GOODBYE_MS_VALUE = num("CHECKOUT_GOODBYE_MS");

// The exit pull-back has its OWN framing (frameCheckoutExitView): the same bird's-eye scale as the
// general overview, but centred on the Reception-to-pavement band so the glass entrance and the
// pavement are in shot while the avatar walks out. These assert the framing maths directly, using
// the same helper and the same real room geometry the component uses.
describe("checkout exit camera framing", () => {
  const VIEWPORT = { w: 1512, h: 900 };
  const coverScale = Math.max(VIEWPORT.w / FRAME_WIDTH, VIEWPORT.h / FRAME_HEIGHT);
  const receptionTop = roomLayers.find((l) => l.id === "reception-room")!.y;

  const overview = computeCenterTransform(
    { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT },
    coverScale,
    VIEWPORT.w,
    VIEWPORT.h,
  );
  const exitView = computeCenterTransform(
    { x: 0, y: receptionTop, width: FRAME_WIDTH, height: FRAME_HEIGHT - receptionTop },
    coverScale,
    VIEWPORT.w,
    VIEWPORT.h,
  );

  it("keeps the overview's scale — it is a reframing, not a different zoom", () => {
    const fn = readFileSync("src/components/OfficeMap/OfficeMap.tsx", "utf8");
    const helper = fn.slice(fn.indexOf("function frameCheckoutExitView("));
    expect(helper.slice(0, helper.indexOf("\n  }"))).toMatch(/initialScale,[\s\S]*?setTransform\(x, y, initialScale,/);
  });

  it("frames substantially lower than the general overview", () => {
    // A more negative y translates the content up, i.e. shows further DOWN the office.
    expect(exitView.y).toBeLessThan(overview.y);
    expect(overview.y - exitView.y).toBeGreaterThan(200);
  });

  it("puts Reception in the lower half, with office above it and the pavement in shot", () => {
    const visibleTop = -exitView.y / coverScale;
    const visibleBottom = visibleTop + VIEWPORT.h / coverScale;
    // The pavement (the frame's bottom edge, where the exit walk ends) is visible.
    expect(visibleBottom).toBeGreaterThanOrEqual(FRAME_HEIGHT - 1);
    // Reception starts below the middle of what is on screen…
    expect(receptionTop).toBeGreaterThan(visibleTop + (visibleBottom - visibleTop) / 2);
    // …and there is still a healthy band of office above it for context.
    expect(receptionTop - visibleTop).toBeGreaterThan(300);
  });

  it("leaves the shared overview framing alone, since other flows depend on it", () => {
    const fn = readFileSync("src/components/OfficeMap/OfficeMap.tsx", "utf8");
    const helper = fn.slice(fn.indexOf("function resetToInitialView("));
    expect(helper.slice(0, helper.indexOf("\n  }"))).toContain("{ x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT }");
  });
});
