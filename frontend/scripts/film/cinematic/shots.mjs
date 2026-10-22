// FILM RIG ONLY — "A Day Inside Offshorly" (the cinematic master). Shots for the existing director.
//
// Loaded by the director's shots.mjs (`Object.assign(SHOTS, cine(helpers))`), so every shot below gets the
// same staging verbs the teaser used (attendance, view, placeBon, puppets …) and goes through the REAL
// product only: __vo3d's own entry points, real key presses, real clicks on the real HUD, the real API.
//
// What is film-only, and page-local to the hero browser (never product code):
//   · camera paths — eased keyframes driven from requestAnimationFrame through the product's own reveal
//     rig (explore: R.target + cameraModes.orbit; player: player.look), so moves are frame-smooth;
//   · HUD presentation — `clean` hides every DOM overlay (pure establishing shots), `nodock` hides only
//     the dock, `full` shows the product exactly as an employee sees it;
//   · an ambience tap — a MediaRecorder on the environmental-audio engine's master gain, so the film can
//     use the world's own rain / room tone instead of library sound.
const BON = "jerevon@offshorly.com";
const STREET = { x: 720, z: 1196 };          // the sidewalk outside the entrance auto-door (exterior:sidewalk, z 1170–1230)
const STREET_BACK = { x: 720, z: 1230 };     // the sidewalk edge, so the step back in leaves him facing north
const GATE_SENSOR = { x: 728, z: 918 };
const PAST_GATES = { x: 728, z: 760 };

// The cast, kept out of Reception for the night (an empty office), then going about a normal morning.
const NIGHT_AWAY = {
  alex: { x: 600, z: 560 }, jan: { x: 640, z: 560 }, micah: { x: 820, z: 600 }, angelo: { x: 560, z: 600 },
  nicole: { x: 900, z: 600 }, kael: { x: 940, z: 600 }, jona: { x: 980, z: 620 }, france: { x: 520, z: 620 }, clang: { x: 860, z: 640 },
};
const MORNING = {
  nicole: { at: { x: 935, z: 1045 }, face: { x: 962, z: 1072 } },      // east lounge, a pair talking
  kael:   { at: { x: 962, z: 1072 }, face: { x: 935, z: 1045 } },
  france: { at: { x: 430, z: 805 },  face: { x: 380, z: 760 } },
  alex:   { at: { x: 600, z: 810 },  face: { x: 640, z: 824 } },
  jan:    { at: { x: 640, z: 824 },  face: { x: 600, z: 810 } },
  angelo: { at: { x: 1000, z: 758 }, face: { x: 470, z: 756 } },
  micah:  { at: { x: 880, z: 735 },  face: { x: 820, z: 650 } },
  clang:  { at: { x: 820, z: 790 },  face: { x: 930, z: 800 } },
  jona:   { at: { x: 880, z: 1100 }, face: { x: 935, z: 1045 } },
};

// Act 1 at night: three people working late in the Hub, everyone else gone home.
const LATE = {
  keys: ["nicole", "kael", "micah"],
  away: ["alex", "jan", "angelo", "france", "jona", "clang"],
  // the rest are at their own room's door, i.e. inside their rooms, off the concourse (V2 world units)
  desk: {
    alex: { x: 330, z: 380 }, jan: { x: 360, z: 395 }, angelo: { x: 1110, z: 380 },
    france: { x: 330, z: 600 }, jona: { x: 1110, z: 600 }, clang: { x: 1080, z: 620 },
  },
  at: {
    nicole: { at: { x: 820, z: 650 }, face: { x: 760, z: 610 } },
    kael:   { at: { x: 760, z: 610 }, face: { x: 820, z: 650 } },
    micah:  { at: { x: 430, z: 790 }, face: { x: 430, z: 700 } },
  },
};
// Act 2 morning: everyone comes in through the gates and spreads out (the pathfinder routes every walk).
const ARRIVALS = {
  alex:   { from: { x: 690, z: 800 }, to: { x: 760, z: 640 }, delay: 300 },
  jan:    { from: { x: 760, z: 805 }, to: { x: 820, z: 660 }, delay: 900 },
  micah:  { from: { x: 690, z: 790 }, to: { x: 560, z: 700 }, delay: 1500 },
  angelo: { from: { x: 760, z: 785 }, to: { x: 900, z: 760 }, delay: 2100 },
  france: { from: { x: 690, z: 790 }, to: { x: 540, z: 780 }, delay: 2700 },
  clang:  { from: { x: 760, z: 800 }, to: { x: 880, z: 700 }, delay: 3300 },
  nicole: { from: { x: 935, z: 1045 }, to: { x: 935, z: 1045 }, delay: 0 },
  kael:   { from: { x: 962, z: 1072 }, to: { x: 962, z: 1072 }, delay: 0 },
  jona:   { from: { x: 690, z: 805 }, to: { x: 640, z: 680 }, delay: 3900 },
};
// Office-view framings (the product's focus rects)
const OFFICE_CAM = {
  reception: { x: 560, z: 960, w: 340, d: 200 },
  entrance:  { x: 470, z: 880, w: 520, d: 300 },
  whole:     { x: 0, z: 96, w: 1440, d: 1028 },
  rooms:     { x: 200, z: 200, w: 960, d: 560 },
};

