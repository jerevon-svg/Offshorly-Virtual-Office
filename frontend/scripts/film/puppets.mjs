// FILM RIG ONLY — Alex, Angelo, Micah and Jan as REAL realtime clients with no browser.
//
// Each puppet is one Socket.IO connection to the film backend (:8003) authenticated through the
// existing development identity path (auth { "x-dev-email" }, the same seam `?as=` and
// scripts/netstress use; the server refuses it outside APP_ENV=development). Everything a puppet does
// is an ordinary client event with a payload the server's own validators accept — walk_started /
// walk_arrived, jump, dnd_set, room_presence_*, typing, send_message — so Bon's browser receives
// exactly what it would receive from a real coworker. Nothing here renders, and nothing is invented.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const req = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const { io } = req("socket.io-client");

export const CAST = {
  bon: { email: "jerevon@offshorly.com", name: "Bon" },
  alex: { email: "alex@offshorly.com", name: "Alex" },
  angelo: { email: "angelo@offshorly.com", name: "Angelo" },
  micah: { email: "micah@offshorly.com", name: "Micah" },
  jan: { email: "jan@offshorly.com", name: "Jan" },
};

let seq = 0;
const round = (v) => Math.round(v * 100) / 100;
const pt = (p) => ({ x: round(p.x), y: round(p.y) });

export class Puppets {
  constructor(api) { this.api = api; this.s = new Map(); this.at = new Map(); }

  async connect(keys) {
    await Promise.all(keys.map((k) => new Promise((ok, bad) => {
      const s = io(this.api, { transports: ["websocket"], auth: { "x-dev-email": CAST[k].email }, reconnection: true, timeout: 15000 });
      s.once("connect", () => { this.s.set(k, s); ok(); });
      s.once("connect_error", (e) => bad(new Error(`${k}: ${e.message}`)));
    })));
  }

  status() { return Object.fromEntries([...this.s].map(([k, s]) => [k, { connected: s.connected, at: this.at.get(k) ?? null }])); }
  emit(k, ev, payload) { const s = this.s.get(k); if (!s) throw new Error(`no puppet ${k}`); s.emit(ev, payload); }

  /** A walk along a V1-frame path (computed by the product's own V1 pathfinder in Bon's page). */
  walk(k, path, { roomId = null, speed = 95, facing = "front", state = "standing", seatKey = null, yaw } = {}) {
    const from = this.at.get(k) ?? path[0];
    let len = 0, prev = from;
    for (const p of path) { len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
    const durationMs = Math.max(400, Math.round((len / speed) * 1000));
    const movementId = `film-${k}-${++seq}-${Date.now()}`;
    this.emit(k, "walk_started", { movementId, origin: pt(from), path: path.map(pt), roomId, durationMs, pacing: "linear" });
    const at = path[path.length - 1];
    return new Promise((done) => setTimeout(() => {
      this.emit(k, "walk_arrived", { movementId, at: pt(at), facing, state, seatKey, roomId, ...(yaw === undefined ? {} : { yaw: round(yaw) }) });
      this.at.set(k, at);
      done(durationMs);
    }, durationMs));
  }

  /** Stand somewhere immediately (staging only — never recorded): a zero-length walk that lands there. */
  place(k, at, opts = {}) { this.at.set(k, at); return this.walk(k, [at], { ...opts, speed: 1e6 }); }

  jump(k) { this.emit(k, "jump", {}); }
  dnd(k, isDnd) { this.emit(k, "dnd_set", { isDnd }); }
  enterRoom(k, roomId) { this.emit(k, "room_presence_enter", { roomId }); }
  leaveRoom(k) { this.emit(k, "room_presence_leave", {}); }
  typing(k, conversationId, isTyping) { this.emit(k, "typing", { conversationId, isTyping }); }
  send(k, conversationId, text) { this.emit(k, "send_message", { conversationId, text, clientTempId: `film-${k}-${++seq}` }); }
  close() { for (const s of this.s.values()) s.close(); }
}
