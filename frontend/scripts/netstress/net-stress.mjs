#!/usr/bin/env node
// VO NETWORK/BACKEND STRESS — dev-only, measurement-only.
//
// Drives the REAL realtime backend on :8001 through its REAL protocol. Nothing here invents an
// event, bypasses auth unsafely, or touches the schema:
//
//   IDENTITY. The Socket.IO handshake's existing dev identity path — auth { "x-dev-email": ... },
//   app/realtime/socket.py::_dev_email_from_auth. It is hard-gated on APP_ENV == "development"
//   (fail-closed) and regex-validated server-side; it is the same seam the VO frontend's `?as=`
//   override uses. The Atlas token path (verify_atlas_token) is deliberately NOT exercised — see
//   the proof-gap note in the report.
//
//   EVENTS. walk_started / walk_arrived, room_presence_enter / room_presence_leave, dnd_set,
//   go_offline / come_online — with payloads that satisfy the server's own validators
//   (_valid_walk_started_payload etc.), so a malformed one would be silently dropped and show up
//   as a delivery failure rather than passing unnoticed.
//
//   DELIBERATELY AVOIDED. spatial_session_start and approach_arrived write quest_events; this
//   phase measures transport and fan-out, not the quest ledger, so they are left alone.
//
// FAN-OUT IS THE POINT. Every one of those handlers broadcasts to EVERY connected socket (only
// call invites are room-scoped), so N clients emitting movement is O(N²) delivery. Latency is
// measured end to end — emitter's clock to receiver's clock, both in this process, so the numbers
// are real one-way delivery times rather than a round trip.
//
//   node scripts/netstress/net-stress.mjs                 # ramp + all 8 scenarios at 70
//   node scripts/netstress/net-stress.mjs --only idle,cave
//   node scripts/netstress/net-stress.mjs --clients 25 --seconds 10
import { io } from "socket.io-client";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith("--") ? v : true; };

const URL_BASE = String(arg("url", "http://localhost:8001"));
const PREFIX = String(arg("prefix", "vostress-"));
const DOMAIN = String(arg("domain", "offshorly.com"));
const SECONDS = Number(arg("seconds", 12));
const PEAK = Number(arg("clients", 70));
const RAMP = String(arg("ramp", "1,10,25,50,70")).split(",").map(Number).filter((n) => n > 0);
const ONLY = arg("only") ? String(arg("only")).split(",").map((s) => s.trim()) : null;
const OUT = resolve(String(arg("out", resolve(HERE, "results"))));

const email = (i) => `${PREFIX}${String(i).padStart(2, "0")}@${DOMAIN}`;
const log = (...a) => console.log("[net]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[i] * 100) / 100;
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: pct(s, 100), mean: s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 100) / 100 : 0 };
}

// ---- backend process sampling (read-only) -------------------------------------------------------
function backendPid() {
  try {
    const parent = execFileSync("bash", ["-lc", `lsof -ti :${new URL(URL_BASE).port} -sTCP:LISTEN | head -1`]).toString().trim();
    if (!parent) return null;
    // uvicorn --reload: the listener is the RELOADER; the app runs in a child alongside a tiny
    // file-watcher process, so pick the heaviest child rather than the first.
    const kids = execFileSync("bash", ["-lc", `pgrep -P ${parent} || true`]).toString().trim().split(/\s+/).filter(Boolean);
    if (!kids.length) return parent;
    let best = parent, bestRss = -1;
    for (const k of kids) {
      const rss = Number(execFileSync("bash", ["-lc", `ps -o rss= -p ${k} || echo 0`]).toString().trim() || 0);
      if (rss > bestRss) { bestRss = rss; best = k; }
    }
    return best;
  } catch { return null; }
}
/** ps %cpu on macOS is a LIFETIME average, useless for a 12-second window. Cumulative CPU TIME is
 *  not: sampled at both ends of a scenario it gives the CPU seconds that scenario actually cost. */