/** The page-side library: installed once per page load (a reload clears it). */
export function pageLib() {
  if (window.__cine) { try { window.__cine.hud("full"); } catch {} }      // a staged page keeps no stale timers
  const v = window.__vo3d;
  const E = {
    io: (s) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2),
    sine: (s) => 0.5 - 0.5 * Math.cos(Math.PI * s),
    lin: (s) => s, out: (s) => 1 - Math.pow(1 - s, 3), in: (s) => s * s * s,
  };
  const lerp = (a, b, e) => a + (b - a) * e;
  let hudTimer = null;
  const cine = (window.__cine = {
    /** HUD presentation for this shot: "clean" | "nodock" | "full" */
    hud(mode) {
      clearInterval(hudTimer);
      const apply = () => {
        const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const keep = new Set();
        for (let e = canvas; e; e = e.parentElement) keep.add(e);
        for (const el of document.querySelectorAll("[data-cine-hidden]")) { el.style.opacity = ""; delete el.dataset.cineHidden; }
        const hide = (el) => { if (el && !keep.has(el)) { el.dataset.cineHidden = "1"; el.style.opacity = "0"; } };
        if (mode === "clean") {
          for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && keep.has(el.parentElement)) hide(el);
        } else if (mode === "nodock") {
          for (const el of document.querySelectorAll("[class*='_dock_']")) hide(el);
          hide([...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Call the toucan"));
        }
      };
      apply();
      cine._mo?.disconnect();
      if (mode !== "full") {
        hudTimer = setInterval(apply, 150);
        let queued = false;
        cine._mo = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; apply(); }); } });
        cine._mo.observe(document.body, { childList: true, subtree: true });
      }
    },
    /** explore (3D view) camera: set one framing now */
    set(k) { v.R.target.x = k.x; v.R.target.z = k.z; v.cameraModes.orbit(k.pitch, k.yaw, k.zoom); },
    /** explore camera path: keys [{t (ms), x, z, pitch, yaw, zoom, ease}] — each segment eased on its own */
    path(keys) {
      return new Promise((done) => {
        const t0 = performance.now(), end = keys.at(-1).t;
        const step = () => {
          const t = performance.now() - t0;
          let i = 0;
          while (i < keys.length - 2 && t > keys[i + 1].t) i++;
          const a = keys[i], b = keys[i + 1] ?? a;
          const s = b.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
          const e = E[b.ease ?? "io"](s);
          cine.set({ x: lerp(a.x, b.x, e), z: lerp(a.z, b.z, e), pitch: lerp(a.pitch, b.pitch, e), yaw: lerp(a.yaw, b.yaw, e), zoom: lerp(a.zoom, b.zoom, e) });
          if (t < end) requestAnimationFrame(step); else done(true);
        };
        requestAnimationFrame(step);
      });
    },
    /** player camera: swing the boom by dyaw/dpitch radians over ms (the product's own look(), eased) */
    swing(dyaw, dpitch, ms, ease = "sine") {
      const K = 0.0026; // PlayerCamera LOOK_SENSITIVITY (radians per pixel)
      return new Promise((done) => {
        const t0 = performance.now();
        let prev = 0;
        const step = () => {
          const s = Math.min(1, (performance.now() - t0) / ms), e = E[ease](s);
          v.player.look(((e - prev) * dyaw) / K, ((e - prev) * dpitch) / K);
          prev = e;
          if (s < 1) requestAnimationFrame(step); else done(true);
        };
        requestAnimationFrame(step);
      });
    },
    /** OFFICE view camera path: keys [{t, x, z, w, d, ease}] — the product's own focus(rect), eased per frame */
    officePath(keys, fill = 0.95) {
      return new Promise((done) => {
        const t0 = performance.now(), end = keys.at(-1).t;
        const step = () => {
          const t = performance.now() - t0;
          let i = 0;
          while (i < keys.length - 2 && t > keys[i + 1].t) i++;
          const a = keys[i], b = keys[i + 1] ?? a;
          const s = b.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
          const e = E[b.ease ?? "io"](s);
          v.cameraModes.focus({ x: lerp(a.x, b.x, e), z: lerp(a.z, b.z, e), w: lerp(a.w, b.w, e), d: lerp(a.d, b.d, e) }, fill);
          if (t < end) requestAnimationFrame(step); else done(true);
        };
        requestAnimationFrame(step);
      });
    },
    /** the explore camera as it is right now (after a real C press), as a path key */
    current() { const p = v.R.camParams; return { x: v.R.target.x, z: v.R.target.z, pitch: p.pitch, yaw: p.yaw, zoom: p.zoom }; },
    /** ambience tap on the environmental-audio master (film-only MediaRecorder, nothing reaches the product) */
    async tapStart() {
      const eng = v.audio.engine;
      v.audio.setEnabled(true);
      await eng.start?.();
      const ctx = eng.ctx ?? eng.context, master = eng.master;
      if (!ctx || !master) return { ok: false, why: "no ctx/master" };
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      master.connect(dest);
      const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      cine._tap = { rec, chunks, dest, master, t0: Date.now() };
      rec.start(250);
      return { ok: true, state: ctx.state, t0: cine._tap.t0 };
    },
    async tapStop() {
      const tap = cine._tap;
      if (!tap) return null;
      await new Promise((r) => { tap.rec.onstop = r; tap.rec.stop(); });
      try { tap.master.disconnect(tap.dest); } catch {}
      const buf = new Uint8Array(await new Blob(tap.chunks, { type: "audio/webm" }).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      cine._tap = null;
      return { t0: tap.t0, b64: btoa(bin) };
    },
  });
  return true;
}

