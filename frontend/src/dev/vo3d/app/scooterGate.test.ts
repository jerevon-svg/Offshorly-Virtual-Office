// S1 — NOTHING RIDES UNTIL THE SERVER SAYS SO (app/scooterGate): grants, refusals, late grants, the racks,
// and healing a ride across a dropped socket or a refresh.
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { ScooterGate } from "./scooterGate";
import { scooterStations, type Vo3dScooterAuthority, type Vo3dScooterState } from "../world/scooters";

function rig(opts: { canMount?: boolean } = {}) {
  let riding: string | null = null;
  let canMount = opts.canMount ?? true;
  const log: string[] = [];
  const answers: ((r: { ok: boolean; reason?: string }) => void)[] = [];
  const authority: Vo3dScooterAuthority = {
    claim: vi.fn((id: string) => { log.push(`claim:${id}`); return new Promise<{ ok: boolean; reason?: string }>((res) => answers.push(res)); }),
    release: vi.fn((id: string) => { log.push(`release:${id}`); }),
  };
  const gate = new ScooterGate({
    ridingId: () => riding,
    canMount: () => canMount,
    mountNow: (id) => { if (!canMount) return false; riding = id; log.push(`ride:${id}`); return true; },
    dismountTaken: () => { log.push(`taken:${riding}`); riding = null; },
    render: () => {},
  });
  const answer = async (r: { ok: boolean; reason?: string }) => { answers.shift()!(r); await Promise.resolve(); await Promise.resolve(); };
  return { gate, authority, log, answer, riding: () => riding, setRiding: (id: string | null) => { riding = id; }, setCanMount: (v: boolean) => { canMount = v; } };
}
const st = (id: string, state: Vo3dScooterState["state"], mine = false): Vo3dScooterState => ({ id, state, mine });

describe("ScooterGate", () => {
  it("without a server it is the single-player ride it always was", () => {
    const r = rig();
    expect(r.gate.request("scooter-r1")).toBe(true);
    expect(r.riding()).toBe("scooter-r1");
  });

  it("with a server it only ASKS — nothing rides until the grant, then it rides", async () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    expect(r.gate.request("scooter-r1")).toBe(false);
    expect(r.riding()).toBeNull();
    expect(r.gate.pending).toBe("scooter-r1");
    expect(r.gate.request("scooter-r2")).toBe(false); // one question at a time
    expect(r.authority.claim).toHaveBeenCalledTimes(1);
    await r.answer({ ok: true });
    expect(r.riding()).toBe("scooter-r1");
    expect(r.gate.pending).toBeNull();
  });

  it("a REFUSED mount never rides and leaves nothing pending", async () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.gate.request("scooter-r1");
    await r.answer({ ok: false, reason: "taken" });
    expect(r.riding()).toBeNull();
    expect(r.gate.pending).toBeNull();
    expect(r.log).toEqual(["claim:scooter-r1"]);
    expect(r.gate.last).toContain("taken");
  });

  it("a grant that arrives after the body walked off is handed straight back", async () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.gate.request("scooter-r1");
    r.setCanMount(false);
    await r.answer({ ok: true });
    expect(r.riding()).toBeNull();
    expect(r.log).toEqual(["claim:scooter-r1", "release:scooter-r1"]);
  });

  it("a grant for a question the world dropped (authority swapped) is handed back too", async () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.gate.request("scooter-r1");
    r.gate.setAuthority(null);
    await r.answer({ ok: true });
    expect(r.riding()).toBeNull();
    expect(r.log).toContain("release:scooter-r1");
  });

  it("does not ask for a scooter the server says is out, and the racks show the server's truth", () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.gate.apply([st("scooter-r1", "ridden"), st("scooter-r2", "fallen"), st("scooter-r3", "docked"), st("scooter-r4", "standing")], true);
    expect(r.gate.available("scooter-r1")).toBe(false);
    expect(r.gate.available("scooter-r2")).toBe(false);
    expect(r.gate.available("scooter-r3")).toBe(true);
    expect(r.gate.request("scooter-r1")).toBe(false);
    expect(r.authority.claim).not.toHaveBeenCalled();
    expect(["scooter-r1", "scooter-r2", "scooter-r3", "scooter-r4"].map((id) => r.gate.inRack(id))).toEqual([false, false, true, false]);
  });

  it("dismounting tells the server and puts it back in the rack at once", () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.gate.apply([st("scooter-l1", "ridden", true)], false);
    r.setRiding("scooter-l1");
    r.setRiding(null);
    r.gate.released("scooter-l1", "dismount");
    expect(r.log).toContain("release:scooter-l1");
    expect(r.gate.inRack("scooter-l1")).toBe(true);
    // …but when the SERVER took it, nothing is released and the rack stays empty
    const q = rig();
    q.gate.setAuthority(q.authority);
    q.gate.apply([st("scooter-l2", "ridden", false)], false);
    q.gate.released("scooter-l2", "taken");
    expect(q.log).toEqual([]);
    expect(q.gate.inRack("scooter-l2")).toBe(false);
  });

  it("a ride the server gave to somebody else ends here", () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.setRiding("scooter-r2");
    r.gate.apply([st("scooter-r2", "ridden", false)], false);
    expect(r.log).toEqual(["taken:scooter-r2"]);
  });

  it("a FULL snapshot re-owns a surviving ride, and hands back one this page no longer has", async () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.setRiding("scooter-r3");
    r.gate.apply([st("scooter-r3", "ridden", true), st("scooter-r4", "ridden", true)], true);
    expect(r.log).toEqual(["claim:scooter-r3", "release:scooter-r4"]);
    // a plain update while riding re-asks nothing
    r.gate.apply([st("scooter-r3", "ridden", true)], false);
    expect(r.log).toHaveLength(2);
  });

  it("if the grace ran out while we could not hear it: ask again, and get off if refused", async () => {
    const r = rig();
    r.gate.setAuthority(r.authority);
    r.setRiding("scooter-l2");
    r.gate.apply([st("scooter-l2", "docked")], true);
    expect(r.log).toEqual(["claim:scooter-l2"]);
    await r.answer({ ok: false, reason: "taken" });
    expect(r.log).toEqual(["claim:scooter-l2", "taken:scooter-l2"]);
  });
});

describe("the fleet has one set of ids, on both sides", () => {
  it("the server's registry names exactly the world's six docks", () => {
    const py = readFileSync("../backend/app/services/scooter_registry.py", "utf8");
    const ids = [...(py.match(/SCOOTER_IDS[^=]*=\s*\(([^)]*)\)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const world = scooterStations({ x: 0, z: 1300, w: 1440, d: 80 }).flatMap((s) => s.docks.map((d) => d.id));
    expect(ids).toEqual(world);
    expect(ids).toHaveLength(6);
  });
});
