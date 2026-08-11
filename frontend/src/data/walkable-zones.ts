export type Pt = { x: number; y: number };

// Corridor-facing entry point per room, just outside the room's box.
// The seat<->door leg (inside a room) is the "last-mile" hop and is
// exempt from obstacle checks — bon is already at his destination room.
export const ROOM_DOORS: Record<string, Pt> = {
  "design-room": { x: 340, y: 478 },
  "executive-room": { x: 720, y: 338 },
  "dev-room": { x: 1088, y: 300 },
  "cms-room": { x: 1116, y: 440 },
  "reception-room": { x: 714, y: 812 },
};

export const AGENT_MARGIN = 12; // wall clearance / obstacle expansion, design-space px
