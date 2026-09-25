// FILM RIG ONLY — the shot list. Each shot has:
//   stage(ctx)  establish local state and leave the product READY TO RECORD (nothing moving yet)
//   verify(ctx) read the real state back and say whether the shot is ready (true/false)
//   go(ctx)     optional: perform the live action — the part the recorder captures
//
// Everything goes through the real product: __vo3d (the production entry points it exposes), real
// keyboard/mouse input, real HUD clicks, real REST calls and real socket events on the film rig.
// World coordinates below are V2 world units (the same numbers __vo3d reports).

const BON = "jerevon@offshorly.com";
const GATE_FRONT = { x: 728, z: 936 };      // Reception side of the speed gates, in front of the lanes
// INSIDE the wide middle lane's detection volume (rooms/reception.ts laneZone(1): x 698–758, z 806–924),
// just south of the gate band (z 832–912) — the lane sensors light red for a checked-out body here.
// (z 936 is the pass-by row that deliberately stays blue.)
const GATE_SENSOR = { x: 728, z: 918 };
// the Reception floor just inside the entrance, well clear of every sensor — where the opening take starts
const RECEPTION_START = { x: 728, z: 1060 };
const PAST_GATES = { x: 728, z: 760 };      // concourse just north of the gates
const CONCOURSE = { x: 560, z: 790 };       // south concourse between the Hub and the gates
// inside the Meeting Room, facing the lift (west). z 934 is the line whose walk passes no chair prompt and
// on which the call plate becomes the Player target at x ≈ 109 (probed with the real targeting).
const ELEVATOR_APPROACH = { x: 300, z: 934 };
// where the cast gathers for the social shots — the open south concourse below the Central Hub.
// (Open floor, from the Player stand map: west lane x 330–470, north concourse z 330–430, south
// concourse z 740–820 between the Hub (x 470–990, z 430–710) and the gate line at z ≈ 840.)
// the 3D reveal's orbit drag (screen px) and wheel zoom — tune by eye; small dy keeps the camera high
const ORBIT = { dx: 320, dy: 40, zoomSteps: 8 };
const TEAM = {
  alex: { x: 720, z: 780 }, jan: { x: 775, z: 800 }, micah: { x: 830, z: 780 }, angelo: { x: 765, z: 752 },
};

// ---------------------------------------------------------------------------------------------- helpers
const v1 = (p) => ({ x: p.x - 10, y: p.z - 17.2 }); // V2 world → V1 wire frame (outside the shifted Design Room)

async function state(ctx) {
  return ctx.vo(() => ({
    access: __vo3d.access.state().access, mode: __vo3d.cameraModes.mode,
    pos: __vo3d.selfMovement.position(),
  }));
}

/** Close whatever panel/dialog is open, the way a person would: its own close button. */
async function closePanels(ctx) {
  // the command-palette style surfaces (Search) close on Escape only — a real key press, as a person would
  for (let i = 0; i < 2; i++) { await ctx.page.keyboard.press("Escape"); await ctx.sleep(150); }
  for (let i = 0; i < 6; i++) {
    const hit = await ctx.vo(() => {
      const on = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; };
      const b = [...document.querySelectorAll("button,[role=menuitem]")].filter(on).find((e) =>
        /^(close\b.*|enter office)$/i.test((e.getAttribute("aria-label") ?? "").trim())
        || /^close$/i.test((e.textContent ?? "").trim()));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!hit) break;
    await ctx.page.mouse.click(hit.x, hit.y);
    await ctx.sleep(350);
  }
  await ctx.page.mouse.move(1919, 1079);
}

/** The nav path line + destination ring (NavDebug, on by default) through the existing hidden dev panel. */
async function hidePathOverlay(ctx) {
  await ctx.vo(() => {
    for (const row of document.querySelectorAll(".lil-controller, .controller")) {
      const name = row.querySelector(".lil-name, .name")?.textContent?.trim();
      if (name !== "show path" && name !== "show destination") continue;
      const box = row.querySelector("input[type=checkbox]");
      if (box && box.checked) { box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); box.dispatchEvent(new Event("input", { bubbles: true })); }
    }
  });
}

async function reloadBon(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.until(() => !!window.__vo3d?.selfMovement, { timeout: 60000, label: "the 3D office" });
  await ctx.sleep(2500);
  await hidePathOverlay(ctx);
  await ctx.page.mouse.move(1919, 1079);
}

/** Server-side attendance for Bon through the real API, then a reload so the page reads it fresh. */
async function attendance(ctx, want) {
  const me = await ctx.api(BON, "GET", "/attendance/me");
  const isIn = me?.status === "CHECKED_IN";
  if (want === "in" && !isIn) await ctx.api(BON, "POST", "/attendance/check-in");
  if (want === "out" && isIn) await ctx.api(BON, "POST", "/attendance/check-out");
  if ((want === "in") !== isIn || (await ctx.vo(() => __vo3d.access.state().access)) !== (want === "in" ? "permitted" : "denied")) {
    await reloadBon(ctx);
    await ctx.until((w) => __vo3d.access.state().access === w, { arg: want === "in" ? "permitted" : "denied", label: `access ${want}` });
  }
  await closePanels(ctx);
}

/** Cycle the REAL C key until the wanted view is showing. */
async function view(ctx, want) {
  for (let i = 0; i < 4; i++) {
    const mode = await ctx.vo(() => __vo3d.cameraModes.mode);
    if (mode === want) return;
    await ctx.page.keyboard.press("KeyC");
    await ctx.sleep(700);
  }
  throw new Error(`could not reach ${want} view`);
}

