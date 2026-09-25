// vo3d interact — RIDING THE LIFT.
//
// ============================= WHAT THE USER SEES ===============================================
//
//    framing   whatever view they were in eases into a cinematic third-person shot behind the avatar
//    approach  the avatar walks the last units to the doors, camera following, the room all around
//    opening   the leaves part on a real, lit vestibule
//    boarding  the avatar walks in and stands on the mark — THE ROOM IS STILL THERE through the doors
//    aligning  it turns and faces them; the room is still visible past it
//    closing   the leaves shut
//    riding    the car travels. The read-out steps 01 -> 02 in plain sight and NOTHING ELSE CHANGES.
//    settle    it arrives and stands for a beat
//    arriving  the leaves part — and the DESTINATION FLOOR is there, already complete, through them
//    leaving   the avatar walks out, control comes back, the destination's view is restored
//    shutting  the leaves close behind it, owning nobody
//
// ============================= HOW THE SEAL WORKS ===============================================
//
// There are TWO places a body can be: a floor's VESTIBULE (a shallow lift bay built into that floor's
// wall, containing no world geometry at all) and THE CABIN (one car, alone at x 9000). Their fronts are
// identical by construction — same interior, same doors, same read-out, same setback (rooms/elevator.ts).
//
// So the whole sequence is:
//
//    doors open  →  vestibule, with the real floor visible past the doorway
//    doors shut  →  translate body + camera into the cabin. Identical geometry, identical distances,
//                   identical frame. Nothing on screen changes.
//    riding      →  the floor swap happens HERE, 9,000 units from any floor, inside a lidded box with
//                   the doors shut. There is no frame in which any of it could be seen.
//    doors shut  →  translate back into the DESTINATION's vestibule. Identical frame again.
//    doors open  →  the destination floor, already complete.
//
// Nothing is hidden, nothing is faded, no lighting is touched and no volume crosses another.
import { headingFor, stepAngle, type Vec2 } from "../core/coords";
import { CABIN, RIDE, toCabin, type ElevatorSpec } from "../rooms/elevator";
import type { ElevatorCoreBuild, LiftBuild } from "../build/elevator";
import type { Vo3dFloorId } from "../app/floors";

export type FloorPhase =
  | "idle" | "framing" | "approach" | "opening" | "boarding" | "aligning"
  | "closing" | "riding" | "settle" | "arriving" | "leaving" | "shutting";

const WALK_TIMEOUT_MS = 8000;
const TURN_TIMEOUT_MS = 2500;
const TURN_RATE = 6;
/** how far through the ride the floor is swapped, and how far through the read-out steps — deliberately
 *  different moments, so a number changing never coincides with anything else happening */
const SWAP_AT = 0.4;
const INDICATOR_AT = 0.64;

export interface FloorTransitionDeps {
  specOf(floor: Vo3dFloorId): ElevatorSpec;
  coreOf(floor: Vo3dFloorId): ElevatorCoreBuild;
  /** the one cabin */
  cabin: LiftBuild;
  indicatorOf(floor: Vo3dFloorId): string;
  bodyPos(): Vec2;
  bodyYaw(): number;
  stepWalk(legs: Vec2[], dt: number): boolean;
  setYaw(yaw: number, snap?: boolean): void;
  place(p: Vec2, look: Vec2): boolean;
  /** MOVE THE BODY AND THE CAMERA BY THE SAME VECTOR, silently — the seal's whole technique */
  translateBody(dx: number, dz: number): void;
  takeAvatar(): boolean;
  releaseAvatar(): void;
  beginCinematic(): void;
  endCinematic(arrivedOn: Vo3dFloorId): void;
  applyFloor(to: Vo3dFloorId): void;
  /** HOW FAR BEHIND THE BODY THE SHOT SITS. A vestibule is 60 deep, so while the body is in one the
   *  camera has about thirty units to work with — a close over-shoulder, which is the right frame for
   *  doors opening onto a room. The cabin has eighty units of car behind its bay, so the RIDE can pull
   *  back into a proper third-person shot. The change is made a beat AFTER the swap and a beat BEFORE
   *  coming back, never on either frame, and PlayerCamera smooths it into a dolly. */
  setBoom(wide: boolean): void;
  onWhere(to: Vo3dFloorId): void;
  invalidateShadows(): void;
}

