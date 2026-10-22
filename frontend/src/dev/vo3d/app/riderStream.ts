// vo3d app — S2: A SCOOTER RIDER, AS EVERYBODY ELSE SEES THEM. Pure (no THREE, no transport), so it is tested
// on its own: the world feeds it samples and asks it where to draw.
//
//   RiderPoseOut         the rider's side: at most one sample per POSE_INTERVAL_MS, numbered (seq) so the
//                        server and every receiver can refuse anything stale or repeated.
//   RiderPoseInterpolator  everybody else's side: a few samples per scooter, drawn RENDER_DELAY_MS in the past
//                        and interpolated between the two that straddle that moment — so the ride reads as
//                        continuous rather than as ten jumps a second. If the next sample is late, the last one
//                        is carried forward along its heading for at most EXTRAPOLATE_MS, then held.
//
// TIME. Each sample carries its sender's own clock (`t`). Receivers never compare it with theirs; they learn
// the gap from the samples themselves (the smallest arrival-minus-sent seen, i.e. the fastest delivery),
// which turns network jitter into a steady line. A new rider starts over.
//
// READY FOR S3: `fx` (drift direction, charge, slip, boost) rides along untouched and is handed back with the
// pose; nothing here reads it yet.

import type { RelayedScooterPose, RiderPose, ScooterFx, ScooterPoseSample } from "../world/scooters";
export type { RelayedScooterPose, RiderPose, ScooterFx, ScooterPoseSample } from "../world/scooters";

export const POSE_INTERVAL_MS = 100;
/** how far behind the newest sample the remote rider is drawn — a little over one interval, so there is
 *  almost always a sample on either side */
export const RENDER_DELAY_MS = 110;
/** how long a late stream is carried forward before the rider is simply held where they were */
export const EXTRAPOLATE_MS = 250;
const BUFFER = 12;
/** how fast the learned clock gap may relax upward (ms per ms), so one lucky fast packet is not forever */
const GAP_RELAX = 0.002;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** S3 — THE DECK AS DRAWN: the ride's travel heading (what is sent) plus a drift's slip into the turn */
export const drawnHeading = (p: RiderPose): number => p.heading + (p.fx?.slip ?? 0);

/** S3 — a drift between two samples: its slip and charge blend (no yaw snap at either end of a drift); its
 *  direction and boost are the newer sample's */
function lerpFx(a: ScooterFx | undefined, b: ScooterFx | undefined, u: number): ScooterFx | undefined {
  if (!a && !b) return undefined;
  const out: ScooterFx = { drift: b?.drift ?? 0, charge: lerp(a?.charge ?? 0, b?.charge ?? 0, u), slip: lerp(a?.slip ?? 0, b?.slip ?? 0, u), boost: b?.boost ?? false };
  return out;
}
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerpAngle = (a: number, b: number, u: number): number => a + wrap(b - a) * u;

export class RiderPoseOut {
  /** numbered from the sender's clock, so a page reloaded mid-ride still counts UP from where it was */
  private seq: number;
  private lastAt = -Infinity;
  private readonly interval: number;
  constructor(intervalMs = POSE_INTERVAL_MS, startSeq = Date.now()) { this.interval = intervalMs; this.seq = Math.floor(startSeq); }
  /** a new ride: the next sample goes out at once */
  reset(): void { this.lastAt = -Infinity; }
  /** the sample to send now, or null (too soon). `force` sends regardless — the first frame of a ride. */
  next(nowMs: number, scooterId: string, pose: RiderPose, force = false): ScooterPoseSample | null {
    if (!force && nowMs - this.lastAt < this.interval) return null;
    this.lastAt = nowMs;
    const out: ScooterPoseSample = { scooterId, seq: ++this.seq, t: nowMs, x: pose.x, z: pose.z, y: pose.y, heading: pose.heading, speed: pose.speed, lean: pose.lean, pitch: pose.pitch };
    if (pose.fx) out.fx = { ...pose.fx };
    return out;
  }
}

interface Track {
  rider: string;
  lastSeq: number;
  /** learned (arrival - sent) gap, ms */
  gap: number;
  gapAt: number;
  samples: { at: number; pose: RiderPose }[];
}

export class RiderPoseInterpolator {
  private readonly tracks = new Map<string, Track>();

  /** take a relayed sample, received at local `nowMs`. Returns false when it was stale or a repeat. */
  push(s: RelayedScooterPose, nowMs: number): boolean {
    let tr = this.tracks.get(s.scooterId);
    // a different rider is a different ride: nothing from before applies (the world also drops a scooter's
    // track whenever the server says its ride changed)
    if (tr && tr.rider !== s.rider) { this.tracks.delete(s.scooterId); tr = undefined; }
    if (tr && s.seq <= tr.lastSeq) return false;
    const gapNow = nowMs - s.t;
    if (!tr) {
      tr = { rider: s.rider, lastSeq: s.seq, gap: gapNow, gapAt: nowMs, samples: [] };
      this.tracks.set(s.scooterId, tr);
    } else {
      tr.gap = Math.min(tr.gap + GAP_RELAX * Math.max(0, nowMs - tr.gapAt), gapNow);
      tr.gapAt = nowMs;
      tr.lastSeq = s.seq;
    }
    const pose: RiderPose = { x: s.x, z: s.z, y: s.y, heading: s.heading, speed: s.speed, lean: s.lean, pitch: s.pitch, ...(s.fx ? { fx: s.fx } : {}) };
    tr.samples.push({ at: s.t, pose });
    if (tr.samples.length > BUFFER) tr.samples.shift();
    return true;
  }