/** Bon to a spot: a planned walk (office/3D) or a PlayerMode placement (player). Staging only. */
async function placeBon(ctx, p, face) {
  const mode = await ctx.vo(() => __vo3d.cameraModes.mode);
  if (mode === "player") {
    await ctx.vo(({ p, face }) => { __vo3d.player.teleport(p.x, p.z); if (face) __vo3d.cave.look(face.x, face.z); }, { p, face });
  } else {
    const here = await ctx.vo(() => __vo3d.selfMovement.position());
    if (Math.hypot(here.x - p.x, here.z - p.z) > 12) {
      const r = await ctx.vo((p) => __vo3d.selfMovement.walkTo(p.x, p.z), p);
      if (!r?.ok) throw new Error(`Bon cannot walk to ${p.x},${p.z}: ${r?.reason}`);
      await ctx.until((p) => { const q = __vo3d.selfMovement.position(); return Math.hypot(q.x - p.x, q.z - p.z) < 14 && __vo3d.selfMovement.clip().startsWith("idle"); }, { arg: p, timeout: 30000, label: "Bon arriving" });
    }
  }
}

/** A puppet to a spot along the product's own V1 pathfinder (computed in Bon's page), then wait. */
async function walkPuppet(ctx, k, to, { instant = false, speed, yaw } = {}) {
  const target = v1(to);
  if (instant || !ctx.puppets.at.get(k)) return ctx.puppets.place(k, target, { yaw });
  const from = ctx.puppets.at.get(k);
  const path = await ctx.vo(async ({ from, target }) => {
    const pf = await import("/virtual-office/src/data/officePathfinding.ts");
    return pf.findPath(from, target);
  }, { from, target });
  return ctx.puppets.walk(k, path, { speed, yaw });
}

async function gatherTeam(ctx, spots = TEAM, instant = true) {
  await Promise.all(Object.entries(spots).map(([k, p]) => walkPuppet(ctx, k, p, { instant })));
  await ctx.sleep(600);
}

async function coworkersAt(ctx, spots) {
  const pos = await ctx.vo(() => __vo3d.coworkers.positions());
  return Object.entries(spots).every(([k, p]) => {
    const c = pos.find((c) => c.name.toLowerCase() === k);
    return c && Math.hypot(c.x - p.x, c.z - p.z) < 30;
  });
}

async function dock(ctx, label) {
  await closePanels(ctx);
  // Notifications' dock label carries its count too ("Notifications" / "Notifications (2 unread)")
  if (label === "Notifications") {
    label = (await ctx.vo(() => [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "").find((a) => /^Notifications( \(\d+ unread\))?$/.test(a)))) ?? label;
  }
  // Chat's dock label carries its unread count ("Conversations" / "6 unread messages")
  if (label === "Conversations") {
    const l = await ctx.vo(() => [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "").find((a) => a === "Conversations" || /unread message/.test(a) && !/ from /.test(a)));
    label = l ?? label;
  }
  await ctx.click(label);
  await ctx.sleep(900);
}

/** Bon's DM with a coworker (type "dm"), from the real conversation list. */
async function dmWith(ctx, email) {
  const convs = await ctx.api(BON, "GET", "/conversations");
  return convs.find((c) => c.type === "dm" && c.participantIds.includes(email))?.id ?? null;
}

/** Bon has read his chats (the real POST /conversations/{id}/read), so no stale unread glow is on screen. */
async function readAll(ctx) {
  const convs = await ctx.api(BON, "GET", "/conversations");
  for (const c of convs) await ctx.api(BON, "POST", `/conversations/${c.id}/read`).catch(() => {});
}

/** If a previous Elevator take left Bon upstairs, ride back down the real way: the Floor 2 call plate + E. */
async function backToGround(ctx) {
  const up = await ctx.vo(() => __vo3d.player.position().x > 3000 || __vo3d.selfMovement.position().x > 3000);
  if (!up) return;
  await view(ctx, "player");
  // the same pose that targets the ground-floor plate (x ≈ 104 on its z 934 line, facing west), 6000 east
  const at = await ctx.vo(() => { const e = __vo3d.world.get("elevator-2/call"); return { x: e.capabilities.approach.point.x - 4, z: 934 }; });
  await ctx.vo((at) => { __vo3d.player.teleport(at.x + 30, at.z); __vo3d.cave.look(-1, 0); }, at);
  await ctx.page.keyboard.down("KeyW");
  await until(ctx, () => __vo3d.player.target() === "Call the elevator", "the Floor 2 call plate", undefined, 8000).finally(() => ctx.page.keyboard.up("KeyW"));
  await ctx.sleep(300);
  await ctx.vo(() => __vo3d.player.interact());                       // PlayerMode's own E handler (off camera)
  const end = Date.now() + 45000;
  let seen = false;
  while (Date.now() < end) {
    const ph = await liftPhase(ctx);
    if (ph === "arriving") seen = true;
    if (seen && ph === "idle") break;
    await ctx.sleep(200);
  }
  await ctx.sleep(800);
}

/** Office baseline every UI shot starts from: checked in, Office view, Bon on the concourse, team out. */
/** End whatever a previous take left running: Bon's call (his own Leave button) and every spatial session. */
async function endSocial(ctx) {
  await ctx.click("Leave call").catch(() => {});
  for (const k of ["alex", "angelo", "micah", "jan"]) ctx.puppets.emit(k, "spatial_session_leave", {});
  await ctx.sleep(300);
}

