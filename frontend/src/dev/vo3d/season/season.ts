// vo3d season — THE SEASONAL DECORATION SEAM. Types and one mapping. No geometry, no materials, no
// lighting, no particles, and deliberately so.
//
// ══ WHAT A SEASON IS, AND WHAT IT IS NOT ══
//
// A season is a REVERSIBLE DECORATIVE LAYER OVER THE SAME V2 WORLD. The Halloween office and the
// Christmas office are this office, decorated: the same rooms, the same walls, the same navigation
// grid, the same seats, the same doors, the same avatars and the same interactions. Nothing about a
// season rebuilds a room, replaces furniture, moves a wall, changes a footprint or forks the world.
// There is ONE world implementation and there will only ever be one — App.tsx mounts the same
// Vo3dHost for "v2", "halloween" and "christmas", and only the Classic office is a different tree.
//
// WHY THAT IS SAFE BY CONSTRUCTION, and not merely by discipline: navigation, collision, seating and
// interaction are all derived from WorldState footprints and region data. nav/solids.ts never reads a
// THREE object (see build/detail-props.ts and build/exterior.ts, which say the same thing about the
// room-dressing and exterior passes). A decoration added as a scene group rather than an Entity
// therefore CANNOT block a cell, narrow a doorway, occupy a seat or move an interaction — whatever
// it is and wherever it is put.
//
// ══ WHAT PHASE 9A SHIPS, AND WHY IT IS ONLY THIS ══
//
// The foundation phase ships the SERVER-SIDE availability model and the gallery plumbing. It ships no
// decoration. So this module is the typed seam the decoration will arrive through and nothing more:
// the vocabulary (`SeasonTheme`), the mapping from an office experience to it, and the shape a layer
// will implement (`SeasonLayer`). There is no implementation of `SeasonLayer` anywhere in this build,
// and `seasonForExperience` can only return "none" for any experience an employee can currently be
// put in, because the backend refuses to publish a season whose decoration layer has not shipped.
//
// WHAT ARRIVES HERE LATER, so it is not re-litigated: a `themes.ts` (an EnvOverlay per season, composed
// onto the resolved weather x phase preset with env/presets' existing `overlay()`, plus the accent
// tables for the copy-on-write surface and LED registries), a `placement.ts` (one table of
// roomId -> decoration anchors), a `decor.ts` (procedural builders, baked, attached to
// SceneMirror.roomGroup so they inherit room culling and static batching), and the one implementation
// of `SeasonLayer` that composes them. None of it exists yet.
import type { OfficeExperience } from "../../../services/settings/officeExperience";

/** Which decorative layer is over the world. "none" is the ordinary office, and it is not a special
 *  case of anything — it is what the world has always been. */
export type SeasonTheme = "none" | "halloween" | "christmas";

/** The office experience each theme decorates. Every value here is still the V2 world. */
const THEME_BY_EXPERIENCE: Partial<Record<OfficeExperience, SeasonTheme>> = {
  halloween: "halloween",
  christmas: "christmas",
};

/** Which season, if any, an office experience asks for.
 *
 *  "v2" and "classic" map to "none", and so does anything unrecognised — the ordinary office is the
 *  answer to every question this function cannot answer, which is the same rule every other resolver
 *  in this app follows. Note that this is a PRESENTATION question, asked only after the server has
 *  already decided the employee may open that experience at all; it is not a permission check and
 *  must never be used as one. */
export function seasonForExperience(experience: OfficeExperience | null | undefined): SeasonTheme {
  return (experience && THEME_BY_EXPERIENCE[experience]) || "none";
}

/** WHAT A SEASONAL DECORATION LAYER WILL IMPLEMENT — declared now so the eventual implementation has
 *  a shape to fill rather than a shape to invent, and so the lifecycle contract is written down while
 *  the reasons for it are fresh.
 *
 *  THE LIFECYCLE RULES, all three inherited from the world this layer decorates:
 *
 *    · `dispose()` IS IDEMPOTENT and must return the world to exactly what it was — every cloned
 *      material back to the shared one, every added group removed and its geometry freed. The
 *      copy-on-write registries in editor/surfaces.ts and editor/emissive.ts already keep the
 *      original material objects for precisely this, so a reset is byte-for-byte rather than a
 *      re-application of the authored values.
 *
 *    · IT OWNS NO SUBSCRIPTIONS AND NO TIMERS. The world's disposer stack owns teardown; a layer that
 *      registered its own listener would be a second thing to remember to unhook.
 *
 *    · IT NEVER TOUCHES WorldState. Not an entity, not a footprint, not a region, not a seat. If a
 *      season ever needs one of those, that is a design conversation and not an implementation
 *      detail — see the nav-inertness note in this module's header for why that line is where the
 *      safety comes from. */
export interface SeasonLayer {
  readonly theme: SeasonTheme;
  /** Idempotent, and after it the world is undecorated. */
  dispose(): void;
}
