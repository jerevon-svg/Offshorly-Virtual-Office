// vo3d editor — ROOM EDITOR V2 PERSISTENCE. Saved edits that survive a browser refresh.
//
// The editor's whole safety model is that the WORLD is authoritative and preview is not. Persistence
// inherits that rule rather than inventing a second one: what is written is a DIFF against the authored
// layout as the room modules built it, taken from committed world state and committed registry specs.
// A drag under the finger, an unconfirmed placement and a slider mid-gesture are all invisible to it.
//
// THE DOCUMENT IS A DIFF, NOT A SCENE. Three reasons, and they are the same reason three times:
//   · the rooms stay the source of truth — an edit to rooms/qa.ts is picked up on the next load rather
//     than shadowed forever by a year-old snapshot of the whole office;
//   · it is small — a dozen moved pieces instead of eleven rooms of geometry;
//   · it can be CHECKED. Every moved entity records the authored transform it was edited FROM, and every
//     surface / LED records the treatment the room BUILT it with. When either no longer matches, that one
//     entry is stale and is dropped — the rest of the layout still loads.
//
// Compatibility is therefore layered, coarse to fine:
//   1. schemaVersion — a document this build does not understand is discarded whole;
//   2. content hash — the set of rooms and authored entity ids the layout was edited against. A room added,
//      removed or renamed invalidates the document whole, because entity ids are only meaningful inside it;
//   3. per-entry base match — described above, drops one entry.
// Nothing here ever throws into the boot path: a corrupt, truncated or hand-edited document loads as null.
//
// SCOPE: V2 Room Editor only, localStorage only. No backend, no API, no V1 surface. The store is handed
// the same collaborators EditSession already has, and it uses the same commit + walkability-resync path,
// so a restored layout is indistinguishable from one a designer dragged into place.
import type { Walkability } from "../nav/Walkability";
import type { SceneMirror } from "../render/SceneMirror";
import {
  type Capabilities, type Entity, type EntityId, type Footprint, type Transform2, type WorldState,
} from "../world/WorldState";
import { bindAnchors, retargetAnchors } from "./anchors";
import { deleteBlocked } from "./editable";
import { clampSpec, sameSpec, type SurfaceRegistry, type SurfaceSpec } from "./surfaces";
import { clampEmissive, sameEmissive, type EmissiveSpec, type LedRegistry } from "./emissive";

/** Bumped whenever the shape below changes incompatibly. An older or newer document is discarded, never
 *  half-read: a layout is not worth a silently wrong office. */
export const LAYOUT_SCHEMA_VERSION = 1;
/** One key, namespaced to the V2 editor so nothing else in the harness can collide with it. */
export const LAYOUT_STORAGE_KEY = "vo3d.editor.v2.layout";

/** a moved authored entity: where the room put it, and where the designer confirmed it */
export type SavedTransform = { id: EntityId; from: Transform2; to: Transform2 };
/** a surface treatment: the material the ROOM built (the staleness check) and the applied spec */
export type SavedSurface = { id: string; base: SurfaceSpec; spec: SurfaceSpec };
export type SavedLed = { id: string; base: EmissiveSpec; spec: EmissiveSpec };

export type LayoutDoc = {
  schemaVersion: number;
  savedAt: number;
  /** what the layout was edited against — see the compatibility ladder above */
  content: { hash: string; rooms: number; entities: number };
  moved: SavedTransform[];
  /** whole entities, because a placed or duplicated piece exists nowhere else */
  added: Entity[];
  deleted: EntityId[];
  surfaces: SavedSurface[];
  leds: SavedLed[];
};

export type LayoutCounts = { moved: number; added: number; deleted: number; surfaces: number; leds: number };
/** what a restore actually did, and what it refused. The panel shows it; the tests assert on it. */
export type RestoreReport = LayoutCounts & { skipped: number };
const noCounts = (): RestoreReport => ({ moved: 0, added: 0, deleted: 0, surfaces: 0, leds: 0, skipped: 0 });
export const layoutIsEmpty = (c: LayoutCounts): boolean =>
  c.moved + c.added + c.deleted + c.surfaces + c.leds === 0;