async function officeBaseline(ctx, { bonAt = CONCOURSE, read = true } = {}) {
  await endSocial(ctx);
  await ctx.click("Dismiss the toucan").catch(() => {});                // a previous Toucan take leaves its panel open
  if (read) await readAll(ctx);
  await attendance(ctx, "in");
  if (await ctx.vo(() => __vo3d.cave.inside())) {                      // a Cave take leaves Bon in the Cave
    await ctx.vo(() => __vo3d.cave.exit());
    await ctx.until(() => !__vo3d.cave.inside(), { timeout: 20000, label: "out of the Cave" });
    await ctx.sleep(1500);
  }
  await backToGround(ctx);
  await view(ctx, "office");
  await closePanels(ctx);
  await placeBon(ctx, bonAt);
  await gatherTeam(ctx);
}

/** A live read-only row of the hidden dev panel, by its label (e.g. the lift's "phase"). */
function guiValue(ctx, name) {
  return ctx.vo((name) => {
    for (const row of document.querySelectorAll(".lil-controller, .controller")) {
      if (row.querySelector(".lil-name, .name")?.textContent?.trim() !== name) continue;
      const input = row.querySelector("input");
      return input ? (input.type === "checkbox" ? String(input.checked) : input.value) : row.querySelector(".lil-widget, .widget")?.textContent?.trim() ?? null;
    }
    return null;
  }, name);
}
const liftPhase = (ctx) => guiValue(ctx, "phase");

/** Frame part of the office with the product's own camera focus (the move it makes when you select someone). */
const TEAM_FRAME = { x: 560, z: 690, w: 420, d: 180 };
async function frame(ctx, rect = TEAM_FRAME, fill = 0.9) {
  await ctx.vo(({ rect, fill }) => __vo3d.cameraModes.focus(rect, fill), { rect, fill });
  await ctx.sleep(900);
}

const until = (ctx, fn, label, arg, timeout) => ctx.until(fn, { label, arg, timeout });

// ------------------------------------------------------------------------------------------ player-view scenes
/** yaw that turns a body at p to face q (V2 convention: forward = (sin yaw, cos yaw)) */
const yawTo = (p, q) => Math.atan2(q.x - p.x, q.z - p.z);
/** FILM ONLY: keep Player view's "click the world to capture your mouse" hint off camera (page-local style) */
async function hideHint(ctx) {
  await ctx.vo(() => {
    if (window.__filmHint) return;
    window.__filmHint = setInterval(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => /capture your mouse/i.test(n.nodeValue) ? 1 : 3 });
      for (let n = w.nextNode(); n; n = w.nextNode()) { const box = n.parentElement?.parentElement; if (box) box.style.visibility = "hidden"; }
    }, 400);
  });
}
/** a DOM click on a visible control (no pointer movement — in Player view a mouse move is a camera look) */
async function tap(ctx, label, page = ctx.page) {
  const ok = await page.evaluate((label) => {
    const on = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const els = [...document.querySelectorAll("button,[role=button],[role=menuitem]")].filter(on);
    const hit = els.find((e) => (e.getAttribute("aria-label") ?? "") === label) ?? els.find((e) => (e.textContent ?? "").trim() === label) ?? els.find((e) => (e.textContent ?? "").trim().startsWith(label));
    if (!hit) return false;
    hit.click();
    return true;
  }, label);
  if (!ok) throw new Error(`no visible control "${label}"`);
  await ctx.sleep(120);
}
/** Player view, Bon at a spot facing a world direction. The social scenes play at sunset (the Settings
 *  time switcher) — the warm, lived-in hour for the human section of the cut. */
async function pvAt(ctx, at, dir, time = "sunset", pitch = 0.12) {
  await hideHint(ctx);
  await ctx.vo((t) => __vo3d.env.setTime(t), time);
  await view(ctx, "player");
  await ctx.vo(({ at, dir, pitch }) => { __vo3d.player.teleport(at.x, at.z); __vo3d.cave.look(dir.x, dir.z, pitch); }, { at, dir, pitch });
  await ctx.sleep(500);
}
/** ease the Player camera around by `rad` over `ms` — a hand on the mouse */
async function orbit(ctx, rad, ms, pitchPx = 0) {
  const n = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i < n; i++) { const e = Math.sin(((i + 0.5) / n) * Math.PI) * (Math.PI / 2) / n; await ctx.vo(({ d, p }) => __vo3d.player.look(d, p), { d: (rad / 0.0026) * e, p: pitchPx * e }); await ctx.sleep(16); }
}
/** a coworker standing at p, turned toward q */
const standAt = (ctx, k, p, q) => walkPuppet(ctx, k, p, { instant: true, yaw: yawTo(p, q) });
const walkTo = (ctx, k, p, q, speed = 70) => walkPuppet(ctx, k, p, { speed, yaw: q ? yawTo(p, q) : undefined });

