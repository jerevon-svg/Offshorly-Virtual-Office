// FILM RIG ONLY — "Offshorly Virtual Office" TEASER 2 (the sequel to the approved 1:04 teaser): the PROOF takes.
//
// Loaded by a TEMPORARY line at the end of ../shots.mjs (removed again after capture; this folder is untracked):
//   Object.assign(SHOTS, (await import(`./cinematic/teaser2.mjs?v=${Date.now()}`)).teaser2({ …the director's verbs… }));
// Every shot goes through the REAL product only: __vo3d's own entry points, real key presses, real clicks.
//
// CAST RULE (Bon, 2026-10-09): the FULL existing VO cast exactly as the product loads it — HumanBase bodies where an
// approved update exists (Bon, Micah, Angelo, Clang, France), every other employee's existing production body (Alex,
// Jan, Jona, Kael, Nicole). Nobody is hidden, removed or checked out to control the cast, and every take records which
// body runtime each person actually wore (`cast` marks). The one attendance change is the story's own premise: Bon
// arrives checked out on the isolated film DB, is refused at the gate and checks in through the real kiosk.
import { pageLib } from "./shots.mjs";

const GATE_SENSOR = { x: 728, z: 918 }, PAST_GATES = { x: 728, z: 760 }, BON_START = { x: 722, z: 1112 };
// the approved teaser's lived-in Reception (shots.mjs OPENING_CAST / OPENING_END), every colleague kept
const OPENING_CAST = {
  nicole: { at: { x: 935, z: 1045 }, face: { x: 962, z: 1072 } },
  kael:   { at: { x: 962, z: 1072 }, face: { x: 935, z: 1045 } },
  jona:   { at: { x: 772, z: 1124 }, face: { x: 860, z: 1100 } },
  france: { at: { x: 430, z: 805 }, face: { x: 380, z: 760 } },
  alex:   { at: { x: 600, z: 810 }, face: { x: 640, z: 824 } },
  jan:    { at: { x: 640, z: 824 }, face: { x: 600, z: 810 } },
  angelo: { at: { x: 1000, z: 758 }, face: { x: 470, z: 756 } },
  micah:  { at: { x: 880, z: 735 }, face: { x: 820, z: 650 } },
  clang:  { at: { x: 1010, z: 792 }, face: { x: 930, z: 800 } },
};
const OPENING_END = {
  ...OPENING_CAST,
  jona:   { at: { x: 912, z: 1066 }, face: { x: 935, z: 1045 } },
  angelo: { at: { x: 420, z: 752 }, face: { x: 430, z: 805 } },
  micah:  { at: { x: 820, z: 650 }, face: { x: 760, z: 610 } },
  clang:  { at: { x: 930, z: 800 }, face: { x: 1010, z: 792 } },
};
// Office-view framings (top-left corner + size)
const CAM = {
  wide0:   { x: 390, z: 735, w: 700, d: 395 },     // the approved teaser's opening wide
  gates:   { x: 548, z: 818, w: 380, d: 214 },     // tighter on the lanes for the refusal
  kiosk:   { x: 395, z: 905, w: 360, d: 203 },
  gates0:  { x: 500, z: 740, w: 460, d: 280 }, gates1: { x: 500, z: 700, w: 460, d: 280 },
  office0: { x: 420, z: 560, w: 620, d: 380 }, office1: { x: 330, z: 500, w: 800, d: 450 },
};

/** film-only page helpers beside the cinematic library: one continuous spline camera move + the runtime cast readout */
function t2Lib() {
  const v = window.__vo3d;
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const E = { sine: (s) => 0.5 - 0.5 * Math.cos(Math.PI * s), io: (s) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2), lin: (s) => s };
  window.__t2 = {
    /** explore camera: ONE Catmull-Rom move through keys [{x,z,pitch,yaw,zoom}] over ms, eased only at its two ends */
    spline(keys, ms, ease = "sine", weights = null) {
      return new Promise((done) => {
        const t0 = performance.now(), n = keys.length - 1, K = (i) => keys[Math.max(0, Math.min(n, i))];
        const w = weights ?? keys.slice(1).map(() => 1), tot = w.reduce((a, b) => a + b, 0);
        const step = () => {
          const s = Math.min(1, (performance.now() - t0) / ms);
          let left = E[ease](s) * tot, i = 0;                       // time-weighted segments: a short first one = a fast drop
          while (i < n - 1 && left > w[i]) { left -= w[i]; i++; }
          const f = Math.min(1, left / w[i]);
          const c = {};
          for (const k of ["x", "z", "pitch", "yaw", "zoom"]) c[k] = cr(K(i - 1)[k], K(i)[k], K(i + 1)[k], K(i + 2)[k], f);
          v.R.target.x = c.x; v.R.target.z = c.z; v.cameraModes.orbit(c.pitch, c.yaw, c.zoom);
          if (s < 1) requestAnimationFrame(step); else done(true);
        };
        requestAnimationFrame(step);
      });
    },
    set(k) { v.R.target.x = k.x; v.R.target.z = k.z; v.cameraModes.orbit(k.pitch, k.yaw, k.zoom); },
    current() { const p = v.R.camParams; return { x: v.R.target.x, z: v.R.target.z, pitch: p.pitch, yaw: p.yaw, zoom: p.zoom }; },
    /** which body every person is ACTUALLY wearing right now (HumanBase vs the existing production GLB) */
    cast() {
      return { mode: v.cameraModes.mode, bon: v.avatar.runtime, bonStatus: v.avatarState.status,
        coworkers: v.coworkers.positions().map((p) => `${p.name}:${p.avatarId}:${p.runtime}`) };
    },
    /** film-only presentation: hide matching DOM (opacity) until cleared — the product keeps running underneath */
    hide(selectors) {
      clearInterval(window.__t2hideT);
      const apply = () => {
        for (const el of document.querySelectorAll("[data-t2-hidden]")) { el.style.opacity = ""; delete el.dataset.t2Hidden; }
        for (const s of selectors) for (const el of document.querySelectorAll(s)) { el.dataset.t2Hidden = "1"; el.style.opacity = "0"; }
      };
      apply();
      if (selectors.length) window.__t2hideT = setInterval(apply, 120);
    },
  };

  // ---- THE FILM CAMERA. A film-only PERSPECTIVE camera made active through the renderer's own setActiveCamera, so the
  // post pipeline, culling, name pills and the Lab cast all use it. Its pose is applied INSIDE R.render (after the
  // frame's own camera/shadow updates, before anything is drawn); the shadow frame follows the shot's subject. ----
  const R = v.R, V3 = R.playerCamera.position.constructor, tmp = new V3();
  const ease = { io: (s) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2), sine: (s) => 0.5 - 0.5 * Math.cos(Math.PI * s), lin: (s) => s, out: (s) => 1 - Math.pow(1 - s, 3) };
  const target = (t) => {
    if (!t) return null;
    if (typeof t === "object") return t;
    if (t === "bird") { const p = v.toucan.root.getWorldPosition(tmp); return { x: p.x, y: p.y, z: p.z }; }
    if (t === "bon") { const p = v.avatar.worldPosition(); return { x: p.x, y: (p.y ?? 0) + 30, z: p.z }; }
    if (t === "group") {
      const pts = [], q = v.avatar.root.getWorldPosition(tmp.clone()); pts.push([q.x, q.y, q.z]);
      v.R.scene.getObjectByName("lift-riders")?.children.forEach((c) => { const w = c.getWorldPosition(tmp.clone()); pts.push([w.x, w.y, w.z]); });
      const n = pts.length; return { x: pts.reduce((a, b) => a + b[0], 0) / n, y: pts.reduce((a, b) => a + b[1], 0) / n + 26, z: pts.reduce((a, b) => a + b[2], 0) / n };
    }
    const q = v.labCast?.headOf(t, tmp) ?? v.labCast?.positionOf(t, tmp);
    return q ? { x: q.x, y: q.y, z: q.z } : null;
  };
  const film = (window.__t2.film = {
    cam: null, on: false, shot: null, P: new V3(), L: new V3(), fov: 38, last: 0, vel: { x: 0, z: -1 }, prevT: null, radius: 460,
    start(fov = 38) {
      if (!this.cam) this.cam = R.playerCamera.clone();
      Object.assign(this.cam, { near: 1.5, far: 14000, fov, aspect: innerWidth / innerHeight }); this.cam.updateProjectionMatrix();
      if (!R.__t2orig) { const orig = R.render; R.__t2orig = orig; R.render = function () { try { window.__t2.pre?.(); } catch {} const f = window.__t2.film; if (f.on) f.apply(); return orig.call(this); }; }
      this.on = true; this.last = performance.now(); R.setActiveCamera(this.cam);
    },
    stop() {
      this.on = false; this.shot = null;
      R.setActiveCamera(v.cameraModes.mode === "player" ? R.playerCamera : R.camera); R.shadowFocus = null; R.shadowRadius = 300;
    },
    /** the next shot; `blend` ms eases from the current pose into it */
    set(shot) {
      this.from = { P: this.P.clone(), L: this.L.clone(), fov: this.fov };
      if (shot.fromCurrent) shot = { ...shot, keys: [{ t: 0, P: [this.P.x, this.P.y, this.P.z], L: [this.L.x, this.L.y, this.L.z], fov: this.fov }, ...shot.keys] };
      if (shot.kind !== "follow" || shot.dir0) this.prevT = null;
      if (shot.dir0) this.vel = { x: shot.dir0[0], z: shot.dir0[1] };
      this.shot = { ...shot, t0: performance.now() };
    },
    pose() { return { P: [this.P.x, this.P.y, this.P.z].map(Math.round), L: [this.L.x, this.L.y, this.L.z].map(Math.round), fov: this.fov }; },
    apply() {
      const s = this.shot; if (!s) return;
      const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000), el = now - s.t0; this.last = now;
      let P, L, fov = s.fov ?? this.fov;
      if (s.kind === "path") {                      // keys [{t ms, P, L, fov}] — Catmull-Rom through time, eased overall
        const K = s.keys, end = K.at(-1).t, tt = (ease[s.ease ?? "lin"])(Math.min(1, el / Math.max(1, end))) * end;
        let i = 0; while (i < K.length - 2 && tt > K[i + 1].t) i++;
        const k = (j) => K[Math.max(0, Math.min(K.length - 1, j))], f = Math.min(1, Math.max(0, (tt - k(i).t) / Math.max(1, k(i + 1).t - k(i).t)));
        P = [0, 1, 2].map((c) => cr(k(i - 1).P[c], k(i).P[c], k(i + 1).P[c], k(i + 2).P[c], f));
        L = [0, 1, 2].map((c) => cr(k(i - 1).L[c], k(i).L[c], k(i + 1).L[c], k(i + 2).L[c], f));
        fov = k(i).fov != null && k(i + 1).fov != null ? k(i).fov + (k(i + 1).fov - k(i).fov) * f : fov;
        if (s.lookTarget) {                        // the lens stays on a moving subject while the dolly runs its keys
          const T = target(s.lookTarget);
          if (T) { const want = [T.x, T.y + (s.lookUp ?? 0), T.z], a = el < 40 ? 1 : 1 - Math.exp(-dt * 6); L = [0, 1, 2].map((c) => [this.L.x, this.L.y, this.L.z][c] + (want[c] - [this.L.x, this.L.y, this.L.z][c]) * a); }
        }
      } else if (s.kind === "follow") {               // a damped chase rig behind/beside a moving subject
        const T = target(s.target); if (!T) return;
        if (this.prevT) { const dx = T.x - this.prevT.x, dz = T.z - this.prevT.z, d = Math.hypot(dx, dz); if (d > 0.05) { const a = 1 - Math.exp(-dt * 3); this.vel = { x: this.vel.x + (dx / d - this.vel.x) * a, z: this.vel.z + (dz / d - this.vel.z) * a }; } }
        this.prevT = T; const n = Math.hypot(this.vel.x, this.vel.z) || 1, fx = this.vel.x / n, fz = this.vel.z / n, rx = -fz, rz = fx;
        const want = [T.x - fx * s.back + rx * s.side, T.y + s.up, T.z - fz * s.back + rz * s.side], look = [T.x + fx * s.lead, T.y + (s.lookUp ?? 0), T.z + fz * s.lead];
        const a = 1 - Math.exp(-dt * (s.k ?? 4));
        P = [0, 1, 2].map((c) => [this.P.x, this.P.y, this.P.z][c] + (want[c] - [this.P.x, this.P.y, this.P.z][c]) * a);
        L = [0, 1, 2].map((c) => [this.L.x, this.L.y, this.L.z][c] + (look[c] - [this.L.x, this.L.y, this.L.z][c]) * a);
      } else if (s.kind === "orbit") {                // around a (moving) subject: radius, height and angle eased over ms
        const T = target(s.target); if (!T) return;
        const e = (ease[s.ease ?? "sine"])(Math.min(1, el / s.ms)), a = ((s.a0 + (s.a1 - s.a0) * e) * Math.PI) / 180;
        const r = s.r0 + (s.r1 - s.r0) * e, h = s.h0 + (s.h1 - s.h0) * e;
        P = [T.x + Math.cos(a) * r, T.y + h, T.z + Math.sin(a) * r]; L = [T.x, T.y + (s.lookUp ?? 0), T.z];
      }
      if (s.blend && this.from && el < s.blend) {    // ease out of the previous pose
        const b = ease.sine(el / s.blend);
        P = P.map((x, c) => [this.from.P.x, this.from.P.y, this.from.P.z][c] + (x - [this.from.P.x, this.from.P.y, this.from.P.z][c]) * b);
        L = L.map((x, c) => [this.from.L.x, this.from.L.y, this.from.L.z][c] + (x - [this.from.L.x, this.from.L.y, this.from.L.z][c]) * b);
        fov = this.from.fov + (fov - this.from.fov) * b;
      }
      this.P.set(P[0], P[1], P[2]); this.L.set(L[0], L[1], L[2]); this.fov = fov;
      const c = this.cam; c.position.copy(this.P); c.lookAt(this.L);
      if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
      c.updateMatrixWorld();
      R.shadowFocus = { x: this.L.x, z: this.L.z }; R.shadowRadius = this.radius;
    },
  });
  // FILM RIG ONLY — THE LIFT HEIGHT CORRECTION (Bon's sunk-in-the-car bug): while the car carries the party, Bon's body
  // runs 8.3 below the cabin floor the riders stand on. Just before each frame is drawn, his body is set level with
  // the riders (only while riders exist, only upward, at most 20). Nothing in the product is changed.
  const ra = new V3(), rb = new V3();
  window.__t2.liftFix = (on) => { window.__t2.pre = on ? () => {
    const g = v.R.scene.getObjectByName("lift-riders"); if (!g || !g.children.length) return;
    g.children[0].getWorldPosition(ra); v.avatar.root.getWorldPosition(rb);
    const d = ra.y - rb.y; if (d > 0.4 && d < 20) { v.avatar.root.position.y += d; v.avatar.root.updateMatrixWorld(true); }
  } : null; };
  return true;
}

