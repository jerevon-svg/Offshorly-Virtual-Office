// CAMPUS SCOOTERS — the client end of the server's scooter registry (backend app/services/scooter_registry.py).
//
// Its own socket, the way Go Together's travelPartyStore has its own: the snapshot arrives on connect (and on
// every reconnect), each change arrives as `scooter_state`, and a mount is a QUESTION — `claimScooter`
// resolves only once the server has answered. Nothing here knows about riding; the V2 world asks through
// app/useScooterAuthority and draws what this store holds.
//
// THE RULES THE WORLD RELIES ON:
//   • a claim never resolves `ok` without the server's grant: offline → refused at once, no answer within
//     CLAIM_TIMEOUT_MS → refused, and a grant that arrives AFTER that is handed straight back, so a scooter
//     can never be held by somebody whose world gave up on it;
//   • a newer state never loses to an older one (per-scooter `version`), while a full snapshot always wins
//     (a restarted server starts its versions again).
import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import type { ScooterServerState } from "../../dev/vo3d/world/scooters";
import type { RelayedScooterPose, RiderPose, ScooterPoseSample } from "../../dev/vo3d/app/riderStream";

export interface ScooterWire {
  id: string;
  state: ScooterServerState;
  rider: string | null;
  at: { x: number; z: number; yaw: number } | null;
  since: number;
  version: number;
  /** S2 — the rider's last pose (ridden only), for somebody joining mid-ride */
  pose?: RiderPose | null;
  /** S5 — the accident a FALLEN scooter belongs to */
  accident?: string | null;
}

/** S5 — a confirmed accident, with the server's own timestamps (seconds on the shared clock) */
export interface ScooterAccidentWire {
  id: string; rider: string; scooterId: string; loop: string; vehicle: number;
  at: number; x: number; z: number; heading: number; speed: number; closing: number; carHeading: number; carSpeed: number;
  endsAt: number;
  /** S6 — the contact normal (car → scooter) and where the scooter comes to rest */
  nx: number; nz: number; restX: number; restZ: number;
  /** S6 — how far the rider's world let the throws go (null until their browser has said) */
  reach?: { rider: { k: number; turn: number }; scooter: { k: number; turn: number } } | null;
  /** S7 — the recovery: how long the crash plays, when the lift began (null: not yet) and where the rider stood */
  crashEnd?: number; liftAt?: number | null; liftFrom?: { x: number; z: number } | null;
  phase?: "crashing" | "fallen" | "lifting" | "upright";
}
/** what the rider's browser reports (world/scooterCrash Contact, with its scooter) */
export interface ScooterAccidentReport { scooterId: string; loop: string; vehicle: number; x: number; z: number; heading: number; speed: number; t: number; closing: number }

export interface ScooterRegistrySnapshot {
  scooters: ScooterWire[];
  /** bumps on every FULL snapshot (connect / reconnect) — the world re-checks its own ride then */
  fullCount: number;
  connected: boolean;
}

export const CLAIM_TIMEOUT_MS = 4000;

const EMPTY: ScooterRegistrySnapshot = { scooters: [], fullCount: 0, connected: false };
let snapshot: ScooterRegistrySnapshot = EMPTY;
let socketInstance: Socket | null = null;
let devEmail: string | null = null;
const listeners = new Set<() => void>();
const pending = new Map<string, { resolve: (r: { ok: boolean; reason?: string }) => void; timer: ReturnType<typeof setTimeout>; scooterId: string }>();
/** requests we gave up on: a late grant for one of these is released at once */
const abandoned = new Set<string>();
let seq = 0;
/** S2 — relayed rider poses go to these directly, never through React state: ten a second per rider */
const poseListeners = new Set<(p: RelayedScooterPose) => void>();

// ---- S4: the campus TRAFFIC holds ride the same socket (backend app/services/traffic_holds.py) ----------
/** one car's schedule as the server has it (frontend world/trafficHolds VehicleTimeline, with its id) */
export interface TrafficVehicleWire {
  loop: string; vehicle: number; d0: number; t0: number;
  hold: { id: string; stopP: number; b: number; releaseAt: number | null; emergency: boolean; accident?: string | null } | null;
}
/** what this browser says about its OWN employee and one car (world/trafficObstacles ObstacleReport) */
export interface TrafficObstacleWire { loop: string; vehicle: number; x: number; z: number; kind: "walk" | "ride"; clear?: true }
const trafficListeners = new Set<(list: TrafficVehicleWire[]) => void>();
/** the newest state, for a world that subscribes after it arrived */
let trafficLatest: TrafficVehicleWire[] | null = null;

