// S2 — RIDERS EVERYBODY SEES (app/riderStream): the 10 Hz stream out, the interpolated ride in, and the
// driver that puts exactly one scooter and one body on the road per ride — and nothing else.
import { describe, expect, it } from "vitest";
import { EXTRAPOLATE_MS, POSE_INTERVAL_MS, RENDER_DELAY_MS, RemoteRiderDriver, RiderPoseInterpolator, RiderPoseOut, type RelayedScooterPose, type RiderPose } from "./riderStream";

const pose = (x: number, over: Partial<RiderPose> = {}): RiderPose => ({ x, z: 1330, y: 0, heading: Math.PI / 2, speed: 0, lean: 0, pitch: 0, ...over });
const relayed = (seq: number, t: number, x: number, over: Partial<RelayedScooterPose> = {}): RelayedScooterPose =>
  ({ scooterId: "scooter-r1", rider: "a@x", seq, t, ...pose(x), ...over });

describe("RiderPoseOut", () => {
  it("sends at most one sample per interval, numbered upward, and the first at once", () => {
    const out = new RiderPoseOut(POSE_INTERVAL_MS, 1000);
    const a = out.next(0, "scooter-r1", pose(1), true)!;
    expect(out.next(50, "scooter-r1", pose(2))).toBeNull();
    const b = out.next(100, "scooter-r1", pose(3))!;
    expect([a.seq, b.seq]).toEqual([1001, 1002]);
    expect([a.t, b.t, b.x]).toEqual([0, 100, 3]);
    out.reset();
    expect(out.next(101, "scooter-r1", pose(4))!.seq).toBe(1003); // a new ride: at once, still counting up
  });

  it("numbers from the sender's clock, so a page reloaded mid-ride still counts up", () => {
    expect(new RiderPoseOut(100, 2_000).next(0, "s", pose(0), true)!.seq).toBeGreaterThan(new RiderPoseOut(100, 1_000).next(0, "s", pose(0), true)!.seq);
  });

  it("carries the reserved drift block untouched", () => {
    const s = new RiderPoseOut().next(0, "s", pose(0, { fx: { drift: 1, charge: 0.4, boost: false } }), true)!;
    expect(s.fx).toEqual({ drift: 1, charge: 0.4, boost: false });
  });
});