export function teaser2(H) {
  const { attendance, view, placeBon, walkPuppet, walkTo, closePanels, hideHint, hidePathOverlay, yawTo, until, camHold } = H;
  const lib = async (ctx) => { await ctx.page.evaluate(pageLib); await ctx.page.evaluate(t2Lib); await hidePathOverlay?.(ctx); };
  const castTo = (ctx, spots) => Promise.all(Object.entries(spots).map(([k, c]) => walkPuppet(ctx, k, c.at, { instant: true, yaw: yawTo(c.at, c.face) })));
  const marks = () => { const m = []; return [m, (what, extra) => m.push({ what, t: Date.now() / 1000, ...extra })]; };
  const readCast = (ctx) => ctx.vo(() => window.__t2.cast());
  const officePath = (ctx, keys) => ctx.vo((keys) => window.__cine.officePath(keys), keys);
  const spline = (ctx, keys, ms, ease, weights) => ctx.vo(({ keys, ms, ease, weights }) => window.__t2.spline(keys, ms, ease, weights), { keys, ms, ease, weights: weights ?? null });
  const set3d = (ctx, k) => ctx.vo((k) => window.__t2.set(k), k);
  const hud = (ctx, mode) => ctx.vo((m) => window.__cine.hud(m), mode);
  const byTest = (ctx, id) => ctx.vo((id) => { const b = document.querySelector(`[data-testid='${id}']`); if (!b || b.disabled) return false; b.click(); return true; }, id);

  /** 3D-view keys (target x/z, pitch°, yaw°, zoom) — checked against stills (T2Frames) before recording */
  const K = {
    drop:      { x: 700, z: 760, pitch: 40, yaw: -8, zoom: 0.95 },     // ALIVE: the fast drop into the 3D world
    concourse: { x: 600, z: 790, pitch: 32, yaw: -15, zoom: 1.6 },  // yaw 0 = camera south looking north, 90 = east looking west
    east:      { x: 820, z: 720, pitch: 34, yaw: 20, zoom: 1.5 },
    gaming:    { x: 1150, z: 690, pitch: 46, yaw: 50, zoom: 1.25 },
    ne:        { x: 1190, z: 240, pitch: 42, yaw: 75, zoom: 1.15 },
  };

  const film = (ctx, shot) => ctx.vo((s) => window.__t2.film.set(s), shot);
  const filmOn = (ctx, fov) => ctx.vo((f) => window.__t2.film.start(f), fov ?? 38);
  const filmOff = (ctx) => ctx.vo(() => window.__t2.film.stop());
  const status = (ctx) => ctx.vo(() => document.querySelector("[data-testid='ai-workforce-step']")?.textContent?.trim() ?? "");
  const untilStatus = (ctx, re, timeout = 200000) => until(ctx, (src) => new RegExp(src).test(document.querySelector("[data-testid='ai-workforce-step']")?.textContent ?? ""), `status ${re}`, re, timeout);

  // ---- the revised proof (Bon's review of 2026-10-09): real 3D camera moves, the cast at work, whole panels ----
  const HIDE_FILM = ["[class*='_dock_']", "button[aria-label='Call the toucan']", "[data-testid='vo3d-toucan']", "[data-testid^='vo3d-task-window-']", "[data-testid='ai-workforce-card']"];
  const hideUi = (ctx, sel) => ctx.vo((s) => window.__t2.hide(s), sel);
  /** everyone at work in their OWN rooms: real seat anchors, claimed over the real wire (the product's seated hold) */
  const SEATS = {
    micah: "design-room/design-member-chair1", angelo: "design-room/design-member-chair2",
    jan: "dev-room/lead-chair-west", alex: "dev-room/visitor-chair-w2",
    clang: "gaming-room/sofa#sofa-west", france: "gaming-room/sofa#sofa-centre",
    kael: "executive-room/sofa-west#sofa-west-centre", nicole: "executive-room/sofa-east#sofa-east-centre",
    jona: "ai-room/member-chair-1-1",
  };
  const SEATS_TOOLS = { ...SEATS, micah: "central-hub/cafe-chair-0-north", angelo: "central-hub/cafe-chair-0-east" };
  async function seatCast(ctx, seats) {
    const pts = await ctx.vo(async (ids) => {
      const s = await import("/virtual-office/src/dev/vo3d/app/seats.ts"), a = s.groundFloorSeatAnchors();
      return Object.fromEntries(ids.map((id) => { const x = a.find((q) => q.id === id); return [id, x ? { x: x.point.x, z: x.point.z } : null]; }));
    }, Object.values(seats));
    await Promise.all(Object.entries(seats).filter(([, id]) => pts[id]).map(([k, id]) => {
      const at = { x: pts[id].x - 10, y: pts[id].z - 17.2 }; ctx.puppets.at.set(k, at);
      return ctx.puppets.walk(k, [at], { speed: 1e6, state: "sitting", seatKey: `v2:${id}` });
    }));
    await ctx.sleep(1800);
    return { missing: Object.entries(seats).filter(([, id]) => !pts[id]).map(([k]) => k), seated: await ctx.vo(() => __vo3d.coworkers.positions().map((p) => `${p.name}:${p.seat ?? "-"}`)) };
  }
  const ROOM_SHOTS = [   // [name, path keys | orbit] — each move 3 s; the edit takes a beat from each
    ["R0-office", { keys: [{ t: 0, P: [1700, 560, 1500], L: [720, 0, 620], fov: 40 }, { t: 3000, P: [1560, 500, 1380], L: [720, 0, 600], fov: 40 }] }],
    ["R1-design", { keys: [{ t: 0, P: [44, 80, 368], L: [104, 26, 440], fov: 42 }, { t: 3000, P: [52, 78, 373], L: [106, 26, 441], fov: 41 }] }],
    ["R3-dev", { keys: [{ t: 0, P: [1395, 78, 268], L: [1330, 30, 120], fov: 42 }, { t: 3000, P: [1290, 74, 272], L: [1225, 28, 100], fov: 42 }] }],
    ["R4-gaming", { keys: [{ t: 0, P: [1318, 90, 646], L: [1279, 30, 738], fov: 42 }, { t: 3000, P: [1298, 80, 660], L: [1279, 30, 738], fov: 40 }] }],
    ["R2-executive", { keys: [{ t: 0, P: [895, 125, 268], L: [731, 25, 202], fov: 40 }, { t: 3000, P: [858, 104, 248], L: [731, 25, 200], fov: 40 }] }],
    ["R5-ai", { keys: [{ t: 0, P: [285, 150, 255], L: [100, 25, 170], fov: 42 }, { t: 3000, P: [255, 92, 232], L: [95, 25, 165], fov: 42 }],
      after: { reseat: { micah: "central-hub/cafe-chair-0-north", angelo: "central-hub/cafe-chair-0-east", jan: "central-hub/cafe-chair-1-north", alex: "central-hub/cafe-chair-1-east" }, walk: { kael: { x: 930, z: 560 }, nicole: { x: 905, z: 600 } } } }],
    ["R6-hub", { keys: [{ t: 0, P: [420, 150, 770], L: [610, 25, 500], fov: 44 }, { t: 3000, P: [472, 118, 746], L: [622, 25, 490], fov: 42 }] }],
  ];
  const roomsShot = (check) => ({
    about: `ALIVE ROOM MONTAGE${check ? " (CHECK: stills only)" : ""} — the cast at work in their own rooms; one film camera, seven distinct real 3D moves`,
    async stage(ctx) {
      await attendance(ctx, "in"); await closePanels(ctx); await lib(ctx);
      ctx.__seated = await seatCast(ctx, SEATS);
      await ctx.vo(() => __vo3d.env.setTime("day"));
      await hideHint(ctx); await view(ctx, "player");
      await ctx.vo(() => { __vo3d.player.teleport(740, 610); __vo3d.cave.look(-1, -0.6, 0.12); });
      await hideUi(ctx, HIDE_FILM);
      await ctx.page.mouse.move(1919, 1079); await ctx.sleep(2500);
    },
    verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "player",
    async go(ctx) {
      const [m, mark] = marks(); mark("cast", { ...(await readCast(ctx)), seated: ctx.__seated });
      await filmOn(ctx, 42);
      for (const [name, sh] of ROOM_SHOTS) {
        await film(ctx, sh.orbit ? { kind: "orbit", ...sh.orbit } : { kind: "path", ease: "io", keys: sh.keys });
        mark(name);
        if (check) { await ctx.sleep(300); await ctx.snap(`t2c-${name}-a`); await ctx.sleep(2400); await ctx.snap(`t2c-${name}-b`); }
        else await ctx.sleep(3050);
        if (sh.after?.walk) for (const [k, p] of Object.entries(sh.after.walk)) walkTo(ctx, k, p, null, 62).catch(() => {});
        if (sh.after?.reseat) { await seatCast(ctx, sh.after.reseat); mark(`${name}-reseated`); }
      }
      await filmOff(ctx); await hideUi(ctx, []); mark("end");
      mark("cast-end", await readCast(ctx));
      return m;
    },
  });
  /** Player view at a spot, facing a point (cave.look takes a DIRECTION), panels shut */
  const toolSpot = async (ctx, at, look, pitch = 0.12) => {
    await closePanels(ctx);
    await ctx.vo(({ at, look, pitch }) => { __vo3d.player.teleport(at.x, at.z); const dx = look.x - at.x, dz = look.z - at.z, n = Math.hypot(dx, dz) || 1; __vo3d.cave.look(dx / n, dz / n, pitch); }, { at, look, pitch });
    await ctx.sleep(900);
  };
  const labShot = (check) => ({
    about: `AI LAB${check ? " (CHECK: stills only)" : ""} — Bon asks Toucan; a film camera takes off with the bird, tracks its real flight, rises into the Lab reveal, meets the team, follows the scripted job; Bon approves`,
    async stage(ctx) {
      await attendance(ctx, "in"); await closePanels(ctx); await ctx.click("Dismiss the toucan").catch(() => {});
      await lib(ctx); ctx.__seated = await seatCast(ctx, SEATS);
      await ctx.vo(() => __vo3d.env.setTime("day")); await hideHint(ctx); await view(ctx, "player");
      await ctx.vo(() => { __vo3d.player.teleport(740, 790); __vo3d.cave.look(0, -1, 0.1); });
      await hud(ctx, "full"); await hideUi(ctx, []);
      await ctx.page.mouse.move(1919, 1079); await ctx.sleep(2000);
    },
    verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "player",
    async go(ctx) {
      const [m, mark] = marks(); mark("cast", { ...(await readCast(ctx)), seated: ctx.__seated });
      const snap = async (n) => { if (check) await ctx.snap(`t2c-lab-${n}`); };
      let t0 = Date.now(); const at = (s) => ctx.sleep(Math.max(0, t0 + s * 1000 - Date.now()));   // seconds after the request
      await ctx.sleep(900);
      await ctx.click("Call the toucan"); mark("toucan");
      await until(ctx, () => !!document.querySelector("[data-testid='ai-workforce-start']"), "the AI Workforce entry", undefined, 25000);
      await ctx.sleep(2300); await snap("00-entry");
      t0 = Date.now(); mark("request"); await ctx.click("Preview a sample task");
      await at(1.9); await snap("01-request-ui"); mark("ui-held");
      // SHOT A — TAKEOFF: outside, wide front three-quarter on the office; the dolly runs in while the lens holds the bird
      await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 40);
      await film(ctx, { kind: "path", ease: "io", lookTarget: "bird", lookUp: 4, keys: [{ t: 0, P: [1180, 170, 1300], L: [708, 34, 760], fov: 38 }, { t: 3600, P: [790, 112, 720], L: [712, 66, 600], fov: 34 }] });
      mark("A"); await ctx.sleep(300); await snap("02-A-start");
      await untilStatus(ctx, "flying to the AI Lab", 20000); mark("liftoff");
      await at(4.7); await snap("03-A-end");
      // SHOT B — THE FLIGHT: a chase rig at the bird's height, behind and to one side
      await film(ctx, { kind: "follow", target: "bird", back: 46, side: 24, up: 22, lead: 40, lookUp: 0, k: 4, fov: 46, blend: 1200 });
      mark("B"); await at(6.6); await snap("04-B-mid");
      // SHOT C — THE DISCOVERY: as the Lab comes up, rise and pull back into the wide reveal
      await until(ctx, () => __vo3d.toucan.root.getWorldPosition(__vo3d.R.playerCamera.position.clone()).z < -230, "the bird over the campus", undefined, 20000);
      await film(ctx, { kind: "path", ease: "io", fromCurrent: true, keys: [{ t: 3600, P: [1260, 430, -230], L: [740, 30, -700], fov: 44 }] });
      mark("C"); await ctx.sleep(3700); await snap("05-C-reveal");
      await film(ctx, { kind: "path", ease: "sine", fromCurrent: true, keys: [{ t: 9000, P: [1120, 300, -340], L: [760, 60, -720], fov: 42 }] });
      mark("C2"); await at(16); await snap("06-C2-team");
      // SHOT D — MEET THE TEAM at the briefing
      await at(21.4); await film(ctx, { kind: "orbit", target: "milo", r0: 74, r1: 58, a0: -75, a1: -45, h0: 28, h1: 20, lookUp: 6, ms: 2600, fov: 34 }); mark("D-milo"); await ctx.sleep(1300); await snap("07-milo");
      await at(24.0); await film(ctx, { kind: "orbit", target: "nova", r0: 74, r1: 58, a0: -105, a1: -135, h0: 28, h1: 20, lookUp: 6, ms: 2600, fov: 34 }); mark("D-nova"); await ctx.sleep(1300); await snap("08-nova");
      await at(26.6); await film(ctx, { kind: "orbit", target: "pip", r0: 64, r1: 54, a0: -55, a1: -80, h0: 24, h1: 18, lookUp: 6, ms: 2600, fov: 34 }); mark("D-pip"); await ctx.sleep(1300); await snap("09-pip");
      await at(29.2); await film(ctx, { kind: "orbit", target: { x: 740, y: 20, z: -570 }, r0: 170, r1: 150, a0: 60, a1: 95, h0: 80, h1: 66, ms: 6000, fov: 40 }); mark("brief"); await ctx.sleep(1500); await snap("10-brief");
      // THE WORK — Nova designs
      await untilStatus(ctx, "Nova is heading", 60000); await at(44);
      await film(ctx, { kind: "orbit", target: "nova", r0: 88, r1: 72, a0: 10, a1: 40, h0: 46, h1: 36, lookUp: 10, ms: 8500, fov: 38 }); mark("nova-station");
      await untilStatus(ctx, "Nova is working", 30000); mark("nova-working"); await ctx.sleep(1200); await snap("11-nova-working");
      // Nova takes the work to Milo — side-on, then the handoff two-shot
      await untilStatus(ctx, "taking the work to Milo", 30000); await ctx.sleep(1500);
      await film(ctx, { kind: "follow", target: "nova", back: 0, side: -70, up: 34, lead: 20, lookUp: 12, k: 3, fov: 40, blend: 900 }); mark("nova-walk"); await ctx.sleep(1500); await snap("12-nova-walk");
      await at(61); await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [575, 72, -455], L: [613, 22, -530], fov: 38 }, { t: 4500, P: [588, 64, -466], L: [613, 22, -530], fov: 36 }] }); mark("handoff-1");
      await untilStatus(ctx, "Milo has the work", 30000); mark("milo-has"); await snap("13-handoff-1");
      // Milo builds
      await untilStatus(ctx, "Milo is heading", 30000); await at(79);
      await film(ctx, { kind: "orbit", target: "milo", r0: 88, r1: 72, a0: 170, a1: 140, h0: 46, h1: 36, lookUp: 10, ms: 9000, fov: 38 }); mark("milo-station");
      await untilStatus(ctx, "Milo is working", 30000); mark("milo-working"); await ctx.sleep(1200); await snap("14-milo-working");
      // Milo → Pip
      await untilStatus(ctx, "taking the work to Pip", 30000); await at(95);
      await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [835, 72, -455], L: [867, 22, -530], fov: 38 }, { t: 5000, P: [846, 64, -464], L: [867, 22, -530], fov: 36 }] }); mark("handoff-2");
      await untilStatus(ctx, "Pip has the work", 30000); mark("pip-has"); await snap("15-handoff-2");
      // Pip reviews
      await untilStatus(ctx, "Pip is heading", 30000); await at(108);
      await film(ctx, { kind: "orbit", target: "pip", r0: 82, r1: 68, a0: 160, a1: 190, h0: 44, h1: 34, lookUp: 10, ms: 8000, fov: 38 }); mark("pip-station");
      await untilStatus(ctx, "Pip is reviewing", 30000); mark("pip-reviewing"); await ctx.sleep(1200); await snap("16-pip-reviewing");
      // Toucan carries the result home
      await untilStatus(ctx, "bringing you the result", 40000); await ctx.sleep(700);
      await film(ctx, { kind: "follow", target: "bird", dir0: [0, 1], back: 50, side: -26, up: 22, lead: 40, lookUp: 0, k: 4, fov: 46 }); mark("return");
      await ctx.sleep(2500); await snap("17-return");
      await untilStatus(ctx, "back with you", 30000).catch(() => {});
      // BON — the result reaches him in-app; he opens it and decides
      await filmOff(ctx); await hideUi(ctx, []); mark("bon");
      await untilStatus(ctx, "Result delivered", 20000); mark("delivered"); await ctx.sleep(1900); await snap("18-delivered");
      await byTest(ctx, "ailab-view-result"); mark("result"); await ctx.sleep(2800); await snap("19-result");
      await ctx.click("Approve"); mark("approved"); await ctx.sleep(2600); await snap("20-approved");
      mark("cast-end", await readCast(ctx));
      return m;
    },
  });

  // ---- THE LAB IN SEGMENTS (disk: ~100 s recorded instead of 155): ONE live job across six director commands. Each
  // segment's stage only WAITS (unrecorded) for its moment; the film camera and the job carry on in the page between. ----
  const labAt = (ctx, s) => ctx.sleep(Math.max(0, ctx.__labT0 + s * 1000 - Date.now()));
  const labSeg = (about, wait, run) => ({
    about, async stage(ctx) { if (wait) await wait(ctx); }, verify: async () => true,
    async go(ctx) { const [m, mark] = marks(); mark("seg", { since: Math.round((Date.now() - (ctx.__labT0 ?? Date.now())) / 100) / 10 }); await run(ctx, mark); mark("cast-end", await readCast(ctx)); return m; },
  });
  // LEAN WINDOWS: the camera is placed during each (unrecorded) wait; go() records only the moment the edit uses
  const win = (about, wait, run) => labSeg(about, wait, run);
  const LAB_SEGS = {
    T2Lab1: {
      about: "AI LAB 1 — the request (UI), takeoff, the flight, the Lab reveal",
      async stage(ctx) {
        await labShot(false).stage(ctx);
        await ctx.click("Call the toucan");
        await until(ctx, () => !!document.querySelector("[data-testid='ai-workforce-start']"), "the AI Workforce entry", undefined, 25000);
        await ctx.sleep(1800);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "player",
      async go(ctx) {
        const [m, mark] = marks(); mark("cast", { ...(await readCast(ctx)), seated: ctx.__seated });
        await ctx.sleep(1200);
        ctx.__labT0 = Date.now(); mark("request"); await ctx.click("Preview a sample task");
        await labAt(ctx, 1.9); mark("ui-held");
        await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 38);
        await film(ctx, { kind: "path", ease: "io", lookTarget: "bird", lookUp: 4, keys: [{ t: 0, P: [1180, 170, 1300], L: [708, 34, 760], fov: 38 }, { t: 3600, P: [790, 112, 720], L: [712, 66, 600], fov: 34 }] }); mark("A");
        await untilStatus(ctx, "flying to the AI Lab", 20000); mark("liftoff");
        await labAt(ctx, 4.7);
        await film(ctx, { kind: "follow", target: "bird", back: 46, side: 24, up: 22, lead: 40, lookUp: 0, k: 4, fov: 46, blend: 1200 }); mark("B");
        await until(ctx, () => __vo3d.toucan.root.getWorldPosition(__vo3d.R.playerCamera.position.clone()).z < -230, "the bird over the campus", undefined, 20000);
        await film(ctx, { kind: "path", ease: "io", fromCurrent: true, keys: [{ t: 3600, P: [1260, 430, -230], L: [740, 30, -700], fov: 44 }] }); mark("C");
        await ctx.sleep(3700);
        await film(ctx, { kind: "path", ease: "sine", fromCurrent: true, keys: [{ t: 9000, P: [1120, 300, -340], L: [760, 60, -720], fov: 42 }] }); mark("C2");
        await ctx.sleep(1600); mark("end");
        return m;
      },
    },
    T2Lab1b: win("AI LAB 1b — meet the team at the brief: Milo, Nova, Pip",
      async (ctx) => { await labAt(ctx, 21.2); await film(ctx, { kind: "orbit", target: "milo", r0: 74, r1: 58, a0: -75, a1: -45, h0: 28, h1: 20, lookUp: 6, ms: 2600, fov: 34 }); },
      async (ctx, mark) => {
        mark("D-milo"); await ctx.sleep(2600);
        await film(ctx, { kind: "orbit", target: "nova", r0: 74, r1: 58, a0: -105, a1: -135, h0: 28, h1: 20, lookUp: 6, ms: 2600, fov: 34 }); mark("D-nova"); await ctx.sleep(2600);
        await film(ctx, { kind: "orbit", target: "pip", r0: 64, r1: 54, a0: -55, a1: -80, h0: 24, h1: 18, lookUp: 6, ms: 2600, fov: 34 }); mark("D-pip"); await ctx.sleep(2600);
        await film(ctx, { kind: "orbit", target: { x: 740, y: 20, z: -570 }, r0: 170, r1: 150, a0: 60, a1: 95, h0: 80, h1: 66, ms: 6000, fov: 40 }); mark("brief"); await ctx.sleep(2200);
      }),
    T2Lab2a: win("AI LAB 2a — Nova at work",
      async (ctx) => { await untilStatus(ctx, "Nova is heading", 60000); await labAt(ctx, 44); await film(ctx, { kind: "orbit", target: "nova", r0: 88, r1: 72, a0: 10, a1: 40, h0: 46, h1: 36, lookUp: 10, ms: 8500, fov: 38 }); await untilStatus(ctx, "Nova is working", 30000); },
      async (ctx, mark) => { mark("nova-working"); await ctx.sleep(3200); }),
    T2Lab2b: win("AI LAB 2b — Nova carries the work to Milo",
      async (ctx) => { await untilStatus(ctx, "taking the work to Milo", 30000); await ctx.sleep(1500); await film(ctx, { kind: "follow", target: "nova", back: 0, side: -70, up: 34, lead: 20, lookUp: 12, k: 3, fov: 40, blend: 900 }); await ctx.sleep(900); },
      async (ctx, mark) => { mark("nova-walk"); await ctx.sleep(3000); }),
    T2Lab2c: win("AI LAB 2c — the handoff to Milo",
      async (ctx) => { await labAt(ctx, 60.5); await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [575, 72, -455], L: [613, 22, -530], fov: 38 }, { t: 5000, P: [588, 64, -466], L: [613, 22, -530], fov: 36 }] }); },
      async (ctx, mark) => { mark("handoff-1"); await untilStatus(ctx, "Milo has the work", 30000); mark("milo-has"); await ctx.sleep(1600); }),
    T2Lab3: win("AI LAB 3 — Milo builds",
      async (ctx) => { await untilStatus(ctx, "Milo is heading", 30000); await labAt(ctx, 79); await film(ctx, { kind: "orbit", target: "milo", r0: 88, r1: 72, a0: 170, a1: 140, h0: 46, h1: 36, lookUp: 10, ms: 9000, fov: 38 }); await untilStatus(ctx, "Milo is working", 30000); },
      async (ctx, mark) => { mark("milo-working"); await ctx.sleep(3200); }),
    T2Lab4: win("AI LAB 4 — Milo hands the work to Pip",
      async (ctx) => { await labAt(ctx, 94.5); await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [835, 72, -455], L: [867, 22, -530], fov: 38 }, { t: 5500, P: [846, 64, -464], L: [867, 22, -530], fov: 36 }] }); },
      async (ctx, mark) => { mark("handoff-2"); await untilStatus(ctx, "Pip has the work", 30000); mark("pip-has"); await ctx.sleep(1600); }),
    T2Lab5: win("AI LAB 5 — Pip reviews",
      async (ctx) => { await untilStatus(ctx, "Pip is heading", 30000); await labAt(ctx, 108); await film(ctx, { kind: "orbit", target: "pip", r0: 82, r1: 68, a0: 160, a1: 190, h0: 44, h1: 34, lookUp: 10, ms: 8000, fov: 38 }); await untilStatus(ctx, "Pip is reviewing", 30000); },
      async (ctx, mark) => { mark("pip-reviewing"); await ctx.sleep(3400); }),
    T2Lab6a: win("AI LAB 6a — Toucan carries the result home",
      async (ctx) => { await untilStatus(ctx, "bringing you the result", 60000); await ctx.sleep(500); await film(ctx, { kind: "follow", target: "bird", dir0: [0, 1], back: 50, side: -26, up: 22, lead: 40, lookUp: 0, k: 4, fov: 46 }); await ctx.sleep(600); },
      async (ctx, mark) => { mark("return"); await ctx.sleep(2600); }),
    T2Lab6b: win("AI LAB 6b — the result reaches Bon in-app; he opens it and approves",
      async (ctx) => { await untilStatus(ctx, "back with you", 30000).catch(() => {}); await filmOff(ctx); await hideUi(ctx, []); await ctx.sleep(1400); },
      async (ctx, mark) => {
        mark("bon"); await untilStatus(ctx, "Result delivered", 20000); mark("delivered"); await ctx.sleep(1900);
        await byTest(ctx, "ailab-view-result"); mark("result"); await ctx.sleep(2800);
        await ctx.click("Approve"); mark("approved"); await ctx.sleep(2400);
      }),
  };

  // ---- FULL CUT — tolerant beat runners: every beat is marked; a failing beat is recorded (never hidden) and the take
  // carries on; the "Check" twin of each shot snaps a still after every beat instead of recording. ----
  const SHOTS = H.SHOTS;
  const byText = (ctx, re) => ctx.vo((src) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom <= innerHeight && r.right <= innerWidth; };
    const rx = new RegExp(src, "i");
    const b = [...document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem],[role=option],a")].filter(vis)
      .find((e) => rx.test((e.getAttribute("aria-label") || "") + " " + (e.textContent || "")));
    if (!b) return false; b.click(); return true;
  }, re);
  const clickAny = async (ctx, re) => {
    const pt = await ctx.vo((src) => {
      const rx = new RegExp(src, "i"), vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && getComputedStyle(e).visibility !== "hidden"; };
      const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
      const hits = [...document.querySelectorAll("body *")].filter((e) => vis(e) && (rx.test(e.getAttribute("aria-label") || "") || rx.test(own(e))));
      if (!hits.length) return null;
      hits.sort((x, y) => x.getBoundingClientRect().width * x.getBoundingClientRect().height - y.getBoundingClientRect().width * y.getBoundingClientRect().height);
      const r = hits[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, re);
    if (!pt) return false;
    await ctx.page.mouse.click(pt.x, pt.y); await ctx.sleep(120); await ctx.page.mouse.move(1919, 1079); return true;
  };
  const typeIn = async (ctx, sel, text) => { await ctx.page.click(sel).catch(() => {}); for (const ch of text) { await ctx.page.keyboard.type(ch); await ctx.sleep(55 + Math.random() * 45); } };
  function beats(name, about, stage, list) {
    const mk = (check) => ({
      about: `${about}${check ? " (CHECK: stills)" : ""}`, stage, verify: async () => true,
      async go(ctx) {
        const [m, mark] = marks(); mark("cast", await readCast(ctx));
        for (const [bn, fn] of list) {
          mark(bn);
          try { await fn(ctx, mark); mark(`${bn}:ok`); } catch (e) { mark(`${bn}:FAILED`, { error: String(e?.message ?? e).slice(0, 160) }); }
          if (check) await ctx.snap(`t2c-${name}-${bn}`);
        }
        mark("cast-end", await readCast(ctx));
        return m;
      },
    });
    return { [name]: mk(false), [`${name}Check`]: mk(true) };
  }
  const dayPlayer = async (ctx, seats = SEATS) => {
    await attendance(ctx, "in"); await closePanels(ctx); await lib(ctx);
    await ctx.vo(() => window.__t2?.film?.stop?.()); await hideUi(ctx, []);
    // every day shot is on the ground floor: an upstairs (or off-map) body gets a fresh page, then the ground-floor restore
    const off = () => ctx.vo(() => { const p = __vo3d.player.position(); return __vo3d.floor() !== "floor-1" || Math.abs(p.x) > 3000 || Math.abs(p.z) > 3000; });
    if (await off()) {
      await fresh(ctx); await ctx.vo(() => window.__t2?.film?.stop?.());
      if (await ctx.vo(() => __vo3d.floor() !== "floor-1")) { await ctx.vo(() => __vo3d.restoreGroundFloor()); await until(ctx, () => __vo3d.floor() === "floor-1", "the ground floor", undefined, 30000); await ctx.sleep(2500); }
      await ctx.vo(() => { __vo3d.player.teleport(740, 790); }); await ctx.sleep(800);
    }
    ctx.__seated = await seatCast(ctx, seats);
    await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
    await ctx.vo(() => { document.activeElement?.blur?.(); });
    await hideHint(ctx); await toPlayer(ctx); await hud(ctx, "full"); await hideUi(ctx, []);
    await ctx.page.mouse.move(1919, 1079); await ctx.sleep(1500);
  };
  /** Player view, robustly: the real C key first; then the product's own mode switch; then a reload and once more */
  const toPlayer = async (ctx) => {
    try { await view(ctx, "player"); return; } catch {}
    for (let i = 0; i < 2; i++) {
      const ok = await ctx.vo(() => { __vo3d.setCameraMode("player"); return __vo3d.cameraModes.mode === "player"; });
      if (ok) return;
      await ctx.vo(() => __vo3d.selfMovement.walkTo(740, 760)); await ctx.sleep(4000);
    }
    await ctx.vo(() => location.reload()).catch(() => {}); await ctx.sleep(9000);
    await until(ctx, () => !!window.__vo3d?.selfMovement, "the 3D office", undefined, 60000);
    await lib(ctx); await view(ctx, "player");
  };
  const close = async (ctx) => { await closePanels(ctx); await ctx.vo(() => { document.activeElement?.blur?.(); }); };
  const wrapDay = (name) => SHOTS?.[name] && {
    about: `${SHOTS[name].about} — on today's build, daylight`,
    async stage(ctx) { await SHOTS[name].stage(ctx); await lib(ctx); await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); }); await ctx.sleep(1200); },
    verify: SHOTS[name].verify, go: SHOTS[name].go,
  };
  const FULL = {
    T2Conv: wrapDay("PVConversation"),
    T2Video: wrapDay("PVSpatialVideo"),
    ...beats("T2UI", "TOOLS — profile, room details, notifications, a colleague's character, rewards (demo), settings; each at its own place", (ctx) => dayPlayer(ctx), [
      ["profile-spot", (ctx) => toolSpot(ctx, { x: 690, z: 620 }, { x: 560, z: 480 }, 0.1)],
      ["profile", async (ctx) => { await ctx.click("Open my profile"); await ctx.sleep(500); }],
      ["feed", async (ctx) => { if (!(await byText(ctx, "^\\s*Feed\\s*$"))) throw new Error("no Feed tab"); await ctx.sleep(1700); }],
      ["achievements", async (ctx) => { if (!(await byText(ctx, "Achievements"))) throw new Error("no Achievements tab"); await ctx.sleep(1400); }],
      ["badge", async (ctx) => { if (!(await byText(ctx, "Badges|Badge"))) throw new Error("no badge control"); await ctx.sleep(1500); }],
      ["rooms-spot", async (ctx) => { await close(ctx); await ctx.vo(() => document.activeElement?.blur?.()); await view(ctx, "explore"); await set3d(ctx, { x: 330, z: 470, pitch: 52, yaw: 25, zoom: 0.9 }); await ctx.sleep(1200); }],
      ["rooms", async (ctx) => { await ctx.click("Open room details"); await ctx.sleep(2000); }],
      ["room-design", async (ctx) => { await ctx.sleep(1600); }],
      ["back-to-player", async (ctx) => { await close(ctx); await toPlayer(ctx); await ctx.sleep(600); }],
      ["notif-spot", async (ctx) => { await close(ctx); await toolSpot(ctx, { x: 980, z: 800 }, { x: 760, z: 700 }, 0.1); }],
      ["notifications", async (ctx) => { if (!(await byText(ctx, "^Notifications"))) throw new Error("no Notifications"); await ctx.sleep(2000); }],
      ["alex-spot", async (ctx) => { await close(ctx); await toolSpot(ctx, { x: 1300, z: 250 }, { x: 1208, z: 90 }, 0.1); }],
      ["search-alex", async (ctx) => { await ctx.click("Search for a person"); await ctx.sleep(500); await ctx.page.keyboard.type("Alex", { delay: 120 }); await ctx.sleep(900); await ctx.sleep(1600); }],
      ["character", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Character\\s*$"))) throw new Error("no Character tab"); await ctx.sleep(2600); }],
      ["rewards-spot", async (ctx) => { await close(ctx); await toolSpot(ctx, { x: 860, z: 800 }, { x: 760, z: 640 }, 0.12); }],
      ["rewards", async (ctx) => { await ctx.click("Open Rewards"); await ctx.sleep(1800); }],
      ["reward-item", async (ctx) => { if (!(await clickAny(ctx, "Office Playlist"))) throw new Error("no affordable demo item"); await ctx.sleep(1500); }],
      ["history", async (ctx) => { if (!(await clickAny(ctx, "^\s*History\s*$"))) throw new Error("no History tab"); await ctx.sleep(1800); }],
      ["settings-spot", async (ctx) => { await close(ctx); await toolSpot(ctx, { x: 720, z: 1000 }, { x: 728, z: 900 }, 0.12); }],
      ["settings", async (ctx) => { await ctx.click("Settings"); await ctx.sleep(1500); }],
      ["controls", async (ctx) => { await byText(ctx, "^\\s*Controls"); await ctx.sleep(1100); }],
      ["audio", async (ctx) => { await byText(ctx, "^\\s*Audio"); await ctx.sleep(1100); }],
      ["graphics", async (ctx) => { await byText(ctx, "^\\s*Graphics"); await ctx.sleep(1100); }],
      ["environment", async (ctx) => { await byText(ctx, "^\\s*Environment"); await ctx.sleep(1300); }],
      ["end", async (ctx) => { await close(ctx); await ctx.sleep(400); }],
    ]),
    ...beats("T2Memory", "MEETING MEMORY — Memory tab, the recurring Product Sync, the receipt (decisions + evidence), before/after, a cited answer", (ctx) => dayPlayer(ctx), [
      ["spot", (ctx) => toolSpot(ctx, { x: 660, z: 560 }, { x: 560, z: 480 }, 0.1)],
      ["meetings", async (ctx) => { await ctx.click("Open meetings"); await ctx.sleep(1500); }],
      ["memory", async (ctx) => { if (!(await byText(ctx, "^\\s*Memory\\s*$"))) throw new Error("no Memory tab"); await ctx.sleep(1800); }],
      ["session", async (ctx) => { if (!(await byText(ctx, "Virtual Office Product Sync"))) throw new Error("no session"); await ctx.sleep(2600); }],
      ["scroll", async (ctx) => { await ctx.vo(() => { const d = document.querySelector("[aria-label='Summary']")?.closest("[class*='scroll'],[class*='body'],section") ?? document.scrollingElement; d.scrollBy?.({ top: 260, behavior: "smooth" }); }); await ctx.sleep(1800); }],
      ["ask", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Ask this meeting"))) throw new Error("no Ask this meeting"); await ctx.sleep(1100); }],
      ["question", async (ctx) => { await ctx.vo(() => { const i = [...document.querySelectorAll("textarea,input[type=text],input:not([type])")].find((e) => e.offsetParent); i?.focus(); }); await ctx.sleep(200); for (const ch of "When are we launching now?") { await ctx.page.keyboard.type(ch); await ctx.sleep(45); } await ctx.sleep(400); await ctx.page.keyboard.press("Enter"); await ctx.sleep(3800); }],
      ["end", async (ctx) => { await ctx.sleep(600); }],
    ]),
  };

  // ---- THE LAB, v3 (Bon's notes): a front-facing takeoff the bird flies past, a higher chase clear of the statue and
  // canopies, EYE-LEVEL three-quarter medium shots of the agents (faces, bodies, work), lean recorded windows ----
  const EYE = 2;   // camera height above an agent's head target ≈ eye level
  const L3 = {
    A: { kind: "path", ease: "io", lookTarget: "bird", lookUp: 2, keys: [{ t: 0, P: [812, 74, 650], L: [708, 34, 760], fov: 36 }, { t: 3800, P: [748, 84, 640], L: [712, 66, 600], fov: 40 }] },
    B: { kind: "follow", target: "bird", back: 46, side: 24, up: 30, lead: 30, lookUp: -16, k: 4, fov: 46, blend: 1000 },
    C: { kind: "path", ease: "io", fromCurrent: true, keys: [{ t: 4000, P: [1270, 460, -230], L: [740, 30, -700], fov: 44 }] },
    milo: { kind: "orbit", target: "milo", r0: 54, r1: 46, a0: -55, a1: -75, h0: EYE, h1: EYE, lookUp: -2, ms: 2600, fov: 34 },
    nova: { kind: "orbit", target: "nova", r0: 54, r1: 46, a0: -125, a1: -105, h0: EYE, h1: EYE, lookUp: -2, ms: 2600, fov: 34 },
    pip: { kind: "orbit", target: "pip", r0: 50, r1: 44, a0: -95, a1: -80, h0: EYE, h1: EYE, lookUp: -2, ms: 2600, fov: 34 },
    brief: { kind: "orbit", target: { x: 740, y: 18, z: -575 }, r0: 130, r1: 116, a0: -150, a1: -128, h0: 14, h1: 12, ms: 5000, fov: 40 },
    novaWork: { kind: "orbit", target: "nova", r0: 60, r1: 52, a0: -20, a1: 0, h0: 6, h1: 4, lookUp: -4, ms: 7000, fov: 36 },
    novaWalk: { kind: "follow", target: "nova", back: 4, side: 58, up: 12, lead: 22, lookUp: -4, k: 3, fov: 38, blend: 900 },
    hand1: { kind: "path", ease: "sine", keys: [{ t: 0, P: [566, 24, -470], L: [613, 18, -530], fov: 36 }, { t: 5000, P: [578, 22, -480], L: [613, 18, -530], fov: 34 }] },
    miloWork: { kind: "orbit", target: "milo", r0: 60, r1: 52, a0: 200, a1: 222, h0: 6, h1: 4, lookUp: -4, ms: 8000, fov: 36 },
    hand2: { kind: "path", ease: "sine", keys: [{ t: 0, P: [822, 24, -470], L: [867, 18, -530], fov: 36 }, { t: 5500, P: [834, 22, -480], L: [867, 18, -530], fov: 34 }] },
    pipWork: { kind: "orbit", target: "pip", r0: 58, r1: 50, a0: 190, a1: 212, h0: 6, h1: 4, lookUp: -4, ms: 7500, fov: 36 },
    back: { kind: "follow", target: "bird", dir0: [0, 1], back: 46, side: -24, up: 32, lead: 40, lookUp: -6, k: 4, fov: 46 },
  };
  async function lab3Opening(ctx, mark, snap) {
    await ctx.sleep(1200);
    ctx.__labT0 = Date.now(); mark("request"); await ctx.click("Preview a sample task");
    await labAt(ctx, 1.9); mark("ui-held"); await snap("01-ui");
    await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 36);
    await film(ctx, L3.A); mark("A"); await ctx.sleep(400); await snap("02-A");
    await untilStatus(ctx, "flying to the AI Lab", 20000); mark("liftoff");
    await labAt(ctx, 5.2); await snap("03-A-pass");
    await film(ctx, L3.B); mark("B"); await labAt(ctx, 7.0); await snap("04-B");
    await until(ctx, () => __vo3d.toucan.root.getWorldPosition(__vo3d.R.playerCamera.position.clone()).z < -150, "the bird over the campus", undefined, 20000);
    await film(ctx, L3.C); mark("C"); await ctx.sleep(4100); await snap("05-C");
    await film(ctx, { kind: "path", ease: "sine", fromCurrent: true, keys: [{ t: 9000, P: [1120, 300, -340], L: [760, 60, -720], fov: 42 }] }); mark("C2");
  }
  async function lab3Team(ctx, mark, snap) {
    await film(ctx, L3.milo); mark("D-milo"); await ctx.sleep(1300); await snap("06-milo"); await ctx.sleep(1300);
    await film(ctx, L3.nova); mark("D-nova"); await ctx.sleep(1300); await snap("07-nova"); await ctx.sleep(1300);
    await film(ctx, L3.pip); mark("D-pip"); await ctx.sleep(1300); await snap("08-pip"); await ctx.sleep(1300);
    await film(ctx, L3.brief); mark("brief"); await ctx.sleep(1500); await snap("09-brief"); await ctx.sleep(700);
  }
  const LAB3 = {
    T2Lab3Check: {
      about: "AI LAB v3 (CHECK: stills only) — the whole job with the new cameras",
      stage: LAB_SEGS.T2Lab1.stage, verify: async () => true,
      async go(ctx) {
        const [m, mark] = marks(); const snap = (n) => ctx.snap(`t2c-lab3-${n}`);
        await lab3Opening(ctx, mark, snap);
        await labAt(ctx, 21.2); await lab3Team(ctx, mark, snap);
        await untilStatus(ctx, "Nova is heading", 60000); await labAt(ctx, 44); await film(ctx, L3.novaWork); await untilStatus(ctx, "Nova is working", 30000); await ctx.sleep(1500); await snap("10-nova-work");
        await untilStatus(ctx, "taking the work to Milo", 30000); await ctx.sleep(1500); await film(ctx, L3.novaWalk); await ctx.sleep(1800); await snap("11-nova-walk");
        await labAt(ctx, 60.5); await film(ctx, L3.hand1); await untilStatus(ctx, "Milo has the work", 30000); await snap("12-hand1");
        await untilStatus(ctx, "Milo is heading", 30000); await labAt(ctx, 79); await film(ctx, L3.miloWork); await untilStatus(ctx, "Milo is working", 30000); await ctx.sleep(1500); await snap("13-milo-work");
        await labAt(ctx, 94.5); await film(ctx, L3.hand2); await untilStatus(ctx, "Pip has the work", 30000); await snap("14-hand2");
        await untilStatus(ctx, "Pip is heading", 30000); await labAt(ctx, 108); await film(ctx, L3.pipWork); await untilStatus(ctx, "Pip is reviewing", 30000); await ctx.sleep(1500); await snap("15-pip-work");
        await untilStatus(ctx, "bringing you the result", 60000); await ctx.sleep(500); await film(ctx, L3.back); await ctx.sleep(2200); await snap("16-back");
        await untilStatus(ctx, "back with you", 30000).catch(() => {}); await filmOff(ctx); await hideUi(ctx, []);
        await untilStatus(ctx, "Result delivered", 20000); await ctx.sleep(1900); await byTest(ctx, "ailab-view-result"); await ctx.sleep(2800); await ctx.click("Approve"); await ctx.sleep(2000);
        return m;
      },
    },
    T2Lab3a: { about: "AI LAB v3 1 — the request, a front-facing takeoff, the chase, the reveal", stage: LAB_SEGS.T2Lab1.stage, verify: async () => true,
      async go(ctx) { const [m, mark] = marks(); mark("cast", await readCast(ctx)); await lab3Opening(ctx, mark, async () => {}); await ctx.sleep(1600); mark("end"); return m; } },
    T2Lab3b: labSeg("AI LAB v3 2 — meet the team (eye level)", async (ctx) => { await labAt(ctx, 21.0); },
      async (ctx, mark) => { await lab3Team(ctx, mark, async () => {}); }),
    T2Lab3c: labSeg("AI LAB v3 3 — Nova designs", async (ctx) => { await untilStatus(ctx, "Nova is heading", 60000); await labAt(ctx, 44); await film(ctx, L3.novaWork); await untilStatus(ctx, "Nova is working", 30000); },
      async (ctx, mark) => { mark("nova-working"); await ctx.sleep(3300); }),
    T2Lab3d: labSeg("AI LAB v3 4 — Nova carries the work to Milo", async (ctx) => { await untilStatus(ctx, "taking the work to Milo", 30000); await ctx.sleep(1500); await film(ctx, L3.novaWalk); await ctx.sleep(900); },
      async (ctx, mark) => { mark("nova-walk"); await ctx.sleep(3000); }),
    T2Lab3e: labSeg("AI LAB v3 5 — the handoff to Milo", async (ctx) => { await labAt(ctx, 60.5); await film(ctx, L3.hand1); },
      async (ctx, mark) => { mark("handoff-1"); await untilStatus(ctx, "Milo has the work", 30000); mark("milo-has"); await ctx.sleep(1600); }),
    T2Lab3f: labSeg("AI LAB v3 6 — Milo builds", async (ctx) => { await untilStatus(ctx, "Milo is heading", 30000); await labAt(ctx, 79); await film(ctx, L3.miloWork); await untilStatus(ctx, "Milo is working", 30000); },
      async (ctx, mark) => { mark("milo-working"); await ctx.sleep(3300); }),
    T2Lab3g: labSeg("AI LAB v3 7 — Milo hands the work to Pip", async (ctx) => { await labAt(ctx, 94.5); await film(ctx, L3.hand2); },
      async (ctx, mark) => { mark("handoff-2"); await untilStatus(ctx, "Pip has the work", 30000); mark("pip-has"); await ctx.sleep(1600); }),
    T2Lab3h: labSeg("AI LAB v3 8 — Pip reviews", async (ctx) => { await untilStatus(ctx, "Pip is heading", 30000); await labAt(ctx, 108); await film(ctx, L3.pipWork); await untilStatus(ctx, "Pip is reviewing", 30000); },
      async (ctx, mark) => { mark("pip-reviewing"); await ctx.sleep(3500); }),
    T2Lab3i: labSeg("AI LAB v3 9 — Toucan carries the result home", async (ctx) => { await untilStatus(ctx, "bringing you the result", 60000); await ctx.sleep(500); await film(ctx, L3.back); await ctx.sleep(600); },
      async (ctx, mark) => { mark("return"); await ctx.sleep(2600); }),
    T2Lab3j: LAB_SEGS.T2Lab6b,
  };

  // ---- the rest of the film: environment, out and about, the workday close, the elevator callback + Floor 2, Toucan, CAVE ----
  const filmPath = (ctx, keys, ease = "io") => film(ctx, { kind: "path", ease, keys });
  const REST = {
    ...beats("T2Env", "ENVIRONMENT — one slow drone move while the day turns to sunset, night and a storm; the weather pill; a real reload with the loader", async (ctx) => {
      await dayPlayer(ctx); await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 40);
      await filmPath(ctx, [{ t: 0, P: [1760, 600, 1560], L: [700, 0, 560], fov: 40 }, { t: 400, P: [1755, 598, 1556], L: [700, 0, 560], fov: 40 }]); await ctx.sleep(1500);
    }, [
      ["drone", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [1760, 600, 1560], L: [700, 0, 560], fov: 40 }, { t: 12500, P: [1500, 470, 1330], L: [720, 0, 520], fov: 38 }], "sine"); await ctx.sleep(2500); }],
      ["sunset", async (ctx) => { await ctx.vo(() => __vo3d.env.setTime("sunset")); await ctx.sleep(2600); }],
      ["night", async (ctx) => { await ctx.vo(() => __vo3d.env.setTime("night")); await ctx.sleep(2600); }],
      ["storm", async (ctx) => { await ctx.vo(() => __vo3d.weather.setWeather("storm")); await ctx.sleep(1400); await ctx.vo(() => __vo3d.weather.strike?.()); await ctx.sleep(2200); }],
      ["pill", async (ctx) => { await filmOff(ctx); await hideUi(ctx, []); await toolSpot(ctx, { x: 740, z: 790 }, { x: 740, z: 600 }, 0.14); await ctx.sleep(2400); }],
      ["reload", async (ctx) => { await ctx.vo(() => { __vo3d.weather.setWeather("clear"); __vo3d.env.setTime("day"); setTimeout(() => location.reload(), 80); }).catch(() => {}); await ctx.sleep(6500); }],
    ]),
    ...beats("T2Out", "OUT AND ABOUT — Leaving at the kiosk (not checkout), out the door, the street, the expansion crew, a scooter with its speedometer", (ctx) => dayPlayer(ctx), [
      ["kiosk", async (ctx) => { await toolSpot(ctx, { x: 552, z: 1066 }, { x: 552, z: 1120 }, 0.16); await ctx.vo(() => __vo3d.reception.startApproach(__vo3d.reception.kioskId)); await ctx.sleep(2200); }],
      ["leaving", async (ctx) => { if (!(await clickAny(ctx, "^\\\\s*Leaving"))) throw new Error("no Leaving option"); await ctx.sleep(1500); await clickAny(ctx, "Lunch|Errand|Break|Out for"); await ctx.sleep(1200); await clickAny(ctx, "^\\\\s*(Confirm|Done|Set|Save|Go)\\\\b"); await ctx.sleep(1800); }],
      ["exit", async (ctx) => { await close(ctx); await toolSpot(ctx, { x: 720, z: 1120 }, { x: 720, z: 1260 }, 0.1); await ctx.hold(["KeyW"], 2600); await ctx.sleep(600); }],
      ["street", async (ctx) => { await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 40); await filmPath(ctx, [{ t: 0, P: [1010, 62, 1210], L: [760, 12, 1300], fov: 40 }, { t: 4200, P: [930, 52, 1230], L: [700, 12, 1310], fov: 38 }], "sine"); await ctx.sleep(4300); }],
      ["crew", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [770, 70, -110], L: [560, 14, -290], fov: 40 }, { t: 4200, P: [730, 56, -150], L: [560, 14, -290], fov: 36 }], "sine"); await ctx.sleep(4300); }],
      ["scooter", async (ctx) => {
        await filmOff(ctx); await hideUi(ctx, []);
        const r = await ctx.vo(() => { const s = __vo3d.player.scooters; const c = s.candidates?.() ?? []; const first = Array.isArray(c) ? c[0] : null; return { n: Array.isArray(c) ? c.length : typeof c, first: first ? JSON.stringify(first).slice(0, 160) : null }; });
        if (!r.first) throw new Error(`no scooter candidates (${r.n})`);
        const pos = JSON.parse(r.first); const at = pos.at ?? pos.pos ?? pos;
        await toolSpot(ctx, { x: (at.x ?? 0) + 14, z: (at.z ?? 0) + 14 }, { x: at.x ?? 0, z: at.z ?? 0 }, 0.1);
        const m = await ctx.vo((id) => { try { return JSON.stringify(__vo3d.player.scooters.mount(id)).slice(0, 120); } catch (e) { return "mount failed: " + e; } }, pos.id ?? null);
        if (/fail|false|null/.test(String(m))) { await ctx.press("KeyE"); }
        await ctx.sleep(900);
      }],
      ["ride", async (ctx) => { await ctx.hold(["KeyW", "ShiftLeft"], 4200); await ctx.sleep(500); }],
    ]),
    T2Cave: SHOTS?.CaveV2 && {
      about: "CAVE — Player view at the championship portal: the Cave opens around Bon, a slow look round (today's build, daylight)",
      async stage(ctx) {
        await lib(ctx); await ctx.vo(() => window.__t2?.film?.stop?.()); await hideUi(ctx, []);
        if (await ctx.vo(() => __vo3d.floor() !== "floor-1")) {   // down by the real lift (standing up first if seated)
          await ctx.press("KeyE").catch(() => {}); await ctx.sleep(1500); await ctx.vo(() => __vo3d.elevator());
          await until(ctx, () => __vo3d.floor() === "floor-1", "the ground floor", undefined, 60000); await ctx.sleep(3000);
        }
        await SHOTS.CaveV2.stage(ctx); await lib(ctx); await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); }); await ctx.sleep(1500);
      },
      verify: SHOTS.CaveV2.verify, go: SHOTS.CaveV2.go,
    },
  };

  // ==== THE COMPLETE CUT (Bon, 2026-10-09 PM): natural blocking throughout — colleagues face each other or their
  // work, Bon faces the Toucan, the Go Together party is REAL (invited, accepted and walked through the product's own
  // party protocol), the world turns through day → sunset → night → rain on one continuous 360° orbit ====
  const SCRATCH = "/private/tmp/claude-501/-Users-lekoffshorly-Documents-AI-Agents/8af1557c-538a-4ebf-8343-8363132ceb4e/scratchpad";
  const MAIL = { alex: "alex@offshorly.com", micah: "micah@offshorly.com" };
  const toV1 = (p) => ({ x: p.x - 10, y: p.z - 17.2 });
  const LIFT_V1 = toV1({ x: 108, z: 937 });
  const SEATS_PARTY = { ...SEATS, alex: "central-hub/cafe-chair-1-north", micah: "central-hub/cafe-chair-1-east" };
  const OFFICE_C = { x: 725, y: 0, z: 575 };
  let up2 = 0;
  /** an UPSTAIRS walk, sent exactly as the product's own feed sends one (adapters/v1SelfMovement movedInPlace /
   *  satInPlace): V1's lift coordinate rides as the anchor, the real Meeting Floor points as the local walk */
  const upstairs = (ctx, k, path, ms, { state = "standing", seatKey = null, yaw } = {}) => {
    const from = ctx.__up?.[k] ?? path[0], end = path.at(-1), dur = Math.max(100, Math.min(20000, Math.round(ms))), id = `film2-${k}-${++up2}-${Date.now()}`;
    ctx.puppets.emit(k, "walk_started", { movementId: id, origin: LIFT_V1, path: [LIFT_V1], roomId: "floor-2", durationMs: dur, localOrigin: { x: from.x, y: from.z }, localPath: path.map((p) => ({ x: p.x, y: p.z })) });
    (ctx.__up ??= {})[k] = end; ctx.puppets.at.set(k, LIFT_V1);
    return new Promise((done) => setTimeout(() => {
      ctx.puppets.emit(k, "walk_arrived", { movementId: id, at: LIFT_V1, facing: "front", state, seatKey, roomId: "floor-2", localAt: { x: end.x, y: end.z }, ...(yaw === undefined ? {} : { yaw }) });
      done();
    }, dur));
  };
  /** Bon's own route, sampled in his page — colleagues walking WITH him trail it (never through a wall he did not walk through) */
  const trailOn = (ctx) => ctx.vo(() => {
    clearInterval(window.__t2trailT); window.__t2trail = [];
    window.__t2trailT = setInterval(() => { const p = __vo3d.avatar.worldPosition(); window.__t2trail.push([performance.now(), p.x, p.z, __vo3d.floor()]); if (window.__t2trail.length > 900) window.__t2trail.shift(); }, 110);
  });
  async function trail(ctx, k, lagMs, ref) {
    let last = null;
    while (!ref.stop) {
      const seg = await ctx.vo(({ lag, since }) => { const now = performance.now(), T = window.__t2trail ?? [], until = now - lag; return T.filter((q) => q[0] > (since ?? until - 600) && q[0] <= until); }, { lag: lagMs, since: last });
      if (seg.length < 2) { await ctx.sleep(200); continue; }
      const floor = seg.at(-1)[3], pts = seg.filter((q) => q[3] === floor).map((q) => ({ x: q[1], z: q[2] }));
      const span = Math.max(200, seg.at(-1)[0] - (last ?? seg[0][0])); last = seg.at(-1)[0];
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (len < 1.5) { await ctx.sleep(150); continue; }
      if (floor === "floor-1") await ctx.puppets.walk(k, pts.map(toV1), { speed: len / (span / 1000) });
      else await upstairs(ctx, k, pts, span);
    }
  }
  const bonAt = (ctx) => ctx.vo(() => { const p = __vo3d.avatar.worldPosition(); const s = __vo3d.goTogether.self(); return { x: p.x, z: p.z, floor: __vo3d.floor(), moving: s.moving, riding: s.riding }; });
  async function untilBon(ctx, ok, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { const b = await bonAt(ctx); if (ok(b)) return b; await ctx.sleep(200); } return null; }
  /** GO TOGETHER — Alex and Micah take part through the product's own party protocol: they accept the invitation, say
   *  where they are, walk to their own slot for every stage (gather, lift lobby, off the lift, the room) and report ready */
  function partyDriver(ctx, who = MAIL) {
    const S = { log: [], done: {}, refs: {}, last: null, chat: [] };
    const ready = (k, stageId, floor) => { ctx.puppets.emit(k, "party_ready", { stageId, floor }); S.log.push([Date.now(), k, "ready", stageId]); };
    const onUpdate = async (k, email, payload) => {
      const p = payload?.party; if (!p) return;
      S.last = p.stage; S.party = p;
      if (p.stage === "forming") { const at = ctx.puppets.at.get(k); if (at) ctx.puppets.emit(k, "party_where", { floor: "floor-1", roomId: null, position: { x: at.x + 10, z: at.y + 17.2 } }); return; }
      const order = p.rendezvous?.participants ?? [], i = order.indexOf(email); if (i < 0) return;
      const stageId = p.stage === "gathering" ? p.rendezvous?.stageId : p.leg?.stageId;
      if (!stageId || S.done[k] === stageId) return;
      if (!["gathering", "to_lift", "ride", "to_room"].includes(p.stage)) return;
      S.done[k] = stageId; S.log.push([Date.now(), k, p.stage, stageId, i]);
      if (S.refs[k]) S.refs[k].stop = true;
      const lag = 420 + 480 * Math.max(0, i - 1);
      if (p.stage === "gathering") {
        const t = await ctx.vo(async ({ i, n }) => { const m = await import("/virtual-office/src/dev/vo3d/app/goTogether.ts"); return m.rendezvousSlot(__vo3d.goTogether.hub().point, i, n); }, { i, n: order.length });
        await ctx.sleep(500 + 500 * i);                                  // they finish the thought, then get up
        await walkPuppet(ctx, k, t, { speed: 82 }); await ctx.sleep(250); ready(k, stageId, "floor-1");
      } else if (p.stage === "to_lift") {
        const lobby = await ctx.vo(({ f, i }) => __vo3d.goTogether.liftLobby(f, i), { f: p.leg.floor, i });
        const ref = (S.refs[k] = { stop: false }), run = trail(ctx, k, lag, ref);
        await untilBon(ctx, (b) => Math.hypot(b.x - 108, b.z - 937) < 70 && !b.moving, 60000);
        ref.stop = true; await run;
        await walkPuppet(ctx, k, lobby, { speed: 80 }); ready(k, stageId, "floor-1");
      } else if (p.stage === "ride") {
        await untilBon(ctx, (b) => b.floor === p.leg.toFloor, 90000); await ctx.sleep(2400);
        const spot = await ctx.vo(({ f, i }) => __vo3d.goTogether.liftLobby(f, i), { f: p.leg.toFloor, i });
        (ctx.__up ??= {})[k] = spot; await upstairs(ctx, k, [spot], 120); ready(k, stageId, p.leg.toFloor);
      } else if (p.stage === "to_room") {
        const ref = (S.refs[k] = { stop: false }), run = trail(ctx, k, lag, ref);
        const a = await ctx.vo(({ dest }) => __vo3d.goTogether.arrival(dest), { dest: p.destination });
        await untilBon(ctx, (b) => a && Math.hypot(b.x - a.point.x, b.z - a.point.z) < 60 && !b.moving, 60000);
        ref.stop = true; await run;
        const t = await ctx.vo(async ({ dest, i }) => { const m = await import("/virtual-office/src/dev/vo3d/app/goTogether.ts"); const a = __vo3d.goTogether.arrival(dest); return a && m.arrivalSlot(a.point, a.into, i); }, { dest: p.destination, i });
        if (t) await upstairs(ctx, k, [t], 700);
        ready(k, stageId, "floor-2");
      }
    };
    for (const [k, email] of Object.entries(who)) {
      const s = ctx.puppets.s.get(k);
      for (const ev of ["party_invite_incoming", "party_updated", "party_ended", "party_chat"]) s.off(ev);
      s.on("party_invite_incoming", (inv) => { S.log.push([Date.now(), k, "invited"]); setTimeout(() => s.emit("party_invite_accept", { inviteId: inv.inviteId }), 1500 + 900 * Object.keys(who).indexOf(k)); });
      s.on("party_updated", (w) => onUpdate(k, email, w).catch((e) => S.log.push([Date.now(), k, "ERR", String(e?.message ?? e).slice(0, 140)])));
      s.on("party_ended", (e) => S.log.push([Date.now(), k, "ended", e?.reason]));
      s.on("party_chat", (c) => S.chat.push([Date.now(), c?.email, c?.text]));
    }
    ctx.__party = S;
    return S;
  }
  const say = (ctx, k, text) => ctx.puppets.emit(k, "party_chat_send", { text });
  /** Bon turns to FACE a point with one short real key tap (Player view moves relative to the camera) */
  async function faceToward(ctx, p, ms = 140) {
    await ctx.vo(() => document.activeElement?.blur?.());
    const key = await ctx.vo((p) => {
      const b = __vo3d.avatar.worldPosition(), c = __vo3d.R.playerCamera, V = c.position.constructor, f = new V(); c.getWorldDirection(f);
      const fx = f.x, fz = f.z, n = Math.hypot(fx, fz) || 1, dx = p.x - b.x, dz = p.z - b.z, m = Math.hypot(dx, dz) || 1;
      const fw = (fx * dx + fz * dz) / (n * m), rt = (-fz * dx + fx * dz) / (n * m);
      return Math.abs(fw) >= Math.abs(rt) ? (fw > 0 ? "KeyW" : "KeyS") : (rt > 0 ? "KeyD" : "KeyA");
    }, p);
    await ctx.hold([key], ms); await ctx.sleep(250); return key;
  }
  const birdXZ = (ctx) => ctx.vo(() => { const p = __vo3d.toucan.root.getWorldPosition(__vo3d.R.playerCamera.position.clone()); return { x: p.x, y: p.y, z: p.z }; });
  const fresh = async (ctx) => { await ctx.vo(() => location.reload()).catch(() => {}); await ctx.sleep(8000); await until(ctx, () => !!window.__vo3d?.selfMovement && !!window.__vo3d?.toucan, "the 3D office", undefined, 90000); await ctx.sleep(2500); await lib(ctx); };
  const clearModals = async (ctx) => { for (const re of ["^\\s*Not yet\\s*$", "^\\s*Cancel checkout\\s*$", "^\\s*Cancel\\s*$", "^\\s*Close\\s*$"]) { if (await clickAny(ctx, re)) await ctx.sleep(500); } await close(ctx); };
  const setField = (ctx, sel, value, ev = "input") => ctx.vo(({ sel, value, ev }) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent); if (!el) return false;
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); el.dispatchEvent(new Event(ev, { bubbles: true })); if (ev !== "change") el.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }, { sel, value, ev });
  /** the next 5-minute slot that starts within the product's 5-minute reminder lead, in the page's own clock */
  /** pick people in the product's own picker dialog — clicks scoped to the dialog (never a name pill in the world) */
  const pickPeople = (ctx, names, confirm) => ctx.vo(async ({ names, confirm }) => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = () => [...document.querySelectorAll("[role=dialog]")].find((d) => d.offsetParent && [...d.querySelectorAll("button")].some((b) => /Invite|Done/.test(b.innerText)));
    for (let i = 0; i < 20 && !dlg(); i++) await sl(150);
    const d = dlg(); if (!d) return "no picker";
    for (const n of names) { const b = [...d.querySelectorAll("button")].find((x) => x.innerText.split("\n").some((l) => l.trim() === n)); if (!b) return `no ${n}`; if (b.getAttribute("aria-pressed") !== "true") b.click(); await sl(380); }
    const c = [...d.querySelectorAll("button")].find((x) => new RegExp(confirm).test(x.innerText)); if (!c || c.disabled) return "no confirm"; c.click(); return "ok";
  }, { names, confirm });
  const nextSlot = (ctx) => ctx.vo(() => { const d = new Date(Date.now() + 75000); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; });
  async function look(ctx) {
    const { readFile } = await import("node:fs/promises");
    const L = JSON.parse(await readFile(`${SCRATCH}/look.json`, "utf8")), out = [];
    await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 40);
    for (const s of L) {
      if (s.env) await ctx.vo((e) => { if (e.time) __vo3d.env.setTime(e.time); if (e.weather) __vo3d.weather.setWeather(e.weather); }, s.env);
      const P = s.orbit ? [OFFICE_C.x + Math.cos((s.orbit.a * Math.PI) / 180) * s.orbit.r, s.orbit.h, OFFICE_C.z + Math.sin((s.orbit.a * Math.PI) / 180) * s.orbit.r] : s.P;
      const Lk = s.orbit ? [OFFICE_C.x, s.orbit.ly ?? 0, OFFICE_C.z] : s.L;
      await film(ctx, { kind: "path", keys: [{ t: 0, P, L: Lk, fov: s.fov ?? 40 }, { t: 50, P, L: Lk, fov: s.fov ?? 40 }] });
      await ctx.sleep(s.wait ?? 700); out.push(await ctx.snap(`look-${s.name}`));
    }
    await filmOff(ctx); await hideUi(ctx, []);
    return out;
  }
  const ORBIT = { r: 1350, h: 420, ly: 0, a0: 40, fov: 40, ms: 12600 };
  const PROD = {
    T2Look: { about: "CAMERA SCOUT — stills only, poses from the scratchpad look.json", async stage(ctx) { await lib(ctx); await closePanels(ctx); await hideHint(ctx); await toPlayer(ctx); await ctx.sleep(1500); }, verify: async () => true, go: look },
    ...beats("T2Orbit", "THE WORLD AROUND US — one continuous 360° orbit of the whole office while the day turns to sunset, night and rain (the product's own Settings presets, blended by the product)", async (ctx) => {
      await dayPlayer(ctx); await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); });
      await hideUi(ctx, HIDE_FILM); await filmOn(ctx, ORBIT.fov);
      await film(ctx, { kind: "orbit", target: OFFICE_C, r0: ORBIT.r, r1: ORBIT.r, a0: ORBIT.a0 - 8, a1: ORBIT.a0, h0: ORBIT.h, h1: ORBIT.h, lookUp: ORBIT.ly, ms: 400, ease: "lin", fov: ORBIT.fov });
      await ctx.sleep(3000);
    }, [
      ["orbit", async (ctx) => { await film(ctx, { kind: "orbit", target: OFFICE_C, r0: ORBIT.r, r1: ORBIT.r, a0: ORBIT.a0, a1: ORBIT.a0 + 360, h0: ORBIT.h, h1: ORBIT.h, lookUp: ORBIT.ly, ms: ORBIT.ms, ease: "lin", fov: ORBIT.fov }); await ctx.sleep(2800); }],
      ["sunset", async (ctx) => { await ctx.vo(() => __vo3d.env.setTime("sunset")); await ctx.sleep(3000); }],
      ["night", async (ctx) => { await ctx.vo(() => __vo3d.env.setTime("night")); await ctx.sleep(2900); }],
      ["rain", async (ctx) => { await ctx.vo(() => __vo3d.weather.setWeather("rain")); await ctx.sleep(4600); }],
    ]),
    ...beats("T2Street", "BEYOND THE WALLS — the street and its traffic, the company lot, the expansion crew at work (film camera, daylight)", async (ctx) => {
      await dayPlayer(ctx); await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 40);
      await filmPath(ctx, [{ t: 0, P: [1010, 62, 1210], L: [760, 12, 1300], fov: 40 }, { t: 50, P: [1010, 62, 1210], L: [760, 12, 1300], fov: 40 }]); await ctx.sleep(1500);
    }, [
      ["street", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [1010, 62, 1210], L: [760, 12, 1300], fov: 40 }, { t: 4200, P: [930, 52, 1230], L: [700, 12, 1310], fov: 38 }], "sine"); await ctx.sleep(4300); }],
      ["layby", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [420, 150, 1150], L: [560, 0, 1350], fov: 40 }, { t: 4200, P: [470, 130, 1172], L: [600, 0, 1352], fov: 38 }], "sine"); await ctx.sleep(4300); }],
      ["lot", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [-330, 120, 1120], L: [-600, 0, 860], fov: 40 }, { t: 4200, P: [-385, 96, 1062], L: [-620, 0, 880], fov: 38 }], "sine"); await ctx.sleep(4300); }],
      ["crew", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [300, 140, -100], L: [530, 10, -320], fov: 40 }, { t: 4200, P: [336, 118, -136], L: [535, 10, -325], fov: 38 }], "sine"); await ctx.sleep(4300); }],
    ]),
    ...beats("T2Traffic", "THE STREET — real traffic passing the lay-by (jeepney, tricycles, the kalesa) in front of the office; the shot rolls as a car approaches", async (ctx) => {
      await dayPlayer(ctx); await hideUi(ctx, HIDE_FILM); await filmOn(ctx, 38);
      await filmPath(ctx, [{ t: 0, P: [1000, 46, 1790], L: [760, 18, 1480], fov: 38 }, { t: 50, P: [1000, 46, 1790], L: [760, 18, 1480], fov: 38 }]);
      const cars = () => ctx.vo(() => { const o = __vo3d.R.scene.getObjectByName("traffic-gloss"), M = __vo3d.R.playerCamera.matrixWorld.constructor, m = new M(), V = __vo3d.R.playerCamera.position.constructor, p = new V(), r = []; for (let i = 0; i < o.instanceCount; i += 2) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.z > 1530 && p.z < 1710) r.push([i, p.x]); } return r; });
      const t = Date.now();
      while (Date.now() - t < 45000) {
        const a = await cars(ctx); await ctx.sleep(250); const b = await cars(ctx);
        const hit = b.find(([i, x]) => { const q = a.find((c) => c[0] === i); if (!q) return false; const vx = (x - q[1]) / 0.25; return Math.abs(vx) > 60 && (760 - x) / vx > 1.4 && (760 - x) / vx < 2.6; });
        if (hit) { ctx.__car = hit; break; }
      }
    }, [
      ["traffic", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [1000, 46, 1790], L: [760, 18, 1480], fov: 38 }, { t: 5200, P: [905, 40, 1796], L: [700, 18, 1480], fov: 37 }], "sine"); await ctx.sleep(5300); }],
    ]),
    ...beats("T2Scooter", "SCOOTER — a shared scooter from the Reception dock: mount, ride, the speedometer reading the ground (Player view, daylight)", async (ctx) => {
      await dayPlayer(ctx);
      await ctx.vo(() => { __vo3d.player.teleport(1150, 1236); __vo3d.cave.look(1, 0, 0.1); }); await ctx.sleep(1500);
    }, [
      ["mount", async (ctx) => { const c = await ctx.vo(() => __vo3d.player.scooters.candidates()); if (!c.length) throw new Error("no scooter in reach"); const ok = await ctx.vo((id) => __vo3d.player.scooters.mount(id), c[0]); if (!ok) throw new Error(`mount refused ${c[0]}`); await ctx.sleep(900); }],
      ["ride", async (ctx) => { await ctx.hold(["KeyW"], 2600); }],
      ["boost", async (ctx) => { await ctx.hold(["KeyW", "ShiftLeft"], 2600); }],
      ["hud", async (ctx) => { const h = await ctx.vo(() => JSON.stringify(__vo3d.player.scooters.hud?.() ?? null).slice(0, 200)); ctx.__hud = h; await ctx.hold(["KeyW"], 1200); }],
      ["stop", async (ctx) => { await ctx.sleep(1500); await ctx.vo(() => __vo3d.player.scooters.dismount()); await ctx.sleep(800); }],
    ]),
    ...beats("T2Toucan2", "TOUCAN — Bon calls the bird, turns to face it as it lands, and asks what he missed (the deterministic catch-up, no AI call)", async (ctx) => {
      await dayPlayer(ctx, SEATS_TOOLS); await ctx.click("Dismiss the toucan").catch(() => {}); await ctx.sleep(600);
      await toolSpot(ctx, { x: 770, z: 735 }, { x: 690, z: 600 }, 0.1); await ctx.sleep(800);
      // a clean conversation for the take: open, start a new one, send the bird off again (all unrecorded)
      if (await clickAny(ctx, "^\\s*(Call|Ask) the toucan\\s*$")) { await until(ctx, () => !!document.querySelector("[data-testid='vo3d-toucan']"), "the Toucan panel", undefined, 20000).catch(() => {}); await ctx.sleep(800);
        await ctx.click("Start a new conversation").catch(() => {}); await ctx.sleep(600); await ctx.click("Dismiss the toucan").catch(() => {}); await ctx.sleep(6000); }
    }, [
      ["call", async (ctx) => { if (!(await clickAny(ctx, "^\\s*(Call|Ask) the toucan\\s*$"))) throw new Error("no toucan button"); await until(ctx, () => !!document.querySelector("[data-testid='vo3d-toucan']"), "the Toucan panel", undefined, 20000); await ctx.sleep(2600); }],
      ["face", async (ctx) => { ctx.__faced = await faceToward(ctx, await birdXZ(ctx)); await ctx.sleep(900); }],
      ["ask", async (ctx) => { await ctx.vo(() => { const i = [...document.querySelectorAll("[data-testid='vo3d-toucan'] textarea, [data-testid='vo3d-toucan'] input")].find((e) => e.offsetParent); if (i) { Object.getOwnPropertyDescriptor(i.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); } }); for (const ch of "What did I miss?") { await ctx.page.keyboard.type(ch); await ctx.sleep(55); } await ctx.sleep(300); await ctx.page.keyboard.press("Enter"); await ctx.sleep(4600); }],
    ]),
    ...beats("T2Close", "THE WORKDAY CLOSE — night: Bon heads for the doors, 'Leaving?' → Check Out → 'Ready to wrap up your day?' → today's log → submit → out into the night", async (ctx) => {
      await fresh(ctx); await dayPlayer(ctx); await clearModals(ctx); await ctx.vo(() => __vo3d.env.setTime("night"));
      await toolSpot(ctx, { x: 722, z: 1050 }, { x: 726, z: 1200 }, 0.14); await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 42); await filmPath(ctx, [{ t: 0, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }, { t: 50, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }]); await ctx.sleep(900);
    }, [
      ["walk", async (ctx) => { await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }, { t: 3400, P: [650, 58, 990], L: [718, 18, 1118], fov: 40 }] }); await ctx.sleep(500); await ctx.hold(["KeyW"], 1000); await until(ctx, () => !!document.querySelector("[aria-label='Leaving the office']"), "the Leaving card", undefined, 6000); await ctx.sleep(1200); }],
      ["checkout", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Check Out\\s*$"))) throw new Error("no Check Out"); await ctx.sleep(1800); }],
      ["start", async (ctx) => { await filmOff(ctx); await hideUi(ctx, []); if (!(await clickAny(ctx, "^\\s*Start checkout\\s*$"))) throw new Error("no Start checkout"); await until(ctx, () => [...document.querySelectorAll("button")].some((b) => /Log today.s work/.test(b.textContent) && b.offsetParent), "the time summary", undefined, 30000); await ctx.sleep(1600); }],
      ["summary", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Log today.s work\\s*$"))) throw new Error("no Log today's work"); await until(ctx, () => !!document.querySelector("input[aria-label='Hours']"), "the time log", undefined, 12000); await ctx.sleep(900); }],
      ["log", async (ctx) => {
        const fill = async () => {
          const w = await ctx.vo(() => (document.body.innerText.match(/Worked today:\s*([^·\n]+)/) || [])[1] ?? "");
          const h = +(w.match(/(\d+)\s*h/) || [0, 0])[1], m = +(w.match(/(\d+)\s*m/) || [0, 0])[1]; ctx.__worked = w;
          await setField(ctx, "input[aria-label='Hours']", String(h)); await setField(ctx, "input[aria-label='Minutes']", String(m));
        };
        await fill();
        ctx.__cat = await ctx.vo(() => {
          const s = [...document.querySelectorAll("select")].find((e) => e.offsetParent && [...e.options].some((o) => /Select a category/i.test(o.text)));
          const o = s && [...s.options].find((o) => o.value); if (!o) return null;
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value); s.dispatchEvent(new Event("change", { bubbles: true })); return o.text;
        });
        await ctx.vo(() => { const t = [...document.querySelectorAll("textarea")].find((e) => e.offsetParent); t?.focus(); });
        for (const ch of "Teaser 2: camera passes and the edit") { await ctx.page.keyboard.type(ch); await ctx.sleep(26); }
        await ctx.sleep(500); await fill(); await ctx.sleep(700);
      }],
      ["review", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Review log\\s*$"))) throw new Error("no Review log"); await ctx.sleep(1500); }],
      ["submit", async (ctx) => { const ok = await ctx.vo(() => { const b = [...document.querySelectorAll("button")].find((e) => /Submit log and check out/.test(e.textContent)); return b ? !b.disabled : null; }); if (!ok) throw new Error(`submit not enabled (${ok}; worked ${ctx.__worked}; cat ${ctx.__cat})`); await clickAny(ctx, "Submit log and check out"); await ctx.sleep(1200); await until(ctx, () => /Checkout time/.test(document.body.innerText), "the checkout summary", undefined, 15000); await ctx.sleep(2200); }],
      ["done", async (ctx) => { await clickAny(ctx, "^\\s*Close\\s*$"); await ctx.sleep(900); }],
      ["walk-out", async (ctx) => { await toPlayer(ctx).catch(() => {}); await ctx.vo(() => __vo3d.selfMovement.walkTo(722, 1265)); await ctx.sleep(3800); }],
    ]),
    ...beats("T2PartyA", "GO TOGETHER 1 — at the café with Alex and Micah: Bon schedules the Product Sync in Echo (Floor 2) for a few minutes from now and invites them", async (ctx) => {
      ctx.__up = {}; await dayPlayer(ctx, SEATS_PARTY); await clearModals(ctx); partyDriver(ctx); await trailOn(ctx);
      await toolSpot(ctx, { x: 640, z: 560 }, { x: 600, z: 500 }, 0.12); await ctx.sleep(900);
    }, [
      ["meetings", async (ctx) => { await ctx.click("Open meetings"); await ctx.sleep(1300); }],
      ["schedule", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Schedule meeting\\s*$"))) throw new Error("no Schedule meeting"); await ctx.sleep(900); }],
      ["title", async (ctx) => { await ctx.vo(() => document.querySelector("input[placeholder='Product sync']")?.focus()); for (const ch of "Product Sync") { await ctx.page.keyboard.type(ch); await ctx.sleep(45); } await ctx.sleep(300); }],
      ["time", async (ctx) => { ctx.__slot = await nextSlot(ctx); if (!(await setField(ctx, "input[type=time]", ctx.__slot))) throw new Error("no time field"); await until(ctx, () => !!document.querySelector("[data-testid='meeting-room-echo']"), "the free rooms", undefined, 10000); await ctx.sleep(500); }],
      ["invite", async (ctx) => { await ctx.vo(() => document.querySelector("[data-testid='meeting-invite']")?.click()); const r = await pickPeople(ctx, ["Alex", "Micah"], "^\\s*Invite 2\\s*$"); if (r !== "ok") throw new Error(`picker: ${r}`); await ctx.sleep(800); }],
      ["room", async (ctx) => { await until(ctx, () => { const b = document.querySelector("[data-testid='meeting-room-echo']"); return !!b && !b.disabled; }, "Echo free", undefined, 10000).catch(() => {}); const ok = await ctx.vo(() => { const b = document.querySelector("[data-testid='meeting-room-echo']"); if (!b || b.disabled) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; }); if (!ok) throw new Error("Echo not free"); await ctx.sleep(900); }],
      ["save", async (ctx) => { const ok = await ctx.vo(() => { const b = document.querySelector("[data-testid='meeting-save']"); if (!b || b.disabled) return false; b.click(); return true; }); if (!ok) throw new Error("Schedule disabled"); await until(ctx, () => !document.querySelector("[data-testid='meeting-save']"), "the booking", undefined, 8000); await ctx.sleep(1500); }],
      ["close", async (ctx) => { await close(ctx); await ctx.sleep(500); }],
    ]),
    ...beats("T2PartyB", "GO TOGETHER 2 — 'Starting soon' → Go together → Alex and Micah accept → Start Walking: they get up and gather with Bon", async (ctx) => {
      await until(ctx, () => !!document.querySelector("[data-testid='meeting-reminder-go-together']"), "the meeting reminder", undefined, 60000); await ctx.sleep(800);
    }, [
      ["go-together", async (ctx) => { await ctx.vo(() => document.querySelector("[data-testid='meeting-reminder-go-together']")?.click()); await ctx.sleep(900); }],
      ["pick", async (ctx) => { const r = await pickPeople(ctx, ["Alex", "Micah"], "^\\s*Invite 2 people\\s*$"); if (r !== "ok") throw new Error(`picker: ${r}`); await ctx.sleep(700); }],
      ["accepted", async (ctx) => { await until(ctx, () => !!document.querySelector("[data-testid='go-together-start']"), "Start Walking", undefined, 15000); await ctx.sleep(1400); }],
      ["start", async (ctx) => { await ctx.vo(() => document.querySelector("[data-testid='go-together-start']")?.click()); await ctx.sleep(4200); }],
    ]),
    ...beats("T2PartyC", "GO TOGETHER 3 — the party walks to the lift together, talking on the way (travel chat), a tracking shot alongside", async (ctx) => {
      const t = Date.now(); while (ctx.__party?.last !== "to_lift" && Date.now() - t < 60000) await ctx.sleep(250);
      await ctx.sleep(600); await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 44);
      await film(ctx, { kind: "follow", target: "bon", back: -150, side: 22, up: 62, lead: -70, lookUp: -18, k: 2.0, fov: 44 }); await ctx.sleep(1600);
    }, [
      ["walk", async (ctx) => { await ctx.sleep(500); say(ctx, "alex", "I've got the launch numbers 📈"); await ctx.sleep(2600); say(ctx, "micah", "And the new homepage designs!"); await ctx.sleep(3600); }],
    ]),
    ...beats("T2PartyD", "GO TOGETHER 4 — the callback: the doors close on the three of them (01); they open on the Meeting Floor (02) and the party steps out", async (ctx) => {
      await untilBon(ctx, (b) => Math.hypot(b.x - 108, b.z - 937) < 300, 60000);
      await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [262, 48, 937], L: [80, 24, 937], fov: 42 }, { t: 9000, P: [232, 44, 937], L: [80, 24, 937], fov: 40 }] });
    }, [
      ["lift", async (ctx) => { await untilBon(ctx, (b) => b.riding, 40000); await ctx.sleep(2600); }],
      ["ride", async (ctx) => { await untilBon(ctx, (b) => b.floor === "floor-2", 40000);
        await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [6262, 48, 622], L: [6080, 24, 622], fov: 42 }, { t: 7000, P: [6238, 44, 622], L: [6080, 24, 622], fov: 40 }] }); await ctx.sleep(6500); }],
    ]),
    ...beats("T2PartyE", "GO TOGETHER 5 — over the Meeting Floor as the party walks to Echo; they take their seats facing each other", async (ctx) => {
      await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 42);
      await filmPath(ctx, [{ t: 0, P: [6060, 70, 640], L: [6500, 10, 622], fov: 44 }, { t: 50, P: [6060, 70, 640], L: [6500, 10, 622], fov: 44 }]);
    }, [
      ["crane", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [6060, 70, 640], L: [6500, 10, 622], fov: 44 }, { t: 6000, P: [6300, 230, 760], L: [6820, 0, 600], fov: 42 }], "sine"); await ctx.sleep(6100); }],
      ["arrive", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [7080, 160, 470], L: [7268, 10, 300], fov: 40 }, { t: 5000, P: [7140, 120, 430], L: [7268, 10, 260], fov: 38 }], "sine"); await untilBon(ctx, (b) => Math.hypot(b.x - 7268, b.z - 322) < 90 && !b.moving, 30000); await ctx.sleep(800); }],
      ["seats", async (ctx) => {
        const ch = await ctx.vo(async () => { const s = await import("/virtual-office/src/dev/vo3d/app/seats.ts"); return s.meetingFloorSeatAnchors().filter((a) => a.id.startsWith("floor-2/echo/")).map((a) => ({ id: a.id, x: a.point.x, z: a.point.z, yaw: a.yaw ?? null })); });
        ctx.__echo = ch; const pick = (n) => ch.find((c) => c.id.endsWith(`chair-${n}`));
        await ctx.vo(() => __vo3d.selfMovement.sit("floor-2/echo/chair-0"));
        const t = Date.now(); while (Date.now() - t < 9000 && !["alex", "micah"].every((k) => ctx.__party?.log.some((e) => e[1] === k && e[2] === "ended"))) await ctx.sleep(200);
        await ctx.sleep(400);
        for (const [k, n, lag] of [["alex", 1, 0], ["micah", 3, 450]]) { const c = pick(n); if (!c) continue; const from = ctx.__up?.[k] ?? { x: 7268, z: 300 };
          setTimeout(() => upstairs(ctx, k, [{ x: from.x, z: Math.min(from.z, 300) }, { x: c.x, z: c.z + 26 }, { x: c.x, z: c.z }], 1700, { state: "sitting", seatKey: `v2:${c.id}`, ...(c.yaw == null ? {} : { yaw: c.yaw }) }), lag); }
        await ctx.sleep(4600);
      }],
    ]),
    ...beats("T2Down", "LIFT DOWN — after the meeting, Bon takes the lift back to the office floor", async (ctx) => {
      await filmOff(ctx); await hideUi(ctx, []); await ctx.vo(() => __vo3d.cave.look(-1, 0.4, 0.12)); await ctx.sleep(1500);
    }, [
      ["call", async (ctx) => { await ctx.vo(() => __vo3d.elevator()); await untilBon(ctx, (b) => b.riding, 30000); await ctx.sleep(400); }],
      ["down", async (ctx) => { await untilBon(ctx, (b) => b.floor === "floor-1", 40000); await ctx.sleep(3200); }],
    ]),
    ...beats("T2Exit", "LEAVING? — Bon heads for the doors; the product asks where he is going (not a check-out): 'Go to the AI Lab' — and out he goes", async (ctx) => {
      await fresh(ctx); await dayPlayer(ctx); await clearModals(ctx); await castTo(ctx, { nicole: OPENING_END.nicole, kael: OPENING_END.kael, jona: OPENING_END.jona });
      await toolSpot(ctx, { x: 722, z: 1050 }, { x: 726, z: 1200 }, 0.14); await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 42); await filmPath(ctx, [{ t: 0, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }, { t: 50, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }]); await ctx.sleep(900);
    }, [
      ["walk", async (ctx) => { await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }, { t: 3400, P: [650, 58, 990], L: [718, 18, 1118], fov: 40 }] }); await ctx.sleep(500); await ctx.hold(["KeyW"], 1000); await until(ctx, () => !!document.querySelector("[aria-label='Leaving the office']"), "the Leaving card", undefined, 6000); await ctx.sleep(1400); }],
      ["ai-lab", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Go to the AI Lab\\s*$"))) throw new Error("no Go to the AI Lab"); await ctx.sleep(700); }],
      ["out", async (ctx) => { await film(ctx, { kind: "follow", target: "bon", dir0: [0, 1], back: 80, side: -30, up: 26, lead: 30, lookUp: -10, k: 2.5, fov: 42, blend: 1200 }); await ctx.hold(["KeyW"], 3800); await ctx.sleep(600); }],
    ]),
    T2Lab4a: {
      about: "AI LAB v4 1 — Bon turns to the Toucan, asks; the bird answers 'Got it', Bon watches it go; the front-facing takeoff, the chase, the reveal",
      async stage(ctx) { await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); }); await LAB_SEGS.T2Lab1.stage(ctx); await ctx.vo(() => { __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); }); await ctx.sleep(1500); },
      verify: async () => true,
      async go(ctx) {
        const [m, mark] = marks(); mark("cast", await readCast(ctx));
        // THE TWO-SHOT: eye level, square to the line between Bon and the perched bird, from the open (south) side
        const two = await ctx.vo(() => {
          const b = __vo3d.toucan.root.getWorldPosition(__vo3d.R.playerCamera.position.clone()), p = __vo3d.avatar.worldPosition();
          const dx = b.x - p.x, dz = b.z - p.z, n = Math.hypot(dx, dz) || 1, ux = dx / n, uz = dz / n;
          let nx = -uz, nz = ux; if (nz < 0) { nx = -nx; nz = -nz; }
          const M = [(b.x + p.x) / 2, (b.y + 30) / 2 + 2, (b.z + p.z) / 2];
          return { P: [M[0] + nx * 78, M[1] + 8, M[2] + nz * 78], L: M, bird: [b.x, b.y, b.z].map(Math.round) };
        });
        await filmOn(ctx, 36);
        await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: two.P, L: two.L, fov: 36 }, { t: 6000, P: [two.P[0] + (two.L[0] - two.P[0]) * 0.12, two.P[1], two.P[2] + (two.L[2] - two.P[2]) * 0.12], L: two.L, fov: 34 }] });
        await ctx.sleep(900); mark("face", { key: await faceToward(ctx, { x: two.bird[0], z: two.bird[2] }), two }); await ctx.sleep(1400);
        ctx.__labT0 = Date.now(); mark("request"); await ctx.click("Preview a sample task");
        await labAt(ctx, 1.9); mark("ui-held");
        await untilStatus(ctx, "flying to the AI Lab", 20000); mark("liftoff");
        await ctx.sleep(350); mark("watch", { key: await faceToward(ctx, { x: 728, z: 300 }, 120) });
        await hideUi(ctx, HIDE_FILM); await film(ctx, L3.A); mark("A");
        await labAt(ctx, 7.0); await film(ctx, { kind: "follow", target: "bird", back: 34, side: 130, up: 46, lead: 30, lookUp: -10, k: 4, fov: 46, blend: 900 }); mark("B");
        await until(ctx, () => __vo3d.toucan.root.getWorldPosition(__vo3d.R.playerCamera.position.clone()).z < -150, "the bird over the campus", undefined, 20000);
        await film(ctx, L3.C); mark("C"); await ctx.sleep(4100);
        await film(ctx, { kind: "path", ease: "sine", fromCurrent: true, keys: [{ t: 9000, P: [1120, 300, -340], L: [760, 60, -720], fov: 42 }] }); mark("C2");
        await ctx.sleep(1600); mark("end"); return m;
      },
    },
  };


  // ==== GO TOGETHER × 4 (Bon, 2026-10-09): Bon, Alex, Micah and Jan — the real party protocol; a loose social
  // formation (pairs, never a rigid file, every offset point tested against the floor's own walkability); a
  // conversational pause facing each other at the lift; doorway reveals; Echo seats paired across the table ====
  const MAIL4 = { alex: "alex@offshorly.com", micah: "micah@offshorly.com", jan: "jan@offshorly.com" };
  const SEATS_PARTY4 = { ...SEATS, alex: "central-hub/cafe-chair-1-north", micah: "central-hub/cafe-chair-1-south", jan: "central-hub/cafe-chair-1-west" };
  const FORM = { alex: { lag: 380, side: 21 }, micah: { lag: 980, side: -17 }, jan: { lag: 1180, side: 18 } };
  /** trail Bon's route with a lateral offset, each point kept only where the floor is walkable (else the route itself) */
  async function trailForm(ctx, k, f, ref, floor2 = false) {
    let last = null;
    while (!ref.stop) {
      const seg = await ctx.vo(({ lag, since, side }) => {
        const now = performance.now(), T = window.__t2trail ?? [], until = now - lag, w = __vo3d.walkability;
        const raw = T.filter((q) => q[0] > (since ?? until - 600) && q[0] <= until);
        return raw.map((q, i) => {
          const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)], dx = b[1] - a[1], dz = b[2] - a[2], n = Math.hypot(dx, dz) || 1;
          const ox = q[1] + (-dz / n) * side, oz = q[2] + (dx / n) * side;
          const ok = !!w && q[3] === __vo3d.floor() && w.walkable(Math.floor(ox / 16), Math.floor(oz / 16)) && w.walkable(Math.floor((ox + q[1]) / 32), Math.floor((oz + q[2]) / 32));
          return [q[0], ok ? ox : q[1], ok ? oz : q[2], q[3]];
        });
      }, { lag: f.lag, since: last, side: floor2 ? Math.sign(f.side) * 10 : f.side });
      if (seg.length < 2) { await ctx.sleep(200); continue; }
      const fl = seg.at(-1)[3], pts = seg.filter((q) => q[3] === fl).map((q) => ({ x: q[1], z: q[2] }));
      const span = Math.max(200, seg.at(-1)[0] - (last ?? seg[0][0])); last = seg.at(-1)[0];
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (len < 1.5) { await ctx.sleep(150); continue; }
      if (fl === "floor-1") await ctx.puppets.walk(k, pts.map(toV1), { speed: len / (span / 1000) });
      else await upstairs(ctx, k, pts, span);
    }
  }
  function partyDriver4(ctx, who = MAIL4) {
    const S = { log: [], done: {}, refs: {}, last: null };
    const ready = (k, stageId, floor) => { ctx.puppets.emit(k, "party_ready", { stageId, floor }); S.log.push([Date.now(), k, "ready", stageId]); };
    const keys = Object.keys(who);
    const onUpdate = async (k, email, payload) => {
      const p = payload?.party; if (!p) return;
      S.last = p.stage; S.party = p;
      if (p.stage === "forming") { const at = ctx.puppets.at.get(k); if (at) ctx.puppets.emit(k, "party_where", { floor: "floor-1", roomId: null, position: { x: at.x + 10, z: at.y + 17.2 } }); return; }
      const order = p.rendezvous?.participants ?? [], i = order.indexOf(email); if (i < 0) return;
      const stageId = p.stage === "gathering" ? p.rendezvous?.stageId : p.leg?.stageId;
      if (!stageId || S.done[k] === stageId || !["gathering", "to_lift", "ride", "to_room"].includes(p.stage)) return;
      S.done[k] = stageId; S.log.push([Date.now(), k, p.stage, stageId, i]);
      if (S.refs[k]) S.refs[k].stop = true;
      if (p.stage === "gathering") {
        const t = await ctx.vo(async ({ i, n }) => { const m = await import("/virtual-office/src/dev/vo3d/app/goTogether.ts"); return m.rendezvousSlot(__vo3d.goTogether.hub().point, i, n); }, { i, n: order.length });
        await ctx.sleep(450 + 420 * keys.indexOf(k));                    // they finish the thought, then get up
        const hub = await ctx.vo(() => __vo3d.goTogether.hub().point);
        await walkPuppet(ctx, k, t, { speed: 80, yaw: yawTo(t, hub) }); await ctx.sleep(250); ready(k, stageId, "floor-1");
      } else if (p.stage === "to_lift") {
        const lobby = await ctx.vo(({ f, i }) => __vo3d.goTogether.liftLobby(f, i), { f: p.leg.floor, i });
        const ref = (S.refs[k] = { stop: false }), run = trailForm(ctx, k, FORM[k], ref);
        await untilBon(ctx, (b) => Math.hypot(b.x - 108, b.z - 937) < 70 && !b.moving, 60000);
        ref.stop = true; await run;
        // THE PAUSE AT THE LIFT: onto their own lobby slot, turned in toward the group — a moment before the doors
        const slots = await ctx.vo(({ f, n }) => Array.from({ length: n }, (_, j) => __vo3d.goTogether.liftLobby(f, j)), { f: p.leg.floor, n: order.length });
        const c = { x: slots.reduce((a, q) => a + q.x, 0) / slots.length + 14, z: slots.reduce((a, q) => a + q.z, 0) / slots.length };
        await walkPuppet(ctx, k, lobby, { speed: 78, yaw: yawTo(lobby, c) });
        await ctx.sleep(2600 + 250 * keys.indexOf(k)); ready(k, stageId, "floor-1");
      } else if (p.stage === "ride") {
        await untilBon(ctx, (b) => b.floor === p.leg.toFloor, 90000); await ctx.sleep(2400);
        const spot = await ctx.vo(({ f, i }) => __vo3d.goTogether.liftLobby(f, i), { f: p.leg.toFloor, i });
        (ctx.__up ??= {})[k] = spot; await upstairs(ctx, k, [spot], 120); ready(k, stageId, p.leg.toFloor);
      } else if (p.stage === "to_room") {
        const ref = (S.refs[k] = { stop: false }), run = trailForm(ctx, k, FORM[k], ref, true);
        const a = await ctx.vo(({ dest }) => __vo3d.goTogether.arrival(dest), { dest: p.destination });
        await untilBon(ctx, (b) => a && Math.hypot(b.x - a.point.x, b.z - a.point.z) < 60 && !b.moving, 60000);
        ref.stop = true; await run;
        const t = await ctx.vo(async ({ dest, i }) => { const m = await import("/virtual-office/src/dev/vo3d/app/goTogether.ts"); const a = __vo3d.goTogether.arrival(dest); return a && m.arrivalSlot(a.point, a.into, i); }, { dest: p.destination, i });
        if (t) await upstairs(ctx, k, [t], 700);
        ready(k, stageId, "floor-2");
      }
    };
    for (const [k, email] of Object.entries(who)) {
      const s = ctx.puppets.s.get(k);
      for (const ev of ["party_invite_incoming", "party_updated", "party_ended", "party_chat"]) s.off(ev);
      s.on("party_invite_incoming", (inv) => { S.log.push([Date.now(), k, "invited"]); setTimeout(() => s.emit("party_invite_accept", { inviteId: inv.inviteId }), 1400 + 800 * keys.indexOf(k)); });
      s.on("party_updated", (w) => onUpdate(k, email, w).catch((e) => S.log.push([Date.now(), k, "ERR", String(e?.message ?? e).slice(0, 140)])));
      s.on("party_ended", (e) => S.log.push([Date.now(), k, "ended", e?.reason]));
    }
    ctx.__party = S; return S;
  }
  /** Bon's height against the cabin copies while the car runs (the sunk-in-the-lift diagnosis) */
  const liftHeights = (ctx) => ctx.vo(() => {
    const V = __vo3d.R.playerCamera.position.constructor, b = __vo3d.avatar.root.getWorldPosition(new V()), r = [];
    __vo3d.R.scene.getObjectByName("lift-riders")?.children.forEach((c) => { const w = c.getWorldPosition(new V()); r.push([Math.round(w.x), Math.round(w.y * 10) / 10, Math.round(w.z)]); });
    const cam = __vo3d.R.playerCamera.getWorldPosition(new V());
    return { bon: [Math.round(b.x), Math.round(b.y * 10) / 10, Math.round(b.z)], riders: r, cam: [Math.round(cam.x), Math.round(cam.y), Math.round(cam.z)], floor: __vo3d.floor() };
  });
  const PARTY4 = {
    T2PartyLog: { about: "DATA — the party driver log", async stage() {}, verify: async () => true, async go(ctx) { const S = ctx.__party; return { heights: ctx.__heights ?? null, last: S?.last, log: (S?.log ?? []).map((e) => [new Date(e[0]).toISOString().slice(11, 19), ...e.slice(1)]), party: S?.party ? { stage: S.party.stage, members: S.party.members, leg: S.party.leg, rv: S.party.rendezvous && { kind: S.party.rendezvous.kind, participants: S.party.rendezvous.participants, ready: S.party.rendezvous.ready } } : null }; } },
    ...beats("T2Party4A", "GO TOGETHER ×4 · 1 — at the café table with Alex, Micah and Jan: Bon schedules the Product Sync in Echo and invites all three", async (ctx) => {
      ctx.__up = {}; await fresh(ctx); await clickAny(ctx, "^\\s*End\\s*$");
      // a reload restores the floor Bon was last on: the journey starts from the ground floor
      if (await ctx.vo(() => __vo3d.floor() !== "floor-1")) { await ctx.vo(() => __vo3d.restoreGroundFloor()); await until(ctx, () => __vo3d.floor() === "floor-1", "the ground floor", undefined, 30000); await ctx.sleep(2500); }
      await dayPlayer(ctx, SEATS_PARTY4); await clearModals(ctx); partyDriver4(ctx); await trailOn(ctx);
      await toolSpot(ctx, { x: 682, z: 488 }, { x: 600, z: 488 }, 0.12); await ctx.sleep(900);
    }, [
      ["meetings", async (ctx) => { await ctx.click("Open meetings"); await ctx.sleep(1300); }],
      ["schedule", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Schedule meeting\\s*$"))) throw new Error("no Schedule meeting"); await ctx.sleep(900); }],
      ["title", async (ctx) => { await ctx.vo(() => document.querySelector("input[placeholder='Product sync']")?.focus()); for (const ch of "Product Sync") { await ctx.page.keyboard.type(ch); await ctx.sleep(45); } await ctx.sleep(300); }],
      ["time", async (ctx) => { ctx.__slot = await nextSlot(ctx); if (!(await setField(ctx, "input[type=time]", ctx.__slot))) throw new Error("no time field"); await until(ctx, () => !!document.querySelector("[data-testid='meeting-room-echo']"), "the free rooms", undefined, 10000); await ctx.sleep(500); }],
      ["invite", async (ctx) => { await ctx.vo(() => document.querySelector("[data-testid='meeting-invite']")?.click()); const r = await pickPeople(ctx, ["Alex", "Micah", "Jan"], "^\\s*Invite 3\\s*$"); if (r !== "ok") throw new Error(`picker: ${r}`); await ctx.sleep(800); }],
      ["room", async (ctx) => { await until(ctx, () => { const b = document.querySelector("[data-testid='meeting-room-echo']"); return !!b && !b.disabled; }, "Echo free", undefined, 10000).catch(() => {}); const ok = await ctx.vo(() => { const b = document.querySelector("[data-testid='meeting-room-echo']"); if (!b || b.disabled) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; }); if (!ok) throw new Error("Echo not free"); await ctx.sleep(900); }],
      ["save", async (ctx) => { const ok = await ctx.vo(() => { const b = document.querySelector("[data-testid='meeting-save']"); if (!b || b.disabled) return false; b.click(); return true; }); if (!ok) throw new Error("Schedule disabled"); await until(ctx, () => !document.querySelector("[data-testid='meeting-save']"), "the booking", undefined, 8000); await ctx.sleep(1500); }],
      ["close", async (ctx) => { await close(ctx); await ctx.sleep(500); }],
    ]),
    ...beats("T2Party4B", "GO TOGETHER ×4 · 2 — 'Starting soon' → Go together → all three accept → Start Walking: they get up and gather with Bon", async (ctx) => {
      await until(ctx, () => !!document.querySelector("[data-testid='meeting-reminder-go-together']"), "the meeting reminder", undefined, 60000); await ctx.sleep(800);
    }, [
      ["go-together", async (ctx) => { await ctx.vo(() => document.querySelector("[data-testid='meeting-reminder-go-together']")?.click()); await ctx.sleep(900); }],
      ["pick", async (ctx) => { const r = await pickPeople(ctx, ["Alex", "Micah", "Jan"], "^\\s*Invite 3 people\\s*$"); if (r !== "ok") throw new Error(`picker: ${r}`); await ctx.sleep(700); }],
      ["accepted", async (ctx) => { await until(ctx, () => !!document.querySelector("[data-testid='go-together-start']"), "Start Walking", undefined, 15000); await ctx.sleep(2400); }],
      ["start", async (ctx) => { await ctx.vo(() => document.querySelector("[data-testid='go-together-start']")?.click()); await ctx.sleep(4600); }],
    ]),
    ...beats("T2Party4C", "GO TOGETHER ×4 · 3 — walking together: a front tracking shot, then alongside (side tracking); Bon's own travel-chat line", async (ctx) => {
      const t = Date.now(); while (ctx.__party?.last !== "to_lift" && Date.now() - t < 60000) await ctx.sleep(250);
      await ctx.sleep(500); await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 44);
      await film(ctx, { kind: "follow", target: "bon", back: -150, side: 26, up: 58, lead: -80, lookUp: -16, k: 2.0, fov: 44 }); await ctx.sleep(1400);
    }, [
      ["front", async (ctx) => {
        await ctx.sleep(500); await ctx.press("Slash"); await ctx.sleep(250);
        for (const ch of "Echo's this way 👉") { await ctx.page.keyboard.type(ch); await ctx.sleep(42); }
        await ctx.page.keyboard.press("Enter"); await ctx.sleep(1100);
        ctx.puppets.emit("alex", "party_chat_send", { text: "Right behind you!" }); await ctx.sleep(1300);
        ctx.puppets.emit("jan", "party_chat_send", { text: "Bringing the launch numbers 📈" }); await ctx.sleep(900); }],
      ["side", async (ctx) => { await film(ctx, { kind: "follow", target: "bon", back: 30, side: 120, up: 72, lead: -20, lookUp: -26, k: 2.0, fov: 46, blend: 1400 }); await ctx.sleep(4400); }],
    ]),
    ...beats("T2Party4D", "GO TOGETHER ×4 · 4 — the wide group shot at the lift: a pause facing each other; into the car together (01); inside the car; the doors open on 02", async (ctx) => {
      await untilBon(ctx, (b) => Math.hypot(b.x - 108, b.z - 937) < 320, 60000);
      await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [300, 70, 1060], L: [104, 22, 940], fov: 44 }, { t: 9000, P: [262, 58, 1028], L: [100, 22, 938], fov: 42 }] });
    }, [
      ["lobby", async (ctx) => { await untilBon(ctx, (b) => Math.hypot(b.x - 108, b.z - 937) < 60 && !b.moving, 30000); await ctx.sleep(2200); }],
      ["doors", async (ctx) => { await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [262, 48, 937], L: [80, 24, 937], fov: 42 }, { t: 7000, P: [236, 44, 937], L: [80, 24, 937], fov: 40 }], blend: 900 }); await untilBon(ctx, (b) => b.riding, 40000); await ctx.sleep(2600); }],
      ["ride", async (ctx) => { ctx.__heights = [await liftHeights(ctx)]; await ctx.vo(() => window.__t2.liftFix(true));
        await untilBon(ctx, (b) => b.floor === "floor-2", 40000); ctx.__heights.push(await liftHeights(ctx));
        await film(ctx, { kind: "orbit", target: "group", r0: 62, r1: 54, a0: 204, a1: 192, h0: 34, h1: 30, lookUp: -4, ms: 3800, fov: 58 }); await ctx.sleep(900); ctx.__heights.push(await liftHeights(ctx)); await ctx.sleep(2300); }],
      ["reveal", async (ctx) => { await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [6300, 62, 652], L: [6090, 26, 622], fov: 42 }, { t: 6000, P: [6286, 58, 648], L: [6090, 26, 622], fov: 40 }] }); await ctx.sleep(5400); await ctx.vo(() => window.__t2.liftFix(false)); }],
    ]),
    ...beats("T2Party4E", "GO TOGETHER ×4 · 5 — together across the Meeting Floor to Echo; four seats paired across the table; Bon starts the meeting", async (ctx) => {
      await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 42);
      await film(ctx, { kind: "follow", target: "bon", back: -140, side: 24, up: 60, lead: -70, lookUp: -16, k: 2.0, fov: 44, blend: 800 });
    }, [
      ["walk", async (ctx) => { await ctx.sleep(4800); }],
      ["arrive", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [7080, 160, 470], L: [7268, 10, 300], fov: 40 }, { t: 5000, P: [7140, 120, 430], L: [7268, 10, 260], fov: 38 }], "sine"); await untilBon(ctx, (b) => Math.hypot(b.x - 7268, b.z - 322) < 90 && !b.moving, 30000); await ctx.sleep(600); }],
      ["seats", async (ctx) => {
        const ch = await ctx.vo(async () => { const s = await import("/virtual-office/src/dev/vo3d/app/seats.ts"); return s.meetingFloorSeatAnchors().filter((a) => a.id.startsWith("floor-2/echo/")).map((a) => ({ id: a.id, x: a.point.x, z: a.point.z, yaw: a.yaw ?? null })); });
        const pick = (n) => ch.find((c) => c.id.endsWith(`chair-${n}`));
        await ctx.vo(() => __vo3d.selfMovement.sit("floor-2/echo/chair-0"));
        const t = Date.now(); while (Date.now() - t < 9000 && !Object.keys(MAIL4).every((k) => ctx.__party?.log.some((e) => e[1] === k && e[2] === "ended"))) await ctx.sleep(200);
        await ctx.sleep(300);
        for (const [k, n, lag] of [["alex", 1, 0], ["jan", 2, 380], ["micah", 3, 760]]) { const c = pick(n); if (!c) continue; const from = ctx.__up?.[k] ?? { x: 7268, z: 300 };
          setTimeout(() => upstairs(ctx, k, [{ x: from.x, z: Math.min(from.z, 300) }, { x: c.x, z: c.z + (c.z > 140 ? 26 : -26) }, { x: c.x, z: c.z }], 1800, { state: "sitting", seatKey: `v2:${c.id}`, ...(c.yaw == null ? {} : { yaw: c.yaw }) }), lag); }
        await filmPath(ctx, [{ t: 0, P: [7378, 74, 214], L: [7262, 16, 140], fov: 50 }, { t: 7000, P: [7366, 68, 206], L: [7262, 16, 140], fov: 48 }], "sine");
        await ctx.sleep(4400);
      }],
      ["start", async (ctx) => { ctx.__started = await clickAny(ctx, "^\\s*Start meeting\\s*$"); await ctx.sleep(3200); }],
    ]),
  };

  // ==== SEASONS (Bon, 2026-10-09: authorized on the ISOLATED film DB only). The real creator controls publish the two
  // existing seasonal offices; the real Office Experience switch (confirm → reload → the startup loader) puts Bon in
  // each; a matched film camera holds the orbit's own final framing so the office transforms in place. ====
  const ORBIT_END = (() => { const a = (ORBIT.a0 * Math.PI) / 180; return { P: [OFFICE_C.x + Math.cos(a) * ORBIT.r, ORBIT.h, OFFICE_C.z + Math.sin(a) * ORBIT.r], L: [OFFICE_C.x, 0, OFFICE_C.z] }; })();
  const settingsOpen = async (ctx) => { await closePanels(ctx); await ctx.click("Settings"); await until(ctx, () => !!document.querySelector("[data-testid='office-experience-settings']"), "Settings → Office Experience", undefined, 12000); await ctx.sleep(700); };
  async function switchOffice(ctx, value, mark) {
    await settingsOpen(ctx);
    await ctx.vo((v) => { const l = document.querySelector(`[data-testid='office-experience-settings'] label[data-value='${v}']`); l?.scrollIntoView({ block: "center" }); l?.click(); }, value);
    await ctx.sleep(900); mark?.("picked");
    await ctx.vo(() => { window.__t2before = true; });
    const ok = await ctx.vo(() => { const b = [...document.querySelectorAll("[data-testid='office-experience-settings'] button")].find((x) => /Switch and reload/.test(x.textContent)); if (!b) return false; b.click(); return true; });
    if (!ok) throw new Error(`no Switch and reload for ${value}`);
    mark?.("reload"); await until(ctx, () => !window.__t2before, "the new document", undefined, 30000); await ctx.sleep(1500);
    await until(ctx, () => !!window.__vo3d?.selfMovement && !!window.__vo3d?.toucan, "the office after the switch", undefined, 90000);
    mark?.("loaded"); await ctx.sleep(2500); await lib(ctx);
  }
  const SEASONS = {
    T2SeasonPrep: { about: "DATA — publish the two seasonal offices through the real Creator Studio (film DB only)", async stage(ctx) { await dayPlayer(ctx); }, verify: async () => true,
      async go(ctx) {
        await settingsOpen(ctx); await until(ctx, () => !!document.querySelector("[data-testid='creator-studio']"), "Creator Studio", undefined, 12000).catch(() => {});
        const r = {};
        for (const k of ["halloween", "christmas"]) {
          r[k] = await ctx.vo(async (k) => {
            const row = document.querySelector(`[data-testid='creator-season-${k}']`); if (!row) return "no row";
            const st = row.querySelector(`[data-testid='creator-season-state-${k}']`)?.textContent ?? "";
            const b = [...row.querySelectorAll("button")].find((x) => /^\s*Publish\s*$/.test(x.textContent)); if (!b) return `no Publish (${st})`;
            b.click(); await new Promise((r) => setTimeout(r, 2500)); return "published: " + (row.querySelector(`[data-testid='creator-season-state-${k}']`)?.textContent ?? "");
          }, k);
        }
        r.saved = await ctx.vo(() => [...document.querySelectorAll("[data-testid='office-experience-settings'] input[type=radio]")].filter((i) => i.checked).map((i) => i.value));
        await closePanels(ctx); return r;
      } },
    ...beats("T2SeasonH", "SEASONS 1 — the real switch to the Halloween office: confirm → the startup loader → the office transformed, from the orbit's own final framing", async (ctx) => {
      await dayPlayer(ctx); await ctx.vo(() => { __vo3d.env.setTime("night"); __vo3d.weather.setWeather("clear"); });
    }, [
      ["matched", async (ctx) => { await closePanels(ctx); await ctx.vo(() => { __vo3d.env.setTime("night"); __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); }); await hideHint(ctx); await toPlayer(ctx).catch(() => {});
        await hideUi(ctx, HIDE_FILM); await filmOn(ctx, ORBIT.fov); await film(ctx, { kind: "orbit", target: OFFICE_C, r0: ORBIT.r, r1: ORBIT.r - 40, a0: ORBIT.a0 - 4, a1: ORBIT.a0 + 6, h0: ORBIT.h, h1: ORBIT.h - 20, ms: 6000, ease: "sine", fov: ORBIT.fov }); await ctx.sleep(6200); }],
      ["hub", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [420, 150, 770], L: [610, 25, 500], fov: 44 }, { t: 4000, P: [472, 118, 746], L: [622, 25, 490], fov: 42 }], "sine"); await ctx.sleep(4100); }],
    ]),
    ...beats("T2SeasonC", "SEASONS 2 — the switch to the White Christmas office, the same framing", async (ctx) => {
      await lib(ctx); await ctx.vo(() => window.__t2?.film?.stop?.()); await hideUi(ctx, []);
    }, [
      ["switch", async (ctx, mark) => { await switchOffice(ctx, "christmas", mark); }],
      ["matched", async (ctx) => { await closePanels(ctx); await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); }); await hideHint(ctx); await toPlayer(ctx).catch(() => {});
        await hideUi(ctx, HIDE_FILM); await filmOn(ctx, ORBIT.fov); await film(ctx, { kind: "orbit", target: OFFICE_C, r0: ORBIT.r, r1: ORBIT.r - 40, a0: ORBIT.a0 - 4, a1: ORBIT.a0 + 6, h0: ORBIT.h, h1: ORBIT.h - 20, ms: 6000, ease: "sine", fov: ORBIT.fov }); await ctx.sleep(6200); }],
      ["night", async (ctx) => { await ctx.vo(() => __vo3d.env.setTime("night")); await ctx.sleep(4500); }],
      ["hub", async (ctx) => { await filmPath(ctx, [{ t: 0, P: [420, 150, 770], L: [610, 25, 500], fov: 44 }, { t: 4000, P: [472, 118, 746], L: [622, 25, 490], fov: 42 }], "sine"); await ctx.sleep(4100); }],
    ]),
    T2SeasonRestore: { about: "DATA — back to the 3D Office (Bon's saved choice) and unpublish both seasons through the Creator Studio", async stage(ctx) { await lib(ctx); await ctx.vo(() => window.__t2?.film?.stop?.()); await hideUi(ctx, []); }, verify: async () => true,
      async go(ctx) {
        const [m, mark] = marks(); await switchOffice(ctx, "v2", mark).catch((e) => mark("switch-failed", { e: String(e).slice(0, 120) }));
        await settingsOpen(ctx); const r = {};
        for (const k of ["halloween", "christmas"]) {
          r[k] = await ctx.vo(async (k) => {
            const row = document.querySelector(`[data-testid='creator-season-${k}']`); if (!row) return "no row";
            const b = [...row.querySelectorAll("button")].find((x) => /^\s*Unpublish\s*$/.test(x.textContent)); if (!b) return "no Unpublish";
            b.click(); await new Promise((r) => setTimeout(r, 2500)); return "unpublished: " + (row.querySelector(`[data-testid='creator-season-state-${k}']`)?.textContent ?? "");
          }, k);
        }
        r.saved = await ctx.vo(() => [...document.querySelectorAll("[data-testid='office-experience-settings'] input[type=radio]")].filter((i) => i.checked).map((i) => i.value));
        await closePanels(ctx); return { r, m };
      } },
  };

  // ==== PEOPLE (Bon's revision, 2026-10-09): a believable conversation — Micah and Angelo mid-chat turn to Bon as he walks
  // up; the real interaction menu → Chat (a spatial conversation); film-only synthetic lines; the office moves behind ====
  const domTap = (ctx, label) => ctx.vo((label) => {
    const on = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const els = [...document.querySelectorAll("button,[role=button],[role=menuitem]")].filter(on);
    const hit = els.find((e) => (e.getAttribute("aria-label") ?? "") === label) ?? els.find((e) => (e.textContent ?? "").trim() === label) ?? els.find((e) => (e.textContent ?? "").trim().startsWith(label));
    if (!hit) return false; hit.click(); return true;
  }, label);
  const dmWith = async (ctx, email) => { const c = await ctx.api("jerevon@offshorly.com", "GET", "/conversations"); return c.find((x) => x.type === "dm" && x.participantIds.includes(email))?.id ?? null; };
  const TALK_M = { x: 762, z: 702 }, TALK_A = { x: 800, z: 690 };
  const SEATS_TALK = { ...SEATS, jan: "central-hub/cafe-chair-1-north", alex: "central-hub/cafe-chair-1-east" };
  const TALK = {
    ...beats("T2Talk", "PEOPLE — Bon walks up to Micah and Angelo mid-conversation; they turn to him; the real menu → Chat; a two-line exchange; the office moving behind", async (ctx) => {
      await dayPlayer(ctx, SEATS_TALK); await clearModals(ctx);
      await castTo(ctx, { micah: { at: TALK_M, face: TALK_A }, angelo: { at: TALK_A, face: TALK_M }, kael: { at: { x: 1010, z: 640 }, face: { x: 470, z: 640 } } });
      await toolSpot(ctx, { x: 652, z: 762 }, { x: 762, z: 702 }, 0.1); await ctx.sleep(1500);
    }, [
      ["walk", async (ctx) => {
        walkTo(ctx, "kael", { x: 470, z: 640 }, null, 62).catch(() => {});
        await ctx.hold(["KeyW"], 900); await ctx.sleep(250);
      }],
      ["turn", async (ctx) => { const b = await ctx.vo(() => __vo3d.player.position());
        // a three-quarter group shot from the open side: Bon left, Micah centre, Angelo right — every face readable
        const mid = { x: (b.x + TALK_M.x) / 2, z: (b.z + TALK_M.z) / 2 }, dx = TALK_M.x - b.x, dz = TALK_M.z - b.z, n = Math.hypot(dx, dz) || 1;
        let nx = -dz / n, nz = dx / n; if (nz < 0) { nx = -nx; nz = -nz; }
        await filmOn(ctx, 40); await filmPath(ctx, [{ t: 0, P: [mid.x + nx * 150 + dx * 0.25, 46, mid.z + nz * 150 + dz * 0.25], L: [mid.x + dx * 0.30, 22, mid.z + dz * 0.30], fov: 40 }, { t: 9000, P: [mid.x + nx * 132 + dx * 0.28, 42, mid.z + nz * 132 + dz * 0.28], L: [mid.x + dx * 0.30, 22, mid.z + dz * 0.30], fov: 38 }], "sine");
        walkPuppet(ctx, "micah", TALK_M, { instant: true, yaw: yawTo(TALK_M, b) }); await ctx.sleep(350);
        walkPuppet(ctx, "angelo", TALK_A, { instant: true, yaw: yawTo(TALK_A, { x: (b.x + TALK_M.x) / 2, z: (b.z + TALK_M.z) / 2 }) }); await ctx.sleep(700); }],
      ["menu", async (ctx) => { await ctx.vo(() => __vo3d.coworkers.interact.select("micah@offshorly.com")); await ctx.sleep(1100); }],
      ["chat", async (ctx) => { if (!(await domTap(ctx, "Chat"))) throw new Error("no Chat in the menu"); await ctx.sleep(900);
        ctx.__dm = await dmWith(ctx, "micah@offshorly.com"); if (ctx.__dm) ctx.puppets.emit("micah", "spatial_session_start", { sessionId: ctx.__dm }); await ctx.sleep(700); }],
      ["bon-says", async (ctx) => {
        const ok = await ctx.vo(() => { const t = [...document.querySelectorAll("textarea,input[type=text]")].filter((e) => e.offsetParent && !e.closest("[data-testid='vo3d-toucan']")).pop(); if (!t) return false; t.focus(); return true; });
        if (!ok) throw new Error("no chat composer");
        for (const ch of "Coffee after standup? ☕") { await ctx.page.keyboard.type(ch); await ctx.sleep(48); }
        await ctx.sleep(250); await ctx.page.keyboard.press("Enter"); await ctx.sleep(1100); }],
      ["reply", async (ctx) => { if (!ctx.__dm) throw new Error("no DM"); ctx.puppets.typing("micah", ctx.__dm, true); await ctx.sleep(1500); ctx.puppets.typing("micah", ctx.__dm, false); ctx.puppets.send("micah", ctx.__dm, "Always ☕"); await ctx.sleep(2200); }],
    ]),
  };

  // ==== THE MEETING (Bon's revision): Bon walks up to Echo's TV and presents; colleagues seated. The share itself cannot be
  // published from a headless film browser, so the TV carries a SYNTHETIC slide (film-only material override) and the edit
  // labels it "PRESENTATION · SYNTHETIC PREVIEW". ====
  const SLIDE = () => {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 576; const g = c.getContext("2d");
    g.fillStyle = "#0f2a1f"; g.fillRect(0, 0, 1024, 576); g.fillStyle = "#1f8f5f"; g.fillRect(0, 0, 1024, 10);
    g.fillStyle = "#e9f5ee"; g.font = "bold 56px Helvetica"; g.fillText("Product Sync", 64, 120);
    g.font = "32px Helvetica"; g.fillStyle = "#a8d8bf"; g.fillText("Launch plan · this quarter", 64, 172);
    const rows = [["Homepage redesign", 0.92], ["Pricing page", 0.74], ["Deployment checks", 0.58], ["QA checklist", 0.41]];
    rows.forEach(([t, v], i) => { const y = 250 + i * 72; g.fillStyle = "#e9f5ee"; g.font = "28px Helvetica"; g.fillText(t, 64, y + 26);
      g.fillStyle = "#2a5a44"; g.fillRect(420, y, 520, 34); g.fillStyle = "#3fcf8e"; g.fillRect(420, y, 520 * v, 34); });
    return c;
  };
  const PRESENT = {
    ...beats("T2Present", "MEETING — the REAL screen share: Bon shares, the product walks him to Echo's TV, he presents (the film browser's test-pattern source is covered by a labelled synthetic slide), then stops and returns to his seat", async (ctx) => {
      await untilBon(ctx, (b) => b.floor === "floor-2", 30000);
      // start seated: if a share is still running from a test, stop it and let the product walk him back
      if (await domTap(ctx, "🖥 Stop sharing")) await ctx.sleep(6000);
      await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 46);
      await filmPath(ctx, [{ t: 0, P: [7302, 64, 170], L: [7132, 30, 106], fov: 46 }, { t: 50, P: [7302, 64, 170], L: [7132, 30, 106], fov: 46 }]); await ctx.sleep(900);
    }, [
      ["share", async (ctx) => {
        if (!(await domTap(ctx, "🖥 Share screen"))) throw new Error("no Share screen");
        await filmPath(ctx, [{ t: 0, P: [7302, 64, 170], L: [7132, 30, 106], fov: 46 }, { t: 9000, P: [7276, 60, 160], L: [7130, 32, 104], fov: 42 }], "sine");
        await ctx.vo((slideSrc) => {   // SYNTHETIC SLIDE over the test-pattern stream, re-asserted while the share runs (film only)
          const slide = (0, eval)(slideSrc)();
          clearInterval(window.__t2slideT);
          window.__t2slideT = setInterval(() => {
            const m = __vo3d.R.scene.getObjectByName("mf-screen:floor-2/echo"); if (!m) return;
            if (!m.userData.t2slide) {
              const Tex = Object.getPrototypeOf(Object.values(m.material).find((v) => v && v.isTexture) ?? m.material.map ?? {}).constructor;
              if (!Tex || Tex === Object) return;
              const t = new Tex(slide); t.colorSpace = "srgb"; t.needsUpdate = true; m.userData.t2slide = t;
            }
            if (m.material.map !== m.userData.t2slide) { m.userData.t2orig ??= m.material; const mat = m.userData.t2mat ?? m.material.clone(); mat.map = m.userData.t2slide; mat.color?.set?.(0xffffff); if ("emissiveMap" in mat) { mat.emissiveMap = m.userData.t2slide; mat.emissive?.set?.(0xffffff); mat.emissiveIntensity = 0.85; } mat.needsUpdate = true; m.userData.t2mat = mat; m.material = mat; }
          }, 150);
        }, `(${SLIDE.toString()})`);
        await until(ctx, () => __vo3d.meetingDirector?.state?.phase === "presenting" || (typeof __vo3d.meetingDirector?.state === "function" && __vo3d.meetingDirector.state().phase === "presenting"), "presenting", undefined, 12000).catch(() => {});
        await ctx.sleep(1200); }],
      ["present", async (ctx) => { await ctx.sleep(3800); }],
      ["stop", async (ctx) => { await domTap(ctx, "🖥 Stop sharing"); await ctx.sleep(4200); }],
    ]),
    T2PresentRestore: { about: "DATA — stop the slide override and put Echo's TV material back", async stage() {}, verify: async () => true,
      async go(ctx) { return ctx.vo(() => { clearInterval(window.__t2slideT); const m = __vo3d.R.scene.getObjectByName("mf-screen:floor-2/echo"); if (m?.userData.t2orig) { m.material = m.userData.t2orig; delete m.userData.t2orig; delete m.userData.t2mat; delete m.userData.t2slide; return "restored"; } return "nothing"; }); } },
  };

  // ==== SCOOTER EXPLORATION (Bon's revision): from the Reception dock along the east walk, round the north path to the AI
  // Lab — an autopilot that only presses the real keys (W, A/D, Shift), steering at waypoints on surfaces the product rides ====
  const ROUTE = [{ x: 1542, z: 1150 }, { x: 1542, z: 700 }, { x: 1542, z: 300 }, { x: 1542, z: 30 }, { x: 1520, z: -150 }, { x: 1500, z: -300 }, { x: 1340, z: -336 }, { x: 1170, z: -336 }];
  async function autopilot(ctx, ms, onTick) {
    const kb = ctx.page.keyboard, st = () => ctx.vo(() => { const r = __vo3d.player.scooters.ride(); const p = __vo3d.player.position(); return { h: r?.heading ?? null, x: p.x, z: p.z, riding: __vo3d.player.scooters.riding() }; });
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    await kb.down("KeyW"); await ctx.sleep(700);
    // calibrate: which key turns the heading positive?
    const a = await st(); await kb.down("KeyD"); await ctx.sleep(260); await kb.up("KeyD"); await ctx.sleep(120); const b = await st();
    const dPos = wrap((b.h ?? 0) - (a.h ?? 0)) > 0 ? "KeyD" : "KeyA", dNeg = dPos === "KeyD" ? "KeyA" : "KeyD";
    const log = [], t0 = Date.now(); let wp = 0, held = null, boost = false, throttle = true, lastMove = { t: Date.now(), x: 0, z: 0 };
    while (Date.now() - t0 < ms && wp < ROUTE.length) {
      const c = await st(); if (!c.riding || c.h == null) break;
      const W = ROUTE[wp], N = ROUTE[wp + 1], dx = W.x - c.x, dz = W.z - c.z, d = Math.hypot(dx, dz);
      // reached, or already PASSED (the waypoint is behind on the way to the next one)
      const passed = N && ((N.x - W.x) * (c.x - W.x) + (N.z - W.z) * (c.z - W.z)) > 0 && d < 160;
      if (d < 60 || passed) { wp++; continue; }
      const e = wrap(Math.atan2(dx, -dz) - c.h), want = Math.abs(e) > 0.06 ? (e > 0 ? dPos : dNeg) : null;
      if (want !== held) { if (held) await kb.up(held); if (want) await kb.down(want); held = want; }
      const thr = Math.abs(e) < 0.7; if (thr !== throttle) { if (thr) await kb.down("KeyW"); else await kb.up("KeyW"); throttle = thr; }
      const fast = Math.abs(e) < 0.12 && d > 300; if (fast !== boost) { if (fast) await kb.down("ShiftLeft"); else await kb.up("ShiftLeft"); boost = fast; }
      if (Math.hypot(c.x - lastMove.x, c.z - lastMove.z) > 4) lastMove = { t: Date.now(), x: c.x, z: c.z };
      else if (Date.now() - lastMove.t > 1400) {   // stuck: ease back, then carry on
        if (held) { await kb.up(held); held = null; } await kb.up("KeyW"); await kb.down("KeyS"); await ctx.sleep(550); await kb.up("KeyS"); await kb.down("KeyW"); throttle = true; lastMove = { t: Date.now(), x: c.x, z: c.z };
      }
      if (log.length === 0 || Date.now() - log.at(-1)[0] > 500) log.push([Date.now(), Math.round(c.x), Math.round(c.z), wp]);
      if (onTick) await onTick(Date.now() - t0, wp);
      await ctx.sleep(50);
    }
    if (held) await kb.up(held); if (boost) await kb.up("ShiftLeft"); await kb.up("KeyW");
    return { dPos, log: log.map((r) => [Math.round((r[0] - t0) / 100) / 10, r[1], r[2], r[3]]), done: wp };
  }
  const SCOOT = {
    ...beats("T2Scoot2", "EXPLORE — a scooter from the Reception dock, along the east walk and the north path to the AI Lab; the riding view with its speedometer, then film angles", async (ctx) => {
      await dayPlayer(ctx); await ctx.vo(() => { __vo3d.player.teleport(1150, 1236); __vo3d.cave.look(1, 0, 0.1); }); await ctx.sleep(1500);
    }, [
      ["mount", async (ctx) => { const c = await ctx.vo(() => __vo3d.player.scooters.candidates()); if (!c.length) throw new Error("no scooter in reach"); if (!(await ctx.vo((id) => __vo3d.player.scooters.mount(id), c[0]))) throw new Error("mount refused"); await ctx.sleep(700); }],
      ["ride", async (ctx, mark) => {
        let cam = 0;
        ctx.__ride = await autopilot(ctx, 30000, async (t, wp) => {
          if (cam === 0 && t > 5200) { cam = 1; mark("cam-side"); await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 44); await film(ctx, { kind: "follow", target: "bon", back: 16, side: 96, up: 22, lead: 26, lookUp: -6, k: 3, fov: 44 }); }
          if (cam === 1 && wp >= 3) { cam = 2; mark("cam-front"); await film(ctx, { kind: "follow", target: "bon", back: -130, side: 30, up: 26, lead: -50, lookUp: -4, k: 2.5, fov: 42, blend: 800 }); }
          if (cam === 2 && wp >= 6) { cam = 3; mark("cam-crane"); await film(ctx, { kind: "follow", target: "bon", back: 120, side: -40, up: 120, lead: 80, lookUp: -40, k: 2, fov: 46, blend: 1200 }); }
        });
        mark("ride-end", { route: ctx.__ride });
      }],
      ["arrive", async (ctx) => { await ctx.sleep(1800); }],
    ]),
  };

  // ==== THE END OF THE DAY (Bon's revision): sunset; "Leaving?" → Check Out → wrap up → today's log (description written
  // ONCE: the field is cleared first) → submitted → "View today's log" → out through the real doors, a low three-quarter
  // exterior shot with the building behind him ====
  const END = {
    ...beats("T2End", "THE END OF THE DAY — sunset checkout, today's log, then Bon walks out of the building (low three-quarter exterior)", async (ctx) => {
      await fresh(ctx); await dayPlayer(ctx); await clearModals(ctx); await ctx.vo(() => { __vo3d.env.setTime("sunset"); __vo3d.weather.setWeather("clear"); __vo3d.weather.settle?.(); });
      await toolSpot(ctx, { x: 722, z: 1050 }, { x: 726, z: 1200 }, 0.14);
      await hideUi(ctx, HIDE_FILM.filter((q) => !/dock/.test(q))); await filmOn(ctx, 42);
      await filmPath(ctx, [{ t: 0, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }, { t: 50, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }]); await ctx.sleep(1500);
    }, [
      ["walk", async (ctx) => { await film(ctx, { kind: "path", ease: "sine", keys: [{ t: 0, P: [636, 64, 968], L: [714, 18, 1112], fov: 42 }, { t: 3400, P: [650, 58, 990], L: [718, 18, 1118], fov: 40 }] }); await ctx.sleep(500); await ctx.hold(["KeyW"], 1000); await until(ctx, () => !!document.querySelector("[aria-label='Leaving the office']"), "the Leaving card", undefined, 6000); await ctx.sleep(1100); }],
      ["checkout", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Check Out\\s*$"))) throw new Error("no Check Out"); await ctx.sleep(1600); }],
      ["start", async (ctx) => { await filmOff(ctx); await hideUi(ctx, []); if (!(await clickAny(ctx, "^\\s*Start checkout\\s*$"))) throw new Error("no Start checkout"); await until(ctx, () => [...document.querySelectorAll("button")].some((b) => /Log today.s work/.test(b.textContent) && b.offsetParent), "the time summary", undefined, 30000); await ctx.sleep(1400); }],
      ["summary", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Log today.s work\\s*$"))) throw new Error("no Log today's work"); await until(ctx, () => !!document.querySelector("input[aria-label='Hours']"), "the time log", undefined, 12000); await ctx.sleep(800); }],
      ["log", async (ctx) => {
        const fill = async () => {
          const w = await ctx.vo(() => (document.body.innerText.match(/Worked today:\s*([^·\n]+)/) || [])[1] ?? "");
          const h = +(w.match(/(\d+)\s*h/) || [0, 0])[1], m = +(w.match(/(\d+)\s*m/) || [0, 0])[1]; ctx.__worked = w;
          await setField(ctx, "input[aria-label='Hours']", String(h)); await setField(ctx, "input[aria-label='Minutes']", String(m));
        };
        await fill();
        ctx.__cat = await ctx.vo(() => {
          const s = [...document.querySelectorAll("select")].find((e) => e.offsetParent && [...e.options].some((o) => /Select a category/i.test(o.text)));
          const o = s && [...s.options].find((o) => o.value); if (!o) return null;
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value); s.dispatchEvent(new Event("change", { bubbles: true })); return o.text;
        });
        await setField(ctx, "textarea", "");                          // a restored draft is cleared first: written once
        await ctx.vo(() => { const t = [...document.querySelectorAll("textarea")].find((e) => e.offsetParent); t?.focus(); });
        for (const ch of "Product Sync, launch plan and the teaser review") { await ctx.page.keyboard.type(ch); await ctx.sleep(24); }
        await ctx.sleep(400); await fill(); await ctx.sleep(600);
      }],
      ["review", async (ctx) => { if (!(await clickAny(ctx, "^\\s*Review log\\s*$"))) throw new Error("no Review log"); await ctx.sleep(1300); }],
      ["submit", async (ctx) => { const ok = await ctx.vo(() => { const b = [...document.querySelectorAll("button")].find((e) => /Submit log and check out/.test(e.textContent)); return b ? !b.disabled : null; }); if (!ok) throw new Error(`submit not enabled (${ok}; worked ${ctx.__worked})`); await clickAny(ctx, "Submit log and check out"); await until(ctx, () => /Checkout time/.test(document.body.innerText), "the checkout summary", undefined, 15000); await ctx.sleep(1500); }],
      ["view-log", async (ctx) => { await clickAny(ctx, "^\\s*View today.s log\\s*$"); await ctx.sleep(2200); }],
      ["done", async (ctx) => { await clickAny(ctx, "^\\s*Close\\s*$"); await ctx.sleep(700); }],
      ["exit", async (ctx) => {
        await toPlayer(ctx).catch(() => {}); await ctx.vo(() => __vo3d.env.setTime("sunset"));
        await hideUi(ctx, [...HIDE_FILM, "[data-testid='scooter-hud']"]); await filmOn(ctx, 44);
        await filmPath(ctx, [{ t: 0, P: [850, 13, 1300], L: [704, 28, 1150], fov: 44 }, { t: 6500, P: [872, 12, 1352], L: [712, 26, 1196], fov: 42 }], "sine");
        await ctx.vo(() => { __vo3d.cave.look(0, 1, 0.1); }); await ctx.sleep(500);
        await ctx.hold(["KeyW"], 3600); await ctx.sleep(1800); }],
    ]),
  };
  return {
    ...LAB_SEGS,
    ...LAB3,
    ...FULL,
    ...REST,
    ...PROD,
    ...PARTY4,
    ...SEASONS,
    ...TALK,
    ...PRESENT,
    ...SCOOT,
    ...END,
    T2Rooms: roomsShot(false),
    T2RoomsCheck: roomsShot(true),
    T2Lab: labShot(false),
    T2LabCheck: labShot(true),
    T2Tools: {
      about: "TOOL MONTAGE — four tools at four places, the world alive behind each; every panel whole (no crop, no digital zoom)",
      async stage(ctx) {
        await attendance(ctx, "in"); await closePanels(ctx); await lib(ctx);
        ctx.__seated = await seatCast(ctx, SEATS_TOOLS);
        await ctx.vo(() => __vo3d.env.setTime("day")); await hideHint(ctx); await view(ctx, "player");
        await hud(ctx, "full"); await hideUi(ctx, []);
        await toolSpot(ctx, { x: 690, z: 600 }, { x: 564, z: 476 });
        await ctx.page.mouse.move(1919, 1079); await ctx.sleep(1500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "player",
      async go(ctx) {
        const [m, mark] = marks(); mark("cast", { ...(await readCast(ctx)), seated: ctx.__seated });
        const next = () => ctx.vo(() => document.querySelector("button[aria-label='Next item']")?.click());
        mark("hub-open"); await ctx.click("Hub");                                        // 1 · the Hub, at the café
        await until(ctx, () => !!document.querySelector("button[aria-label='Next item']"), "the Hub", undefined, 15000);
        await ctx.sleep(1400); mark("hub-card1"); await next(); await ctx.sleep(1300); mark("hub-card2"); await next(); await ctx.sleep(1300); mark("hub-card3");
        await toolSpot(ctx, { x: 640, z: 610 }, { x: 552, z: 464 }, 0.1); mark("search-spot");    // 2 · Search, Micah in shot behind it
        await ctx.click("Search for a person"); mark("search-open"); await ctx.sleep(700);
        await ctx.page.keyboard.type("Mi", { delay: 160 }); mark("search-typed"); await ctx.sleep(2200);
        await toolSpot(ctx, { x: 1180, z: 800 }, { x: 1279, z: 740 }, 0.1); mark("tasks-spot");   // 3 · Tasks in the gaming room
        await ctx.click("Open Tasks"); mark("tasks-open"); await ctx.sleep(1700);
        await ctx.click("Missions").catch(() => {}); mark("missions"); await ctx.sleep(1900);
        await toolSpot(ctx, { x: 860, z: 800 }, { x: 860, z: 600 }, 0.14); mark("room-spot");     // 4 · Room: names over the plan
        await ctx.click("Room"); mark("room-open"); await ctx.sleep(3000);
        await closePanels(ctx); mark("end");
        mark("cast-end", await readCast(ctx));
        return m;
      },
    },
    T2Probe2: {
      about: "PROBE 2 — the API surface and the live dock/menu labels (data only)",
      async stage(ctx) { await attendance(ctx, "in"); await closePanels(ctx); await lib(ctx); await hideHint(ctx); await view(ctx, "player"); await ctx.sleep(1500); },
      verify: async () => true,
      async go(ctx) {
        return ctx.vo(() => {
          const v = __vo3d, k = (o) => (o && typeof o === "object" ? Object.keys(o).slice(0, 60) : typeof o);
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          return {
            top: Object.keys(v).slice(0, 200), env: k(v.env), weather: k(v.weather), cave: k(v.cave), goTogether: k(v.goTogether),
            scooter: k(v.scooter ?? v.scooters ?? v.vehicles), meetings: k(v.meetings), reception: k(v.reception), player: k(v.player), access: k(v.access),
            buttons: [...document.querySelectorAll("button,[role=button],[role=tab]")].filter(vis).map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40)).filter(Boolean).slice(0, 80),
          };
        });
      },
    },
    // ---- DATA ONLY (no recording): room bounds, the bird's real flight path, the agents' stations through one sample job
    T2Probe: {
      about: "PROBE — room rects, the Toucan's real flight path and the Lab agents' positions through one scripted sample (data only)",
      async stage(ctx) {
        await attendance(ctx, "in");
        await closePanels(ctx);
        await lib(ctx);
        await castTo(ctx, OPENING_END);
        await ctx.vo(() => __vo3d.env.setTime("day"));
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(() => { __vo3d.player.teleport(740, 760); __vo3d.cave.look(740, 600, 0.14); });
        await ctx.sleep(2000);
      },
      verify: async () => true,
      async go(ctx) {
        const out = {};
        out.plan = await ctx.vo(() => { const W = __vo3d.world ?? {}; const rs = W.rooms ?? __vo3d.plan?.rooms ?? null;
          return { worldKeys: Object.keys(W).slice(0, 50), frame: __vo3d.plan?.frame ?? null,
            rooms: Array.isArray(rs) ? rs.map((r) => ({ id: r.id, name: r.name ?? r.label, rect: r.rect ?? r.bounds ?? r.box ?? null })) : (rs ? Object.keys(rs) : null) }; });
        out.bon = await ctx.vo(() => { const p = __vo3d.avatar.worldPosition(); return [p.x, p.y, p.z].map(Math.round); });
        out.labGroup = await ctx.vo(() => { const p = __vo3d.labGroup.position; return [p.x, p.y, p.z]; });
        await ctx.click("Call the toucan");
        await until(ctx, () => !!document.querySelector("[data-testid='ai-workforce-start']"), "the AI Workforce entry", undefined, 25000);
        await ctx.sleep(2500);
        out.perch = await ctx.vo(() => { const p = __vo3d.toucan.position(); return [p.x, p.y, p.z].map(Math.round); });
        await ctx.click("Preview a sample task");
        out.samples = await ctx.vo(async () => {
          const res = [], t0 = performance.now(), tmp = __vo3d.R.playerCamera.position.clone(); let last = "";
          while (performance.now() - t0 < 185000) {
            const t = performance.now() - t0, st = document.querySelector("[data-testid='ai-workforce-step']")?.textContent?.trim() ?? "";
            const p = __vo3d.toucan.position(), bird = [p.x, p.y, p.z].map(Math.round);
            const ag = {}; for (const id of ["milo", "nova", "pip"]) { const q = __vo3d.labCast?.positionOf(id, tmp); ag[id] = q ? [q.x, q.y, q.z].map(Math.round) : null; }
            if (t < 34000 ? true : st !== last) res.push({ t: Math.round(t), st: st !== last ? st : undefined, bird, fly: __vo3d.toucan.flying(), ag: t < 34000 && (Math.round(t / 100) % 10) ? undefined : ag });
            last = st;
            if (/Result delivered/.test(st)) break;
            await new Promise((r) => setTimeout(r, t < 34000 ? 200 : 250));
          }
          return res;
        });
        await ctx.sleep(2500);
        await byTest(ctx, "ailab-view-result");
        await ctx.sleep(1500);
        await ctx.click("Approve").catch(() => {});
        await ctx.sleep(1500);
        await closePanels(ctx);
        return out;
      },
    },

    T2Check: {
      about: "VERIFY — the body every person actually wears in Office, 3D and Player view, with stills for the record",
      async stage(ctx) {
        await attendance(ctx, "in");
        await lib(ctx);
        await castTo(ctx, OPENING_END);
        await ctx.vo(() => __vo3d.env.setTime("day"));
        await view(ctx, "office");
        await placeBon(ctx, { x: 520, z: 790 });
        await camHold(ctx, CAM.office0);
        await ctx.page.mouse.move(1919, 1079);
        await ctx.sleep(2500);
      },
      verify: async () => true,
      async go(ctx) {
        const out = {};
        await camHold(ctx, { x: 380, z: 600, w: 640, d: 360 });
        await ctx.sleep(1500);
        out.office = await readCast(ctx); out.officeSnap = await ctx.snap("t2check-1-office");
        await ctx.press("KeyC");
        await until(ctx, () => __vo3d.cameraModes.mode === "explore", "3D view");
        await ctx.sleep(1500);
        out.yawProbe = await ctx.vo(async () => {
          const r = [], f = () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
          for (const y of [0, 90]) { window.__t2.set({ x: 700, z: 700, pitch: 30, yaw: y, zoom: 2 }); await f(); const c = __vo3d.camera.position; r.push({ yaw: y, dx: Math.round(c.x - 700), dz: Math.round(c.z - 700) }); }
          return r;
        });
        await set3d(ctx, { x: 540, z: 805, pitch: 20, yaw: 0, zoom: 3.2 });              // Bon among France, Alex and Jan
        await ctx.sleep(1500);
        out.explore = await readCast(ctx); out.exploreSnap = await ctx.snap("t2check-2-3d-group");
        for (const [i, k] of Object.values(K).entries()) { await set3d(ctx, k); await ctx.sleep(1300); await ctx.snap(`t2check-key${i}`); }
        await set3d(ctx, { x: 520, z: 790, pitch: 30, yaw: 0, zoom: 2.2 });
        await ctx.press("KeyC");
        await until(ctx, () => __vo3d.cameraModes.mode === "player", "player view");
        await ctx.sleep(1800);
        out.player = await readCast(ctx); out.playerSnap = await ctx.snap("t2check-3-player");
        return out;
      },
    },

    // ---- 00:00–00:16 · OFFICE VIEW: walk in → refused → the kiosk → Check In → through the green lane → the office opens
    T2Opening: {
      about: "OPENING — the approved teaser's gate → kiosk → green lane, re-staged with today's cast and a camera that glides with Bon",
      async stage(ctx) {
        await attendance(ctx, "out");                                        // the story's premise: Bon arrives
        await lib(ctx);
        await view(ctx, "office");
        await castTo(ctx, OPENING_CAST);
        await placeBon(ctx, BON_START);
        await ctx.vo(() => __vo3d.env.setTime("day"));
        await camHold(ctx, CAM.wide0);
        await hud(ctx, "nodock");
        await ctx.page.mouse.move(1919, 1079);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "denied",
      async go(ctx) {
        const [m, mark] = marks(), bg = [];
        const cue = (ms, fn) => bg.push(ctx.sleep(ms).then(fn).catch(() => {}));
        mark("cast", await readCast(ctx));
        mark("walk-in");
        cue(300, () => walkTo(ctx, "angelo", { x: 470, z: 756 }, null, 55));
        cue(4200, () => walkTo(ctx, "micah", { x: 820, z: 650 }, null, 50));
        cue(4800, () => walkTo(ctx, "clang", { x: 930, z: 800 }, null, 45));
        const push = officePath(ctx, [{ t: 0, ...CAM.wide0 }, { t: 7600, ...CAM.gates, ease: "io" }]);
        await placeBon(ctx, GATE_SENSOR);
        mark("at-sensor");
        await push;
        await ctx.sleep(1500);
        mark("refused");
        cue(200, () => walkTo(ctx, "jona", { x: 912, z: 1066 }, { x: 935, z: 1045 }, 55));
        await ctx.vo(() => __vo3d.reception.startApproach(__vo3d.reception.kioskId));
        mark("to-kiosk");
        const glide = officePath(ctx, [{ t: 0, ...CAM.gates }, { t: 3400, ...CAM.kiosk, ease: "io" }]);
        await until(ctx, () => [...document.querySelectorAll("[role=menuitem]")].some((e) => e.textContent.trim() === "Check In"), "the kiosk card", undefined, 35000);
        await glide;
        mark("kiosk-card");
        await ctx.sleep(1400);
        await ctx.click("Check In");
        mark("check-in");
        await until(ctx, () => __vo3d.access.state().access === "permitted", "check-in confirmed");
        mark("permitted");
        await ctx.sleep(2200);                                               // the Company Hub greets him (real)
        await closePanels(ctx);
        mark("hub-closed");
        cue(0, () => walkTo(ctx, "angelo", { x: 420, z: 752 }, null, 45));
        const back = officePath(ctx, [{ t: 0, ...CAM.kiosk }, { t: 2600, ...CAM.gates0, ease: "io" }, { t: 7000, ...CAM.gates1, ease: "io" }]);
        await placeBon(ctx, PAST_GATES);
        mark("past-gates");
        await back;
        const pull = officePath(ctx, [{ t: 0, ...CAM.gates1 }, { t: 1600, ...CAM.office0, ease: "io" }, { t: 6400, ...CAM.office1, ease: "out" }]);
        await placeBon(ctx, { x: 700, z: 745 });
        await pull;
        mark("end");
        await Promise.all(bg);
        mark("cast-end", await readCast(ctx));
        return m;
      },
    },

    // ---- 00:16 ALIVE → 00:29 · the real C press tilts the same office into 3D; ONE continuous spline fly-through
    T2Alive: {
      about: "ALIVE — the opening's end state, the real C press into 3D, then one continuous crane/glide over colleagues and rooms",
      async stage(ctx) {
        await attendance(ctx, "in");
        await lib(ctx);
        await castTo(ctx, OPENING_END);
        await view(ctx, "office");
        await placeBon(ctx, { x: 700, z: 745 });
        await ctx.vo(() => __vo3d.env.setTime("day"));
        await camHold(ctx, CAM.office1);
        await hud(ctx, "nodock");
        await ctx.page.mouse.move(1919, 1079);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "office",
      async go(ctx) {
        const [m, mark] = marks();
        mark("cast", await readCast(ctx));
        walkTo(ctx, "clang", { x: 1010, z: 792 }, null, 40).catch(() => {});  // the concourse keeps moving through the reveal
        walkTo(ctx, "micah", { x: 760, z: 610 }, null, 40).catch(() => {});
        await ctx.sleep(1000);
        mark("C");
        await ctx.press("KeyC");
        await until(ctx, () => __vo3d.cameraModes.mode === "explore", "3D view");
        mark("explore");
        const k0 = await ctx.vo(() => window.__t2.current());              // no settle: the drop starts on the switch itself
        mark("fly", { from: k0 });
        await spline(ctx, [k0, K.drop, K.concourse, K.east, K.gaming, K.ne], 13000, "lin", [1.3, 2.6, 2.8, 3.0, 3.3]);
        mark("end");
        await ctx.sleep(600);
        mark("cast-end", await readCast(ctx));
        return m;
      },
    },

    // ---- 00:29–00:35 · "It's something… you EXPERIENCE." — a push-in behind Bon, the real C press into Player view
    T2Experience: {
      about: "EXPERIENCE — 3D push-in onto Bon's back, the real C press into Player view; walk → sprint → jump down the concourse",
      async stage(ctx) {
        await attendance(ctx, "in");
        await lib(ctx);
        await castTo(ctx, { ...OPENING_END, clang: { at: { x: 1110, z: 745 }, face: { x: 1160, z: 745 } } });
        await view(ctx, "office");
        await placeBon(ctx, { x: 1040, z: 786 });
        await placeBon(ctx, { x: 1000, z: 786 });                            // the last step heads WEST, down the concourse
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.player.mode.camera.pitch = 0.2; });
        await hideHint(ctx);
        await view(ctx, "explore");
        await set3d(ctx, { x: 960, z: 770, pitch: 46, yaw: 60, zoom: 1.1 });
        await hud(ctx, "nodock");
        await ctx.page.mouse.move(1919, 1079);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "explore",
      async go(ctx) {
        const k = ctx.page.keyboard, [m, mark] = marks();
        mark("cast", await readCast(ctx));
        await ctx.sleep(500);
        mark("push");
        await spline(ctx, [{ x: 960, z: 770, pitch: 46, yaw: 60, zoom: 1.1 }, { x: 990, z: 782, pitch: 38, yaw: 75, zoom: 2.0 }, { x: 1000, z: 786, pitch: 32, yaw: 90, zoom: 3.0 }], 2800, "io");
        mark("C");
        await k.press("KeyC");
        await until(ctx, () => __vo3d.cameraModes.mode === "player", "player view");
        mark("player");
        await ctx.sleep(350);
        await k.down("KeyW"); mark("walk");
        await ctx.sleep(500);
        await k.down("ShiftLeft"); mark("sprint");
        await ctx.sleep(1100);
        await k.press("Space"); mark("jump");
        await ctx.sleep(1900);
        await k.up("ShiftLeft"); await ctx.sleep(500); await k.up("KeyW"); mark("stop");
        await ctx.sleep(800);
        mark("cast-end", await readCast(ctx));
        return m;
      },
    },

    // ---- 00:35 · the music-only montage opens: the Hub from the dock, its cards, the weather card's city forecast
    T2Hub: {
      about: "MONTAGE — Player view on the concourse; the dock's Hub: kudos → update → survey → town hall → birthday → the weather card's city forecast",
      async stage(ctx) {
        await attendance(ctx, "in");
        await closePanels(ctx);
        await lib(ctx);
        await castTo(ctx, OPENING_END);
        await ctx.vo(() => __vo3d.env.setTime("day"));
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(() => { __vo3d.player.teleport(760, 812); __vo3d.cave.look(760, 640, 0.12); });
        await hud(ctx, "full");
        await ctx.page.mouse.move(1919, 1079);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.cameraModes.mode)) === "player",
      async go(ctx) {
        const [m, mark] = marks();
        mark("cast", await readCast(ctx));
        await ctx.sleep(800);
        await ctx.click("Hub");
        mark("hub");
        await until(ctx, () => !!document.querySelector("button[aria-label='Next item']"), "the Hub", undefined, 15000);
        await ctx.sleep(1500);
        for (let i = 0; i < 9; i++) {
          const title = await ctx.vo(() => { let el = document.querySelector("button[aria-label='Next item']"); while (el && !el.querySelector("h2")) el = el.parentElement; return el?.querySelector("h2")?.textContent?.trim() ?? null; });
          mark(`slide:${title}`);
          if (await ctx.vo(() => !!document.querySelector("section[aria-label='Weather forecast']"))) break;
          await ctx.sleep(1500);
          if (!(await ctx.vo(() => { const b = document.querySelector("button[aria-label='Next item']"); if (!b) return false; b.click(); return true; }))) break;
        }
        await ctx.sleep(1000);
        const choose = await ctx.click("Change city").then(() => true, () => ctx.click("Choose a city").then(() => true, () => false));
        if (choose) {
          await ctx.sleep(500);
          await ctx.page.click("#weather-city-search");
          await ctx.page.mouse.move(1919, 1079);
          mark("typing");
          for (const ch of "Mandaluyong") { await ctx.page.keyboard.type(ch); await ctx.sleep(60 + Math.random() * 50); }
          await ctx.sleep(400);
          await ctx.page.keyboard.press("Enter");
          await until(ctx, () => document.querySelectorAll("li button[class*='resultRow']").length > 0, "city matches", undefined, 15000);
          await ctx.sleep(900);
          const row = await ctx.vo(() => {
            const rows = [...document.querySelectorAll("li button[class*='resultRow']")];
            const r = rows.find((b) => /mandaluyong/i.test(b.textContent) && /metro manila/i.test(b.textContent)) ?? rows.find((b) => /mandaluyong/i.test(b.textContent));
            if (!r) return null;
            const q = r.getBoundingClientRect();
            return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
          });
          if (row) { await ctx.page.mouse.click(row.x, row.y); await ctx.page.mouse.move(1919, 1079); }
          mark(row ? "picked" : "no-match");
          await until(ctx, () => /°/.test(document.querySelector("section[aria-label='Weather forecast']")?.textContent ?? ""), "the forecast", undefined, 15000).catch(() => {});
          mark("forecast");
          await ctx.sleep(3000);
        }
        await closePanels(ctx);
        mark("end");
        return m;
      },
    },

    // ---- 03:00–03:29 · Toucan → "Preview a sample task" → Watch in Lab (the product's own camera) → result → Approve
    T2AiLab: {
      about: "AI LAB — the real AI Workforce Preview (scripted sample, labelled): Toucan takes the task to the Lab, the team works, the result comes back, Bon approves",
      async stage(ctx) {
        await attendance(ctx, "in");
        await closePanels(ctx);
        await ctx.click("Dismiss the toucan").catch(() => {});
        await lib(ctx);
        await castTo(ctx, OPENING_END);
        await ctx.vo(() => __vo3d.env.setTime("day"));
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(() => { __vo3d.player.teleport(740, 800); __vo3d.cave.look(740, 640, 0.14); });
        await hud(ctx, "full");
        await ctx.page.mouse.move(1919, 1079);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => !!window.__vo3d && __vo3d.cameraModes.mode === "player")),
      async go(ctx) {
        const [m, mark] = marks();
        mark("cast", await readCast(ctx));
        let polling = true, last = "";
        const poll = (async () => {                                         // the job's own status line, as it changes
          while (polling) {
            const s = await ctx.vo(() => document.querySelector("[data-testid='ai-workforce-step']")?.textContent?.trim() ?? "").catch(() => "");
            if (s && s !== last) { last = s; mark(`step:${s}`); }
            await ctx.sleep(400);
          }
        })();
        await ctx.sleep(1200);
        await ctx.click("Call the toucan");
        mark("toucan");
        await until(ctx, () => !!document.querySelector("[data-testid='ai-workforce-start']"), "the AI Workforce entry", undefined, 25000);
        await ctx.sleep(2400);
        mark("request");
        await ctx.click("Preview a sample task");
        await until(ctx, () => { const b = document.querySelector("[data-testid='ai-workforce-watch']"); return !!b && !b.disabled; }, "Watch in Lab", undefined, 20000);
        await ctx.sleep(1800);
        await byTest(ctx, "ai-workforce-watch");
        mark("watch");
        await until(ctx, () => !!document.querySelector("[data-testid='ailab-view-result']"), "the delivered result", undefined, 180000);
        mark("delivered");
        await ctx.sleep(3000);
        if (await byTest(ctx, "ai-workforce-stop-watch")) mark("stop-watch");
        await ctx.sleep(1800);
        if (await byTest(ctx, "ai-workforce-open-chat")) mark("chat");
        await ctx.sleep(3800);
        await byTest(ctx, "ailab-view-result");
        mark("result");
        await ctx.sleep(3200);
        await ctx.click("Approve");
        mark("approved");
        await ctx.sleep(3200);
        polling = false; await poll;
        mark("cast-end", await readCast(ctx));
        return m;
      },
    },
  };
}