function cpuSeconds(t) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(t.trim());
  if (!m) return NaN;
  const [, d, h, mi, sec] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(mi) * 60) + Number(sec);
}
function sampleProc(pid) {
  if (!pid) return null;
  try {
    const out = execFileSync("ps", ["-o", "time=,rss=", "-p", String(pid)]).toString().trim().split(/\s+/);
    return { cpuSec: cpuSeconds(out[0]), rssMb: Math.round(Number(out[1]) / 1024) };
  } catch { return null; }
}

// ---- a simulated employee ----------------------------------------------------------------------
class Client {
  constructor(i, bus) {
    this.i = i;
    this.email = email(i);
    this.bus = bus;
    this.socket = null;
    this.connects = 0;
    this.connectMs = [];
    this.errors = [];
    this.unexpectedDisconnects = 0;
    this.lastSnapshot = null;
    this.lastRoomPresence = null;
    this.lastArrived = null; // {movementId, at, revision}
    this.closing = false;
  }
  connect() {
    return new Promise((resolve) => {
      const t0 = now();
      // reconnection OFF: this harness owns the reconnect scenario explicitly, so a silent
      // client-library retry can never disguise a failed connection as a successful one.
      const s = io(URL_BASE, { transports: ["websocket"], auth: { "x-dev-email": this.email }, reconnection: false, timeout: 20000 });
      this.socket = s;
      let settled = false;
      s.on("connect", () => { this.connects++; this.connectMs.push(now() - t0); if (!settled) { settled = true; resolve(true); } });
      s.on("connect_error", (e) => { this.errors.push(`connect_error: ${e.message}`); if (!settled) { settled = true; resolve(false); } });
      s.on("disconnect", (reason) => { if (!this.closing) { this.unexpectedDisconnects++; this.errors.push(`disconnect: ${reason}`); } });
      s.on("chat_error", (p) => this.errors.push(`chat_error: ${p?.code ?? "?"}`));
      s.on("positions_snapshot", (p) => { this.lastSnapshot = p; this.bus.onSnapshot(this, p); });
      s.on("room_presence", (p) => { this.lastRoomPresence = p; this.bus.onBroadcast("room_presence", this); });
      s.on("dnd_status", () => this.bus.onBroadcast("dnd_status", this));
      s.on("offline_lineup", () => this.bus.onBroadcast("offline_lineup", this));
      s.on("peer_walk_started", (p) => this.bus.onPeerWalk("peer_walk_started", this, p));
      s.on("peer_walk_arrived", (p) => { this.bus.onPeerWalk("peer_walk_arrived", this, p); });
      s.onAny((e) => { this.bus.received++; void e; });
    });
  }
  close() { this.closing = true; this.socket?.close(); }
}

// ---- the measurement bus -----------------------------------------------------------------------
class Bus {
  constructor() { this.reset(); }
  reset() {
    this.received = 0;
    this.emitted = 0;
    this.inflight = new Map();   // key -> { t0, expected, got }
    this.latencies = { peer_walk_started: [], peer_walk_arrived: [], room_presence: [], dnd_status: [], offline_lineup: [] };
    this.broadcastInflight = null;
    this.fanout = { expected: 0, actual: 0 };
    this.snapshots = 0;
  }
  /** a movement emit: one key, N-1 expected receivers */
  trackWalk(key, expected) { this.inflight.set(key, { t0: now(), expected, got: 0 }); this.fanout.expected += expected; this.emitted++; }
  onPeerWalk(event, client, payload) {
    const key = `${event}:${payload?.movementId}`;
    const rec = this.inflight.get(key);
    if (!rec) return;
    rec.got++;
    this.fanout.actual++;
    this.latencies[event].push(now() - rec.t0);
  }
  /** a broadcast-shaped emit (room/status): one key, N expected receivers (the emitter included) */
  trackBroadcast(event, expected) { this.broadcastInflight = { event, t0: now(), expected, got: 0 }; this.fanout.expected += expected; this.emitted++; }
  onBroadcast(event, _client) {
    const b = this.broadcastInflight;
    if (!b || b.event !== event) return;
    b.got++;
    this.fanout.actual++;
    this.latencies[event].push(now() - b.t0);
  }
  onSnapshot() { this.snapshots++; }
  settle() {
    const missing = [...this.inflight.values()].reduce((n, r) => n + (r.expected - r.got), 0);
    return missing;
  }
}

