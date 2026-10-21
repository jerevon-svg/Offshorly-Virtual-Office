// vo3d app — S1: NOTHING RIDES UNTIL THE SERVER SAYS SO. The world's side of the scooter registry, pure so it
// can be tested without a WebGL world (app/world.ts hands it the few things it needs).
//
//   request(id)   E on a dock. With an authority it only ASKS; the ride starts when (and if) the server says
//                 yes AND the body can still set off from that dock — the answer is a round trip away. A
//                 grant that can no longer be used is handed straight back. With no authority (the
//                 standalone dev page, tests) it is the immediate single-player ride it always was.
//   released(id)  the local ride ended: tell the server (unless it was the server that ended it), and
//                 record the release at once so the rack never stands empty for a round trip.
//   apply(list)   the server's word. On a FULL snapshot (connect / reconnect) a ride that survived a dropped
//                 socket is re-owned, and one this page no longer has (a refresh mid-ride) is handed back;
//                 on any update, a ride the server gave to somebody else ends here.
import type { ScooterPoseSample, Vo3dScooterAuthority, Vo3dScooterState } from "../world/scooters";

export interface ScooterGateDeps {
  /** the scooter this body is riding, or null */
  ridingId(): string | null;
  /** could this body set off on that dock right now (on foot, Player View, ground floor, beside it)? */
  canMount(id: string): boolean;
  /** the single-player mount, unchanged — returns whether the ride started */
  mountNow(id: string): boolean;
  /** end the local ride because the server says it is no longer ours */
  dismountTaken(): void;
  /** redraw the racks */
  render(): void;
  /** S7 — this body beside the UPRIGHT scooter it lifted (its own accident): where it stands, else null */
  recoverAt?(id: string): { x: number; z: number } | null;
}

export class ScooterGate {
  private readonly d: ScooterGateDeps;
  private authority: Vo3dScooterAuthority | null = null;
  readonly registry = new Map<string, Vo3dScooterState>();
  /** a mount asked of the server and not yet answered */
  pending: string | null = null;
  last = "—";

  constructor(deps: ScooterGateDeps) { this.d = deps; }

  get online(): boolean { return this.authority !== null; }

  setAuthority(a: Vo3dScooterAuthority | null): void {
    this.authority = a;
    this.pending = null;
    if (!a) this.registry.clear();
    this.d.render();
  }

  /** may it be asked for? No word yet, or in its rack / standing — never ridden by somebody, never fallen */
  available(id: string): boolean {
    const s = this.registry.get(id);
    return !s || s.state === "docked" || s.state === "standing";
  }

  /** is it drawn in its rack? Not while this body rides it, nor while the server says it is out */
  inRack(id: string): boolean {
    const s = this.registry.get(id);
    return this.d.ridingId() !== id && (!s || s.state === "docked");
  }

  request(id: string): boolean {
    const authority = this.authority;
    if (!authority) return this.d.mountNow(id);
    // S7 — the scooter I lifted, where it stands: asked for from beside it (it is not in a rack to be "available")
    const at = this.d.recoverAt?.(id) ?? null;
    const can = () => (at ? this.d.recoverAt?.(id) != null : this.d.canMount(id));
    if (this.d.ridingId() !== null || this.pending !== null || !can() || (!at && !this.available(id))) return false;
    this.pending = id;
    this.last = `asking for ${id}`;
    void authority.claim(id, at).then((r) => {
      if (this.pending !== id || this.authority !== authority) { if (r.ok) authority.release(id); return; }
      this.pending = null;
      if (!r.ok) { this.last = `refused ${id}: ${r.reason ?? "refused"}`; this.d.render(); return; }
      if (!can() || !this.d.mountNow(id)) { authority.release(id); this.last = `granted ${id} too late — handed back`; return; }
      this.last = `riding ${id}`;
    });
    return false;
  }

  /** S5 — this rider hit a car: the server's verdict, or null when there is no server to ask (single-player) */
  reportAccident(r: Parameters<NonNullable<Vo3dScooterAuthority["reportAccident"]>>[0]): Promise<{ ok: boolean; reason?: string }> | null {
    return this.authority?.reportAccident?.(r) ?? null;
  }
  /** S7 — E beside my own fallen scooter. One ask at a time (repeated E presses are the same ask); the lift
   *  itself starts when the server's accident says so, for everybody at once. null: no server, nothing to ask. */
  liftPending: string | null = null;
  lift(id: string, at: { x: number; z: number }): Promise<{ ok: boolean; reason?: string }> | null {
    const authority = this.authority;
    if (!authority?.liftAccident || this.liftPending !== null) return null;
    this.liftPending = id;
    return authority.liftAccident(id, at).then((r) => { this.liftPending = null; this.last = r.ok ? `lifting ${id}` : `lift refused: ${r.reason ?? "?"}`; return r; });
  }

  /** S6 — the reach this rider's world allows their own accident (the server records it, everybody plays it) */
  reportAccidentReach(id: string, reach: Parameters<NonNullable<Vo3dScooterAuthority["reportAccidentReach"]>>[1]): void {
    this.authority?.reportAccidentReach?.(id, reach);
  }

  /** S2 — the ride's pose, to the server (only while the server is in the loop) */
  sendPose(sample: ScooterPoseSample): void {
    this.authority?.sendPose?.(sample);
  }

  released(id: string, reason: string): void {
    if (this.authority && reason !== "taken") {
      this.authority.release(id);
      this.registry.set(id, { id, state: "docked", mine: false });
    }
    this.d.render();
  }

  apply(list: readonly Vo3dScooterState[], full: boolean): void {
    for (const s of list) {
      this.registry.set(s.id, { ...s });
      const authority = this.authority;
      if (!authority) continue;
      if (this.d.ridingId() === s.id) {
        if (s.state === "ridden" && s.mine) { if (full) void authority.claim(s.id); }
        else if (s.state === "ridden" || s.state === "fallen") this.d.dismountTaken();
        // the server let it go while we could not hear it (the grace ran out): ask again, or get off
        else void authority.claim(s.id).then((r) => { if (!r.ok && this.d.ridingId() === s.id) this.d.dismountTaken(); });
      } else if (s.state === "ridden" && s.mine && this.pending !== s.id) authority.release(s.id);
    }
    this.d.render();
  }
}
