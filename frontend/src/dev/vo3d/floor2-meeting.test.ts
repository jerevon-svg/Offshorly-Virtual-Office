// vo3d — THE MEETING FLOOR, held to what it claims: separate glass rooms with stable ids, every door, seat
// and display reachable from the lift, private-meeting access that can never trap anybody, and floor
// travel that never reads as Away.
import { describe, expect, it } from "vitest";
import { ELEVATOR, FLOOR_RECT, ORIGIN, floor2StandTest } from "./rooms/floor2";
import {
  COMMONS, DOOR_W, GLASS_RUNS, ISLAND, MEETING_ROOMS, PLATE_ORIGIN, ZONES, meetingFloorEntities, meetingRoom, meetingRoomAt,
} from "./rooms/floor2Meeting";
import { MeetingRoomAccess } from "./app/meetingRoomAccess";
import { makePlateRouter } from "./nav/plateRoute";
import { NAV_RADIUS } from "./nav/clearance";
import type { Rect, Vec2 } from "./core/coords";

const stand = (p: Vec2): boolean => floor2StandTest(p, NAV_RADIUS);
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, w: r.w + 2 * m, d: r.d + 2 * m });
const router = makePlateRouter(FLOOR_RECT, stand);
const reachable = (to: Vec2, from: Vec2 = ELEVATOR.boarding): boolean => router.route(from, to) !== null;
const entities = meetingFloorEntities();

describe("Meeting Floor — identity and mix", () => {
  it("sits on floor 2's own plate", () => expect(PLATE_ORIGIN).toEqual(ORIGIN));
  it("gives every room a stable, unique id and its own meeting id", () => {
    const ids = MEETING_ROOMS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of MEETING_ROOMS) {
      expect(r.id).toMatch(/^floor-2\/[a-z]+$/);
      expect(r.meetingId).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/); // the backend's _MEETING_ID rule
    }
    expect(meetingRoom("floor-2/hotel")?.kind).toBe("boardroom");
  });
  it("mixes huddle, standard, large, board, project and lounge rooms", () => {
    const kinds = new Set(MEETING_ROOMS.map((r) => r.kind));
    for (const k of ["huddle", "standard", "large", "boardroom", "project", "lounge"]) expect(kinds.has(k as never), k).toBe(true);
  });
  it("seats every room to its capacity, every seat a REAL seat entity", () => {
    for (const r of MEETING_ROOMS) {
      const seats = entities.filter((e) => e.roomId === r.id).reduce((n, e) => n + (e.capabilities.seat ? 1 : e.capabilities.lounge?.slots.length ?? 0), 0);
      // at least its capacity: the boardroom adds a two-seat side lounge beyond its fourteen at the table
      expect(seats, r.id).toBeGreaterThanOrEqual(r.capacity);
      expect(r.seats.length || seats, r.id).toBe(r.kind === "lounge" ? seats : r.capacity);
    }
  });
});

describe("Meeting Floor — architecture", () => {
  it("keeps every room a separate volume: no two rooms touch, none sits in a street or on the lift", () => {
    for (const r of MEETING_ROOMS) {
      for (const o of MEETING_ROOMS) if (o !== r) expect(overlaps(grow(r.rect, 19), o.rect), `${r.id} vs ${o.id}`).toBe(false);
      for (const [name, z] of Object.entries(ZONES)) if (name !== "commons") expect(overlaps(r.interior, z), `${r.id} in ${name}`).toBe(false);
      expect(overlaps(r.rect, ELEVATOR.outer)).toBe(false);
    }
  });
  it("cuts exactly one door per room, wide enough for two bodies", () => {
    for (const r of MEETING_ROOMS) {
      expect(GLASS_RUNS.filter((g) => g.door && g.roomId === r.id), r.id).toHaveLength(1);
      expect(r.door.to - r.door.from).toBe(DOOR_W);
      expect(stand(r.door.centre), r.id).toBe(true);
    }
  });
});