// ---- payload builders, matching the server's validators ----------------------------------------
let movementSeq = 0;
const ROOMS = ["design-team", "dev-team", "qa-team", "cms-team", "ai-team", "executive", "gaming", "meeting", "project", "reception", "central-hub"];
const FACINGS = ["front", "back", "left", "right"];
const point = (x, y) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });

function walkStarted(i) {
  const id = `ms-${++movementSeq}-${i}`;
  const ox = 200 + ((i * 37) % 900), oy = 200 + ((i * 53) % 700);
  return {
    movementId: id,
    origin: point(ox, oy),
    path: [point(ox + 40, oy), point(ox + 40, oy + 40)],
    roomId: ROOMS[i % ROOMS.length],
    durationMs: 1200,
  };
}
const walkArrived = (started, i) => ({
  movementId: started.movementId,
  at: started.path[started.path.length - 1],
  facing: FACINGS[i % 4],
  state: "standing",
  seatKey: null,
  roomId: started.roomId,
});

// ---- health / event-loop responsiveness probe ---------------------------------------------------
class HealthProbe {
  constructor() { this.samples = []; this.stop = false; }
  async run() {
    while (!this.stop) {
      const t0 = now();
      try {
        const r = await fetch(`${URL_BASE}/health`);
        await r.text();
        this.samples.push(now() - t0);
      } catch { this.samples.push(NaN); }
      await sleep(250);
    }
  }
}

