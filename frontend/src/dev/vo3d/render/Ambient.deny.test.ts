// vo3d render — PHASE 7E: THE SCANNER'S THIRD STATE.
//
// A speed gate that is SHUT must not read the same as one that is merely idle. This file tests that one
// addition and the promise that came with it: the denied colour substitutes for green through the SAME
// single lerp, and nothing else about a scanner — least of all its proximity activation, which the scanner
// sound and the diagnostics read — changes at all.
//
// Built against the REAL Reception group, not a fixture, because the whole point is that no mesh, material
// or builder was added: the channels under test are the ones already on the speed gates.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) — the same
// exemption app/spawn.phase5.test.ts takes. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AmbientSystem } from "./Ambient";
import { PALETTE } from "./Materials";
import { receptionStatic } from "../build/reception";
import { GATE, GATE_SCANNER_IDS, ENTRY_SCANNER_ID, KIOSK_SCANNER_ID, RECEPTION_ROOM } from "../rooms/reception";

/** Reception exactly as the world builds it — no fixture, no stand-in. */
const buildReception = () => receptionStatic(RECEPTION_ROOM);

/** The gate's ACCESS BAR — the strip a person reads for "may I go through". */
function accessBar(built: THREE.Object3D, index: number): THREE.MeshStandardMaterial {
  return channelOf(built, index, (spec) => spec.access === true && spec.kind === "pulse");
}
/** The gate's READER wash — the fixture's own electronics. Grouped (so it still brightens as somebody
 *  arrives) and deliberately UNTINTED, so its colour never leaves blue. */
function readerGlow(built: THREE.Object3D, index: number): THREE.MeshStandardMaterial {
  return channelOf(built, index, (spec) => spec.kind === "fade" && !spec.access);
}
/** A lane-facing light line — same: electronics, at eye level in the lane. */
function laneLine(built: THREE.Object3D, index: number, o?: THREE.Mesh): THREE.MeshStandardMaterial {
  return channelOf(built, index, (spec, mesh) => {
    const m = mesh.material as THREE.MeshStandardMaterial;
    return spec.kind === "pulse" && !spec.access && spec.group !== undefined && m.emissive?.getHex() === PALETTE.cyan;
  }, o);
}
type Spec = { kind?: string; tint?: unknown; access?: boolean; group?: string };
/** Somebody walks into the lane, stands there, then walks on. */
const ARRIVE = 200, LEAVE = 900;
function channelOf(built: THREE.Object3D, index: number, pick: (s: Spec, o: THREE.Mesh) => boolean, _o?: THREE.Mesh): THREE.MeshStandardMaterial {
  const band = built.getObjectByName(`speed-gate:${GATE.pedestals[index]}`)!;
  let found: THREE.Mesh | null = null;
  band.traverse((o) => {
    const spec = o.userData.ambient as Spec | undefined;
    if (!found && spec && (o as THREE.Mesh).material && pick(spec, o as THREE.Mesh)) found = o as THREE.Mesh;
  });
  const m = (found! as THREE.Mesh).material as THREE.MeshStandardMaterial;
  return m;
}
/** The colour a person actually sees — emissive where there is one, otherwise the base colour. */
const reads = (m: THREE.MeshStandardMaterial): number => (m.emissive ?? m.color).getHex();

function settled(): { sys: AmbientSystem; built: THREE.Object3D } {
  const built = buildReception();
  const sys = new AmbientSystem();
  sys.collect("reception-room", built);
  return { sys, built };
}
const run = (sys: AmbientSystem, frames = 300) => { for (let i = 0; i < frames; i++) sys.update(i * 0.016, 0.016); };

describe("BLUE IS THE RESTING STATE, for everybody", () => {
  it("idles blue with nobody near it — refused or not", () => {
    for (const denied of [true, false]) {
      const { sys, built } = settled();
      sys.setScannerDenied(GATE_SCANNER_IDS[0], denied);
      run(sys, 60);
      expect(reads(accessBar(built, 0)), `denied=${denied}`).toBe(PALETTE.cyan);
    }
  });

  it("idles blue before V1 has answered at all", () => {
    const { sys, built } = settled();
    run(sys, 60);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.cyan);
  });
});

