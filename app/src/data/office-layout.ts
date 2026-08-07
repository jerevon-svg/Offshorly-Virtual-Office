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
import sidewalk from "../assets/office/decor/sidewalk.png";
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
import karen from "../assets/office/characters/karen.png";
import kylle from "../assets/office/characters/kylle.png";
import lalaine from "../assets/office/characters/lalaine.png";
import rhendel from "../assets/office/characters/rhendel.png";
import nicole from "../assets/office/characters/nicole.png";
import kael from "../assets/office/characters/kael.png";
import eson from "../assets/office/characters/eson.png";
import bhong from "../assets/office/characters/bhong.png";
import ivory from "../assets/office/characters/ivory.png";
import aiMemberDesk1 from "../assets/office/furniture/ai-team/ai-member-desk-1.png";
import aiLeadDesk from "../assets/office/furniture/ai-team/ai-lead-desk.png";
import aiMemberChair from "../assets/office/furniture/ai-team/ai-member-chair.png";
import aiLeadChair from "../assets/office/furniture/ai-team/ai-lead-chair.png";
import devChair from "../assets/office/furniture/dev-team/dev-chair.png";
import ceoDesk from "../assets/office/furniture/executive-team/ceo-desk.png";
import ctoDesk from "../assets/office/furniture/executive-team/cto-desk.png";
import centerDesk from "../assets/office/furniture/executive-team/center-desk.png";
import hrSdesk from "../assets/office/furniture/executive-team/hr-sdesk.png";
import hrLdesk from "../assets/office/furniture/executive-team/hr-ldesk.png";
import bottomLeftDesk from "../assets/office/furniture/executive-team/bottom-left-desk.png";
import hrChair from "../assets/office/furniture/executive-team/hr-chair.png";
import whiteSofa from "../assets/office/furniture/executive-team/white-sofa.png";
import plantSmall from "../assets/office/furniture/executive-team/plant-small.png";
import hrFloormat from "../assets/office/furniture/executive-team/hr-floormat.png";
import execChair from "../assets/office/furniture/executive-team/exec-chair.png";
import execVisitorChair from "../assets/office/furniture/executive-team/exec-visitor-chair.png";
import bottomCenterSofa from "../assets/office/furniture/executive-team/bottom-center-sofa.png";
import topCenterSofa from "../assets/office/furniture/executive-team/top-center-sofa.png";
import devLeadDesk from "../assets/office/furniture/dev-team/dev-lead-desk.png";
import devBayDesk from "../assets/office/furniture/dev-team/dev-bay-desk.png";
import devSideDesk from "../assets/office/furniture/dev-team/dev-side-desk.png";
import devVisitorChair from "../assets/office/furniture/dev-team/dev-visitor-chair.png";
import devSidePlant from "../assets/office/furniture/dev-team/dev-side-plant.png";
import devSideMat from "../assets/office/furniture/dev-team/dev-side-mat.png";
import devSideSofa from "../assets/office/furniture/dev-team/dev-side-sofa.png";
import designLeadDesk from "../assets/office/furniture/design-team/design-lead-desk.png";
import designMemberDesk from "../assets/office/furniture/design-team/design-member-desk.png";
import designCurveDesk from "../assets/office/furniture/design-team/design-curve-desk.png";
import designDeskPanel from "../assets/office/furniture/design-team/design-desk-panel.png";
import designSideDesk from "../assets/office/furniture/design-team/design-side-desk.png";
import designSideSofa from "../assets/office/furniture/design-team/design-side-sofa.png";
import designSideBeanbag from "../assets/office/furniture/design-team/design-side-beanbag.png";
import designSideMat from "../assets/office/furniture/design-team/design-side-mat.png";
import designLeadChair from "../assets/office/furniture/design-team/design-lead-chair.png";
import designMemberChairA from "../assets/office/furniture/design-team/design-member-chair-a.png";
import designMemberChairB from "../assets/office/furniture/design-team/design-member-chair-b.png";

