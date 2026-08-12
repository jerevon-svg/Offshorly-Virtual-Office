import type { AssetLayer } from "../../types/office";

// Render order: floor first (base), then room/decor images, then
// furniture/character images, Y-sorted by feet-line among themselves so
// characters visually draw behind/in front of furniture correctly.
export const KIND_ORDER: Record<AssetLayer["kind"], number> = {
  floor: 0,
  sidewalk: 0.5,
  room: 1,
  decor: 1,
  furniture: 2,
  character: 3,
};

// Kinds at/above this bucket participate in true Y-sort by feet-line depth.
// Kinds below stay in their fixed bucket order (floor/room/decor unchanged).
const DEPTH_MIN = 2;

function baseline(layer: AssetLayer): number {
  return layer.y + layer.height; // bottom edge = feet-line
}

// Seat-type furniture (chair/sofa/beanbag) whose full asset bounding box
// (including base/legs) extends below a seated character's own sprite
// baseline (torso/head only, legs implicitly hidden by the seat). Matched
// on `path` (filename), not `id` — some ids (e.g. dev-lead1-visitor1) don't
// contain "chair" but their underlying asset path does.
function isSeat(layer: AssetLayer): boolean {
  return layer.kind === "furniture" && /chair|sofa|beanbag/i.test(layer.path);
}

// Derived numeric sort key per layer. Seat-type furniture always gets
// -Infinity so it sorts first (renders behind) relative to ANY other layer
// in the Y-sort group, regardless of its own baseline. This is a real key
// comparison (transitive), not a pairwise conditional, so the guarantee
// holds no matter which pairs the sort algorithm happens to compare
// directly. Non-seat furniture (desks) keep using their real baseline, so
// character-vs-desk occlusion is unchanged.
function sortKey(layer: AssetLayer): number {
  if (isSeat(layer)) return -Infinity;
  return baseline(layer);
}

// Per-room opt-in override: lets a SPECIFIC room id participate in a narrow,
// targeted Y-sort comparison against characters/furniture using a manually
// tuned "occlusion line" (a y-coordinate just below the room's back-wall
// band) instead of the room's full bounding box. Rooms with no entry here
// keep the exact original fixed-bucket behavior below, unchanged.
//
// Verified against real feet-baselines: cms-room's only interior occupant
// (jona, feet ~426.9) must stay in front; the dev-room approach corridor's
// feet-baselines (~351-363, all characters) must render behind CMS's back
// wall. 390 sits with ~27px margin below the corridor max and ~37px above
// jona — see master-agent investigation for full derivation.
const ROOM_OCCLUSION_LINE: Record<string, number> = {
  "cms-room": 390,
};

function occlusionLineFor(layer: AssetLayer): number | undefined {
  if (layer.kind !== "room") return undefined;
  return ROOM_OCCLUSION_LINE[layer.id];
}

export function depthCompare(a: AssetLayer, b: AssetLayer): number {
  const ao = KIND_ORDER[a.kind];
  const bo = KIND_ORDER[b.kind];

  // Opt-in override: exactly one side is a room with a tuned occlusion line,
  // and the other side is furniture/character (participates in the normal
  // Y-sort group). Compare the room's occlusion line against the other
  // side's own sortKey instead of the fixed ao/bo bucket order. Every other
  // combination (both rooms, room-vs-floor/decor, room with no override,
  // etc.) falls through to the original unchanged fixed-bucket rule.
  const aLine = occlusionLineFor(a);
  const bLine = occlusionLineFor(b);
  if (aLine !== undefined && bo >= DEPTH_MIN) {
    return aLine - sortKey(b);
  }
  if (bLine !== undefined && ao >= DEPTH_MIN) {
    return sortKey(a) - bLine;
  }

  if (ao < DEPTH_MIN || bo < DEPTH_MIN) return ao - bo; // fixed low buckets preserved, unchanged behavior

  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka - kb; // smaller key = further back = drawn first (i.e. appears "behind")
  return ao - bo; // tie-break on equal key: furniture(2) draws before character(3), so character appears in front
}
