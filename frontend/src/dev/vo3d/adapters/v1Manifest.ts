// vo3d adapter — READ-ONLY view of the production asset manifest.
import manifest from "../../../data/office-assets-manifest.json";
import type { Rect, Facing, Vec2 } from "../core/coords";
import type { Entity } from "../world/WorldState";
import { kindFootprint } from "../rooms/footprint";

type Layer = { id: string; kind: string; path: string; x: number; y: number; width: number; height: number };
const layers = manifest as Layer[];

export function v1RoomRect(layerId: string): Rect {
  const l = layers.find((e) => e.id === layerId && e.kind === "room");
  if (!l) throw new Error(`v1Manifest: no room layer ${layerId}`);
  return { x: l.x, z: l.y, w: l.width, d: l.height };
}

/** Manifest furniture filename → vo3d builder kind. */
const KIND_BY_FILE: Record<string, string> = {
  "design-lead-desk.png": "lead-desk",
  "design-member-desk.png": "member-desk",
  "design-desk-panel.png": "desk-panel",
  "design-curve-desk.png": "curve-desk",
  "design-side-desk.png": "side-desk",
  "design-side-sofa.png": "sofa",
  "design-side-beanbag.png": "beanbag",
  "design-side-mat.png": "rug",
  "design-member-chair-a.png": "chair-a",
  "design-member-chair-b.png": "chair-b",
  "design-lead-chair.png": "lead-chair",
};

// A chair faces the desk it serves; desks present their drawer fronts to the sitter.
function facingFor(kind: string, cx: number, roomCentreX: number): Facing {
  switch (kind) {
    case "chair-a":
    case "member-desk":
      return cx < roomCentreX ? "west" : "east";
    case "chair-b":
    case "desk-panel":
    case "curve-desk":
      return "north";
    case "lead-chair":
    case "lead-desk":
      return "south";
    default:
      return "south";
  }
}

/** Every separated furniture layer of a room folder as a world-space entity (footprint = manifest box). */
export function v1FurnitureEntities(roomId: string, folder: string, roomRect: Rect, offset: Vec2 = { x: 0, z: 0 }): Entity[] {
  const roomCentreX = roomRect.x + roomRect.w / 2;
  return layers
    .filter((l) => (l.kind === "furniture" || l.kind === "decor") && l.path.includes(`/${folder}/`) && KIND_BY_FILE[l.path.split("/").pop() ?? ""])
    .map((l) => {
      const kind = KIND_BY_FILE[l.path.split("/").pop() ?? ""];
      const cx = l.x + l.width / 2 + offset.x, cz = l.y + l.height / 2 + offset.z;
      const facing = facingFor(kind, cx, roomCentreX);
      return {
        id: `${roomId}/${l.id}`,
        kind,
        roomId,
        transform: { pos: { x: cx, z: cz }, yaw: 0 }, // builders orient by `facing`; yaw reserved for editor rotation later
        footprint: kindFootprint(kind, l.width, l.height),
        capabilities: {},
        props: { facing, mirrored: cx > roomCentreX, w: l.width, d: l.height },
        source: { v1LayerId: l.id },
      } satisfies Entity;
    });
}