// ---- scenarios ----------------------------------------------------------------------------------
/** Each scenario receives the live clients and drives them with real emits for `seconds`. */
const SCENARIOS = {
  "idle": {
    label: "connected / idle presence",
    async run() { await sleep(SECONDS * 1000); },
  },
  "movement-distributed": {
    label: "distributed movement updates",
    async run(cs, bus) {
      const end = Date.now() + SECONDS * 1000;
      let round = 0;
      while (Date.now() < end) {
        // one walk per client per ~3 s, staggered across the population
        const slice = cs.filter((_, idx) => idx % 6 === round % 6);
        for (const c of slice) await emitWalk(c, cs.length, bus);
        round++;
        await sleep(500);
      }
    },
  },
  "movement-burst": {
    label: "movement burst (all clients at once)",
    async run(cs, bus) {
      const end = Date.now() + SECONDS * 1000;
      while (Date.now() < end) {
        await Promise.all(cs.map((c) => emitWalk(c, cs.length, bus)));
        await sleep(1000);
      }
    },
  },
  "status": {
    label: "status changes (DND + offline lineup)",
    async run(cs, bus) {
      const end = Date.now() + SECONDS * 1000;
      let flip = false;
      while (Date.now() < end) {
        for (const c of cs) {
          bus.trackBroadcast("dnd_status", cs.length);
          c.socket.emit("dnd_set", { isDnd: flip });
          await sleep(12);
        }
        flip = !flip;
        await sleep(400);
      }
      for (const c of cs) c.socket.emit("dnd_set", { isDnd: false });
    },
  },
  "rooms": {
    label: "room / location changes",
    async run(cs, bus) {
      const end = Date.now() + SECONDS * 1000;
      let round = 0;
      while (Date.now() < end) {
        for (const [idx, c] of cs.entries()) {
          bus.trackBroadcast("room_presence", cs.length);
          c.socket.emit("room_presence_enter", { roomId: ROOMS[(idx + round) % ROOMS.length] });
          await sleep(10);
        }
        round++;
        await sleep(300);
      }
    },
  },
  "cave": {
    label: "70 clients concentrated in the CAVE",
    async run(cs, bus) {
      // everybody into one room — the worst case for room_presence fan-out and for any
      // per-room bookkeeping that walks its occupant list
      for (const c of cs) {
        bus.trackBroadcast("room_presence", cs.length);
        c.socket.emit("room_presence_enter", { roomId: "cave-theater" });
        await sleep(10);
      }
      const end = Date.now() + SECONDS * 1000;
      while (Date.now() < end) {
        await Promise.all(cs.map((c) => emitWalk(c, cs.length, bus, "cave-theater")));
        await sleep(900);
      }
    },
  },
  "reconnect-burst": {
    label: "reconnect burst (all clients drop and return at once)",
    async run(cs, bus, ctx) {
      // give everyone a known position first, so "did reconnect restore state?" is answerable
      await Promise.all(cs.map((c) => emitWalk(c, cs.length, bus)));
      await sleep(1500);
      for (const c of cs) c.close();
      await sleep(1500);
      const t0 = now();
      const ok = await Promise.all(cs.map((c) => { c.closing = false; return c.connect(); }));
      ctx.reconnect = { allAtOnceMs: Math.round((now() - t0) * 100) / 100, succeeded: ok.filter(Boolean).length, attempted: cs.length };
      await sleep(Math.max(2000, SECONDS * 300));
    },
  },
  "mixed": {
    label: "mixed representative activity",
    async run(cs, bus) {
      const end = Date.now() + SECONDS * 1000;
      let round = 0;
      while (Date.now() < end) {
        const movers = cs.filter((_, i) => i % 3 === round % 3);
        await Promise.all(movers.map((c) => emitWalk(c, cs.length, bus)));
        const statusers = cs.filter((_, i) => i % 7 === round % 7);
        for (const c of statusers) { bus.trackBroadcast("dnd_status", cs.length); c.socket.emit("dnd_set", { isDnd: round % 2 === 0 }); await sleep(8); }
        const movers2 = cs.filter((_, i) => i % 5 === round % 5);
        for (const c of movers2) { bus.trackBroadcast("room_presence", cs.length); c.socket.emit("room_presence_enter", { roomId: ROOMS[(round + c.i) % ROOMS.length] }); await sleep(8); }
        round++;
        await sleep(600);
      }
      for (const c of cs) c.socket.emit("dnd_set", { isDnd: false });
    },
  },
};

async function emitWalk(c, total, bus, roomId) {
  if (!c.socket?.connected) return;
  const started = walkStarted(c.i);
  if (roomId) started.roomId = roomId;
  bus.trackWalk(`peer_walk_started:${started.movementId}`, total - 1);
  c.socket.emit("walk_started", started);
  await sleep(started.durationMs > 400 ? 40 : 10);
  const arrived = walkArrived(started, c.i);
  bus.trackWalk(`peer_walk_arrived:${started.movementId}`, total - 1);
  c.socket.emit("walk_arrived", arrived);
  c.lastArrived = { movementId: started.movementId, at: arrived.at, roomId: arrived.roomId };
}

// ---- runner --------------------------------------------------------------------------------------
async function connectAll(n) {
  const bus = new Bus();
  const clients = Array.from({ length: n }, (_, i) => new Client(i + 1, bus));
  const t0 = now();
  const ok = await Promise.all(clients.map((c) => c.connect()));
  const wallMs = Math.round((now() - t0) * 100) / 100;
  return { bus, clients, connected: ok.filter(Boolean).length, attempted: n, wallMs };
}

function collectErrors(clients) {
  const all = clients.flatMap((c) => c.errors);
  const byKind = {};
  for (const e of all) { const k = e.split(":")[0]; byKind[k] = (byKind[k] ?? 0) + 1; }
  return { total: all.length, byKind, sample: all.slice(0, 5) };
}

