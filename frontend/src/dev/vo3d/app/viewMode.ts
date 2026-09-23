// vo3d app — WHICH CAMERA IS DRIVING, as a value React can hold.
//
// The same split as app/interactions.ts and for the same reason: the world owns the camera, the host owns
// the DOM, and the host has to know which of the two experiences is on screen because they want different
// chrome. OFFICE and 3D EXPLORE are looked-at worlds and carry the branded HUD over them; PLAYER is a
// walked world that takes the pointer, so the HUD is hidden (not unmounted — see HudDock's `hidden`)
// while it is active.
//
// This module imports nothing, so app/world.ts stays loadable by the standalone dev page.

/** The three camera modes app/world.ts's CAMERA_MODES already names. */
export type Vo3dViewMode = "office" | "explore" | "player";
