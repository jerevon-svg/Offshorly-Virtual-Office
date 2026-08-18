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

// Tiny positive offset applied to a back-sit occupant's own baseline when
// forcing their chair's sort key to sit "just barely in front of" them (see
// sortKey below). Keeps the chair from tying (and losing the furniture-vs-
// character tie-break) with its own occupant's real baseline, while staying
// far below any other real baseline difference in practice.
const BACK_SIT_EPSILON = 0.01;

// Derived numeric sort key per layer. Seat-type furniture always gets
// -Infinity so it sorts first (renders behind) relative to ANY other layer
// in the Y-sort group, regardless of its own baseline. This is a real key
// comparison (transitive), not a pairwise conditional, so the guarantee
// holds no matter which pairs the sort algorithm happens to compare
// directly. Non-seat furniture (desks) keep using their real baseline, so
// character-vs-desk occlusion is unchanged.
//
// EXCEPTION: a seat currently occupied by a back-facing sitter (character's
// back to the viewer) needs its backrest rendered IN FRONT OF that occupant —
// the opposite of every other seat pose. Rather than moving the WHOLE chair
// layer in front (which would also hide the seat/armrests/legs beneath/
// around the character — visually wrong), OfficeStage.tsx generates a
// SYNTHETIC clone of the chair layer, clipped (CSS clip-path) to only its top
// "backrest" portion (see chairBackrestCrop.ts), with id
// `${furnitureId}-backrest-crop`. `occupantBaselines` (built in
// OfficeMap.tsx via backSitOccupancy.ts's computeBackSitOccupantBaselines, now
// keyed by that SYNTHETIC crop-layer id, not the base furniture id directly)
// carries that specific occupant's own baseline for exactly this case. When
// a layer's id is a key in that map — which in practice is only ever the
// synthetic crop layer, since the base chair layer's id has no "-backrest-
// crop" suffix — its sort key becomes the occupant's baseline plus a small
// epsilon instead of -Infinity, so it draws just after (in front of) that
// occupant, while still correctly drawing behind any OTHER, further-forward
// character (real baseline comparison, not a hardcoded "always front" rule).
// The base chair layer itself is NEVER a key in this map anymore, so it
// keeps the unchanged -Infinity (always-behind) behavior below, same as
// every other seat (unoccupied, occupied but facing front/left/right, or in
// one of the 6 non-manifest rooms with no furnitureId link).
function sortKey(layer: AssetLayer, occupantBaselines?: Record<string, number>): number {
  if (isSeat(layer)) {
    const occupantBaseline = occupantBaselines?.[layer.id];
    if (occupantBaseline !== undefined) return occupantBaseline + BACK_SIT_EPSILON;
    return -Infinity;
  }
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

// Builds the actual comparator, closing over an optional back-sit
// occupant-baseline map (see sortKey's doc comment above). Called fresh with
// the current map each render in OfficeStage — cheap (a closure + a couple
// of property lookups), and keeps depthCompare's own signature/behavior
// exactly as-is for every existing caller/test that doesn't pass a map.
export function createDepthCompare(
  occupantBaselines?: Record<string, number>,
): (a: AssetLayer, b: AssetLayer) => number {
  return (a: AssetLayer, b: AssetLayer): number => {
    const ao = KIND_ORDER[a.kind];
    const bo = KIND_ORDER[b.kind];

    // Opt-in override: exactly one side is a room with a tuned occlusion
    // line, and the other side is furniture/character (participates in the
    // normal Y-sort group). Compare the room's occlusion line against the
    // other side's own sortKey instead of the fixed ao/bo bucket order.
    // Every other combination (both rooms, room-vs-floor/decor, room with no
    // override, etc.) falls through to the original unchanged fixed-bucket
    // rule.
    const aLine = occlusionLineFor(a);
    const bLine = occlusionLineFor(b);
    if (aLine !== undefined && bo >= DEPTH_MIN) {
      return aLine - sortKey(b, occupantBaselines);
    }
    if (bLine !== undefined && ao >= DEPTH_MIN) {
      return sortKey(a, occupantBaselines) - bLine;
    }

    if (ao < DEPTH_MIN || bo < DEPTH_MIN) return ao - bo; // fixed low buckets preserved, unchanged behavior

    const ka = sortKey(a, occupantBaselines);
    const kb = sortKey(b, occupantBaselines);
    if (ka !== kb) return ka - kb; // smaller key = further back = drawn first (i.e. appears "behind")
    return ao - bo; // tie-break on equal key: furniture(2) draws before character(3), so character appears in front
  };
}

// Back-compat default comparator (no back-sit occupant map) — every existing
// caller/test that imports `depthCompare` directly keeps working unchanged.
export const depthCompare = createDepthCompare();
