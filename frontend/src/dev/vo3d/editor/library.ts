// vo3d editor — THE ASSET LIBRARY.
//
// Every item below is an EXISTING production builder (build/furniture, build/{exec,cms,ai,dev,qa}-furniture,
// build/plants, build/led) addressed by the entity kind the registry already routes. Nothing here models
// geometry: a library item is a kind, a category, a label and the default props that kind's builder reads.
// That is the whole point — the library adds a way to PLACE the office's furniture, not a second copy of it.
//
// The logical footprint comes from rooms/footprint.ts, the same rule every room's own factory uses, so a
// placed desk blocks navigation exactly as an authored one does and a placed rug is walked over exactly as
// an authored one is.
import { kindFootprint } from "../rooms/footprint";
import type { Entity, EntityId, Footprint } from "../world/WorldState";
import type { Vec2 } from "../core/coords";

export const ASSET_CATEGORIES = ["Desks", "Chairs", "Sofas / Seating", "Storage", "Plants", "Tables", "Decor", "Lighting"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export type AssetItem = {
  /** entity kind — routed by build/registry.ts, never by this file */
  kind: string;
  category: AssetCategory;
  label: string;
  /** plan size the builder is authored around */
  w: number;
  d: number;
  /** builder props beyond w/d/facing */
  props?: Record<string, number | string | boolean>;
};

/** THE CATALOGUE. Sizes are the ones the rooms themselves author these pieces at, so a placed piece is the
 *  same object as a built one rather than a stretched approximation. */
export const ASSET_LIBRARY: AssetItem[] = [
  // ---- Desks --------------------------------------------------------------------------------------
  { kind: "member-desk", category: "Desks", label: "Member desk", w: 58, d: 34 },
  { kind: "lead-desk", category: "Desks", label: "Lead desk", w: 72, d: 38 },
  { kind: "side-desk", category: "Desks", label: "Side desk", w: 44, d: 30 },
  { kind: "cms-member-desk", category: "Desks", label: "CMS desk", w: 58, d: 34 },
  { kind: "cms-lead-desk", category: "Desks", label: "CMS lead desk", w: 72, d: 38 },
  { kind: "ai-bench-desk", category: "Desks", label: "AI bench desk", w: 96, d: 38 },
  { kind: "ai-lead-desk", category: "Desks", label: "AI lead desk", w: 72, d: 38 },
  { kind: "dev-bay-desk", category: "Desks", label: "Dev bay desk", w: 96, d: 38 },
  { kind: "dev-lead-desk", category: "Desks", label: "Dev lead desk", w: 72, d: 38 },
  { kind: "qa-bench-desk", category: "Desks", label: "QA bench desk", w: 96, d: 38 },
  { kind: "qa-lead-desk", category: "Desks", label: "QA lead desk", w: 72, d: 38 },
  { kind: "desk-panel", category: "Desks", label: "Privacy panel", w: 58, d: 3 },

  // ---- Chairs -------------------------------------------------------------------------------------
  { kind: "chair-a", category: "Chairs", label: "Task chair A", w: 22, d: 22 },
  { kind: "chair-b", category: "Chairs", label: "Task chair B", w: 22, d: 22 },
  { kind: "lead-chair", category: "Chairs", label: "Lead chair", w: 24, d: 24 },
  { kind: "gaming-chair", category: "Chairs", label: "Gaming chair", w: 24, d: 24 },
  { kind: "cafe-chair", category: "Chairs", label: "Café chair", w: 18, d: 18 },
  { kind: "cms-task-chair", category: "Chairs", label: "CMS task chair", w: 22, d: 22 },
  { kind: "ai-task-chair", category: "Chairs", label: "AI task chair", w: 22, d: 22 },
  { kind: "dev-task-chair", category: "Chairs", label: "Dev task chair", w: 22, d: 22 },
  { kind: "qa-task-chair", category: "Chairs", label: "QA task chair", w: 22, d: 22 },
  { kind: "exec-task-chair", category: "Chairs", label: "Executive task chair", w: 24, d: 24 },
  { kind: "exec-visitor-chair", category: "Chairs", label: "Visitor chair", w: 22, d: 22 },

  // ---- Sofas / Seating ----------------------------------------------------------------------------
  { kind: "sofa", category: "Sofas / Seating", label: "Sofa", w: 78, d: 34, props: { tone: "lounge", seats: 3 } },
  { kind: "cms-sofa", category: "Sofas / Seating", label: "CMS sofa", w: 78, d: 34, props: { seats: 3 } },
  { kind: "dev-sofa", category: "Sofas / Seating", label: "Dev sofa", w: 78, d: 34, props: { seats: 3 } },
  { kind: "qa-sofa", category: "Sofas / Seating", label: "QA sofa", w: 78, d: 34, props: { seats: 3 } },
  { kind: "exec-sofa", category: "Sofas / Seating", label: "Executive sofa", w: 78, d: 34, props: { seats: 3 } },
  { kind: "tub-chair", category: "Sofas / Seating", label: "Tub chair", w: 26, d: 26, props: { tone: "lounge" } },
  { kind: "armchair", category: "Sofas / Seating", label: "Armchair", w: 28, d: 28, props: { seats: 1 } },
  { kind: "exec-lounge-chair", category: "Sofas / Seating", label: "Lounge chair", w: 28, d: 28 },
  { kind: "beanbag", category: "Sofas / Seating", label: "Bean bag", w: 26, d: 26 },
  { kind: "cms-pouf", category: "Sofas / Seating", label: "Pouf", w: 20, d: 20 },
  { kind: "qa-pouf", category: "Sofas / Seating", label: "QA pouf", w: 20, d: 20 },

  // ---- Tables -------------------------------------------------------------------------------------
  { kind: "round-table", category: "Tables", label: "Round table", w: 30, d: 30 },
  { kind: "cafe-table", category: "Tables", label: "Café table", w: 24, d: 24 },
  { kind: "lounge-table", category: "Tables", label: "Lounge table", w: 40, d: 24, props: { tone: "lounge" } },
  { kind: "conference-table", category: "Tables", label: "Conference table", w: 120, d: 52 },
  { kind: "exec-coffee-table", category: "Tables", label: "Executive coffee table", w: 44, d: 26 },
  { kind: "cms-round-table", category: "Tables", label: "CMS round table", w: 28, d: 28 },
  { kind: "qa-round-table", category: "Tables", label: "QA round table", w: 28, d: 28 },

  // ---- Storage ------------------------------------------------------------------------------------
  // The office's storage volumes are room-static joinery rather than entities; the two that ARE entities
  // are listed, and the rest stay architecture on purpose (moving a built-in credenza is a room change).
  { kind: "dev-side-desk", category: "Storage", label: "Side credenza", w: 44, d: 30 },
  { kind: "exec-planter", category: "Storage", label: "Planter box", w: 22, d: 22 },

  // ---- Plants -------------------------------------------------------------------------------------
  // `y` IS NOT OPTIONAL. build/registry reads the plant spec as `y: Number(e.props.y)`, so leaving it out
  // hands the builder NaN, and a NaN in one group's position makes the whole subtree's world matrix NaN —
  // which is invisible on screen but leaves the piece with no measurable bounds at all.
  { kind: "plant", category: "Plants", label: "Floor plant", w: 18, d: 18, props: { r: 9, h: 30, y: 0, lush: 1 } },
  { kind: "plant", category: "Plants", label: "Tall plant", w: 22, d: 22, props: { r: 11, h: 44, y: 0, lush: 1.15 } },
  { kind: "plant", category: "Plants", label: "Low plant", w: 14, d: 14, props: { r: 7, h: 18, y: 0, lush: 0.9 } },

  // ---- Decor --------------------------------------------------------------------------------------
  { kind: "rug", category: "Decor", label: "Rug", w: 90, d: 60 },
  { kind: "exec-rug", category: "Decor", label: "Executive rug", w: 90, d: 60 },
  { kind: "cms-rug", category: "Decor", label: "CMS rug", w: 90, d: 60 },
  { kind: "dev-rug", category: "Decor", label: "Dev rug", w: 90, d: 60 },
  { kind: "qa-rug", category: "Decor", label: "QA rug", w: 90, d: 60 },

  // ---- Lighting -----------------------------------------------------------------------------------
  // The office's ONE light channel (build/led.ts): an emissive bar in a channel plus a single additive
  // spill. Placed as an entity it is immediately addressable in the Lighting tab, and it adds NO
  // real-time light — which is exactly why a room can carry a dozen of them.
  { kind: "led-strip", category: "Lighting", label: "LED strip (cool)", w: 60, d: 4, props: { color: "cyan", intensity: 1.6, glow: 0.18, reach: 20 } },
  { kind: "led-strip", category: "Lighting", label: "LED strip (warm)", w: 60, d: 4, props: { color: "coveWarm", intensity: 1.6, glow: 0.18, reach: 20 } },
  { kind: "led-strip", category: "Lighting", label: "LED strip (violet)", w: 60, d: 4, props: { color: "gamingLed", intensity: 1.9, glow: 0.24, reach: 24 } },
];

export const itemsIn = (category: AssetCategory): AssetItem[] => ASSET_LIBRARY.filter((i) => i.category === category);
export const assetKey = (i: AssetItem): string => `${i.kind}:${i.label}`;
export const findAsset = (key: string): AssetItem | null => ASSET_LIBRARY.find((i) => assetKey(i) === key) ?? null;

export const assetFootprint = (item: AssetItem): Footprint => kindFootprint(item.kind, item.w, item.d);

/** The entity a library item becomes. `editable` is declared outright: a piece the designer placed is
 *  editable by construction, and it carries no gameplay wiring, so it is also deletable. */
export function assetEntity(item: AssetItem, id: EntityId, roomId: string, pos: Vec2, yaw = 0): Entity {
  return {
    id, kind: item.kind, roomId,
    transform: { pos: { ...pos }, yaw },
    footprint: assetFootprint(item),
    placement: { movable: true, clearance: 1 },
    capabilities: { editable: true, ...(item.kind === "plant" ? { sway: true as const } : {}) },
    props: { w: item.w, d: item.d, facing: "north", ...item.props },
  };
}