/** the slice of Storage this needs — so a test can hand it a Map and a headless build can hand it null */
export type LayoutStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** localStorage when the browser has it AND lets us touch it (private mode, blocked site data, SSR). */
export function browserLayoutStorage(): LayoutStorage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    s.getItem(LAYOUT_STORAGE_KEY);
    return s;
  } catch { return null; }
}
/** an in-memory stand-in with the same contract */
export function memoryLayoutStorage(): LayoutStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
};

const sameTransform = (a: Transform2, b: Transform2): boolean =>
  a.pos.x === b.pos.x && a.pos.z === b.pos.z && a.yaw === b.yaw;
const copyTransform = (t: Transform2): Transform2 => ({ pos: { x: t.pos.x, z: t.pos.z }, yaw: t.yaw });

/** A detached copy, safe to keep while the world moves on (the same shape EditSession's history keeps). */
function snapshot(e: Entity): Entity {
  return {
    ...e,
    transform: copyTransform(e.transform),
    footprint: e.footprint ? { ...e.footprint } : undefined,
    placement: e.placement ? { ...e.placement } : undefined,
    capabilities: { ...e.capabilities },
    props: { ...e.props },
  };
}

export type LayoutDeps = {
  world: WorldState;
  mirror: SceneMirror;
  walkability: Walkability;
  surfaces?: SurfaceRegistry | null;
  leds?: LedRegistry | null;
  /** omit for the real browser store; pass null to disable persistence entirely */
  storage?: LayoutStorage | null;
};

/**
 *  THE AUTHORED BASELINE IS TAKEN ONCE, AT CONSTRUCTION, BEFORE ANY RESTORE. Everything this class can do
 *  — diff, save, reset — is expressed against it, which is what makes "Reset to Authored Layout" a real
 *  restore rather than an undo stack deep enough to hope.
 */
export class LayoutStore {
  private readonly world: WorldState;
  private readonly mirror: SceneMirror;
  private readonly walkability: Walkability;
  private readonly surfaces: SurfaceRegistry | null;
  private readonly leds: LedRegistry | null;
  readonly storage: LayoutStorage | null;
  /** the office as the room modules built it */
  private readonly authored = new Map<EntityId, Entity>();
  readonly contentHash: string;
  private readonly roomCount: number;

  constructor(deps: LayoutDeps) {
    this.world = deps.world;
    this.mirror = deps.mirror;
    this.walkability = deps.walkability;
    this.surfaces = deps.surfaces ?? null;
    this.leds = deps.leds ?? null;
    this.storage = deps.storage === undefined ? browserLayoutStorage() : deps.storage;
    for (const e of deps.world.entities.values()) this.authored.set(e.id, snapshot(e));
    this.roomCount = deps.world.rooms.size;
    // Ids and kinds, not transforms: a desk nudged in a room file must invalidate THAT desk's saved move
    // (the per-entry `from` check does exactly that) without throwing away an unrelated room's lighting.
    const rooms = [...deps.world.rooms.keys()].sort().join(",");
    const ents = [...this.authored.values()].map((e) => `${e.id}:${e.kind}`).sort().join(",");
    this.contentHash = fnv1a(`${LAYOUT_SCHEMA_VERSION}|${rooms}|${ents}`);
  }

  /** was this entity built by a room, or added in the editor? */
  isAuthored(id: EntityId): boolean { return this.authored.has(id); }
  authoredEntity(id: EntityId): Entity | null { const e = this.authored.get(id); return e ? snapshot(e) : null; }

  // ---- capture -------------------------------------------------------------------------------------
  /** How much a save would write, without writing it — cheap enough for the panel's per-frame refresh. */
  counts(exclude: EntityId | null = null): LayoutCounts {
    const c: LayoutCounts = { moved: 0, added: 0, deleted: 0, surfaces: 0, leds: 0 };
    for (const e of this.world.entities.values()) {
      if (e.id === exclude) continue; // an unconfirmed placement is not part of the layout yet
      const a = this.authored.get(e.id);
      if (!a) { c.added++; continue; }
      if (!sameTransform(a.transform, e.transform)) c.moved++;
    }
    for (const id of this.authored.keys()) if (!this.world.entities.has(id)) c.deleted++;
    for (const s of this.surfaces?.all() ?? []) if (!sameSpec(s.committed, s.base)) c.surfaces++;
    for (const l of this.leds?.all() ?? []) if (!sameEmissive(l.committed, l.base)) c.leds++;
    return c;
  }