function set(next: Partial<ScooterRegistrySnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getScooterRegistrySnapshot(): ScooterRegistrySnapshot {
  return snapshot;
}

export function setDevIdentity(email: string | null): void {
  devEmail = email;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for campus scooters — see .env.example.");
  return raw.replace(/\/+$/, "");
}

/** fold one scooter in: a stale version never overwrites a newer one */
export function mergeScooter(list: readonly ScooterWire[], s: ScooterWire): ScooterWire[] {
  const i = list.findIndex((x) => x.id === s.id);
  if (i < 0) return [...list, s];
  if (list[i].version > s.version) return list as ScooterWire[];
  const next = list.slice();
  next[i] = s;
  return next;
}

export function applyFullSnapshot(p: { scooters?: ScooterWire[] } | undefined): void {
  set({ scooters: Array.isArray(p?.scooters) ? p!.scooters : [], fullCount: snapshot.fullCount + 1 });
}
export function applyScooterState(p: { scooter?: ScooterWire } | undefined): void {
  if (p?.scooter?.id) set({ scooters: mergeScooter(snapshot.scooters, p.scooter) });
}
export function applyRelayedPose(p: RelayedScooterPose | undefined): void {
  if (!p || typeof p.scooterId !== "string" || typeof p.rider !== "string") return;
  for (const l of poseListeners) l(p);
}
/** S2 — hear every other rider's pose (the server never echoes our own) */
export function onScooterPose(listener: (p: RelayedScooterPose) => void): () => void {
  poseListeners.add(listener);
  return () => { poseListeners.delete(listener); };
}
/** S2 — our own pose while riding: the server relays it only if we are that scooter's rider */
export function sendScooterPose(sample: ScooterPoseSample): void {
  if (snapshot.connected) socketInstance?.emit("scooter_pose", sample);
}

export function applyTrafficHolds(p: { vehicles?: TrafficVehicleWire[] } | undefined): void {
  if (!p || !Array.isArray(p.vehicles)) return;
  trafficLatest = p.vehicles;
  for (const l of trafficListeners) l(p.vehicles);
}
/** S4 — the server's traffic holds, now and on every change (handed the latest at once if there is one) */
export function onTrafficHolds(listener: (list: TrafficVehicleWire[]) => void): () => void {
  trafficListeners.add(listener);
  if (trafficLatest) listener(trafficLatest);
  return () => { trafficListeners.delete(listener); };
}
/** S4 — this employee is in a car's way (or, with `clear`, no longer) */
export function sendTrafficObstacle(r: TrafficObstacleWire): void {
  if (snapshot.connected) socketInstance?.emit("traffic_obstacle", r);
}

// ---- S5: accidents ------------------------------------------------------------------------------------
const accidentListeners = new Set<(list: ScooterAccidentWire[]) => void>();
let accidents: ScooterAccidentWire[] = [];
const accidentPending = new Map<string, { resolve: (r: { ok: boolean; reason?: string }) => void; timer: ReturnType<typeof setTimeout> }>();
function setAccidents(next: ScooterAccidentWire[]): void {
  accidents = next;
  for (const l of accidentListeners) l(accidents);
}
export function applyAccidentSnapshot(p: { accidents?: ScooterAccidentWire[] } | undefined): void {
  if (p && Array.isArray(p.accidents)) setAccidents(p.accidents);
}
export function applyAccident(p: { accident?: ScooterAccidentWire } | undefined): void {
  if (p?.accident?.id) setAccidents([...accidents.filter((a) => a.id !== p.accident!.id), p.accident]);
}
export function applyAccidentResolved(p: { id?: string } | undefined): void {
  if (p?.id) setAccidents(accidents.filter((a) => a.id !== p.id));
}
export function applyAccidentResult(r: { requestId?: string | null; ok?: boolean; reason?: string } | undefined): void {
  const p = r?.requestId ? accidentPending.get(r.requestId) : undefined;
  if (!p || !r) return;
  accidentPending.delete(r.requestId!);
  clearTimeout(p.timer);
  p.resolve(r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "refused" });
}
/** S5 — every accident in progress, now and on every change */
export function onScooterAccidents(listener: (list: ScooterAccidentWire[]) => void): () => void {
  accidentListeners.add(listener);
  listener(accidents);
  return () => { accidentListeners.delete(listener); };
}
/** S5 — I HIT A CAR. Resolves with the server's verdict (never `ok` without it); offline or no answer: refused */
export function reportScooterAccident(r: ScooterAccidentReport): Promise<{ ok: boolean; reason?: string }> {
  const socket = socketInstance;
  if (!socket || !snapshot.connected) return Promise.resolve({ ok: false, reason: "offline" });
  const requestId = `ac-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { accidentPending.delete(requestId); resolve({ ok: false, reason: "timeout" }); }, CLAIM_TIMEOUT_MS);
    accidentPending.set(requestId, { resolve, timer });
    socket.emit("scooter_accident", { ...r, requestId });
  });
}

/** S7 — E BESIDE MY FALLEN SCOOTER: the server's verdict (a granted lift also arrives as the accident, with its time) */
const liftPending = new Map<string, { resolve: (r: { ok: boolean; reason?: string }) => void; timer: ReturnType<typeof setTimeout> }>();
export function liftScooterAccident(id: string, at: { x: number; z: number }): Promise<{ ok: boolean; reason?: string }> {
  const socket = socketInstance;
  if (!socket || !snapshot.connected) return Promise.resolve({ ok: false, reason: "offline" });
  const requestId = `lf-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { liftPending.delete(requestId); resolve({ ok: false, reason: "timeout" }); }, CLAIM_TIMEOUT_MS);
    liftPending.set(requestId, { resolve, timer });
    socket.emit("scooter_accident_lift", { id, x: at.x, z: at.z, requestId });
  });
}
export function applyLiftResult(r: { requestId?: string | null; ok?: boolean; reason?: string } | undefined): void {
  const p = r?.requestId ? liftPending.get(r.requestId) : undefined;
  if (!p) return;
  liftPending.delete(r!.requestId!);
  clearTimeout(p.timer);
  p.resolve({ ok: r!.ok === true, ...(r!.reason ? { reason: r!.reason } : {}) });
}