export function cine(H) {
  const { attendance, view, placeBon, walkPuppet, walkLine, closePanels, readAll, hideHint, hidePathOverlay, yawTo, until } = H;
  // the page library + the nav path/destination overlay off (the teaser rig's own dev-panel toggle)
  const lib = async (ctx) => { await ctx.page.evaluate(pageLib); await hidePathOverlay?.(ctx); };
  const cam = (ctx, k) => ctx.vo((k) => window.__cine.set(k), k);
  const path = (ctx, keys) => ctx.vo((keys) => window.__cine.path(keys), keys);
  const hud = (ctx, mode) => ctx.vo((m) => window.__cine.hud(m), mode);
  const marks = () => { const m = []; const mark = (what) => m.push({ what, t: Date.now() / 1000 }); return [m, mark]; };
  const castTo = (ctx, spots) => Promise.all(Object.entries(spots).map(([k, c]) => c.at
    ? walkPuppet(ctx, k, c.at, { instant: true, yaw: yawTo(c.at, c.face) })
    : walkPuppet(ctx, k, c, { instant: true })));
  /** take colleagues offline (their socket closes, so they leave the world) / bring them back */
  // Presence is persistent for checked-in employees, so "gone home" is the real thing: a check-out through the
  // attendance API as that person (and a check-in to come back). The socket follows the same state.
  const att = async (ctx, k, want) => {
    const email = ctx.CAST[k].email;
    const me = await ctx.api(email, "GET", "/attendance/me").catch(() => null);
    const isIn = me?.status === "CHECKED_IN";
    if (want === "in" && !isIn) await ctx.api(email, "POST", "/attendance/check-in");
    if (want === "out" && isIn) await ctx.api(email, "POST", "/attendance/check-out");
  };
  const offline = async (ctx, keys) => {
    for (const k of keys) { await att(ctx, k, "out"); const s = ctx.puppets.s.get(k); if (s) { s.close(); ctx.puppets.s.delete(k); ctx.puppets.at.delete(k); } }
    await ctx.sleep(1200);
  };
  const online = async (ctx, keys) => {
    for (const k of keys) await att(ctx, k, "in");
    const miss = keys.filter((k) => !ctx.puppets.s.get(k)?.connected);
    if (miss.length) await ctx.puppets.connect(miss);
    await ctx.sleep(1200);
  };
  /** a held key for ms (real KeyboardEvents) */
  const hold = async (ctx, key, ms) => { await ctx.page.keyboard.down(key); await ctx.sleep(ms); await ctx.page.keyboard.up(key); };
  /** save the ambience tap next to the take's frames */
  async function saveTap(ctx, name) {
    const r = await ctx.vo(() => window.__cine.tapStop());
    if (!r?.b64) return null;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const dir = process.env.FILM_CLIPS;
    await mkdir(dir, { recursive: true });
    const file = `${dir}/${name}.ambience.webm`;
    await writeFile(file, Buffer.from(r.b64, "base64"));
    return { file, t0: r.t0 / 1000 };
  }

  return {
    // ---------------------------------------------------------------- ACT 1 — night, rain, an empty office
    CineNight: {
      about: "ACT 1 — night, rain: a slow crane down over the empty campus to Bon alone on the street, facing the lit building",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "explore");
        await lib(ctx);
        await castTo(ctx, NIGHT_AWAY);
        await ctx.vo(() => { __vo3d.env.setTime("night"); __vo3d.weather.setWeather("rain"); });
        await placeBon(ctx, STREET_BACK);
        await placeBon(ctx, STREET);                                         // the last step in faces him north, at the building
        await hud(ctx, "clean");
        await cam(ctx, CINE_CAM.night0);
        await ctx.sleep(4000);                                               // rain + light settled
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "denied",
      async go(ctx) {
        const [m, mark] = marks();
        await ctx.vo(() => window.__cine.tapStart());
        mark("crane");
        await path(ctx, [{ t: 0, ...CINE_CAM.night0 }, { t: 15000, ...CINE_CAM.night1, ease: "io" }]);
        mark("held");
        await ctx.sleep(2500);
        mark("end");
        m.push({ what: "tap", ...(await saveTap(ctx, "CineNight")) });
        return m;
      },
    },

    CineDawn: {
      about: "ACT 1→2 — the same street, locked off: night and rain give way to a clear morning (the real Environment switch)",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "explore");
        await lib(ctx);
        await castTo(ctx, NIGHT_AWAY);
        await ctx.vo(() => { __vo3d.env.setTime("night"); __vo3d.weather.setWeather("rain"); });
        await placeBon(ctx, STREET_BACK);
        await placeBon(ctx, STREET);
        await hud(ctx, "clean");
        await cam(ctx, CINE_CAM.dawn);
        await ctx.sleep(4000);
      },
      async go(ctx) {
        const [m, mark] = marks();
        mark("night");
        await ctx.sleep(2500);
        await ctx.vo(() => __vo3d.weather.setWeather("clear"));
        mark("clear");
        await ctx.sleep(1500);
        await ctx.vo(() => __vo3d.env.setTime("sunset"));
        mark("sunset");
        await ctx.sleep(2000);
        await ctx.vo(() => __vo3d.env.setTime("day"));
        mark("day");
        await ctx.sleep(4000);
        mark("end");
        return m;
      },
    },

    // ---------------------------------------------------------------- ACT 2 — arrival
    CineArrive: {
      about: "ACT 2 — morning, Player view: Bon walks in off the street, through the auto-door, across a lived-in Reception to the gates",
      async stage(ctx) {
        await attendance(ctx, "out");
        await lib(ctx);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
        await castTo(ctx, MORNING);
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(({ p }) => { __vo3d.player.teleport(p.x, p.z); __vo3d.cave.look(0, -1, 0.1); }, { p: STREET_BACK });
        await hud(ctx, "clean");
        await ctx.sleep(3500);
      },
      async go(ctx) {
        const [m, mark] = marks();
        const bg = [];
        const cue = (ms, fn) => bg.push(ctx.sleep(ms).then(fn).catch(() => {}));
        cue(1200, () => walkLine(ctx, "jona", [{ x: 640, z: 1040 }, { x: 900, z: 1060 }], { x: 935, z: 1045 }, 45));
        cue(2500, () => walkLine(ctx, "angelo", [{ x: 470, z: 756 }], null, 50));
        mark("walk");
        const swing = ctx.vo(() => window.__cine.swing(-0.35, 0.05, 6000));
        await ctx.page.keyboard.down("KeyW");
        await until(ctx, () => __vo3d.player.position().z < 960, "Bon at the gates", undefined, 20000).catch(() => {});
        await ctx.page.keyboard.up("KeyW");
        await swing;
        mark("gates");
        await ctx.sleep(2500);
        mark("end");
        await Promise.all(bg);
        return m;
      },
    },

    CineGate: {
      about: "ACT 2 — the refusal, close: checked-out Bon steps into the lane and the gates light red",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "explore");
        await lib(ctx);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
        await castTo(ctx, MORNING);
        await placeBon(ctx, { x: 904, z: 940 });                            // the east end of the desk, on the real route in
        await hud(ctx, "nodock");
        await cam(ctx, CINE_CAM.gate0);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "denied",
      async go(ctx) {
        const [m, mark] = marks();
        mark("step");
        const push = path(ctx, [{ t: 0, ...CINE_CAM.gate0 }, { t: 6500, ...CINE_CAM.gate1 }]);
        await placeBon(ctx, GATE_SENSOR);
        mark("red");
        await push;
        await ctx.sleep(1500);
        mark("end");
        return m;
      },
    },

    CineCheckIn: {
      about: "ACT 2 — the kiosk: Bon walks up, the real Check In card, the click, then the Company Hub opens (cards + weather)",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "explore");
        await lib(ctx);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("auto"); });
        await castTo(ctx, MORNING);
        await placeBon(ctx, GATE_SENSOR);
        await hud(ctx, "nodock");
        await cam(ctx, CINE_CAM.kiosk0);
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "denied",
      async go(ctx) {
        const [m, mark] = marks();
        mark("approach");
        const push = path(ctx, [{ t: 0, ...CINE_CAM.kiosk0 }, { t: 5000, ...CINE_CAM.kiosk1 }]);
        await ctx.vo(() => __vo3d.reception.startApproach(__vo3d.reception.kioskId));
        await until(ctx, () => [...document.querySelectorAll("[role=menuitem]")].some((e) => e.textContent.trim() === "Check In"), "the kiosk card", undefined, 35000);
        await push;
        mark("card");
        await ctx.sleep(1600);
        await ctx.click("Check In");
        mark("check-in");
        await until(ctx, () => __vo3d.access.state().access === "permitted", "check-in confirmed");
        mark("permitted");
        await ctx.sleep(3500);                                              // the Company Hub opens on its own (real)
        mark("hub");
        const hubMarks = await hubTour(ctx);
        m.push(...hubMarks);
        mark("end");
        return m;
      },
    },

    CineWeather: {
      about: "ACT 2 — the Hub's weather slide: Choose a city → 'Mandaluyong' → the real forecast for his area",
      async stage(ctx) {
        await attendance(ctx, "in");
        await closePanels(ctx);
        await view(ctx, "explore");
        await lib(ctx);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("auto"); });
        await castTo(ctx, MORNING);
        await placeBon(ctx, { x: 575, z: 1075 });
        await hud(ctx, "nodock");
        await cam(ctx, CINE_CAM.kiosk1);
        await ctx.click("Open Company Hub");                                 // the dock's own Hub button (off camera: dock hidden)
        await until(ctx, () => !!document.querySelector("button[aria-label='Next item']"), "the Hub");
        const n = await ctx.vo(() => [...document.querySelectorAll("button")].filter((b) => /^Item \d+ of \d+$/.test(b.getAttribute("aria-label") ?? "")).length);
        await ctx.click(`Item ${n} of ${n}`);                                // the last slide is the weather
        await ctx.sleep(1500);
      },
      verify: async (ctx) => ctx.vo(() => !!document.querySelector("section[aria-label='Weather forecast']")),
      async go(ctx) {
        const [m, mark] = marks();
        await ctx.sleep(1200);
        mark("slide");
        await ctx.click("Choose a city");
        await ctx.sleep(600);
        await ctx.page.click("#weather-city-search");
        await ctx.page.mouse.move(1919, 1079);
        mark("typing");
        for (const ch of "Mandaluyong") { await ctx.page.keyboard.type(ch); await ctx.sleep(70 + Math.random() * 60); }
        await ctx.sleep(500);
        await ctx.page.keyboard.press("Enter");                              // the card searches on submit
        mark("search");
        await until(ctx, () => document.querySelectorAll("li button[class*='resultRow']").length > 0, "city matches", undefined, 15000);
        await ctx.sleep(1400);
        const row = await ctx.vo(() => {
          const rows = [...document.querySelectorAll("li button[class*='resultRow']")];
          const r = rows.find((b) => /mandaluyong/i.test(b.textContent) && /metro manila/i.test(b.textContent)) ?? rows.find((b) => /mandaluyong/i.test(b.textContent));
          if (!r) return null;
          const q = r.getBoundingClientRect();
          return { x: q.x + q.width / 2, y: q.y + q.height / 2, label: r.textContent.trim() };
        });
        if (!row) throw new Error("no Mandaluyong match");
        await ctx.page.mouse.click(row.x, row.y);
        await ctx.page.mouse.move(1919, 1079);
        mark(`picked:${row.label}`);
        await until(ctx, () => /°/.test(document.querySelector("section[aria-label='Weather forecast']")?.textContent ?? ""), "the forecast", undefined, 15000);
        mark("forecast");
        await ctx.sleep(5000);
        mark("end");
        return m;
      },
    },

    CineEnter: {
      about: "ACT 2 — through the green gates; the camera cranes up and back as the whole living office opens out",
      async stage(ctx) {
        await attendance(ctx, "in");
        await closePanels(ctx);
        await view(ctx, "explore");
        await lib(ctx);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("auto"); });
        await castTo(ctx, MORNING);
        await placeBon(ctx, { x: 800, z: 936 });                            // on the real route in, just east of the lane
        await readAll(ctx);
        await hud(ctx, "full");
        await cam(ctx, CINE_CAM.enter0);
        await ctx.sleep(3000);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "permitted",
      async go(ctx) {
        const [m, mark] = marks();
        const bg = [];
        const cue = (ms, fn) => bg.push(ctx.sleep(ms).then(fn).catch(() => {}));
        cue(600, () => walkLine(ctx, "angelo", [{ x: 470, z: 756 }], null, 45));
        cue(2200, () => walkLine(ctx, "micah", [{ x: 820, z: 650 }], null, 45));
        cue(3800, () => walkLine(ctx, "clang", [{ x: 930, z: 800 }], null, 40));
        cue(5200, () => walkLine(ctx, "france", [{ x: 560, z: 700 }], null, 40));
        mark("walk");
        const crane = path(ctx, [{ t: 0, ...CINE_CAM.enter0 }, { t: 4500, ...CINE_CAM.enter1, ease: "in" }, { t: 13000, ...CINE_CAM.enter2, ease: "out" }]);
        await placeBon(ctx, PAST_GATES);
        mark("through");
        await crane;
        mark("wide");
        await ctx.sleep(2000);
        mark("end");
        await Promise.all(bg);
        return m;
      },
    },


    // ============================================================ REVISED PROOF (v2): Office → 3D → Player
    V2OfficeNight: {
      about: "ACT 1 — Office view at night: tight on the dark Reception, pulling out to the whole floor, then drifting over the rooms; three people working late",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "office");
        await lib(ctx);
        await online(ctx, [...LATE.keys, ...LATE.away]);
        await castTo(ctx, LATE.at);
        await castTo(ctx, LATE.desk);
        await ctx.vo(() => { __vo3d.env.setTime("night"); __vo3d.weather.setWeather("rain"); });
        await placeBon(ctx, STREET_BACK); await placeBon(ctx, STREET);
        await hud(ctx, "clean");
        await ctx.vo((k) => __vo3d.cameraModes.focus(k, 0.95), OFFICE_CAM.reception);
        await ctx.sleep(3500);
      },
      async go(ctx) {
        const [m, mark] = marks();
        await ctx.vo(() => window.__cine.tapStart());
        mark("pull");
        await ctx.vo((keys) => window.__cine.officePath(keys), [
          { t: 0, ...OFFICE_CAM.reception }, { t: 9000, ...OFFICE_CAM.whole, ease: "io" }, { t: 17500, ...OFFICE_CAM.rooms, ease: "io" }]);
        mark("end");
        await ctx.sleep(800);
        m.push({ what: "tap", ...(await saveTap(ctx, "V2OfficeNight")) });
        return m;
      },
    },

    V2Night3D: {
      about: "ACT 2 — still night: the real C press turns the flat plan into the 3D world; the camera rises and turns toward the rainy street",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "office");
        await lib(ctx);
        await online(ctx, [...LATE.keys, ...LATE.away]);
        await castTo(ctx, LATE.at);
        await castTo(ctx, LATE.desk);
        await ctx.vo(() => { __vo3d.env.setTime("night"); __vo3d.weather.setWeather("rain"); });
        await placeBon(ctx, STREET_BACK); await placeBon(ctx, STREET);
        await hud(ctx, "clean");
        await ctx.vo((k) => __vo3d.cameraModes.focus(k, 0.95), OFFICE_CAM.entrance);
        await ctx.sleep(3500);
      },
      async go(ctx) {
        const [m, mark] = marks();
        await ctx.vo(() => window.__cine.tapStart());
        await ctx.sleep(1200);
        mark("C");
        await ctx.press("KeyC");
        await until(ctx, () => __vo3d.cameraModes.mode === "explore", "3D view");
        mark("explore");
        await ctx.sleep(900);
        const from = await ctx.vo(() => window.__cine.current());
        await path(ctx, [{ t: 0, ...from }, { t: 7000, ...CINE_CAM.night0, ease: "io" }]);
        mark("end");
        await ctx.sleep(1200);
        m.push({ what: "tap", ...(await saveTap(ctx, "V2Night3D")) });
        return m;
      },
    },

    V2Morning3D: {
      about: "ACT 2 — morning in 3D: colleagues come through the gates and spread out to the Hub and their rooms; a slow orbit over the concourse",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "explore");
        await lib(ctx);
        await online(ctx, Object.keys(ARRIVALS));
        await castTo(ctx, Object.fromEntries(Object.entries(ARRIVALS).map(([k, a]) => [k, a.from])));
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
        await placeBon(ctx, STREET_BACK); await placeBon(ctx, STREET);
        await hud(ctx, "nodock");
        await cam(ctx, CINE_CAM.morning0);
        await ctx.sleep(3500);
      },
      async go(ctx) {
        const [m, mark] = marks();
        const bg = Object.entries(ARRIVALS).map(([k, a]) => ctx.sleep(a.delay).then(() => walkPuppet(ctx, k, a.to, { speed: a.speed ?? 70 })).catch(() => {}));
        mark("orbit");
        await path(ctx, [{ t: 0, ...CINE_CAM.morning0 }, { t: 12000, ...CINE_CAM.morning1, ease: "io" }]);
        mark("end");
        await Promise.all(bg);
        return m;
      },
    },

    V2StreetPV: {
      about: "ACT 3 — morning: 3D view on Bon at the kerb, the real C press drops into Player view behind him, and he walks in through the auto-door",
      async stage(ctx) {
        await attendance(ctx, "out");
        await view(ctx, "explore");
        await lib(ctx);
        await online(ctx, Object.keys(MORNING));
        await castTo(ctx, MORNING);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
        await placeBon(ctx, STREET_BACK);
        await placeBon(ctx, { x: 720, z: 1226 });
        await hideHint(ctx);
        await hud(ctx, "clean");
        await cam(ctx, CINE_CAM.kerb);
        await ctx.sleep(3000);
      },
      async go(ctx) {
        const [m, mark] = marks();
        const bg = [];
        const cue = (ms, fn) => bg.push(ctx.sleep(ms).then(fn).catch(() => {}));
        cue(1500, () => walkPuppet(ctx, "jona", { x: 900, z: 1090 }, { speed: 60 }));     // the pathfinder takes her round the desk
        mark("hold");
        await ctx.sleep(1200);
        mark("C");
        await ctx.press("KeyC");
        await until(ctx, () => __vo3d.cameraModes.mode === "player", "Player view");
        mark("player");
        await ctx.vo(() => __vo3d.cave.look(0, -1, 0.1));
        await ctx.sleep(1300);
        mark("walk");
        await ctx.page.keyboard.down("KeyW");
        await until(ctx, () => __vo3d.player.position().z < 1086, "Bon inside", undefined, 12000).catch(() => {});
        await ctx.page.keyboard.up("KeyW");
        mark("inside");
        await ctx.sleep(1800);
        mark("end");
        await Promise.all(bg);
        return m;
      },
    },

    V2GatePV: {
      about: "ACT 3 — Player view, side-on: Bon walks along the gate line and turns into a lane; it lights red; the camera eases round behind him",
      async stage(ctx) {
        await attendance(ctx, "out");
        await lib(ctx);
        await online(ctx, Object.keys(MORNING));
        await castTo(ctx, MORNING);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(() => { __vo3d.player.teleport(866, 938); __vo3d.cave.look(-1, 0, 0.12); });
        await hud(ctx, "clean");
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "denied",
      async go(ctx) {
        const [m, mark] = marks();
        mark("walk");
        await ctx.page.keyboard.down("KeyW");
        await until(ctx, () => __vo3d.player.position().x < 744, "at the lane", undefined, 8000).catch(() => {});
        await ctx.page.keyboard.up("KeyW");
        await ctx.page.keyboard.down("KeyD");                                   // strafe right = north, into the lane
        await until(ctx, () => __vo3d.player.position().z < 924, "in the lane", undefined, 4000).catch(() => {});
        await ctx.sleep(250);
        await ctx.page.keyboard.up("KeyD");
        mark("red");
        await ctx.sleep(900);
        await ctx.vo(() => window.__cine.swing(1.25, -0.04, 2600));            // round behind him: the red lanes ahead
        mark("behind");
        await ctx.sleep(1600);
        mark("end");
        return m;
      },
    },

    V2KioskPV: {
      about: "ACT 3 — Player view, over the shoulder at the kiosk: E, the real card, Check In; the Company Hub over the Player view; the weather slide's city search",
      async stage(ctx) {
        await attendance(ctx, "out");
        await lib(ctx);
        await online(ctx, Object.keys(MORNING));
        await castTo(ctx, MORNING);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("auto"); });
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(() => { __vo3d.player.teleport(552, 1070); __vo3d.cave.look(0, -1, 0.16); });
        await ctx.sleep(900);
        await ctx.vo(() => window.__cine.swing(1.15, 0.05, 10));
        await hud(ctx, "nodock");
        await ctx.sleep(2200);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.player.target())) === "Check-in kiosk",
      async go(ctx) {
        const [m, mark] = marks();
        await ctx.sleep(900);
        mark("E");
        await ctx.press("KeyE");
        await until(ctx, () => [...document.querySelectorAll("[role=menuitem]")].some((e) => e.textContent.trim() === "Check In"), "the kiosk card", undefined, 10000);
        mark("card");
        await ctx.sleep(1500);
        await ctx.click("Check In");
        mark("check-in");
        await until(ctx, () => __vo3d.access.state().access === "permitted", "check-in confirmed");
        mark("permitted");
        await until(ctx, () => !!document.querySelector("button[aria-label='Next item']"), "the Hub", undefined, 15000);
        await ctx.sleep(1800);
        m.push(...(await hubTour(ctx, 2000)));
        mark("end");
        return m;
      },
    },

    V2GreenPV: {
      about: "ACT 3 — checked in: Bon walks through the lane as it turns green and out onto a busy concourse; the camera lifts to the Hub",
      async stage(ctx) {
        await attendance(ctx, "in");
        await closePanels(ctx);
        await lib(ctx);
        await online(ctx, Object.keys(MORNING));
        await castTo(ctx, MORNING);
        await ctx.vo(() => { __vo3d.env.setTime("day"); __vo3d.weather.setWeather("clear"); });
        await readAll(ctx);
        await hideHint(ctx);
        await view(ctx, "player");
        await ctx.vo(() => { __vo3d.player.teleport(784, 946); __vo3d.cave.look(0, -1, 0.1); });   // lane C (x 762–806): lane B has a bollard, 678–698 is a pillar
        await hud(ctx, "full");
        await ctx.sleep(2500);
      },
      verify: async (ctx) => (await ctx.vo(() => __vo3d.access.state().access)) === "permitted",
      async go(ctx) {
        const [m, mark] = marks();
        const bg = [];
        const cue = (ms, fn) => bg.push(ctx.sleep(ms).then(fn).catch(() => {}));
        cue(800, () => walkPuppet(ctx, "angelo", { x: 470, z: 756 }, { speed: 60 }));
        cue(1800, () => walkPuppet(ctx, "micah", { x: 820, z: 650 }, { speed: 55 }));
        mark("walk");
        await ctx.page.keyboard.down("KeyW");
        await until(ctx, () => __vo3d.player.position().z < 790, "on the concourse", undefined, 9000).catch(() => {});
        await ctx.page.keyboard.up("KeyW");
        mark("concourse");
        await ctx.vo(() => window.__cine.swing(0.35, -0.12, 3200));
        mark("lift");
        await ctx.sleep(1500);
        mark("end");
        await Promise.all(bg);
        return m;
      },
    },
  };

  /** The post-check-in Company Hub: step through its real carousel, then the weather slide's city search. */
  async function hubTour(ctx, hold = 2600) {
    const [m, mark] = marks();
    const next = () => ctx.vo(() => {
      const b = [...document.querySelectorAll("button")].find((e) => /^(next|next slide|next item)/i.test(e.getAttribute("aria-label") ?? ""));
      if (!b) return false;
      b.click();
      return true;
    });
    for (let i = 0; i < 9; i++) {
      const title = await ctx.vo(() => {
        let el = document.querySelector("button[aria-label='Next item']");
        while (el && !el.querySelector("h2")) el = el.parentElement;
        return el?.querySelector("h2")?.textContent?.trim() ?? null;
      });
      mark(`slide:${title}`);
      if (await ctx.vo(() => !!document.querySelector("section[aria-label='Weather forecast']"))) break;
      await ctx.sleep(hold);
      if (!(await next())) break;
    }
    await ctx.sleep(1200);
    // the weather slide: choose a city, the real search, the real forecast
    const choose = await ctx.click("Change city").then(() => true, () => ctx.click("Choose a city").then(() => true, () => false));
    if (choose) {
      await ctx.sleep(600);
      await ctx.page.click("#weather-city-search");
      await ctx.page.mouse.move(1919, 1079);
      mark("typing");
      for (const ch of "Mandaluyong") { await ctx.page.keyboard.type(ch); await ctx.sleep(70 + Math.random() * 60); }
      await ctx.sleep(450);
      await ctx.page.keyboard.press("Enter");
      mark("search");
      await until(ctx, () => document.querySelectorAll("li button[class*='resultRow']").length > 0, "city matches", undefined, 15000);
      await ctx.sleep(1300);
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
      await ctx.sleep(4000);
    }
    mark("forecast");
    return m;
  }
}