describe("Meeting Floor — circulation, seating, displays", () => {
  it("keeps the arrival axis clear from the lift to the island, and from the island to the boardroom door", () => {
    const summit = meetingRoom("floor-2/hotel")!;
    expect(summit.door.centre.z).toBe(ELEVATOR.boarding.z);
    for (let x = ELEVATOR.boarding.x; x <= summit.approach.x; x += 8) {
      if (Math.abs(x - ISLAND.c.x) < ISLAND.benchOut + NAV_RADIUS) continue; // the axis parts round the island
      expect(stand({ x, z: ELEVATOR.boarding.z }), `x ${x}`).toBe(true);
    }
    expect(reachable(summit.approach)).toBe(true);
  });
  it("routes from the lift to every door and in, and every waiting spot is standable", () => {
    for (const r of MEETING_ROOMS) {
      expect(reachable(r.approach), `${r.id} door`).toBe(true);
      expect(reachable(r.entry, r.approach), `${r.id} entry`).toBe(true);
      expect(meetingRoomAt(r.entry)?.id).toBe(r.id);
      for (const g of r.gather) expect(stand(g), `${r.id} gather`).toBe(true);
    }
    for (const p of [COMMONS.arrival, ...COMMONS.gather]) expect(stand(p), `${p.x},${p.z}`).toBe(true);
  });
  it("can walk up to EVERY seat and every display from the lift", () => {
    for (const e of entities) {
      const points = [
        ...(e.capabilities.seat ? [e.capabilities.seat.approach] : []),
        ...(e.capabilities.lounge?.slots.map((s) => s.approach) ?? []),
        ...(e.capabilities.approach ? [e.capabilities.approach.point] : []),
      ];
      for (const p of points) {
        expect(stand(p), `${e.id} stand ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBe(true);
        expect(reachable(p), `${e.id} reach`).toBe(true);
      }
    }
  });
  it("refuses a destination inside a table", () => {
    const t = MEETING_ROOMS[0].table.rect;
    expect(router.route(ELEVATOR.boarding, { x: t.x + t.w / 2, z: t.z + t.d / 2 })).toBeNull();
  });
});

describe("Meeting Floor — private meetings shut the door, never trap anybody", () => {
  it("is available everywhere until a meeting system says otherwise", () => {
    const a = new MeetingRoomAccess();
    for (const r of MEETING_ROOMS) expect(a.refuses(r.id)).toBe(false);
  });
  it("shuts an active room's doorway to an outsider, opens it to an occupant, lets a participant in", () => {
    const a = new MeetingRoomAccess();
    const r = MEETING_ROOMS.find((x) => x.id === "floor-2/juliett")!;
    a.set(r.id, "active");
    const r1 = makePlateRouter(FLOOR_RECT, stand);
    a.apply(r.approach); // outside
    expect(stand(r.door.centre)).toBe(false);
    expect(a.routeRefused(r.approach, r.entry)).toBe(r.id);
    a.apply(r.entry); // an occupant
    expect(stand(r.door.centre)).toBe(true);
    r1.invalidate();
    expect(r1.route(r.entry, ELEVATOR.boarding)).not.toBeNull();
    a.set(r.id, "active", { selfAuthorized: true });
    a.apply(r.approach);
    expect(stand(r.door.centre)).toBe(true);
    expect(a.routeRefused(r.approach, r.entry)).toBeNull();
    a.set(r.id, "available");
    a.apply(r.approach);
    expect(stand(r.door.centre)).toBe(true);
  });
});

describe("Meeting Floor — presence", () => {
  it("reads every normal floor and the lift as INSIDE the office, never as outside/Away", async () => {
    const { presenceZoneAt, zoneAt } = await import("./app/access");
    const { inCabin, CABIN } = await import("./rooms/elevator");
    const { onFloor2 } = await import("./rooms/floor2");
    const g = { frame: { x: 0, z: 0, w: 1440, d: 1244 }, facadeZ: 1120, gateZ: 890, receptionRect: { x: 332, z: 860, w: 400, d: 300 } };
    const upper = (p: Vec2): boolean => onFloor2(p) || inCabin(p);
    for (const p of [COMMONS.arrival, MEETING_ROOMS[0].entry, ELEVATOR.mark, CABIN.mark]) {
      expect(zoneAt(p, g as never)).toBe("outside");
      expect(presenceZoneAt(p, g as never, upper)).toBe("office");
    }
    expect(presenceZoneAt({ x: 200, z: 1200 }, g as never, upper)).toBe("outside");
  });
});
