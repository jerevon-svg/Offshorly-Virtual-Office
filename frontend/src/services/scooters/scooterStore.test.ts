// S1 — the client end of the scooter registry: a claim is a QUESTION, answered only by the server.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAIM_TIMEOUT_MS, __setScooterSocketForTests, applyClaimResult, applyFullSnapshot, applyScooterState,
  applyRelayedPose, applyTrafficHolds, applyAccident, applyAccidentResolved, applyAccidentResult, applyAccidentSnapshot, onScooterAccidents, reportScooterAccident, onTrafficHolds, sendTrafficObstacle, claimScooter, getScooterRegistrySnapshot, mergeScooter, onScooterPose, releaseScooter, resetScooterStoreForTests, sendScooterPose, type ScooterWire,
} from "./scooterStore";

const sc = (id: string, state: ScooterWire["state"], version: number, rider: string | null = null): ScooterWire => ({ id, state, rider, at: null, since: 0, version });

afterEach(() => { vi.useRealTimers(); resetScooterStoreForTests(); });

describe("scooterStore", () => {
  it("offline: refused at once, nothing sent", async () => {
    await expect(claimScooter("scooter-r1")).resolves.toEqual({ ok: false, reason: "offline" });
  });

  it("resolves only on the server's answer, matched by request id", async () => {
    const emit = vi.fn();
    __setScooterSocketForTests({ emit } as never);
    let settled = false;
    const p = claimScooter("scooter-r1").then((r) => { settled = true; return r; });
    await Promise.resolve();
    expect(settled).toBe(false);
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe("scooter_claim");
    expect(payload.scooterId).toBe("scooter-r1");
    applyClaimResult({ requestId: "someone-else", scooterId: "scooter-r1", ok: true });
    await Promise.resolve();
    expect(settled).toBe(false);
    applyClaimResult({ requestId: payload.requestId, scooterId: "scooter-r1", ok: false, reason: "taken", scooter: sc("scooter-r1", "ridden", 3, "x@y") });
    await expect(p).resolves.toEqual({ ok: false, reason: "taken" });
    // the refusal carried the truth: the store now knows who has it
    expect(getScooterRegistrySnapshot().scooters.find((s) => s.id === "scooter-r1")?.rider).toBe("x@y");
  });

  it("no answer in time → refused; a grant that turns up later is handed straight back", async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    __setScooterSocketForTests({ emit } as never);
    const p = claimScooter("scooter-l1");
    const { requestId } = emit.mock.calls[0][1];
    vi.advanceTimersByTime(CLAIM_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual({ ok: false, reason: "timeout" });
    applyClaimResult({ requestId, scooterId: "scooter-l1", ok: true });
    expect(emit).toHaveBeenLastCalledWith("scooter_release", { scooterId: "scooter-l1" });
  });

  it("a newer state never loses to an older one; a full snapshot always wins and is counted", () => {
    expect(mergeScooter([sc("a", "ridden", 5)], sc("a", "docked", 4))[0].state).toBe("ridden");
    expect(mergeScooter([sc("a", "ridden", 5)], sc("a", "docked", 6))[0].state).toBe("docked");
    const before = getScooterRegistrySnapshot().fullCount;
    applyFullSnapshot({ scooters: [sc("a", "docked", 0)] });
    applyScooterState({ scooter: sc("a", "ridden", 1, "me@x") });
    expect(getScooterRegistrySnapshot().scooters[0].state).toBe("ridden");
    applyFullSnapshot({ scooters: [sc("a", "docked", 0)] }); // a restarted server: versions start again
    expect(getScooterRegistrySnapshot().scooters[0].state).toBe("docked");
    expect(getScooterRegistrySnapshot().fullCount).toBe(before + 2);
  });

  it("release is sent as-is", () => {
    const emit = vi.fn();
    __setScooterSocketForTests({ emit } as never);
    releaseScooter("scooter-r4");
    expect(emit).toHaveBeenCalledWith("scooter_release", { scooterId: "scooter-r4" });
  });
});

