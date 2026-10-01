// Directed Meeting — the pure controller (app/meetingDirector.ts) over a fake port, plus the world.ts wiring
// no unit test can reach (createVo3dWorld needs WebGL), pinned by source like world.goTogetherWiring.test.ts.
import { describe, expect, it } from "vitest";
import src from "./app/world.ts?raw";
import { anchorForSeatKey, v2SeatKey } from "./adapters/v1Seats";
import { MAX_SEAT_ATTEMPTS, MeetingDirector, PRESENTER_TURN, presenterSpot, type DirectedBody, type DirectedSeat, type MeetingDirectorPort } from "./app/meetingDirector";

const ROOM = "floor-2/bravo";
const SEATS: DirectedSeat[] = [
  { anchor: `${ROOM}/chair-0`, pos: { x: 10, z: 0 }, kind: "chair" },
  { anchor: `${ROOM}/chair-1`, pos: { x: 20, z: 0 }, kind: "chair" },
  { anchor: `${ROOM}/chair-2`, pos: { x: 30, z: 0 }, kind: "chair" },
];
const STAGE = { point: { x: 0, z: 50 }, yaw: 1.2 };

/** A world that does what it is told at once: sit → walking to the seat until `arrive()`. */
function rig(opts: { seats?: DirectedSeat[]; room?: string | null } = {}) {
  const log: string[] = [];
  const s = {
    meeting: null as { roomId: string; presenting: boolean } | null,
    body: { pos: { x: 0, z: 0 }, room: opts.room === undefined ? ROOM : opts.room, seat: null, seated: false, seatBusy: false, moving: false, travelling: false } as DirectedBody,
    occupied: new Set<string>(),
    directed: false,
    refuse: new Set<string>(),
    faced: null as number | null,
  };
  const port: MeetingDirectorPort = {
    meeting: () => s.meeting,
    body: () => ({ ...s.body }),
    seats: () => opts.seats ?? SEATS,
    occupied: () => s.occupied,
    sit: (a) => { log.push(`sit ${a}`); if (s.refuse.has(a)) return false; s.body = { ...s.body, seat: a, seatBusy: true, seated: false }; return true; },
    leaveSeat: () => {
      log.push("leaveSeat");
      if (s.body.seatBusy && !s.body.seated) s.body = { ...s.body, seat: null, seatBusy: false };
      else if (s.body.seated) s.body = { ...s.body, seated: false }; // standing sequence under way
    },
    stage: () => STAGE,
    walkTo: (p) => { log.push(`walk ${p.x},${p.z}`); s.body = { ...s.body, moving: true }; return true; },
    stopWalk: () => { if (s.body.moving) log.push("stopWalk"); s.body = { ...s.body, moving: false }; },
    face: (y) => { s.faced = y; log.push(`face ${y}`); },
    setDirected: (on) => { s.directed = on; log.push(`directed ${on}`); },
  };
  const d = new MeetingDirector(port, "");
  const arrive = () => { s.body = { ...s.body, seated: true, seatBusy: true, pos: SEATS.find((x) => x.anchor === s.body.seat)?.pos ?? s.body.pos }; };
  const stoodUp = () => { s.body = { ...s.body, seat: null, seated: false, seatBusy: false }; };
  return { s, d, log, arrive, stoodUp };
}