/** S6 — how far my own accident's throws may go in my world (once; the server checks it only shortens them) */
export function sendScooterAccidentReach(id: string, reach: NonNullable<ScooterAccidentWire["reach"]>): void {
  socketInstance?.emit("scooter_accident_reach", { id, reach });
}

export function applyClaimResult(r: { requestId?: string | null; scooterId?: string; ok?: boolean; reason?: string; scooter?: ScooterWire } | undefined): void {
  if (!r) return;
  if (r.scooter) applyScooterState({ scooter: r.scooter });
  const id = r.requestId ?? "";
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "refused" });
    return;
  }
  // a grant for a request we already gave up on: hand it straight back
  if (r.ok && abandoned.delete(id) && r.scooterId) socketInstance?.emit("scooter_release", { scooterId: r.scooterId });
}

function ensureSocket(): void {
  if (socketInstance) return;
  if (!devEmail && !getAuthToken()) return;
  const socket = io(socketBase(), { auth: devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() }, autoConnect: true });
  socket.on("connect", () => set({ connected: true }));
  socket.on("disconnect", () => set({ connected: false }));
  socket.on("scooters", applyFullSnapshot);
  socket.on("scooter_state", applyScooterState);
  socket.on("scooter_claim_result", applyClaimResult);
  socket.on("scooter_pose", applyRelayedPose);
  socket.on("traffic_holds", applyTrafficHolds);
  socket.on("scooter_accidents", applyAccidentSnapshot);
  socket.on("scooter_accident", applyAccident);
  socket.on("scooter_accident_resolved", applyAccidentResolved);
  socket.on("scooter_accident_result", applyAccidentResult);
  socket.on("scooter_accident_lift_result", applyLiftResult);
  socketInstance = socket;
}

/** MAY I RIDE IT? Resolves with the server's answer — never `ok` without it. */
export function claimScooter(scooterId: string, at?: { x: number; z: number } | null): Promise<{ ok: boolean; reason?: string }> {
  const socket = socketInstance;
  if (!socket || !snapshot.connected) return Promise.resolve({ ok: false, reason: "offline" });
  const requestId = `sc-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      abandoned.add(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, CLAIM_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer, scooterId });
    // S7 — riding a scooter I lifted: where I stand beside it goes with the ask (the server checks I am there)
    socket.emit("scooter_claim", { scooterId, requestId, ...(at ? { x: at.x, z: at.z } : {}) });
  });
}

/** the rider got off: home to the rack (the server broadcasts it) */
export function releaseScooter(scooterId: string): void {
  socketInstance?.emit("scooter_release", { scooterId });
}

export function useScooterRegistry(): ScooterRegistrySnapshot {
  useEffect(() => { ensureSocket(); }, []);
  return useSyncExternalStore(subscribe, getScooterRegistrySnapshot, getScooterRegistrySnapshot);
}

export function resetScooterStoreForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  devEmail = null;
  snapshot = EMPTY;
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  abandoned.clear();
  poseListeners.clear();
  trafficListeners.clear();
  trafficLatest = null;
  accidentListeners.clear();
  accidents = [];
  for (const p of accidentPending.values()) clearTimeout(p.timer);
  accidentPending.clear();
}

/** TESTS ONLY: a fake socket in place of the real one */
export function __setScooterSocketForTests(socket: Pick<Socket, "emit"> | null, connected = true): void {
  socketInstance = socket as Socket | null;
  set({ connected });
}