// Explore-view framings: target (x, z), pitch (deg), yaw (deg), zoom (1 ≈ the whole-office framing).
export const CINE_CAM = {
  morning0: { x: 725, z: 790, pitch: 36, yaw: -24, zoom: 1.2 },
  morning1: { x: 715, z: 715, pitch: 44, yaw: 10, zoom: 0.98 },
  kerb:     { x: 720, z: 1180, pitch: 26, yaw: -8, zoom: 1.5 },
  night0: { x: 720, z: 1120, pitch: 58, yaw: -28, zoom: 0.55 },
  night1: { x: 720, z: 1185, pitch: 24, yaw: -6, zoom: 1.35 },
  dawn:   { x: 720, z: 1170, pitch: 22, yaw: -4, zoom: 1.2 },
  gate0:  { x: 760, z: 925, pitch: 40, yaw: 35, zoom: 2.0 },
  gate1:  { x: 735, z: 912, pitch: 48, yaw: 18, zoom: 2.7 },
  kiosk0: { x: 650, z: 985, pitch: 36, yaw: 20, zoom: 1.6 },
  kiosk1: { x: 560, z: 1055, pitch: 30, yaw: 80, zoom: 2.4 },
  enter0: { x: 760, z: 905, pitch: 30, yaw: 10, zoom: 2.4 },
  enter1: { x: 735, z: 850, pitch: 34, yaw: 4, zoom: 1.9 },
  enter2: { x: 690, z: 770, pitch: 46, yaw: -14, zoom: 1.15 },
};