describe("RiderPoseInterpolator", () => {
  it("draws the ride RENDER_DELAY_MS behind, between the two samples that straddle it — whatever the sender's clock says", () => {
    const ip = new RiderPoseInterpolator();
    const skew = 987_654; // the sender's clock is nowhere near ours
    ip.push(relayed(1, skew + 0, 0), 30);
    ip.push(relayed(2, skew + 100, 10), 130);
    ip.push(relayed(3, skew + 200, 20), 230);
    // each sample arrived 30 ms after it was sent (on its clock), so local time N shows sender time
    // N − 30 − RENDER_DELAY_MS: local 150 + 30 + delay is sender time 150, halfway from sample 2 to 3
    const p = ip.sample("scooter-r1", 150 + 30 + RENDER_DELAY_MS)!;
    expect(p.x).toBeCloseTo(15, 6);
  });

  it("absorbs jitter: a late sample does not drag the ride backwards", () => {
    const ip = new RiderPoseInterpolator();
    ip.push(relayed(1, 0, 0), 20);
    ip.push(relayed(2, 100, 10), 190); // 70 ms late
    ip.push(relayed(3, 200, 20), 220);
    const xs = [250, 270, 290, 310, 330].map((now) => ip.sample("scooter-r1", now)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("refuses repeats and anything older than what it has", () => {
    const ip = new RiderPoseInterpolator();
    expect(ip.push(relayed(5, 0, 0), 0)).toBe(true);
    expect(ip.push(relayed(5, 0, 99), 1)).toBe(false);
    expect(ip.push(relayed(4, -100, 99), 1)).toBe(false);
    expect(ip.sample("scooter-r1", 1000)!.x).toBe(0);
  });

  it("carries a late stream forward along its heading for a moment, then holds", () => {
    const ip = new RiderPoseInterpolator();
    ip.push(relayed(1, 0, 0, { speed: 100 }), 0); // heading π/2 → forward (+x)
    const far = ip.sample("scooter-r1", 10_000)!;
    expect(far.x).toBeCloseTo(100 * (EXTRAPOLATE_MS / 1000), 6);
    expect(ip.sample("scooter-r1", 20_000)!.x).toBeCloseTo(far.x, 9);
  });

  it("turns the short way round", () => {
    const ip = new RiderPoseInterpolator();
    ip.push(relayed(1, 0, 0, { heading: Math.PI - 0.1 }), 0);
    ip.push(relayed(2, 100, 0, { heading: -Math.PI + 0.1 }), 0);
    const h = ip.sample("scooter-r1", 50 + RENDER_DELAY_MS)!.heading;
    expect(Math.abs(Math.atan2(Math.sin(h), Math.cos(h)))).toBeGreaterThan(Math.PI - 0.11);
  });

  it("a different rider on the same scooter starts over", () => {
    const ip = new RiderPoseInterpolator();
    ip.push(relayed(9, 0, 5), 0);
    expect(ip.push(relayed(1, 0, 50, { rider: "b@x" }), 10)).toBe(true);
    expect(ip.riderOf("scooter-r1")).toBe("b@x");
    expect(ip.sample("scooter-r1", 10)!.x).toBe(50);
  });
});

function driverRig() {
  const registry = new Map<string, { state: string; mine: boolean }>();
  const bodies = new Map<string, RiderPose | null>();
  const drawn = new Set<string>(["a@x", "b@x"]); // whose bodies exist here
  const scooters = new Map<string, RiderPose>();
  let visible = true;
  const d = new RemoteRiderDriver({
    registry: (id) => registry.get(id),
    visible: () => visible,
    driveBody: (email, p) => { if (!drawn.has(email)) return false; bodies.set(email, p); return true; },
    placeScooter: (id, p) => { scooters.set(id, p); },
    hideScooter: (id) => { scooters.delete(id); },
  });
  return { d, registry, bodies, scooters, drawn, setVisible: (v: boolean) => { visible = v; } };
}

describe("RemoteRiderDriver — one scooter and one body per ride, never a ghost", () => {
  it("two riders at once, each on their own scooter, each body on its own deck", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: false });
    r.registry.set("scooter-l2", { state: "ridden", mine: false });
    r.d.push(relayed(1, 0, 100), 0);
    r.d.push(relayed(1, 0, 500, { scooterId: "scooter-l2", rider: "b@x" }), 0);
    r.d.update(500);
    expect([...r.scooters.keys()].sort()).toEqual(["scooter-l2", "scooter-r1"]);
    expect(r.bodies.get("a@x")!.x).toBe(100);
    expect(r.bodies.get("b@x")!.x).toBe(500);
    expect(r.d.driving.size).toBe(2);
  });

  it("released (back in its rack): the scooter goes and the body steps off, once", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: false });
    r.d.push(relayed(1, 0, 100), 0);
    r.d.update(500);
    r.registry.set("scooter-r1", { state: "docked", mine: false });
    r.d.rideChanged("scooter-r1");
    r.d.update(600);
    expect(r.scooters.size).toBe(0);
    expect(r.bodies.get("a@x")).toBeNull();
    expect(r.d.driving.size).toBe(0);
    // a straggler sample after the release draws nothing
    r.d.push(relayed(2, 100, 110), 650);
    r.d.update(700);
    expect(r.scooters.size).toBe(0);
  });

  it("never draws OUR OWN ride from the stream, nor a ride the server has not confirmed", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: true });
    r.d.push(relayed(1, 0, 100), 0);
    r.d.push(relayed(1, 0, 100, { scooterId: "scooter-r2", rider: "b@x" }), 0); // no word from the server
    r.d.update(500);
    expect(r.scooters.size).toBe(0);
    expect(r.bodies.size).toBe(0);
  });

  it("a rider whose body is not drawn here (another floor, the Cave) has no scooter either; the viewer upstairs sees none", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: false });
    r.drawn.delete("a@x");
    r.d.push(relayed(1, 0, 100), 0);
    r.d.update(500);
    expect(r.scooters.size).toBe(0);
    r.drawn.add("a@x");
    r.d.update(510);
    expect(r.scooters.size).toBe(1);
    r.setVisible(false); // the viewer took the lift
    r.d.update(520);
    expect(r.scooters.size).toBe(0);
    expect(r.bodies.get("a@x")).toBeNull();
  });

  it("the scooter changing hands: the old rider steps off, the new one gets on — one body on it, never two", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: false });
    r.d.push(relayed(1, 0, 100), 0);
    r.d.update(500);
    r.d.push(relayed(1, 600, 300, { rider: "b@x" }), 600);
    r.d.update(1000);
    expect(r.bodies.get("a@x")).toBeNull();
    expect(r.bodies.get("b@x")!.x).toBe(300);
    expect([...r.d.driving.values()]).toEqual(["b@x"]);
  });

  it("a late joiner's seeded pose draws the rider at once", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: false });
    r.d.push(relayed(5_000, 1_000, 777), 9_999_999); // the stored pose, timed by its own clock
    r.d.update(9_999_999);
    expect(r.scooters.get("scooter-r1")!.x).toBe(777);
  });

  it("clear() takes everybody off", () => {
    const r = driverRig();
    r.registry.set("scooter-r1", { state: "ridden", mine: false });
    r.d.push(relayed(1, 0, 100), 0);
    r.d.update(500);
    r.d.clear();
    expect(r.scooters.size).toBe(0);
    expect(r.bodies.get("a@x")).toBeNull();
  });
});