// Maps each manifest `path` string to its Vite-resolved asset URL.
export const ASSET_PATH_TO_SRC: Record<string, string> = {
  "assets/office/floor.png": floor,
  "assets/office/decor/sidewalk.png": sidewalk,
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
  "assets/office/characters/karen.png": karen,
  "assets/office/characters/kylle.png": kylle,
  "assets/office/characters/lalaine.png": lalaine,
  "assets/office/characters/rhendel.png": rhendel,
  "assets/office/characters/nicole.png": nicole,
  "assets/office/characters/kael.png": kael,
  "assets/office/characters/eson.png": eson,
  "assets/office/characters/bhong.png": bhong,
  "assets/office/characters/ivory.png": ivory,
  "assets/office/furniture/ai-team/ai-member-desk-1.png": aiMemberDesk1,
  "assets/office/furniture/ai-team/ai-lead-desk.png": aiLeadDesk,
  "assets/office/furniture/ai-team/ai-member-chair.png": aiMemberChair,
  "assets/office/furniture/ai-team/ai-lead-chair.png": aiLeadChair,
  "assets/office/furniture/dev-team/dev-chair.png": devChair,
  "assets/office/furniture/executive-team/ceo-desk.png": ceoDesk,
  "assets/office/furniture/executive-team/cto-desk.png": ctoDesk,
  "assets/office/furniture/executive-team/center-desk.png": centerDesk,
  "assets/office/furniture/executive-team/hr-sdesk.png": hrSdesk,
  "assets/office/furniture/executive-team/hr-ldesk.png": hrLdesk,
  "assets/office/furniture/executive-team/bottom-left-desk.png": bottomLeftDesk,
  "assets/office/furniture/executive-team/hr-chair.png": hrChair,
  "assets/office/furniture/executive-team/white-sofa.png": whiteSofa,
  "assets/office/furniture/executive-team/plant-small.png": plantSmall,
  "assets/office/furniture/executive-team/hr-floormat.png": hrFloormat,
  "assets/office/furniture/executive-team/exec-chair.png": execChair,
  "assets/office/furniture/executive-team/exec-visitor-chair.png": execVisitorChair,
  "assets/office/furniture/executive-team/bottom-center-sofa.png": bottomCenterSofa,
  "assets/office/furniture/executive-team/top-center-sofa.png": topCenterSofa,
  "assets/office/furniture/dev-team/dev-lead-desk.png": devLeadDesk,
  "assets/office/furniture/dev-team/dev-bay-desk.png": devBayDesk,
  "assets/office/furniture/dev-team/dev-side-desk.png": devSideDesk,
  "assets/office/furniture/dev-team/dev-visitor-chair.png": devVisitorChair,
  "assets/office/furniture/dev-team/dev-side-plant.png": devSidePlant,
  "assets/office/furniture/dev-team/dev-side-mat.png": devSideMat,
  "assets/office/furniture/dev-team/dev-side-sofa.png": devSideSofa,
  "assets/office/furniture/design-team/design-lead-desk.png": designLeadDesk,
  "assets/office/furniture/design-team/design-member-desk.png": designMemberDesk,
  "assets/office/furniture/design-team/design-curve-desk.png": designCurveDesk,
  "assets/office/furniture/design-team/design-desk-panel.png": designDeskPanel,
  "assets/office/furniture/design-team/design-side-desk.png": designSideDesk,
  "assets/office/furniture/design-team/design-side-sofa.png": designSideSofa,
  "assets/office/furniture/design-team/design-side-beanbag.png": designSideBeanbag,
  "assets/office/furniture/design-team/design-side-mat.png": designSideMat,
  "assets/office/furniture/design-team/design-lead-chair.png": designLeadChair,
  "assets/office/furniture/design-team/design-member-chair-a.png": designMemberChairA,
  "assets/office/furniture/design-team/design-member-chair-b.png": designMemberChairB,
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

export const bonLayer = characterLayers.find((l) => l.id === "bon")!;
export const npcCharacterLayers = characterLayers.filter((l) => l.id !== "bon");

export function formatCharacterName(layer: Pick<AssetLayer, "id" | "name">): string {
  if (layer.name) return layer.name;
  return layer.id
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Room layers used for click-to-view-roster (kept separate from the legacy
// `rooms` flat-rect export above, which uses different ids).
export const roomLayers: AssetLayer[] = officeAssetLayers.filter(
  (l) => l.kind === "room",
);

// Maps each room id to the NPC character layers whose center point falls
// inside that room's bounding box. Every room in roomLayers gets an entry,
// even if empty. `bon` is excluded via npcCharacterLayers (dynamic player
// avatar, not a static roster member).
// Returns the first room in roomLayers whose bounding box contains `point`,
// or null if the point falls outside every room. Used both for the static
// roomMembersById derivation below and for live (dynamic) point lookups,
// e.g. bon's current walking position.
export function roomContainingPoint(point: { x: number; y: number }): AssetLayer | null {
  const room = roomLayers.find(
    (r) =>
      point.x >= r.x &&
      point.x <= r.x + r.width &&
      point.y >= r.y &&
      point.y <= r.y + r.height,
  );
  return room ?? null;
}

export const roomMembersById: Record<string, AssetLayer[]> = (() => {
  const result: Record<string, AssetLayer[]> = {};
  for (const room of roomLayers) {
    result[room.id] = [];
  }
  for (const npc of npcCharacterLayers) {
    const cx = npc.x + npc.width / 2;
    const cy = npc.y + npc.height / 2;
    const room = roomContainingPoint({ x: cx, y: cy });
    if (room) {
      result[room.id].push(npc);
    }
  }
  return result;
})();

const ROOM_NAME_OVERRIDES: Record<string, string> = {
  "ai-room": "AI Room",
  "cms-room": "CMS Room",
  "qa-room": "QA Room",
};

export function formatRoomName(id: string): string {
  if (ROOM_NAME_OVERRIDES[id]) return ROOM_NAME_OVERRIDES[id];
  return id
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// The 6 real team-home rooms an employee can be assigned to in the avatar
// creator's room picker (the other 4 rooms in `rooms` — gaming/project/
// meeting/reception — are shared/common spaces, not valid team picks).
// Filtered from `rooms` rather than duplicated so the picker list and the
// flat-rect room data can never drift apart.
const TEAM_ROOM_IDS = [
  "ai-room",
  "executive-team",
  "dev-team",
  "cms-team",
  "qa-room",
  "design-team",
] as const;

export const teamRooms: Room[] = TEAM_ROOM_IDS.map((id) => {
  const room = rooms.find((r) => r.id === id);
  if (!room) throw new Error(`teamRooms: missing room "${id}" in rooms[]`);
  return room;
});