describe("the gate ANSWERS as somebody arrives, and forgets behind them", () => {
  it("ALLOWED attempt: blue → green → blue", () => {
    const { sys, built } = settled();
    sys.setScannerDenied(GATE_SCANNER_IDS[0], false); // V1 confirmed the check-in
    run(sys, 60);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.cyan);

    sys.setScanner(GATE_SCANNER_IDS[0], true); // a body enters the lane
    run(sys, ARRIVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.readyGreen);

    sys.setScanner(GATE_SCANNER_IDS[0], false); // and walks on through
    run(sys, LEAVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.cyan);
  });

  it("DENIED attempt: blue → red → blue", () => {
    const { sys, built } = settled();
    sys.setScannerDenied(GATE_SCANNER_IDS[0], true);
    run(sys, 60);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.cyan);

    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys, ARRIVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.denyRed);

    // The body is stopped AT the boundary, so it stands there a while — and stays red the whole time.
    run(sys, 600);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.denyRed);

    sys.setScanner(GATE_SCANNER_IDS[0], false); // they give up and walk away
    run(sys, LEAVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.cyan);
  });

  it("an UNANSWERED attempt reads red, never green", () => {
    const { sys, built } = settled();
    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys, ARRIVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.denyRed);
  });

  it("REPEATED approaches answer every time, and each one resets", () => {
    const { sys, built } = settled();
    sys.setScannerDenied(GATE_SCANNER_IDS[0], true);
    for (let i = 0; i < 3; i++) {
      sys.setScanner(GATE_SCANNER_IDS[0], true);
      run(sys, ARRIVE);
      expect(reads(accessBar(built, 0)), `denied approach ${i}`).toBe(PALETTE.denyRed);
      sys.setScanner(GATE_SCANNER_IDS[0], false);
      run(sys, LEAVE);
      expect(reads(accessBar(built, 0)), `after denied approach ${i}`).toBe(PALETTE.cyan);
    }
    // …and the answer follows V1, not the last thing the light did.
    sys.setScannerDenied(GATE_SCANNER_IDS[0], false);
    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys, ARRIVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.readyGreen);
  });

  it("answers at whichever lane the body is in, and leaves the others blue", () => {
    const { sys, built } = settled();
    for (const id of GATE_SCANNER_IDS) sys.setScannerDenied(id, true);
    sys.setScanner(GATE_SCANNER_IDS[2], true);
    run(sys, ARRIVE);
    expect(reads(accessBar(built, 2))).toBe(PALETTE.denyRed);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.cyan);
    expect(reads(accessBar(built, 1))).toBe(PALETTE.cyan);
  });

  it("the answer can change under a body that is still standing there", () => {
    const { sys, built } = settled();
    sys.setScannerDenied(GATE_SCANNER_IDS[0], true);
    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys, ARRIVE);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.denyRed);
    sys.setScannerDenied(GATE_SCANNER_IDS[0], false); // the check-in lands while they wait at the gate
    run(sys, 60);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.readyGreen);
  });
});

describe("THE BLUE ELECTRONICS NEVER ANSWER", () => {
  it("the reader wash and the lane lines stay blue in every state", () => {
    for (const denied of [true, false]) {
      const { sys, built } = settled();
      sys.setScannerDenied(GATE_SCANNER_IDS[0], denied);
      sys.setScanner(GATE_SCANNER_IDS[0], true);
      run(sys, 400);
      expect(reads(readerGlow(built, 0)), `reader, denied=${denied}`).toBe(PALETTE.cyan);
      expect(reads(laneLine(built, 0)), `lane line, denied=${denied}`).toBe(PALETTE.cyan);
      // …while the indicator beside them is answering.
      expect(reads(accessBar(built, 0))).toBe(denied ? PALETTE.denyRed : PALETTE.readyGreen);
    }
  });

  it("they still RESPOND to a body — with brightness, which is not an answer", () => {
    const { sys, built } = settled();
    const m = readerGlow(built, 0);
    run(sys, 60);
    const idle = m.opacity;
    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys, 400);
    expect(m.opacity).toBeGreaterThan(idle);
  });

  it("does not disturb the proximity activation the scanner SOUND and diagnostics read", () => {
    const { sys } = settled();
    sys.setScannerDenied(GATE_SCANNER_IDS[0], true);
    run(sys);
    expect(sys.scannerActivation(GATE_SCANNER_IDS[0])).toBe(0);
    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys);
    expect(sys.scannerActivation(GATE_SCANNER_IDS[0])).toBeGreaterThan(0.97);
  });

  it("can be answered for before its room is built, and the room adopts it", () => {
    const sys = new AmbientSystem();
    sys.setScannerDenied(GATE_SCANNER_IDS[0], true);
    const built = buildReception();
    sys.collect("reception-room", built);
    sys.setScanner(GATE_SCANNER_IDS[0], true);
    run(sys, ARRIVE);
    expect(sys.scannerDenied(GATE_SCANNER_IDS[0])).toBe(true);
    expect(reads(accessBar(built, 0))).toBe(PALETTE.denyRed);
  });
});