  riderOf(scooterId: string): string | null { return this.tracks.get(scooterId)?.rider ?? null; }
  ids(): string[] { return [...this.tracks.keys()]; }
  drop(scooterId: string): void { this.tracks.delete(scooterId); }
  clear(): void { this.tracks.clear(); }

  /** where to draw the rider of `scooterId` at local `nowMs`, or null if nothing has been heard */
  sample(scooterId: string, nowMs: number): RiderPose | null {
    const tr = this.tracks.get(scooterId);
    if (!tr || tr.samples.length === 0) return null;
    // the render moment, on the SENDER's clock
    const at = nowMs - tr.gap - RENDER_DELAY_MS;
    const ss = tr.samples;
    if (at <= ss[0].at) return { ...ss[0].pose };
    for (let i = ss.length - 1; i > 0; i--) {
      const a = ss[i - 1], b = ss[i];
      if (at >= a.at && at <= b.at) {
        const u = b.at > a.at ? (at - a.at) / (b.at - a.at) : 1;
        const fx = lerpFx(a.pose.fx, b.pose.fx, u);
        return {
          x: lerp(a.pose.x, b.pose.x, u), z: lerp(a.pose.z, b.pose.z, u), y: lerp(a.pose.y, b.pose.y, u),
          heading: lerpAngle(a.pose.heading, b.pose.heading, u), speed: lerp(a.pose.speed, b.pose.speed, u),
          lean: lerp(a.pose.lean, b.pose.lean, u), pitch: lerp(a.pose.pitch, b.pose.pitch, u),
          ...(fx ? { fx } : {}),
        };
      }
    }
    // past the newest sample: carry it forward along its heading for a moment, then hold
    const last = ss[ss.length - 1].pose;
    const late = at - ss[ss.length - 1].at;
    const dt = Math.min(late, EXTRAPOLATE_MS) / 1000;
    const carried: RiderPose = { ...last, x: last.x + Math.sin(last.heading) * last.speed * dt, z: last.z - Math.cos(last.heading) * last.speed * dt };
    // A STREAM GONE QUIET carries no drift: a rider not heard from is held, never drawn sliding or sparking
    if (late > EXTRAPOLATE_MS) delete carried.fx;
    return carried;
  }
}

/** what the world gives the driver: the server's word per scooter, and how to draw */
export interface RemoteRiderDeps {
  /** the server's state for a scooter, and whether its rider is THIS employee */
  registry(id: string): { state: string; mine: boolean } | undefined;
  /** is the viewer somewhere riders can be seen (the ground floor)? */
  visible(): boolean;
  /** put `email`'s real body on the deck for this frame (null: take it off); false when no body is drawn */
  driveBody(email: string, pose: RiderPose | null): boolean;
  placeScooter(id: string, pose: RiderPose): void;
  hideScooter(id: string): void;
}

/** EVERY OTHER RIDER, ONE FRAME AT A TIME: the scooter under them and their own body on its deck — only while
 *  the server says that ride is theirs (and not ours), only where their body is drawn, and gone the moment
 *  any of that stops being true. One scooter, one body, one slot: nothing is ever drawn twice or left behind. */
export class RemoteRiderDriver {
  readonly stream = new RiderPoseInterpolator();
  /** which rider's body each scooter is driving right now */
  private readonly bodies = new Map<string, string>();
  private readonly d: RemoteRiderDeps;
  constructor(deps: RemoteRiderDeps) { this.d = deps; }

  /** a relayed pose */
  push(p: RelayedScooterPose, nowMs: number): boolean { return this.stream.push(p, nowMs); }

  /** the server's word changed for these scooters: a ride that CHANGED starts its stream again */
  rideChanged(id: string): void { this.stream.drop(id); this.release(id); }

  /** riding bodies right now, scooter id → email (for the readout and tests) */
  get driving(): ReadonlyMap<string, string> { return this.bodies; }

  update(nowMs: number): void {
    for (const id of this.stream.ids()) {
      const reg = this.d.registry(id);
      const rider = this.stream.riderOf(id)!;
      const live = reg?.state === "ridden" && !reg.mine;
      const prev = this.bodies.get(id);
      if (prev && prev !== rider) { this.d.driveBody(prev, null); this.bodies.delete(id); }
      const pose = live && this.d.visible() ? this.stream.sample(id, nowMs) : null;
      if (pose && this.d.driveBody(rider, pose)) {
        this.d.placeScooter(id, pose);
        this.bodies.set(id, rider);
      } else {
        this.release(id);
        if (!live) this.stream.drop(id);
      }
    }
    for (const id of [...this.bodies.keys()]) if (!this.stream.ids().includes(id)) this.release(id);
  }

  private release(id: string): void {
    this.d.hideScooter(id);
    const was = this.bodies.get(id);
    if (was) { this.d.driveBody(was, null); this.bodies.delete(id); }
  }

  /** everything off (the world going away, the server line dropping) */
  clear(): void {
    for (const id of [...this.bodies.keys()]) this.release(id);
    this.stream.clear();
  }
}