describe("Directed Meeting — activation", () => {
  it("being in the room is not enough: no meeting, no direction", () => {
    const { s, d, log } = rig();
    for (let i = 0; i < 3; i++) d.tick();
    expect(s.directed).toBe(false);
    expect(log).toEqual([]);
  });

  it("connected and at the room's own doorway spot (where Walk There ends): directed in", () => {
    const { s, d } = rig({ room: null });
    s.body.atDoor = ROOM;
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(s.directed).toBe(true);
  });

  it("connected to the room's meeting but standing elsewhere (or mid-journey): still ordinary control", () => {
    const { s, d } = rig({ room: null });
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(s.directed).toBe(false);
    s.body.room = ROOM;
    s.body.travelling = true;
    d.tick();
    expect(s.directed).toBe(false);
  });

  it("joining the meeting inside the room takes locomotion and walks to the nearest free chair", () => {
    const { s, d, log } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(s.directed).toBe(true);
    expect(log).toContain(`sit ${ROOM}/chair-0`);
    expect(d.state.phase).toBe("seating");
  });

  it("a person already sitting keeps their chair", () => {
    const { s, d, log } = rig();
    s.body = { ...s.body, seat: `${ROOM}/chair-2`, seated: true, seatBusy: true };
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(d.state.phase).toBe("seated");
    expect(log.some((l) => l.startsWith("sit"))).toBe(false);
  });

  it("different people spread over the few nearest chairs", () => {
    const picks = new Set<string>();
    for (const key of ["alex@x", "bon@x", "jan@x", "micah@x", "angelo@x"]) {
      const d = new MeetingDirector({ seats: () => SEATS } as unknown as MeetingDirectorPort, key);
      (d as unknown as { room: string }).room = ROOM;
      picks.add(d.choose({ x: 0, z: 0 }, new Set())!);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("Directed Meeting — seat races", () => {
  it("a chair taken by somebody else on the way is dropped where the body stands, and another chosen", () => {
    const { s, d, log } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    s.occupied.add(`${ROOM}/chair-0`);
    d.tick(); // lose it
    d.tick(); // choose again
    expect(log).toContain("leaveSeat");
    expect(log).toContain(`sit ${ROOM}/chair-1`);
  });

  it("the server's rejection (stood back up) retries another seat, and the bound ends in standing", () => {
    const { s, d, log, arrive, stoodUp } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    for (let i = 0; i < MAX_SEAT_ATTEMPTS + 3; i++) {
      d.tick();
      if (s.body.seatBusy && !s.body.seated) { arrive(); d.tick(); stoodUp(); }
    }
    expect(log.filter((l) => l.startsWith("sit")).length).toBeLessThanOrEqual(MAX_SEAT_ATTEMPTS);
    expect(d.state.phase).toBe("standing");
    expect(s.directed).toBe(true); // still in the meeting, just standing
  });

  it("no free seat: stands naturally, never loops", () => {
    const { s, d, log } = rig();
    SEATS.forEach((x) => s.occupied.add(x.anchor));
    s.meeting = { roomId: ROOM, presenting: false };
    for (let i = 0; i < 10; i++) d.tick();
    expect(d.state.phase).toBe("standing");
    expect(log.filter((l) => l.startsWith("sit"))).toEqual([]);
  });

  it("refused sits count against the bound", () => {
    const { s, d, log } = rig();
    SEATS.forEach((x) => s.refuse.add(x.anchor));
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(log.filter((l) => l.startsWith("sit")).length).toBe(3);
    expect(d.state.phase).toBe("standing");
  });
});

describe("Directed Meeting — presenting", () => {
  it("share → stand → walk beside the TV → face the room; stop → back to the same chair", () => {
    const { s, d, log, arrive, stoodUp } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick(); arrive(); d.tick();
    expect(d.state.phase).toBe("seated");
    s.meeting = { roomId: ROOM, presenting: true };
    d.tick();
    expect(log).toContain("leaveSeat");
    stoodUp();
    d.tick();
    expect(log).toContain("walk 0,50");
    expect(d.state.phase).toBe("to_stage");
    s.body = { ...s.body, moving: false, pos: STAGE.point };
    d.tick();
    expect(s.faced).toBe(STAGE.yaw);
    expect(d.state.phase).toBe("presenting");
    d.tick();
    expect(d.state.phase).toBe("presenting");
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(log[log.length - 1]).toBe(`sit ${ROOM}/chair-0`);
  });

  it("sharing on arrival goes straight to the presenter spot", () => {
    const { s, d, log } = rig();
    s.meeting = { roomId: ROOM, presenting: true };
    d.tick();
    expect(log).toContain("walk 0,50");
  });
});

describe("Directed Meeting — release", () => {
  it("leaving the meeting hands the body back where it is and never walks it anywhere", () => {
    const { s, d, log } = rig();
    s.meeting = { roomId: ROOM, presenting: true };
    d.tick();
    s.meeting = null;
    d.tick();
    expect(s.directed).toBe(false);
    expect(log).toContain("stopWalk");
    const n = log.length;
    for (let i = 0; i < 5; i++) d.tick();
    expect(log.length).toBe(n);
  });

  it("PHYSICAL: a body that is no longer in the room (teleported elsewhere) is released, never walked back", () => {
    const { s, d, log } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(s.directed).toBe(true);
    s.body = { ...s.body, moving: false, seat: null, seated: false, seatBusy: false, room: "floor-2/alpha" };
    const n = log.filter((l) => l.startsWith("walk") || l.startsWith("sit")).length;
    for (let i = 0; i < 5; i++) d.tick();
    expect(s.directed).toBe(false);
    expect(log.filter((l) => l.startsWith("walk") || l.startsWith("sit")).length).toBe(n);
  });

  it("Esc / a click suspends for this meeting — no reacquisition loop — until the share state changes", () => {
    const { s, d } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(d.userTookOver()).toBe(true);
    for (let i = 0; i < 5; i++) d.tick();
    expect(s.directed).toBe(false);
    s.meeting = { roomId: ROOM, presenting: true };
    d.tick();
    expect(s.directed).toBe(true);
  });

  it("a suspension ends with the meeting: rejoining directs again", () => {
    const { s, d } = rig();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    d.userTookOver();
    s.meeting = null;
    d.tick();
    s.meeting = { roomId: ROOM, presenting: false };
    d.tick();
    expect(s.directed).toBe(true);
  });
});

describe("presenterSpot", () => {
  it("stands beside a south-facing screen, in front of it, facing the table", () => {
    const spot = presenterSpot({ x: 100, z: 0, facing: "south", w: 40 }, { x: 100, z: 80 }, { x: 60, z: 40 }, () => true)!;
    expect(spot.point.z).toBeGreaterThan(0);
    expect(Math.abs(spot.point.x - 100)).toBeGreaterThan(20); // clear of the screen's end
    expect(spot.point.x).toBeLessThan(100); // the nearer side
    // 3/4: turned from the table toward the screen by the stance angle, never facing the screen
    const toTable = Math.atan2(100 - spot.point.x, 80 - spot.point.z);
    const toScreen = Math.atan2(100 - spot.point.x, 0 - spot.point.z);
    const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(off(spot.yaw, toTable)).toBeCloseTo(PRESENTER_TURN);
    expect(off(spot.yaw, toScreen)).toBeGreaterThan(off(spot.yaw, toTable));
  });
  it("uses the other side when the near one is blocked, and null when nothing is standable", () => {
    const spot = presenterSpot({ x: 100, z: 0, facing: "south", w: 40 }, { x: 100, z: 80 }, { x: 60, z: 40 }, (p) => p.x > 100)!;
    expect(spot.point.x).toBeGreaterThan(100);
    expect(presenterSpot({ x: 0, z: 0, facing: "east", w: 40 }, { x: 50, z: 0 }, { x: 0, z: 0 }, () => false)).toBeNull();
  });
});

describe("app/world.ts — Directed Meeting wiring", () => {
  it("participation is the room's own live call, and presenting is this client's real screen share", () => {
    expect(src).toContain('if (st.status !== "connected" || st.kind !== "meeting") return null;');
    expect(src).toContain("return r ? { roomId: r.id, presenting: st.sharing } : null;");
  });
  it("the meeting and a journey share the Guided base without a second owner", () => {
    expect(src).toContain("const on = guidedHolds.travel || guidedHolds.meeting;");
    expect(src).toContain("return guidedHolds.travel ? GUIDED_JOURNEY_BOOM : 1;");
  });
  it("E does not stand a directed body up; Esc and clicks hand the body back", () => {
    expect(src).toContain("canStandUp: () => !guidedHolds.meeting && engagedSeat() !== null,");
    expect(src).toContain("else if (guidedHolds.meeting) meetingDirector.userTookOver();");
    expect(src).toContain("if (p) { userTookBody(); walkToGround(p.x, p.z); }");
  });
  it("a seat_rejected that lands mid-sit is not lost: the stand happens once the sit completes", () => {
    expect(src).toContain("standUp: () => { const e = engagedSeat(); if (e) e.stand(); else if (seatEngaged()) standWhenSeated = true; },");
    expect(src).toContain("if (e) { e.stand(); standWhenSeated = false; } else if (!seatEngaged()) standWhenSeated = false;");
  });
  it("the feed's upstairs sit reaches the V1 sink (the world's wrapper forwards satInPlace)", () => {
    expect(src).toContain("selfMovement.satInPlace!(toV1Frame(anchor), at, yaw, room, seat)");
  });
});

describe("Meeting Floor seats on the wire", () => {
  it("a v2 key naming a Meeting Floor chair resolves — peers draw the sitter IN the chair, occupancy sees it", () => {
    expect(anchorForSeatKey(v2SeatKey("floor-2/charlie/chair-0"))?.id).toBe("floor-2/charlie/chair-0");
    expect(anchorForSeatKey(v2SeatKey("floor-2/nowhere/chair-0"))).toBeNull();
  });
});

describe("SelfMovementFeed — a sit upstairs is published as SITTING in place", () => {
  it("seated() on the Meeting Floor goes out as satInPlace (never a refused V1 walk); standing resumes local legs", async () => {
    const { SelfMovementFeed } = await import("./app/selfMovement");
    const calls: string[] = [];
    const sink = {
      started: () => calls.push("started"),
      arrived: () => calls.push("arrived"),
      enteredPlace: (_a: unknown, _y: number, room: string | null) => calls.push(`entered ${room}`),
      movedInPlace: () => calls.push("moved"),
      satInPlace: (_a: unknown, at: { x: number }, _y: number, room: string, seat: string) => calls.push(`sat ${room} ${seat} ${at.x}`),
      state: { started: 0, arrived: 0, refused: 0, wire: [] as string[] },
    };
    const feed = new SelfMovementFeed(sink, (p) => p.x < 3000);
    feed.frame(16, { x: 100, z: 100 }, 0, false); // first frame: placement
    feed.entering("floor-2");
    feed.boardedLift({ x: 100, z: 100 });
    feed.alightedLift({ x: 6100, z: 600 }, 0);
    feed.seated({ x: 6700, z: 150 }, 0, "floor-2/charlie/chair-0");
    expect(calls).toContain("sat floor-2 floor-2/charlie/chair-0 6700");
    expect(calls.slice(calls.indexOf("entered floor-2") + 1)).toEqual(["sat floor-2 floor-2/charlie/chair-0 6700"]);
    feed.stood({ x: 6700, z: 150 }, 0);
    feed.frame(16, { x: 6740, z: 150 }, 0, false);
    expect(calls[calls.length - 1]).toBe("moved");
  });
});

describe("Phase 4 fixes — presenter facing publish, invite room, Cave floor", () => {
  it("faced() upstairs publishes the exact final point and yaw as an in-place leg", async () => {
    const { SelfMovementFeed } = await import("./app/selfMovement");
    const moved: { to: { x: number; z: number }; yaw: number }[] = [];
    const sink = {
      started: () => {}, arrived: () => {}, enteredPlace: () => {},
      movedInPlace: (_a: unknown, _f: unknown, to: readonly { x: number; z: number }[], yaw: number) => { moved.push({ to: to[0], yaw }); },
      state: { started: 0, arrived: 0, refused: 0, wire: [] as string[] },
    };
    const feed = new SelfMovementFeed(sink, (p) => p.x < 3000);
    feed.frame(16, { x: 100, z: 100 }, 0, false);
    feed.entering("floor-2");
    feed.boardedLift({ x: 100, z: 100 });
    feed.alightedLift({ x: 6100, z: 600 }, 0);
    feed.faced({ x: 6762, z: 42 }, -0.9);
    expect(moved[moved.length - 1].to).toEqual({ x: 6762, z: 42 });
    expect(moved[moved.length - 1].yaw).toBeCloseTo(-0.9);
  });
  it("world: the presenter's turn is published, accepting an invite follows its meeting id, the Cave is entered from the ground floor", () => {
    expect(src).toContain("selfFeed?.faced({ x: bp.x, z: bp.z }, avatar.yaw);");
    expect(src).toContain("const room = MEETING_ROOMS.find((r) => r.meetingId === meetingId);");
    expect(src).toContain("if (currentFloor !== GROUND_FLOOR_ID && !floorTransition?.restoreOn(GROUND_FLOOR_ID)) return false;");
    expect(src).toContain("if (leaveCaveForJourney()) return false;");
    // Go Together reads where the body REALLY is: a seated body's avatar.position is chair-local
    expect(src).toContain("pos: avatarWorldXZ(),");
    expect(src).toContain("meetingRoomAt(avatarWorldXZ())?.id ?? null");
    expect(src).toContain('if (params.cameraMode !== "player") { const walkThere = meetingWalk; setCameraMode("player"); meetingWalk = walkThere; }');
  });
});

describe("Teleport + End meeting seams", () => {
  it("feed.teleported: from the ground floor to a Meeting Floor room is ONE named-place snap, never a walk", async () => {
    const { SelfMovementFeed } = await import("./app/selfMovement");
    const calls: string[] = [];
    const sink = {
      started: () => calls.push("started"), arrived: () => calls.push("arrived"),
      enteredPlace: (_a: unknown, _y: number, room: string | null, local?: { x: number }) => calls.push(`entered ${room} ${local?.x}`),
      movedInPlace: () => calls.push("moved"),
      state: { started: 0, arrived: 0, refused: 0, wire: [] as string[] },
    };
    const feed = new SelfMovementFeed(sink, (p) => p.x < 3000);
    feed.frame(16, { x: 700, z: 470 }, 0, false);
    feed.entering("floor-2");
    feed.teleported({ x: 6190, z: 470 }, 1);
    expect(calls).toEqual(["entered floor-2 6190"]);
    feed.frame(16, { x: 6190, z: 470 }, 1, false); // the next frame publishes nothing more
    expect(calls).toEqual(["entered floor-2 6190"]);
  });
  it("world: teleport ends every travel continuation, places on the floor without a ride, and publishes the snap", () => {
    const body = src.slice(src.indexOf("function teleportToMeetingRoom("), src.indexOf("function activateInteractable("));
    expect(body).toContain("if (guidedHolds.travel) cancelGuidedTravel();");
    expect(body).toContain("pendingFloor = null; pendingLift = null; meetingWalk = null;");
    expect(body).toContain("floorTransition?.restoreOn(FLOOR2_ID)");
    expect(body).toContain("selfFeed?.teleported(spot, yaw);");
    expect(src).toContain("coworkers.within(p, 22).length === 0");
    // accepting an invitation JOINS; it no longer walks anybody anywhere
    const accept = src.slice(src.indexOf("acceptInvite: async"), src.indexOf("end: () => { caveLiveShare.endForEveryone(); },"));
    expect(accept).not.toContain("walkToMeetingRoom(");
    // PHYSICAL MEETINGS: accepting a room's meeting records the intent and joins no call until arrival
    const roomBranch = accept.slice(accept.indexOf("INTENT — and nothing else"));
    expect(roomBranch).not.toContain("startMeeting(");
    expect(roomBranch).toContain("meetingArrival.intend(");
  });
});
