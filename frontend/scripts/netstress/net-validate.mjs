#!/usr/bin/env node
// VO network stress — FOCUSED CORRECTNESS VALIDATION (dev-only, read-only against :8001).
// Throughput is not the question here; these are the four claims the stress numbers rest on:
//   1. 70 simulated clients are 70 DISTINCT server-side identities
//   2. a room/location change converges — every client agrees on who is in the CAVE
//   3. a movement update reaches every intended recipient and nobody else's identity
//   4. a reconnect restores the client's own last stable position
import { io } from "socket.io-client";
const URL_BASE = "http://localhost:8001";
const N = Number(process.argv[2] ?? 70);
const email = (i) => `vostress-${String(i).padStart(2, "0")}@offshorly.com`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); return ok; };

const clients = [];
for (let i = 1; i <= N; i++) {
  const c = { i, email: email(i), rooms: null, snapshot: null, peers: new Set() };
  c.s = io(URL_BASE, { transports: ["websocket"], auth: { "x-dev-email": c.email }, reconnection: false });
  c.s.on("room_presence", (p) => { c.rooms = p.rooms; });
  c.s.on("positions_snapshot", (p) => { c.snapshot = p.entries; });
  c.s.on("peer_walk_arrived", (p) => c.peers.add(p.email));
  clients.push(c);
}
await Promise.all(clients.map((c) => new Promise((r) => c.s.on("connect", r))));
await sleep(2000);
check("all clients connected", clients.every((c) => c.s.connected), `${clients.filter((c) => c.s.connected).length}/${N}`);
check("clients are distinct identities", new Set(clients.map((c) => c.email)).size === N);

// ---- 2. room/location convergence: everybody into the CAVE ------------------------------------
for (const c of clients) { c.s.emit("room_presence_enter", { roomId: "cave-theater" }); await sleep(8); }
await sleep(2500);
const caveOf = (c) => (c.rooms ?? []).find((r) => r.roomId === "cave-theater")?.members ?? [];
const sizes = clients.map((c) => caveOf(c).length);
check("every client sees all 70 in the CAVE", sizes.every((n) => n === N), `sizes ${Math.min(...sizes)}..${Math.max(...sizes)}`);
const ref = JSON.stringify(caveOf(clients[0]).slice().sort());
check("every client's CAVE roster is identical", clients.every((c) => JSON.stringify(caveOf(c).slice().sort()) === ref));
check("CAVE roster holds 70 distinct stress identities", new Set(caveOf(clients[0])).size === N);

// ---- 3. a movement update reaches every OTHER client, attributed to the right sender ----------
const mover = clients[7];
for (const c of clients) c.peers.clear();
const mid = `val-${Date.now()}`;
const started = { movementId: mid, origin: { x: 500, y: 500 }, path: [{ x: 540, y: 500 }], roomId: "cave-theater", durationMs: 800 };
mover.s.emit("walk_started", started);
await sleep(120);
mover.s.emit("walk_arrived", { movementId: mid, at: { x: 540, y: 500 }, facing: "front", state: "standing", seatKey: null, roomId: "cave-theater" });
await sleep(2500);
const receivers = clients.filter((c) => c !== mover && c.peers.has(mover.email));
check("movement reached every other client", receivers.length === N - 1, `${receivers.length}/${N - 1}`);
check("sender did not receive its own movement echo", !mover.peers.has(mover.email));
check("movement attributed to the correct sender", clients.every((c) => c === mover || [...c.peers].every((e) => e === mover.email)));

// ---- 4. reconnect restores the client's own last stable position ------------------------------
const probe = clients[3];
const pmid = `val-r-${Date.now()}`;
probe.s.emit("walk_started", { movementId: pmid, origin: { x: 300, y: 300 }, path: [{ x: 333, y: 377 }], roomId: "cave-theater", durationMs: 800 });
await sleep(120);
probe.s.emit("walk_arrived", { movementId: pmid, at: { x: 333, y: 377 }, facing: "left", state: "standing", seatKey: null, roomId: "cave-theater" });
await sleep(1500);
probe.s.close();
await sleep(1200);
probe.snapshot = null;
probe.s = io(URL_BASE, { transports: ["websocket"], auth: { "x-dev-email": probe.email }, reconnection: false });
probe.s.on("positions_snapshot", (p) => { probe.snapshot = p.entries; });
await new Promise((r) => probe.s.on("connect", r));
await sleep(1500);
const self = (probe.snapshot ?? []).find((e) => e.email === probe.email);
check("reconnect returns a positions snapshot", Array.isArray(probe.snapshot), `${probe.snapshot?.length ?? 0} entries`);
// wire shape is { email, revision, pos:{x,y}, facing, state, seatKey, roomId, updatedAt, active }
check("reconnect restores own last stable position", !!self && self.pos?.x === 333 && self.pos?.y === 377 && self.facing === "left" && self.roomId === "cave-theater",
  self ? `pos=${self.pos?.x},${self.pos?.y} facing=${self.facing} room=${self.roomId} rev=${self.revision}` : "self entry missing");
check("reconnect suppresses the self-echo of own in-flight movement", !!self && self.active === null);
check("reconnect snapshot still carries the other 69 peers", (probe.snapshot ?? []).filter((e) => e.email.startsWith("vostress-")).length === N,
  `${(probe.snapshot ?? []).filter((e) => e.email.startsWith("vostress-")).length}/${N}`);

for (const c of clients) c.s.close();
await sleep(500);
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