async function runScenario(id, clients, bus, pid) {
  const sc = SCENARIOS[id];
  bus.reset();
  const probe = new HealthProbe();
  const procSamples = [];
  const procTimer = setInterval(() => { const s = sampleProc(pid); if (s) procSamples.push(s); }, 500);
  void probe.run();
  const ctx = {};
  const t0 = now();
  await sc.run(clients, bus, ctx);
  await sleep(1200); // settle: let the last broadcasts land before counting misses
  const durationMs = Math.round((now() - t0) * 100) / 100;
  probe.stop = true;
  clearInterval(procTimer);

  const lat = {};
  for (const [k, v] of Object.entries(bus.latencies)) if (v.length) lat[k] = stats(v);
  const health = stats(probe.samples.filter((v) => Number.isFinite(v)));
  const rss = procSamples.map((s) => s.rssMb);
  const cpuStart = procSamples[0]?.cpuSec, cpuEnd = procSamples.at(-1)?.cpuSec;
  const cpuUsed = Number.isFinite(cpuStart) && Number.isFinite(cpuEnd) ? Math.round((cpuEnd - cpuStart) * 1000) / 1000 : null;
  return {
    id, label: sc.label, clients: clients.length, durationMs,
    emitted: bus.emitted, receivedEvents: bus.received,
    fanout: {
      expected: bus.fanout.expected, actual: bus.fanout.actual,
      deliveredPct: bus.fanout.expected ? Math.round((bus.fanout.actual / bus.fanout.expected) * 10000) / 100 : null,
      missing: Math.max(0, bus.fanout.expected - bus.fanout.actual),
    },
    latencyMs: lat,
    healthRttMs: health.n ? health : null,
    backend: procSamples.length ? {
      cpuSecondsUsed: cpuUsed,
      cpuPercentOfOneCore: cpuUsed !== null ? Math.round((cpuUsed / (durationMs / 1000)) * 1000) / 10 : null,
      rssAvgMb: Math.round(rss.reduce((a, b) => a + b, 0) / rss.length), rssMaxMb: Math.max(...rss),
      rssDeltaMb: rss.length > 1 ? rss.at(-1) - rss[0] : 0,
    } : null,
    connectedAtEnd: clients.filter((c) => c.socket?.connected).length,
    errors: collectErrors(clients),
    extra: ctx,
  };
}

