// Door slide-open/close animation wiring — bridges the flat room-id
// namespace (see roomIdentity.ts / OfficeMap's flatRoomIdAt) to the actual
// door art layer ids painted into the office manifest, plus the direction
// each panel should slide when the door opens.
//
// DOOR_ANIM_MS is shared with OfficeMap.tsx's door-gate walk sequencing (the
// pause between "arrive at near stand" and "walk through") so the slide
// animation duration lines up with when the character actually steps
// through the doorway.
export const DOOR_ANIM_MS = 500;

// Flat room id -> door art layer id(s) that should animate when that room's
// door opens/closes. Rooms without door art (most of them, for now) are
// simply absent from this map — onDoorOpen/onDoorClose treat a missing
// entry as a no-op.
export const DOOR_LAYERS_BY_ROOM: Record<string, string[]> = {
  "ai-room": ["ai-door"],
  "executive-team": ["executive-door-left", "executive-door-right"],
};

// Door art layer id -> which way that panel slides on open (masked by the
// existing `.layer` container's overflow:hidden, so it looks like the door
// recedes into the wall pocket). Two-panel doors split apart, elevator-style.
export const DOOR_SLIDE_DIRECTION: Record<string, "left" | "right"> = {
  "ai-door": "left",
  "executive-door-left": "left",
  "executive-door-right": "right",
};