describe("the kiosk speaks the same language", () => {
  it("has its own scanner channel, beside the gates and the entrance", () => {
    const { sys } = settled();
    expect(sys.scannerIds).toContain(KIOSK_SCANNER_ID);
    expect(sys.scannerIds).toEqual(expect.arrayContaining([...GATE_SCANNER_IDS, ENTRY_SCANNER_ID]));
  });

  it("rests blue, answers on its STATUS LAMP while somebody is at it, and leaves its screen alone", () => {
    const { sys, built } = settled();
    const kiosk = built.getObjectByName("reception-kiosk")!;
    const wired: { access: boolean; tinted: boolean; m: THREE.MeshStandardMaterial }[] = [];
    kiosk.traverse((o) => {
      const spec = o.userData.ambient as Spec | undefined;
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (spec?.group === KIOSK_SCANNER_ID && m) wired.push({ access: spec.access === true, tinted: Boolean(spec.tint), m });
    });
    const lamp = wired.filter((t) => t.access);
    // The screen, the glass sweep and the action tile: wired to the same scanner (so they brighten as
    // somebody arrives) and carrying NO tint at all, which is what makes "they never leave blue" a fact
    // about the data rather than a hope about the animation.
    const screen = wired.filter((t) => !t.access && t.m.color.getHex() === PALETTE.cyan);
    expect(lamp).toHaveLength(1);
    expect(lamp[0].tinted).toBe(true);
    expect(screen.length).toBeGreaterThan(0);
    for (const t of screen) expect(t.tinted, "an untinted channel can never change colour").toBe(false);

    sys.setScannerDenied(KIOSK_SCANNER_ID, true);
    run(sys, 60);
    expect(lamp[0].m.color.getHex(), "blue until somebody is at it").toBe(PALETTE.cyan);

    sys.setScanner(KIOSK_SCANNER_ID, true);
    run(sys, ARRIVE);
    expect(lamp[0].m.color.getHex()).toBe(PALETTE.denyRed);
    for (const t of screen) expect(t.m.color.getHex(), "the kiosk screen stays blue").toBe(PALETTE.cyan);

    sys.setScannerDenied(KIOSK_SCANNER_ID, false);
    run(sys, 60);
    expect(lamp[0].m.color.getHex()).toBe(PALETTE.readyGreen);
    for (const t of screen) expect(t.m.color.getHex(), "…in every state").toBe(PALETTE.cyan);

    sys.setScanner(KIOSK_SCANNER_ID, false);
    run(sys, LEAVE);
    expect(lamp[0].m.color.getHex()).toBe(PALETTE.cyan);
  });
});

// ---- what the world drives them from ----------------------------------------------------------------
// app/world.ts builds a WebGL world and cannot be instantiated in jsdom, so these two promises are read
// off its source, as app/spawn.phase5.test.ts reads its own.
const worldSrc = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the sensors are driven from the SAME answer the gate is", () => {
  const src = code(worldSrc);

  it("refuses every gate scanner exactly when the office may not be entered", () => {
    expect(src).toContain("for (const id of GATE_SCANNER_IDS) mirror.ambient.setScannerDenied(id, !permitted)");
    expect(src).toContain("const permitted = mayEnterOffice(officeAccess)");
  });

  it("chooses the kiosk's answer from attendance and its TIMING from the same proximity test", () => {
    expect(src).toContain("mirror.ambient.setScannerDenied(KIOSK_SCANNER_ID, !permitted)");
    expect(src).toContain("mirror.ambient.setScanner(KIOSK_SCANNER_ID, pointInRect(scannerAt, KIOSK_ZONE))");
  });

  it("A COLOUR NEVER OPENS THE LANE: the reservation is the only thing that does", () => {
    // The gate is held or released in setOfficeAccess, from V1's answer, and the sensor lines below are
    // read-only. If a release ever appeared beside them, a scanner animation could let somebody through.
    const scanners = src.slice(src.indexOf("function updateScanners"));
    const body = scanners.slice(0, scanners.indexOf("\n  }"));
    expect(body).not.toContain("walkability.release");
    expect(body).not.toContain("walkability.reserve");
    expect(body).toContain("mayEnterOffice(officeAccess)");
  });

  it("NEVER refuses the entrance: a checked-out employee is welcome into Reception", () => {
    expect(src).not.toContain("setScannerDenied(ENTRY_SCANNER_ID");
  });

  it("still keeps every attendance decision out of the world", () => {
    expect(src).not.toContain("attendanceService");
    expect(src).not.toContain("CHECKED_IN");
    expect(src).not.toContain("CHECKED_OUT");
  });
});