async function main() {
  const pid = backendPid();
  log("target", URL_BASE, "| backend pid", pid ?? "(not resolved)");
  const report = { generatedAt: new Date().toISOString(), url: URL_BASE, backendPid: pid, emailPrefix: PREFIX, secondsPerScenario: SECONDS, ramp: [], scenarios: [] };

  // ---- RAMP: connection scaling only -----------------------------------------------------------
  for (const n of RAMP) {
    const { bus, clients, connected, attempted, wallMs } = await connectAll(n);
    await sleep(1500); // let every bootstrap snapshot land
    const cm = clients.flatMap((c) => c.connectMs);
    const s = sampleProc(pid);
    report.ramp.push({
      clients: n, connected, attempted, allConnectedWallMs: wallMs,
      connectLatencyMs: stats(cm),
      bootstrapEventsReceived: bus.received,
      bootstrapEventsPerClient: Math.round((bus.received / Math.max(1, connected)) * 100) / 100,
      backend: s, errors: collectErrors(clients),
    });
    log(`ramp ${n}: ${connected}/${attempted} connected in ${wallMs} ms · p95 ${stats(cm).p95} ms · bootstrap events ${bus.received}`);
    for (const c of clients) c.close();
    await sleep(1200);
  }

  // ---- SCENARIOS at peak -----------------------------------------------------------------------
  const ids = (ONLY ?? Object.keys(SCENARIOS)).filter((id) => SCENARIOS[id]);
  const { bus, clients, connected, attempted } = await connectAll(PEAK);
  log(`peak: ${connected}/${attempted} clients connected`);
  await sleep(2000);
  report.peak = { connected, attempted };
  for (const id of ids) {
    log(`scenario ${id} …`);
    const r = await runScenario(id, clients, bus, pid);
    report.scenarios.push(r);
    log(`  ${r.id}: delivered ${r.fanout.deliveredPct}% · emits ${r.emitted} · p95 ${Object.values(r.latencyMs)[0]?.p95 ?? "-"} ms · health p95 ${r.healthRttMs?.p95 ?? "-"} ms · cpu ${r.backend?.cpuPercentOfOneCore ?? "-"}% of a core`);
    await sleep(800);
  }

  // Write the raw run BEFORE any post-processing: a reporting bug must never destroy a five-minute
  // measurement (it did once).
  await mkdir(OUT, { recursive: true });
  const rawPath = resolve(OUT, `netstress-${report.generatedAt.replace(/[:.]/g, "-")}-raw.json`);
  await writeFile(rawPath, JSON.stringify(report, null, 2));

  // ---- CORRECTNESS: distinct identities + convergence ------------------------------------------
  const someone = clients.find((c) => c.socket?.connected);
  const snapshotEmails = new Set((someone?.lastSnapshot?.entries ?? []).map((e) => e.email));
  // room_presence payload is [{ roomId, members: [email] }] (RoomPresenceRegistry.snapshot)
  const roomsPayload = Array.isArray(someone?.lastRoomPresence?.rooms) ? someone.lastRoomPresence.rooms : [];
  const roomEmails = new Set(roomsPayload.flatMap((r) => r?.members ?? []));
  const caveMembers = (roomsPayload.find((r) => r?.roomId === "cave-theater")?.members ?? []).length;
  report.correctness = {
    distinctClientEmails: new Set(clients.map((c) => c.email)).size,
    positionsSnapshotDistinctEmails: snapshotEmails.size,
    stressEmailsInPositionsSnapshot: [...snapshotEmails].filter((e) => typeof e === "string" && e.startsWith(PREFIX)).length,
    roomPresenceDistinctEmails: [...roomEmails].filter((e) => typeof e === "string" && e.startsWith(PREFIX)).length,
    roomsOccupied: roomsPayload.length,
    caveOccupantsAtEnd: caveMembers,
    connectedAtEnd: clients.filter((c) => c.socket?.connected).length,
  };

  for (const c of clients) c.close();
  await sleep(1000);

  await mkdir(OUT, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const path = resolve(OUT, `netstress-${stamp}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  log("wrote", path);
  console.log("\n" + table(report) + "\n");
}

function table(report) {
  const lines = [
    "RAMP (connection scaling)",
    "| clients | connected | all-connected ms | connect p50 | p95 | p99 | bootstrap events | ev/client |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.ramp.map((r) => `| ${r.clients} | ${r.connected}/${r.attempted} | ${r.allConnectedWallMs} | ${r.connectLatencyMs.p50} | ${r.connectLatencyMs.p95} | ${r.connectLatencyMs.p99} | ${r.bootstrapEventsReceived} | ${r.bootstrapEventsPerClient} |`),
    "",
    `SCENARIOS at ${report.peak?.connected ?? "?"} clients`,
    "| scenario | emits | expected deliveries | delivered % | missing | p50 ms | p95 ms | p99 ms | max ms | health p95 ms | cpu % of core | rss max MB | errors |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.scenarios.map((s) => {
      const l = Object.values(s.latencyMs).sort((a, b) => b.n - a.n)[0];
      return `| ${s.label} | ${s.emitted} | ${s.fanout.expected} | ${s.fanout.deliveredPct ?? "-"} | ${s.fanout.missing} | ${l?.p50 ?? "-"} | ${l?.p95 ?? "-"} | ${l?.p99 ?? "-"} | ${l?.max ?? "-"} | ${s.healthRttMs?.p95 ?? "-"} | ${s.backend?.cpuPercentOfOneCore ?? "-"} | ${s.backend?.rssMaxMb ?? "-"} | ${s.errors.total} |`;
    }),
  ];
  return lines.join("\n");
}

main().catch((e) => { console.error("[net] FAILED:", e); process.exit(1); });
