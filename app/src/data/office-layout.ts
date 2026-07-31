import type { Room } from "../types/office";

// Coordinates are relative to the "Offshorly Virtual Office" Figma frame
// (fileKey 2dlKmOJ6adU1S6YrHu8Rj5, nodeId 11878:912), which is 1440x1244 in
// Figma design units. Values come directly from a get_metadata call — the
// tool already returns frame-relative coordinates (frame itself sits at
// absolute canvas x=-1856, y=16162, but children are 0-based within it).
export const FRAME_WIDTH = 1440;
export const FRAME_HEIGHT = 1244;

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
