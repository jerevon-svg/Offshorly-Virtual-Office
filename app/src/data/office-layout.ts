import type { AssetLayer, Room } from "../types/office";
import manifestJson from "./office-assets-manifest.json";

// Coordinates are relative to the "Offshorly Virtual Office" Figma frame
// (fileKey 2dlKmOJ6adU1S6YrHu8Rj5, nodeId 11878:912), which is 1440x1244 in
// Figma design units. This is the single coordinate basis used everywhere
// the layered office is positioned.
export const FRAME_WIDTH = 1440;
export const FRAME_HEIGHT = 1244;

// Vite requires static imports to resolve asset URLs at build time — the
// manifest only carries relative path strings, so every image referenced by
// the manifest needs an explicit import below, mapped by its manifest path.
import floor from "../assets/office/floor.png";
import vendoMachineLeft from "../assets/office/decor/vendo-machine-left.png";
import vendoMachineRight from "../assets/office/decor/vendo-machine-right.png";
import cmsShadow from "../assets/office/decor/cms-shadow.png";
import qaShadow from "../assets/office/decor/qa-shadow.png";
import statue from "../assets/office/decor/statue.png";
import aiRoom from "../assets/office/rooms/ai-room.png";
import executiveRoom from "../assets/office/rooms/executive-room.png";
import devRoom from "../assets/office/rooms/dev-room.png";
import cmsRoom from "../assets/office/rooms/cms-room.png";
import qaRoom from "../assets/office/rooms/qa-room.png";
import designRoom from "../assets/office/rooms/design-room.png";
import gamingRoom from "../assets/office/rooms/gaming-room.png";
import projectRoom from "../assets/office/rooms/project-room.png";
import meetingRoom from "../assets/office/rooms/meeting-room.png";
import receptionRoom from "../assets/office/rooms/reception-room.png";
import centralHub from "../assets/office/rooms/central-hub.png";
import alex from "../assets/office/characters/alex.png";
import chris from "../assets/office/characters/chris.png";
import cyrus from "../assets/office/characters/cyrus.png";
import jona from "../assets/office/characters/jona.png";
import angelo from "../assets/office/characters/angelo.png";
import micah from "../assets/office/characters/micah.png";
import bon from "../assets/office/characters/bon.png";
import clang from "../assets/office/characters/clang.png";
import france from "../assets/office/characters/france.png";
import arisha from "../assets/office/characters/arisha.png";

// Maps each manifest `path` string to its Vite-resolved asset URL.
export const ASSET_PATH_TO_SRC: Record<string, string> = {
  "assets/office/floor.png": floor,
  "assets/office/decor/vendo-machine-left.png": vendoMachineLeft,
  "assets/office/decor/vendo-machine-right.png": vendoMachineRight,
  "assets/office/decor/cms-shadow.png": cmsShadow,
  "assets/office/decor/qa-shadow.png": qaShadow,
  "assets/office/decor/statue.png": statue,
  "assets/office/rooms/ai-room.png": aiRoom,
  "assets/office/rooms/executive-room.png": executiveRoom,
  "assets/office/rooms/dev-room.png": devRoom,
  "assets/office/rooms/cms-room.png": cmsRoom,
  "assets/office/rooms/qa-room.png": qaRoom,
  "assets/office/rooms/design-room.png": designRoom,
  "assets/office/rooms/gaming-room.png": gamingRoom,
  "assets/office/rooms/project-room.png": projectRoom,
  "assets/office/rooms/meeting-room.png": meetingRoom,
  "assets/office/rooms/reception-room.png": receptionRoom,
  "assets/office/rooms/central-hub.png": centralHub,
  "assets/office/characters/alex.png": alex,
  "assets/office/characters/chris.png": chris,
  "assets/office/characters/cyrus.png": cyrus,
  "assets/office/characters/jona.png": jona,
  "assets/office/characters/angelo.png": angelo,
  "assets/office/characters/micah.png": micah,
  "assets/office/characters/bon.png": bon,
  "assets/office/characters/clang.png": clang,
  "assets/office/characters/france.png": france,
  "assets/office/characters/arisha.png": arisha,
};

export const officeAssetLayers = manifestJson as AssetLayer[];

// Legacy flat-rect room data, superseded by officeAssetLayers as the
// authoritative layered-office source, kept for reference/reuse.
export const rooms: Room[] = [
  { id: "ai-room", name: "AI Room", x: 8, y: 8, width: 336.8, height: 290.49 },
  {
    id: "executive-team",
    name: "Executive Team",
    x: 493.72,
    y: 8,
    width: 465.57,
    height: 306.19,
  },
  { id: "dev-team", name: "Dev Team", x: 1111.14, y: 8, width: 321, height: 323.5 },
  {
    id: "cms-team",
    name: "CMS Team",
    x: 1141.25,
    y: 347.07,
    width: 291,
    height: 259.5,
  },
  { id: "qa-room", name: "QA Room", x: 8, y: 596.42, width: 321.11, height: 258.88 },
  {
    id: "design-team",
    name: "Design Team",
    x: 9.48,
    y: 314.46,
    width: 312.44,
    height: 265.96,
  },
  {
    id: "gaming-room",
    name: "Gaming Room",
    x: 1111.71,
    y: 622.35,
    width: 320.29,
    height: 236.6,
  },
  {
    id: "project-room",
    name: "Project Room",
    x: 1079.86,
    y: 842.53,
    width: 352.14,
    height: 395.53,
  },
  {
    id: "meeting-room",
    name: "Meeting Room",
    x: 8,
    y: 863.21,
    width: 324.45,
    height: 374.85,
  },
  {
    id: "reception-room",
    name: "Reception Room",
    x: 332.33,
    y: 838.47,
    width: 748.96,
    height: 399.1,
  },
];

export const characterLayers: AssetLayer[] = officeAssetLayers.filter(
  (l) => l.kind === "character",
);

export function formatCharacterName(layer: Pick<AssetLayer, "id" | "name">): string {
  if (layer.name) return layer.name;
  return layer.id
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