export class FloorTransition {
  private readonly d: FloorTransitionDeps;
  private _floor: Vo3dFloorId;
  private _busy = false;
  private phase: FloorPhase = "idle";
  private from: Vo3dFloorId;
  private to: Vo3dFloorId;
  private elapsed = 0;
  private swapped = false;
  private stepped = false;
  private refused = false;
  /** true while the body is in the cabin rather than in a floor's vestibule */
  private inCabin = false;
  private legs: Vec2[] = [];
  readonly state = { floor: "floor-1" as Vo3dFloorId, phase: "idle" as FloorPhase, busy: false, journeys: 0, last: "—" };

  constructor(deps: FloorTransitionDeps, start: Vo3dFloorId) {
    this.d = deps;
    this._floor = start;
    this.from = start;
    this.to = start;
    this.state.floor = start;
  }

  get floor(): Vo3dFloorId { return this._floor; }
  get busy(): boolean { return this._busy; }
  get currentPhase(): FloorPhase { return this.phase; }
  /** true while the body is inside the cabin — the sealed part of the journey */
  get sealed(): boolean { return this.inCabin; }

  canBoardFrom(p: Vec2): boolean {
    const s = this.d.specOf(this._floor);
    const near = { x: s.outer.x - 20, z: s.outer.z, w: s.outer.w + 44, d: s.outer.d };
    return p.x >= near.x && p.x <= near.x + near.w && p.z >= near.z && p.z <= near.z + near.d;
  }

  start(to: Vo3dFloorId): boolean {
    if (this._busy) { this.state.last = "refused: a journey is already running"; return false; }
    if (to === this._floor) { this.state.last = `refused: already on ${to}`; return false; }
    if (!this.canBoardFrom(this.d.bodyPos())) { this.state.last = "refused: not at the elevator"; return false; }
    this.from = this._floor;
    this.to = to;
    this.swapped = false;
    this.stepped = false;
    this.refused = false;
    this.inCabin = false;
    // CINEMATIC FRAMING FIRST, THEN THE AVATAR: entering PLAYER acquires an owner that "Interaction"
    // outranks, so taking the avatar first makes the mode switch fail silently.
    this.d.beginCinematic();
    if (!this.d.takeAvatar()) {
      this.d.endCinematic(this._floor);
      this.state.last = "refused: the avatar could not be taken";
      return false;
    }
    this._busy = true;
    this.state.busy = true;
    this.d.coreOf(this.from).setIndicator(this.d.indicatorOf(this.from));
    this.d.cabin.setIndicator(this.d.indicatorOf(this.from));
    this.d.coreOf(this.from).setLight(1);
    this.d.cabin.setLight(1);
    this.d.setBoom(true);
    this.enter("framing");
    return true;
  }

  toggle(other: Vo3dFloorId, home: Vo3dFloorId): boolean {
    return this.start(this._floor === other ? home : other);
  }

  private enter(phase: FloorPhase): void {
    this.phase = phase;
    this.state.phase = phase;
    this.elapsed = 0;
    const here = this.d.specOf(this.dockedFloor);
    if (phase === "approach") this.legs = [{ ...here.boarding }];
    else if (phase === "boarding") this.legs = [{ ...here.threshold }, { ...here.mark }];
    else if (phase === "leaving") this.legs = [{ ...here.threshold }, { ...here.boarding }];
    else this.legs = [];
  }

  /** which floor's vestibule the body is using; meaningless while in the cabin */
  private get dockedFloor(): Vo3dFloorId { return this.swapped ? this.to : this.from; }