// ------------------------------------------------------------------------------------------------ shots
export const SHOTS = {
  Reset: {
    about: "Bon checked out at the Reception entrance, Office view, team gathered, panels shut",
    async stage(ctx) { await attendance(ctx, "out"); await view(ctx, "office"); await gatherTeam(ctx); },
  },

  Reception: {
    about: "OPENING — checked-out Bon walks to the gates (red, refused), checks in at the kiosk, gates open",
    async stage(ctx) {
      await attendance(ctx, "out");
      await view(ctx, "office");
      await gatherTeam(ctx);
      await placeBon(ctx, RECEPTION_START);                               // staging: start clearly away from the gates
      await ctx.sleep(800);
    },
    verify: async (ctx) => (await state(ctx)).access === "denied",
    async go(ctx) {
      await ctx.sleep(1000);
      await placeBon(ctx, GATE_SENSOR);                                   // a real walk up into the lane sensor
      await ctx.sleep(3000);                                              // hold on the red refusal
      await ctx.vo(() => __vo3d.reception.startApproach(__vo3d.reception.kioskId)); // the real kiosk walk-up
      await until(ctx, () => [...document.querySelectorAll("[role=menuitem]")].some((e) => e.textContent.trim() === "Check In"), "the kiosk card", undefined, 35000);
      await ctx.sleep(700);
      await ctx.click("Check In");                                        // the real check-in
      await until(ctx, () => __vo3d.access.state().access === "permitted", "check-in confirmed");
      await ctx.sleep(1800);                                              // the post-check-in Company Hub (real)
      await closePanels(ctx);
      await ctx.sleep(600);
      await placeBon(ctx, PAST_GATES);                                    // through the open, green gates
      return state(ctx);
    },
  },

  OfficeView: {
    about: "WORLD — the Office view establishing shot, Bon on the concourse, team in the Hub",
    stage: (ctx) => officeBaseline(ctx),
    verify: async (ctx) => (await state(ctx)).mode === "office" && (await coworkersAt(ctx, TEAM)),
    async go(ctx) { await placeBon(ctx, { x: 700, z: 740 }); return state(ctx); },
  },

  "3DView": {
    about: "WORLD — press C into 3D, then a slow real orbit/zoom drag that reveals depth",
    stage: (ctx) => officeBaseline(ctx),
    verify: async (ctx) => (await state(ctx)).mode === "office",
    async go(ctx) {
      await ctx.page.keyboard.press("KeyC");
      await until(ctx, () => __vo3d.cameraModes.mode === "explore", "3D view");
      await ctx.sleep(900);
      // a person orbiting: left-drag across the world, slowly, then a gentle wheel zoom
      const m = ctx.page.mouse;
      await m.move(960, 520); await m.down();
      for (let i = 0; i <= 120; i++) { await m.move(960 + i * ORBIT.dx / 120, 520 + i * ORBIT.dy / 120); await ctx.sleep(24); }
      await m.up();
      for (let i = 0; i < ORBIT.zoomSteps; i++) { await m.wheel({ deltaY: -60 }); await ctx.sleep(60); }
      await m.move(1919, 1079);
      return state(ctx);
    },
  },

  PlayerReveal: {
    about: "WORLD — from 3D, press C into Player view behind Bon; he starts walking",
    async stage(ctx) {
      await officeBaseline(ctx, { bonAt: { x: 480, z: 790 } });
      await placeBon(ctx, { x: 560, z: 790 });                            // the last step heads EAST → faces the team
      await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.player.mode.camera.pitch = 0.34; }); // the reveal is continuous with the daylight 3D shot
      await hideHint(ctx);
      await view(ctx, "explore");
    },
    verify: async (ctx) => (await state(ctx)).mode === "explore",
    async go(ctx) {
      await ctx.page.keyboard.press("KeyC");
      await until(ctx, () => __vo3d.cameraModes.mode === "player", "player view");
      await ctx.sleep(1200);
      await ctx.hold(["KeyW"], 2200);
      return state(ctx);
    },
  },

  PlayerRun: {
    about: "WORLD — one continuous Player take: walk → sprint up the west concourse → turn east → jump → land → run on",
    async stage(ctx) {
      await officeBaseline(ctx);
      await hideHint(ctx);
      await view(ctx, "player");
      await ctx.vo(() => __vo3d.env.setTime("day"));
      await ctx.vo(() => __vo3d.cave.look(0, -1, 0.34));
      await placeBon(ctx, { x: 400, z: 850 }, { x: 0, z: -1 });           // foot of the west lane, facing north
      await ctx.sleep(800);
    },
    verify: async (ctx) => (await state(ctx)).mode === "player",
    async go(ctx) {
      const k = ctx.page.keyboard;
      const trace = [];
      const mark = async (what) => trace.push({ what, ...(await ctx.vo(() => { const p = __vo3d.player.position(), s = __vo3d.player.state; return { x: Math.round(p.x), z: Math.round(p.z), yaw: +__vo3d.selfMovement.yaw().toFixed(2), air: s.airborne, sprint: s.sprinting }; })) });
      // 90° = 1.5708 rad / LOOK_SENSITIVITY 0.0026 ≈ 604 px of look — eased over the turn like a hand on a mouse
      const turn = async (px, ms) => { const n = Math.round(ms / 16); for (let i = 0; i < n; i++) { const e = Math.sin(((i + 0.5) / n) * Math.PI) * (Math.PI / 2) / n; await ctx.vo((d) => __vo3d.player.look(d, 0), px * e); await ctx.sleep(16); } };
      await mark("start");
      await k.down("KeyW"); await ctx.sleep(1400); await mark("walked");
      await k.down("ShiftLeft"); await ctx.sleep(2900); await mark("sprinted north");
      await turn(604, 1000); await mark("turned east");
      await ctx.sleep(1000);
      await k.press("Space"); await ctx.sleep(250); await mark("airborne");
      await ctx.sleep(700); await mark("landed");
      await ctx.sleep(2000); await mark("ran on");
      await k.up("ShiftLeft"); await ctx.sleep(700); await k.up("KeyW"); await mark("stopped");
      return trace;
    },
  },

  Search: {
    about: "MONTAGE — Search opens and finds a teammate",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Search for a person"); await ctx.page.keyboard.type("Mi", { delay: 120 }); await ctx.sleep(600); return true; },
  },
  Map: {
    about: "MONTAGE — Global Team Map",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Open Global Team Map"); await ctx.sleep(2500); return true; },
  },
  Quests: {
    about: "MONTAGE — Quests (onboarding questline, claimable rewards)",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Open Tasks"); return true; },
  },
  Missions: {
    about: "MONTAGE — Missions tab",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Open Tasks"); await ctx.click("Missions"); await ctx.sleep(700); return true; },
  },
  Toucan: {
    about: "MONTAGE — call the toucan: it flies to Bon and the assistant opens",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) {
      await closePanels(ctx);
      await ctx.click("Call the toucan");
      // the bird really flies from its Central Hub perch; the assistant opens only when it ARRIVES
      await until(ctx, () => document.body.innerText.includes("Toucan Assistant"), "the toucan arriving", undefined, 30000);
      await ctx.sleep(1200);
      return true;
    },
  },
  Boards: {
    about: "MONTAGE — Boards → open the Q4 Office Launch board",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Open office whiteboards"); await ctx.sleep(800); await ctx.click("Q4 Office Launch"); await ctx.sleep(3500); return true; },
  },
  Chat: {
    about: "MONTAGE — Chats list with real conversations",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Conversations"); return true; },
  },
  RoomDetails: {
    about: "MONTAGE — Room details (room labels over the office)",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Open room details"); return true; },
  },
  Hub: {
    about: "MONTAGE — Company Hub (announcement / birthday / Kudos cards)",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Open Company Hub"); return true; },
  },
  Notifications: {
    about: "MONTAGE — Notification Center (run Kudos first so there is something in it)",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) { await dock(ctx, "Notifications"); return true; },
  },

  CoworkerInteraction: {
    about: "MONTAGE — select Angelo in the world: the real interaction menu opens",
    async stage(ctx) { await officeBaseline(ctx, { bonAt: { x: 660, z: 790 } }); await frame(ctx); },
    async go(ctx) {
      await ctx.vo(() => __vo3d.coworkers.interact.select("angelo@offshorly.com"));
      await ctx.sleep(900);
      return ctx.vo(() => [...document.querySelectorAll("[role=menuitem]")].map((e) => e.textContent.trim()));
    },
  },

  SpatialIndicators: {
    about: "CULTURE — overhead spatial chat: Jan typing to Bon, Micah's new message glowing",
    async stage(ctx) { await officeBaseline(ctx, { bonAt: { x: 660, z: 790 } }); await frame(ctx); },
    async go(ctx) {
            ctx.puppets.send("micah", await dmWith(ctx, "micah@offshorly.com"), "Cake in the Hub at 3 🎂");
      await ctx.sleep(600);
      ctx.puppets.typing("jan", await dmWith(ctx, "jan@offshorly.com"), true);
      await ctx.sleep(2500);
      return true;
    },
  },

  Typing: {
    about: "CULTURE — Bon's chat with Alex open; Alex types, then his reply lands",
    async stage(ctx) { await officeBaseline(ctx, { bonAt: { x: 660, z: 790 } }); await frame(ctx); },
    async go(ctx) {
            const dm = await dmWith(ctx, "alex@offshorly.com");
      await dock(ctx, "Conversations");
      await ctx.click("Alex");
      await ctx.sleep(900);
      ctx.puppets.typing("alex", dm, true);
      await ctx.sleep(2200);
      ctx.puppets.typing("alex", dm, false);
      ctx.puppets.send("alex", dm, "On my way to the Hub 👋");
      await ctx.sleep(1200);
      return dm ?? false;
    },
  },

  SpatialConversation: {
    about: "CULTURE — Bon walks up to Alex and they fall into a real spatial conversation",
    async stage(ctx) { await officeBaseline(ctx, { bonAt: { x: 600, z: 790 } }); await frame(ctx); },
    async go(ctx) {
      await ctx.vo(() => __vo3d.coworkers.interact.select("alex@offshorly.com"));
      await ctx.sleep(700);
      await ctx.click("Chat");
      // Bon walks up; the DM opens and his client emits spatial_session_start(sessionId = conversation id).
      await ctx.sleep(4000);
            const dm = await dmWith(ctx, "alex@offshorly.com");
      ctx.puppets.emit("alex", "spatial_session_start", { sessionId: dm });   // Alex's side of the same session
      await ctx.sleep(1500);
      return ctx.vo(() => __vo3d.coworkers.interact.clips());
    },
  },

  AskToJoin: {
    about: "CULTURE — Angelo and Jan are talking; Bon asks to join and is let in",
    async stage(ctx) {
      await officeBaseline(ctx, { bonAt: { x: 600, z: 790 } });
      await frame(ctx);
      const conv = await ctx.api("angelo@offshorly.com", "POST", "/conversations", { peerEmail: "jan@offshorly.com" });
      ctx.puppets.emit("angelo", "spatial_session_start", { sessionId: conv.id });
      ctx.puppets.emit("jan", "spatial_session_start", { sessionId: conv.id });
      ctx.film = { ...ctx.film, askConv: conv.id };
      await ctx.sleep(1200);
    },
    async go(ctx) {
      await ctx.vo(() => __vo3d.coworkers.interact.select("jan@offshorly.com"));
      await ctx.sleep(700);
      await ctx.click("Ask to Join");
      // Angelo answers the real request the way his client would: POST /requests/{id}/resolve accept.
      await ctx.sleep(1500);
      const pending = await ctx.api("angelo@offshorly.com", "GET", "/requests/pending");
      const req = pending.find((r) => (r.kind === "join_group"));
      if (req) await ctx.api("angelo@offshorly.com", "POST", `/requests/${req.id}/resolve`, { decision: "accept" });
      await ctx.sleep(3000);
      return { request: req?.id ?? null };
    },
  },

  SpatialVideo: {
    about: "CULTURE — Bon calls Alex (a real second client accepts), turns his camera on: live video above him",
    async stage(ctx) {
      // Alex takes the call in a real Classic-office session (another browser, no fake camera). He must be
      // checked in first, or his own client reports him out and the office stops drawing him.
      await ctx.api("alex@offshorly.com", "POST", "/attendance/check-in").catch(() => {});
      const alex = await ctx.extra("alex");
      // a fresh load, so his client reads the check-in above (and any DB restore) rather than a stale session
      await alex.reload({ waitUntil: "domcontentloaded" });
      await alex.waitForFunction(() => document.querySelectorAll("button").length > 0, { timeout: 60000 });
      await ctx.sleep(4000);
      await officeBaseline(ctx, { bonAt: { x: 640, z: 790 } });
      await frame(ctx);
    },
    verify: (ctx) => coworkersAt(ctx, { alex: TEAM.alex }),
    async go(ctx) {
      const alex = await ctx.extra("alex");
      await ctx.vo(() => __vo3d.coworkers.interact.select("alex@offshorly.com"));
      await ctx.sleep(700);
      await ctx.click("Call");
      // Alex answers the real ring in his own client
      await alex.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Accept"), { timeout: 20000 });
      await ctx.click("Accept", alex);
      await until(ctx, () => !!document.querySelector('[aria-label="Turn camera on"]'), "the call connected", undefined, 20000);
      // Alex's own Classic client publishes a spot of its own when it loads/joins; put him back beside Bon
      // with an ordinary movement event on his identity (the newest movement is the one everyone draws)
      ctx.puppets.at.delete("alex");
      await walkPuppet(ctx, "alex", { x: 700, z: 790 }, { instant: true });
      await ctx.sleep(800);
      await ctx.click("Turn camera on");
      await until(ctx, () => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0 && !v.paused), "Bon's video playing", undefined, 15000);
      await ctx.sleep(1500);
      return ctx.vo(() => ({
        video: [...document.querySelectorAll("video")].map((v) => `${v.videoWidth}x${v.videoHeight}`),
        alex: __vo3d.coworkers.positions().filter((c) => c.name === "Alex").map((c) => [Math.round(c.x), Math.round(c.z)]),
      }));
    },
  },

  Birthday: {
    about: "CULTURE — the Hub's birthday card for Micah; Bon wishes him happy birthday",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) {
      await dock(ctx, "Open Company Hub");
      for (let i = 0; i < 6 && !(await ctx.visible("Happy Birthday, Micah! 🎂")); i++) { await ctx.click("Next item").catch(() => {}); await ctx.sleep(500); }
      await ctx.sleep(900);
      await ctx.click("Wish Happy Birthday").catch(() => {});
      await ctx.sleep(1500);
      return true;
    },
  },

  Kudos: {
    about: "CULTURE — the Hub's Kudos card for Alex; Bon gives Kudos (a real feed post + notification)",
    stage: (ctx) => officeBaseline(ctx),
    async go(ctx) {
      await dock(ctx, "Open Company Hub");
      for (let i = 0; i < 6 && !(await ctx.visible("Kudos to Alex 🏆")); i++) { await ctx.click("Next item").catch(() => {}); await ctx.sleep(500); }
      await ctx.sleep(900);
      await ctx.click("Give Kudos").catch(() => {});
      await ctx.sleep(1500);
      return true;
    },
  },

  TeamShot: {
    about: "CORE — the whole team in the Hub, Bon walks in to join them (Office view)",
    async stage(ctx) { await officeBaseline(ctx, { bonAt: { x: 480, z: 790 } }); await frame(ctx, { x: 440, z: 680, w: 520, d: 200 }); },
    verify: (ctx) => coworkersAt(ctx, TEAM),
    async go(ctx) {
      walkPuppet(ctx, "micah", { x: 860, z: 760 });
      await placeBon(ctx, { x: 680, z: 795 });
      return state(ctx);
    },
  },

  // ---------------------------------------------------------------------------- v2: Player-view scenes
  PVAskToJoin: {
    about: "SCENE — Player view: Bon walks the concourse toward Angelo + Jan mid-conversation, asks to join, they open up to him",
    async stage(ctx) {
      await officeBaseline(ctx);
      const A = { x: 720, z: 764 }, J = { x: 730, z: 814 };
      await standAt(ctx, "angelo", A, J); await standAt(ctx, "jan", J, A);
      await standAt(ctx, "micah", { x: 930, z: 728 }, { x: 0, z: 728 });
      await standAt(ctx, "alex", { x: 880, z: 800 }, { x: 1000, z: 800 });
      const conv = await ctx.api("angelo@offshorly.com", "POST", "/conversations", { peerEmail: "jan@offshorly.com" });
      ctx.puppets.emit("angelo", "spatial_session_start", { sessionId: conv.id });
      ctx.puppets.emit("jan", "spatial_session_start", { sessionId: conv.id });
      await pvAt(ctx, { x: 520, z: 790 }, { x: 1, z: 0 });
      await ctx.sleep(2500);
    },
    async go(ctx) {
      walkTo(ctx, "micah", { x: 560, z: 728 }, null, 60);                // background life crossing behind the pair
      walkTo(ctx, "alex", { x: 985, z: 760 }, null, 60);
      await ctx.page.keyboard.down("KeyW");
      await until(ctx, () => __vo3d.player.position().x > 640, "Bon near the pair", undefined, 8000).finally(() => ctx.page.keyboard.up("KeyW"));
      await ctx.sleep(700);
      await ctx.vo(() => __vo3d.coworkers.interact.select("jan@offshorly.com"));
      await ctx.sleep(900);
      await tap(ctx, "Ask to Join");
      await ctx.sleep(1300);
      const pending = await ctx.api("angelo@offshorly.com", "GET", "/requests/pending");
      const req = pending.find((r) => r.kind === "join_group");
      if (req) await ctx.api("angelo@offshorly.com", "POST", `/requests/${req.id}/resolve`, { decision: "accept" });
      await ctx.sleep(900);
      // the pair open into a loose triangle, turning toward Bon
      const b = await ctx.vo(() => __vo3d.player.position());
      const A2 = { x: b.x + 62, z: b.z - 30 }, J2 = { x: b.x + 66, z: b.z + 28 };
      const mid = { x: (b.x + A2.x + J2.x) / 3, z: (b.z + A2.z + J2.z) / 3 };
      walkTo(ctx, "angelo", A2, mid, 45); walkTo(ctx, "jan", J2, mid, 45);
      await ctx.sleep(1800);
      await orbit(ctx, -0.5, 1400);                                       // drift round to see their faces
      await ctx.sleep(1200);
      return { request: req?.id ?? null };
    },
  },

  PVConversation: {
    about: "SCENE — Player view: Alex walks up to Bon, they talk (spatial chat), Alex types and replies; over-the-shoulder",
    async stage(ctx) {
      await officeBaseline(ctx);
      await standAt(ctx, "alex", { x: 820, z: 770 }, { x: 560, z: 790 });
      const M = { x: 760, z: 736 }, J = { x: 800, z: 750 };
      await standAt(ctx, "micah", M, J); await standAt(ctx, "jan", J, M);
      await standAt(ctx, "angelo", { x: 470, z: 745 }, { x: 470, z: 900 });
      await pvAt(ctx, { x: 580, z: 790 }, { x: 1, z: 0 });
      await ctx.sleep(2500);
    },
    async go(ctx) {
      const bon = await ctx.vo(() => __vo3d.player.position());
      const AL = { x: bon.x + 56, z: bon.z - 4 };
      await walkTo(ctx, "alex", AL, bon, 75);
      await ctx.sleep(500);
      await ctx.vo(() => __vo3d.coworkers.interact.select("alex@offshorly.com"));
      await ctx.sleep(800);
      await tap(ctx, "Chat");
      await ctx.sleep(1200);
      const dm = await dmWith(ctx, "alex@offshorly.com");
      ctx.puppets.emit("alex", "spatial_session_start", { sessionId: dm });
      await walkPuppet(ctx, "alex", AL, { instant: true, yaw: yawTo(AL, await ctx.vo(() => __vo3d.player.position())) });
      orbit(ctx, Math.PI * 0.85, 2200);                                  // round to over Alex's shoulder
      await ctx.sleep(900);
      ctx.puppets.typing("alex", dm, true);
      await ctx.sleep(2000);
      ctx.puppets.typing("alex", dm, false);
      ctx.puppets.send("alex", dm, "On my way to the Hub 👋");
      await ctx.sleep(1500);
      return dm;
    },
  },

  PVSpatialVideo: {
    about: "SCENE — Player view: face to face with Alex over his shoulder, Bon calls, Alex accepts, Bon's live video floats above him",
    async stage(ctx) {
      await ctx.api("alex@offshorly.com", "POST", "/attendance/check-in").catch(() => {});
      const alex = await ctx.extra("alex");
      await alex.reload({ waitUntil: "domcontentloaded" });
      await alex.waitForFunction(() => document.querySelectorAll("button").length > 0, { timeout: 60000 });
      await ctx.sleep(4000);
      await officeBaseline(ctx);
      const M = { x: 760, z: 736 }, J = { x: 796, z: 752 };
      await standAt(ctx, "micah", M, J); await standAt(ctx, "jan", J, M);
      await standAt(ctx, "angelo", { x: 480, z: 760 }, { x: 440, z: 700 });
      await pvAt(ctx, { x: 600, z: 790 }, { x: 1, z: 0 });
      const b = await ctx.vo(() => __vo3d.player.position());
      ctx.film = { ...ctx.film, alexAt: { x: b.x + 52, z: b.z - 12 }, bon: b };
      await standAt(ctx, "alex", ctx.film.alexAt, b);
      await ctx.sleep(2000);
      await orbit(ctx, Math.PI * 0.85, 1200);
      await ctx.sleep(800);
    },
    async go(ctx) {
      const alex = await ctx.extra("alex");
      await ctx.vo(() => __vo3d.coworkers.interact.select("alex@offshorly.com"));
      await ctx.sleep(700);
      await tap(ctx, "Call");
      await alex.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Accept"), { timeout: 20000 });
      await ctx.click("Accept", alex);
      await until(ctx, () => !!document.querySelector('[aria-label="Turn camera on"]'), "the call connected", undefined, 20000);
      ctx.puppets.at.delete("alex");
      await standAt(ctx, "alex", ctx.film.alexAt, ctx.film.bon);
      await ctx.sleep(700);
      await tap(ctx, "Turn camera on");
      await until(ctx, () => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0 && !v.paused), "Bon's video playing", undefined, 15000);
      await orbit(ctx, -0.18, 2200);                                       // a slow drift while they talk
      await ctx.sleep(1200);
      return true;
    },
  },

  PVOfficeLife: {
    about: "SCENE — Player view: Bon strolls the concourse; Micah + Jan talk, Angelo crosses in front, Alex heads off",
    async stage(ctx) {
      await officeBaseline(ctx);
      const M = { x: 700, z: 742 }, J = { x: 738, z: 760 };
      await standAt(ctx, "micah", M, J); await standAt(ctx, "jan", J, M);
      await standAt(ctx, "angelo", { x: 800, z: 818 }, { x: 500, z: 740 });
      await standAt(ctx, "alex", { x: 860, z: 780 }, { x: 1000, z: 780 });
      await pvAt(ctx, { x: 470, z: 800 }, { x: 1, z: -0.12 });
      await ctx.sleep(2500);
    },
    async go(ctx) {
      walkTo(ctx, "angelo", { x: 520, z: 736 }, null, 70);
      walkTo(ctx, "alex", { x: 990, z: 750 }, null, 60);
      await ctx.hold(["KeyW"], 3600);
      await ctx.sleep(600);
      return true;
    },
  },

  CaveGlimpse: {
    about: "WORLD — Player view at the hidden championship portal: the Cave opens",
    async stage(ctx) {
      await officeBaseline(ctx);
      await hideHint(ctx);
      await view(ctx, "player");
      await ctx.vo(() => __vo3d.cave.atPortal());
      await ctx.sleep(2500);
    },
    async go(ctx) {
      await ctx.sleep(600);
      await ctx.vo(() => __vo3d.cave.enter());
      await ctx.sleep(5500);
      await orbit(ctx, 0.6, 1800);
      await ctx.sleep(400);
      return ctx.vo(() => __vo3d.cave.inside());
    },
  },

  Office3DTour: {
    about: "WORLD (polish) — 3D view room coverage: framed areas with a slow orbit sweep each, for the 3D montage",
    async stage(ctx) { await officeBaseline(ctx); await ctx.vo(() => __vo3d.env.setTime("day")); await view(ctx, "explore"); await ctx.sleep(800); },
    verify: async (ctx) => (await state(ctx)).mode === "explore",
    async go(ctx) {
      const rooms = [
        { x: 470, z: 430, w: 520, d: 280 },   // Central Hub
        { x: 40, z: 40, w: 420, d: 300 },     // north-west team room
        { x: 980, z: 40, w: 420, d: 300 },    // north-east room
        { x: 1000, z: 560, w: 320, d: 260 },  // east (gaming)
        { x: 40, z: 860, w: 340, d: 250 },    // Meeting Room
      ];
      for (const [i, r] of rooms.entries()) {
        await ctx.vo((r) => __vo3d.cameraModes.focus(r, 0.95), r);
        const y0 = i % 2 ? 24 : -24, y1 = -y0, n = 150;
        for (let k = 0; k <= n; k++) { const e = k / n; await ctx.vo(({ p, y }) => __vo3d.cameraModes.orbit(p, y), { p: 44 - 6 * e, y: y0 + (y1 - y0) * e }); await ctx.sleep(16); }
      }
      return true;
    },
  },
  ElevatorLong: {
    about: "ENDING (polish) — the Elevator take held past arrival: settle → doors slowly opening (the suspense beat)",
    async stage(ctx) { await SHOTS.Elevator.stage(ctx); await ctx.vo(() => __vo3d.env.setTime("sunset")); await ctx.sleep(1500); },
    verify: async (ctx) => (await state(ctx)).mode === "player",
    async go(ctx) { const phases = await SHOTS.Elevator.go(ctx); await ctx.sleep(4500); return phases; },
  },
  Elevator: {
    about: "ENDING — Player view in the Meeting Room: Bon walks to the lift, presses E, rides 01 → 02",
    async stage(ctx) {
      await officeBaseline(ctx);
      await hideHint(ctx);
      await view(ctx, "player");
      await placeBon(ctx, ELEVATOR_APPROACH, { x: -1, z: 0 });
      await ctx.sleep(3000);                                              // the dismissed toucan is home, off camera
    },
    verify: async (ctx) => (await state(ctx)).mode === "player",
    async go(ctx) {
      const k = ctx.page.keyboard;
      await k.down("KeyW");
      await until(ctx, () => __vo3d.player.target() === "Call the elevator", "the call plate targeted", undefined, 15000);
      await k.up("KeyW");
      await ctx.sleep(400);
      await k.press("KeyE");                                              // the real call-plate interaction
      // the journey's own phase, read from the existing (hidden) dev panel's live "phase" row
      const phases = [];
      const end = Date.now() + 45000;
      while (Date.now() < end) {
        const ph = await liftPhase(ctx);
        if (ph && ph !== phases[phases.length - 1]) phases.push(ph);
        if (phases.includes("arriving")) { await ctx.sleep(120); break; }   // Floor 2 doors BEGIN to open → cut
        await ctx.sleep(100);
      }
      return phases;
    },
  },
};