  /** The document a save would write. COMMITTED state only: world transforms are committed by definition
   *  (a preview moves the view, never the entity), and the registries are read at `committed`, never at
   *  `preview`, so a half-dragged slider and an unapplied preset are both simply not there. */
  capture(exclude: EntityId | null = null): LayoutDoc {
    const moved: SavedTransform[] = [];
    const added: Entity[] = [];
    const deleted: EntityId[] = [];
    for (const e of this.world.entities.values()) {
      if (e.id === exclude) continue;
      const a = this.authored.get(e.id);
      if (!a) { added.push(snapshot(e)); continue; }
      if (!sameTransform(a.transform, e.transform))
        moved.push({ id: e.id, from: copyTransform(a.transform), to: copyTransform(e.transform) });
    }
    for (const id of this.authored.keys()) if (!this.world.entities.has(id)) deleted.push(id);
    const surfaces: SavedSurface[] = [];
    for (const s of this.surfaces?.all() ?? [])
      if (!sameSpec(s.committed, s.base)) surfaces.push({ id: s.id, base: { ...s.base }, spec: { ...s.committed } });
    const leds: SavedLed[] = [];
    for (const l of this.leds?.all() ?? [])
      if (!sameEmissive(l.committed, l.base)) leds.push({ id: l.id, base: { ...l.base }, spec: { ...l.committed } });
    return {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      savedAt: Date.now(),
      content: { hash: this.contentHash, rooms: this.roomCount, entities: this.authored.size },
      moved, added, deleted, surfaces, leds,
    };
  }