describe("scooterStore — S2 poses", () => {
  const sample = { scooterId: "scooter-r1", seq: 5, t: 1, x: 1, z: 2, y: 0, heading: 0, speed: 10, lean: 0, pitch: 0 };

  it("relayed poses go straight to listeners (malformed ones nowhere); unsubscribing stops them", () => {
    const got: unknown[] = [];
    const off = onScooterPose((p) => got.push(p));
    applyRelayedPose({ ...sample, rider: "a@x" });
    applyRelayedPose({ ...sample } as never); // no rider: dropped
    applyRelayedPose(undefined);
    expect(got).toHaveLength(1);
    off();
    applyRelayedPose({ ...sample, rider: "a@x" });
    expect(got).toHaveLength(1);
  });

  it("sends our own pose only while connected", () => {
    const emit = vi.fn();
    __setScooterSocketForTests({ emit } as never, false);
    sendScooterPose(sample);
    expect(emit).not.toHaveBeenCalled();
    __setScooterSocketForTests({ emit } as never, true);
    sendScooterPose(sample);
    expect(emit).toHaveBeenCalledWith("scooter_pose", sample);
  });
});

describe("scooterStore — S4 traffic holds", () => {
  const car = { loop: "A", vehicle: 2, d0: 0, t0: 1, hold: { id: "h", stopP: 10, b: 1.1, releaseAt: null, emergency: false } };

  it("hands every change to listeners, and the newest at once to a listener that arrives later", () => {
    const early: unknown[] = [];
    onTrafficHolds((l) => early.push(l));
    applyTrafficHolds({ vehicles: [car] });
    applyTrafficHolds(undefined); // junk: nothing
    expect(early).toEqual([[car]]);
    const late: unknown[] = [];
    onTrafficHolds((l) => late.push(l));
    expect(late).toEqual([[car]]);
  });

  it("sends an obstacle report only while connected", () => {
    const emit = vi.fn();
    const r = { loop: "A", vehicle: 2, x: 1, z: 2, kind: "walk" as const };
    __setScooterSocketForTests({ emit } as never, false);
    sendTrafficObstacle(r);
    expect(emit).not.toHaveBeenCalled();
    __setScooterSocketForTests({ emit } as never, true);
    sendTrafficObstacle(r);
    expect(emit).toHaveBeenCalledWith("traffic_obstacle", r);
  });
});

describe("scooterStore — S5 accidents", () => {
  const report = { scooterId: "scooter-r1", loop: "A", vehicle: 2, x: 1, z: 2, heading: 0, speed: 200, t: 1, closing: 300 };
  const acc = { id: "a1", rider: "me@x", scooterId: "scooter-r1", loop: "A", vehicle: 2, at: 1, x: 1, z: 2, heading: 0, speed: 200, closing: 300, carHeading: 0, carSpeed: 160, endsAt: 9, nx: 1, nz: 0, restX: 40, restZ: 2 };

  it("a report resolves only with the server's verdict; offline is refused at once", async () => {
    await expect(reportScooterAccident(report)).resolves.toEqual({ ok: false, reason: "offline" });
    const emit = vi.fn();
    __setScooterSocketForTests({ emit } as never);
    const p = reportScooterAccident(report);
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe("scooter_accident");
    applyAccidentResult({ requestId: "someone-else", ok: true });
    applyAccidentResult({ requestId: payload.requestId, ok: false, reason: "not_an_accident" });
    await expect(p).resolves.toEqual({ ok: false, reason: "not_an_accident" });
  });

  it("keeps the accidents in progress: snapshot, confirmations, resolutions", () => {
    const seen: unknown[][] = [];
    onScooterAccidents((l) => seen.push(l));
    applyAccidentSnapshot({ accidents: [] });
    applyAccident({ accident: acc });
    applyAccident({ accident: acc }); // the same one twice is still one
    applyAccidentResolved({ id: "a1" });
    expect(seen.map((l) => l.length)).toEqual([0, 0, 1, 1, 0]);
  });
});