  update(dtMs: number): void {
    if (this.phase === "idle") return;
    this.elapsed += dtMs;
    const dt = dtMs / 1000;
    const floor = this.dockedFloor;
    const spec = this.d.specOf(floor);
    // THE DOORS THE CAMERA IS LOOKING AT: the cabin's while sealed, the floor's otherwise. Both are the
    // same geometry at the same place relative to the body, which is why swapping between them is free.
    const doors = this.inCabin ? this.d.cabin : this.d.coreOf(floor);
    switch (this.phase) {
      case "framing":
        if (this.elapsed >= RIDE.frameMs) this.enter("approach");
        break;
      case "approach":
        if (this.d.stepWalk(this.legs, dt) || this.elapsed > WALK_TIMEOUT_MS) {
          this.d.setYaw(spec.boardingYaw);
          this.enter("opening");
        }
        break;
      case "opening":
        doors.setOpen(Math.min(1, this.elapsed / RIDE.doorMs));
        if (this.elapsed >= RIDE.doorMs + RIDE.dwellMs) this.enter("boarding");
        break;
      case "boarding":
        if (this.d.stepWalk(this.legs, dt) || this.elapsed > WALK_TIMEOUT_MS) {
          // land on the mark STILL FACING THE WAY IT WALKED — `aligning` is what turns it round, and
          // placing it with the stand look here would snap the turn away before that beat ran
          this.d.place(spec.mark, spec.boardingLook);
          this.enter("aligning");
        }
        break;
      case "aligning": {
        // THE CAMERA COMES IN AS THE BODY TURNS. Held wide through the walk-in — the shot follows from
        // the room, through the open doorway — and dollied to the over-shoulder only once the body is on
        // its mark, because a near boom during the walk puts the lens in the back of its head.
        this.d.setBoom(false);
        // TURN AND FACE THE DOORS. From here the composition is fixed: the avatar's back to the camera,
        // the leaves ahead, the read-out above them — and, until they shut, the real room past them.
        const want = spec.standYaw;
        const next = stepAngle(this.d.bodyYaw(), want, dt * TURN_RATE);
        this.d.setYaw(next);
        if (Math.abs(wrap(want - next)) < 0.04 || this.elapsed > TURN_TIMEOUT_MS) {
          this.d.setYaw(want, true);
          this.enter("closing");
        }
        break;
      }
      case "closing":
        doors.setOpen(Math.max(0, 1 - this.elapsed / RIDE.doorMs));
        if (this.elapsed >= RIDE.doorMs) {
          doors.setOpen(0);
          this.board(spec); // …and the body is in the cabin from here
          this.enter("riding");
        }
        break;
      case "riding": {
        const t = this.elapsed / RIDE.travelMs;
        if (this.elapsed >= 420) this.d.setBoom(true);
        if (!this.swapped && t >= SWAP_AT && !this.swap()) return;
        if (!this.stepped && t >= INDICATOR_AT) {
          this.stepped = true;
          const text = this.d.indicatorOf(this.to);
          this.d.cabin.setIndicator(text);
          for (const f of [this.from, this.to]) this.d.coreOf(f).setIndicator(text);
        }
        if (this.elapsed >= RIDE.travelMs) this.enter("settle");
        break;
      }
      case "settle":
        this.d.setBoom(false);
        if (this.elapsed >= RIDE.settleMs) {
          this.alight(this.d.specOf(this.to)); // back into the destination's vestibule, doors still shut
          this.enter("arriving");
        }
        break;
      case "arriving":
        doors.setOpen(Math.min(1, this.elapsed / RIDE.doorMs));
        if (this.elapsed >= RIDE.doorMs + RIDE.dwellMs) this.enter("leaving");
        break;
      case "leaving":
        if (this.d.stepWalk(this.legs, dt) || this.elapsed > WALK_TIMEOUT_MS) {
          this.d.place(spec.boarding, spec.boardingLook);
          this.finish();
        }
        break;
      case "shutting":
        doors.setOpen(Math.max(0, 1 - this.elapsed / RIDE.doorMs));
        if (this.elapsed >= RIDE.doorMs) { doors.setOpen(0); this.enter("idle"); }
        break;
    }
  }