  /** EXPLICIT SAVE. Returns the document written, or null when there is nowhere to write it. */
  save(exclude: EntityId | null = null): LayoutDoc | null {
    const doc = this.capture(exclude);
    if (!this.storage) return null;
    try { this.storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc)); } catch { return null; }
    return doc;
  }
  /** forget the saved layout; the world is untouched */
  clear(): void { try { this.storage?.removeItem(LAYOUT_STORAGE_KEY); } catch { /* storage is a convenience */ } }
  get hasSaved(): boolean {
    try { return Boolean(this.storage?.getItem(LAYOUT_STORAGE_KEY)); } catch { return false; }
  }

  // ---- load ----------------------------------------------------------------------------------------
  /** The saved layout if it is understandable AND belongs to this office, else null. Never throws. */
  load(): LayoutDoc | null {
    let raw: string | null = null;
    try { raw = this.storage?.getItem(LAYOUT_STORAGE_KEY) ?? null; } catch { return null; }
    return raw === null ? null : parseLayout(raw, this.contentHash);
  }

  // ---- restore -------------------------------------------------------------------------------------
  /** ENTITIES first, so a restored LED strip is in the room group before the registries collect it. */
  restoreEntities(doc: LayoutDoc): RestoreReport {
    const r = noCounts();
    for (const m of doc.moved) {
      const authored = this.authored.get(m.id);
      const live = this.world.entities.get(m.id);
      // the piece still exists, the room still puts it where the save said, and the mesh still carries a
      // transform to move. Any of the three failing means this one entry is stale.
      if (!authored || !live || !sameTransform(authored.transform, m.from) || !this.mirror.isTransformBound(m.id)) { r.skipped++; continue; }
      const binding = bindAnchors(authored);
      const to = copyTransform(m.to);
      this.world.commit((tx) => {
        tx.setTransform(m.id, to);
        // ONE transaction, exactly as a confirm does it — the gameplay anchors of a restored chair can
        // never be observed disagreeing with where the chair actually is.
        tx.setCapabilities(m.id, retargetAnchors(binding, to));
      });
      r.moved++;
    }
    for (const id of doc.deleted) {
      const authored = this.authored.get(id);
      const live = this.world.entities.get(id);
      // Deletion is narrower than editing (editor/editable.ts) and a stale document does not get to widen
      // it: a piece the interaction wiring holds by id is never removed on the strength of saved JSON.
      if (!authored || !live || deleteBlocked(live) !== null) { r.skipped++; continue; }
      this.world.commit((tx) => tx.remove(id));
      r.deleted++;
    }
    for (const e of doc.added) {
      if (this.world.entities.has(e.id) || !this.world.rooms.has(e.roomId)) { r.skipped++; continue; }
      this.world.commit((tx) => tx.add(snapshot(e)));
      if (!this.mirror.hasView(e.id)) { this.world.commit((tx) => tx.remove(e.id)); r.skipped++; continue; }
      r.added++;
    }
    this.walkability.syncFromWorld(this.world);
    return r;
  }

  /** TREATMENTS second — the registries must have collected before a spec can be replayed onto them. */
  restoreTreatments(doc: LayoutDoc): RestoreReport {
    const r = noCounts();
    for (const s of doc.surfaces) {
      const entry = this.surfaces?.get(s.id) ?? null;
      if (!entry || !sameSpec(entry.base, s.base)) { r.skipped++; continue; } // room rebuilt this surface
      this.surfaces!.replay(s.id, s.spec);
      r.surfaces++;
    }
    for (const l of doc.leds) {
      const entry = this.leds?.get(l.id) ?? null;
      if (!entry || !sameEmissive(entry.base, l.base)) { r.skipped++; continue; }
      this.leds!.replay(l.id, l.spec);
      r.leds++;
    }
    return r;
  }

  /** both halves, for callers whose registries are already collected */
  restore(doc: LayoutDoc): RestoreReport {
    const a = this.restoreEntities(doc), b = this.restoreTreatments(doc);
    return {
      moved: a.moved + b.moved, added: a.added + b.added, deleted: a.deleted + b.deleted,
      surfaces: a.surfaces + b.surfaces, leds: a.leds + b.leds, skipped: a.skipped + b.skipped,
    };
  }

  /** RESET TO AUTHORED LAYOUT — the production office back, and the saved edits gone with it. Expressed
   *  against the baseline rather than by replaying history backwards, so it is correct no matter how the
   *  room got into its current state (including a layout restored before this session began). */
  resetToAuthored(): RestoreReport {
    const r = noCounts();
    for (const e of [...this.world.entities.values()]) {
      if (this.authored.has(e.id)) continue;
      if (!e.capabilities.editable) continue; // never ours to remove
      this.world.commit((tx) => tx.remove(e.id));
      r.added++;
    }
    for (const a of this.authored.values()) {
      const live = this.world.entities.get(a.id);
      if (!live) { this.world.commit((tx) => tx.add(snapshot(a))); r.deleted++; continue; }
      // Transform equality is a sound proxy for "untouched": capabilities are only ever rewritten inside
      // a transform commit (EditSession, and restoreEntities above), never on their own.
      if (sameTransform(live.transform, a.transform)) continue;
      this.world.commit((tx) => {
        tx.setTransform(a.id, copyTransform(a.transform));
        tx.setCapabilities(a.id, { ...a.capabilities });
      });
      r.moved++;
    }
    this.walkability.syncFromWorld(this.world);
    for (const s of this.surfaces?.all() ?? []) if (!sameSpec(s.committed, s.base)) { this.surfaces!.reset(s.id); r.surfaces++; }
    for (const l of this.leds?.all() ?? []) if (!sameEmissive(l.committed, l.base)) { this.leds!.reset(l.id); r.leds++; }
    this.clear();
    return r;
  }
}

// ---- validation --------------------------------------------------------------------------------------
// Everything below treats the stored string as HOSTILE — not because an attacker is expected in
// localStorage, but because a half-written document, a schema from a future branch and a hand-edited file
// all arrive through this one door, and the office has to come up either way.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readTransform(v: unknown): Transform2 | null {
  if (!isObj(v) || !isObj(v.pos) || !num(v.yaw)) return null;
  if (!num(v.pos.x) || !num(v.pos.z)) return null;
  return { pos: { x: v.pos.x, z: v.pos.z }, yaw: v.yaw };
}
function readSurfaceSpec(v: unknown): SurfaceSpec | null {
  if (!isObj(v) || typeof v.preset !== "string" || !num(v.color) || !num(v.brightness) || !num(v.roughness) || !num(v.detail)) return null;
  // clamped on the way in, so a saved spec can never carry a value the panel could not have produced
  return clampSpec({ preset: v.preset as SurfaceSpec["preset"], color: v.color, brightness: v.brightness, roughness: v.roughness, detail: v.detail });
}
function readEmissiveSpec(v: unknown): EmissiveSpec | null {
  if (!isObj(v) || !num(v.color) || !num(v.intensity) || !num(v.glow)) return null;
  return clampEmissive({ color: v.color, intensity: v.intensity, glow: v.glow });
}
function readFootprint(v: unknown): Footprint | undefined | null {
  if (v === undefined) return undefined;
  if (!isObj(v)) return null;
  const solid = v.solid === false ? { solid: false } : {};
  if (v.shape === "rect" && num(v.w) && num(v.d)) return { shape: "rect", w: v.w, d: v.d, ...solid };
  if (v.shape === "circle" && num(v.r)) return { shape: "circle", r: v.r, ...solid };
  if (v.shape === "sector" && num(v.rIn) && num(v.rOut) && num(v.from) && num(v.to))
    return { shape: "sector", rIn: v.rIn, rOut: v.rOut, from: v.from, to: v.to, ...solid };
  return null;
}
function readProps(v: unknown): Record<string, number | string | boolean> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number | string | boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" || typeof val === "boolean") out[k] = val;
    else if (num(val)) out[k] = val;
    else return null;
  }
  return out;
}