  /** VESTIBULE → CABIN, with the leaves shut. A translation and two visibility flags; the frame is
   *  identical on both sides of it because the two interiors are the same interior. */
  private board(from: ElevatorSpec): void {
    const v = toCabin(from);
    this.d.cabin.setOpen(0);
    this.d.cabin.group.visible = true;
    this.d.translateBody(v.x, v.z);
    this.d.place(CABIN.mark, { x: 1, z: 0 });
    this.inCabin = true;
    this.d.invalidateShadows();
  }

  /** CABIN → VESTIBULE, the same move backwards. */
  private alight(to: ElevatorSpec): void {
    if (!this.inCabin) return;
    const v = toCabin(to);
    this.d.coreOf(this.to).setOpen(0);
    this.d.translateBody(-v.x, -v.z);
    this.d.place(to.mark, to.standLook);
    this.inCabin = false;
    this.d.cabin.group.visible = false;
    this.d.invalidateShadows();
  }

  /** THE FLOOR CHANGE, made while the body is in the cabin: 9,000 units from any floor, behind shut
   *  doors, inside a lidded box. There is no frame in which any part of it is on screen. */
  private swap(): boolean {
    this.d.onWhere(this.to);
    this.d.applyFloor(this.to);
    this.swapped = true;
    this._floor = this.to;
    this.state.floor = this.to;
    return true;
  }

  private finish(): void {
    this._busy = false;
    this.state.busy = false;
    this.state.journeys++;
    if (!this.refused) this.state.last = `arrived on ${this._floor}`;
    this.d.setBoom(false);
    this.d.releaseAvatar();
    this.d.endCinematic(this._floor);
    this.enter("shutting");
  }

  /** PUT THE WORLD ON `floor` BECAUSE THAT IS WHERE THIS EMPLOYEE ALREADY WAS — a restore, not a
   *  journey: no cinematic, no doors, no ownership, nothing to cover. */
  restoreOn(floor: Vo3dFloorId): boolean {
    if (this._busy || floor === this._floor) return floor === this._floor;
    const far = this.d.specOf(floor);
    this.d.onWhere(floor);
    this.d.applyFloor(floor);
    if (!this.d.place(far.boarding, far.boardingLook)) {
      this.d.applyFloor(this._floor);
      this.d.onWhere(this._floor);
      this.state.last = `restore refused: ${floor} would not hold a body`;
      return false;
    }
    this._floor = floor;
    this.state.floor = floor;
    this.from = floor;
    this.to = floor;
    this.d.coreOf(floor).setIndicator(this.d.indicatorOf(floor));
    this.d.cabin.setIndicator(this.d.indicatorOf(floor));
    this.state.last = `restored on ${floor}`;
    return true;
  }
}

function wrap(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }

/** Walk `legs` in order, CONSUMING them — the queue is what carries progress between frames. */
export function walkLegs(pos: Vec2, legs: Vec2[], speed: number, dt: number): { pos: Vec2; yaw: number | null; arrived: boolean } {
  let remaining = speed * dt;
  let p = { x: pos.x, z: pos.z };
  while (remaining > 0 && legs.length > 0) {
    const t = legs[0];
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    if (d <= remaining) { p = { x: t.x, z: t.z }; remaining -= d; legs.shift(); continue; }
    p = { x: p.x + (dx / d) * remaining, z: p.z + (dz / d) * remaining };
    remaining = 0;
  }
  const next = legs[0];
  return { pos: p, yaw: next ? headingFor(next.x - p.x, next.z - p.z) : null, arrived: legs.length === 0 };
}