/** An added entity is REBUILT from known fields rather than trusted as parsed.
 *
 *  Its capabilities are narrowed to `editable` (+ `sway`) on purpose, which is the same rule `duplicate`
 *  already enforces: a piece the editor created is a PROP. Saved JSON must not be able to introduce a
 *  second seat, a stand-here cell nothing owns, or a door — the office's gameplay wiring names its
 *  objects by id and a restored layout is not allowed to invent one. */
function readAddedEntity(v: unknown): Entity | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== "string" || !v.id || typeof v.kind !== "string" || !v.kind || typeof v.roomId !== "string" || !v.roomId) return null;
  const transform = readTransform(v.transform);
  if (!transform) return null;
  const footprint = readFootprint(v.footprint);
  if (footprint === null) return null;
  const props = readProps(v.props ?? {});
  if (!props) return null;
  const caps = isObj(v.capabilities) ? v.capabilities : {};
  const capabilities: Capabilities = { editable: true, ...(caps.sway === true ? { sway: true as const } : {}) };
  const placement = isObj(v.placement) && typeof v.placement.movable === "boolean" && num(v.placement.clearance)
    ? { movable: v.placement.movable, clearance: v.placement.clearance }
    : { movable: true, clearance: 1 };
  return { id: v.id, kind: v.kind, roomId: v.roomId, transform, footprint, placement, capabilities, props };
}

/** Parse + validate a stored layout. Returns null for anything this build cannot safely apply: bad JSON,
 *  a different schemaVersion, or a content hash from a different office. Individual malformed ENTRIES are
 *  dropped instead, so one bad row never costs a whole layout. */
export function parseLayout(raw: string, expectedHash: string): LayoutDoc | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v)) return null;
  if (v.schemaVersion !== LAYOUT_SCHEMA_VERSION) return null;
  if (!isObj(v.content) || v.content.hash !== expectedHash) return null;
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

  const moved: SavedTransform[] = [];
  for (const m of arr(v.moved)) {
    if (!isObj(m) || typeof m.id !== "string") continue;
    const from = readTransform(m.from), to = readTransform(m.to);
    if (from && to) moved.push({ id: m.id, from, to });
  }
  const added: Entity[] = [];
  for (const e of arr(v.added)) { const ent = readAddedEntity(e); if (ent) added.push(ent); }
  const deleted = arr(v.deleted).filter((d): d is string => typeof d === "string" && d.length > 0);
  const surfaces: SavedSurface[] = [];
  for (const s of arr(v.surfaces)) {
    if (!isObj(s) || typeof s.id !== "string") continue;
    const base = readSurfaceSpec(s.base), spec = readSurfaceSpec(s.spec);
    if (base && spec) surfaces.push({ id: s.id, base, spec });
  }
  const leds: SavedLed[] = [];
  for (const l of arr(v.leds)) {
    if (!isObj(l) || typeof l.id !== "string") continue;
    const base = readEmissiveSpec(l.base), spec = readEmissiveSpec(l.spec);
    if (base && spec) leds.push({ id: l.id, base, spec });
  }
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    savedAt: num(v.savedAt) ? v.savedAt : 0,
    content: {
      hash: expectedHash,
      rooms: num(v.content.rooms) ? v.content.rooms : 0,
      entities: num(v.content.entities) ? v.content.entities : 0,
    },
    moved, added, deleted, surfaces, leds,
  };
}
