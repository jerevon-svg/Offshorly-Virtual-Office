// vo3d app — THE EMPLOYEE INTERACTION CONTRACT (Phase 6D). The same split, and the same reason, as
// app/coworkers.ts: the V1 side (app/Vo3dHost.tsx and its adapters) runs V1's chat, call, approach and
// profile services, while app/world.ts must stay loadable by the standalone dev page with no V1 anything
// in its graph. The vocabulary both sides name lives here, in a module that imports nothing at all.
//
// WHAT PHASE 6D IS — AND IS NOT.
//
// It is a way to SELECT a coworker in the V2 world and invoke V1's existing interactions on them. That is
// all. The world raycasts a body (Office View) or targets one through PLAYER mode's own facing cone, and
// hands the host an email and a display name. Everything that happens next — the attendance gate, the DND
// gate, the DM conversation, the spatial session, the call invite, the join request, the quest signal —
// is V1's own code running unchanged, from V1's own modules, exactly as OfficeMap.tsx runs it.
//
// The world therefore:
//   • DECIDES NOTHING about a person. It knows an email is a key; it has never read a roster row.
//   • RUNS NO ACTION. `onSelect` is a notification, not a dispatch, and the world has no idea what a chat
//     panel is. The one verb it does own is `approachCoworker`, because walking this body is the world's
//     job and nobody else's — and even that publishes through the Phase 5 movement sink it already had.
//   • OPENS NO SOCKET, FETCHES NOTHING, IMPORTS NO V1 MODULE. Unchanged from every phase before it.

/** WHO WAS SELECTED. An email (the key every V1 feed joins on — see app/coworkers.ts) and the display
 *  name the body's own nameplate already carries. Nothing else: the world holds no roster row to give. */
export interface Vo3dCoworkerSelection {
  email: string;
  displayName: string;
}

/** WHERE A BODY IS ON SCREEN, in CSS pixels in the viewport's own frame — what an anchored DOM card needs
 *  and the only form of it the host can use directly.
 *
 *  RECOMPUTED, NEVER REMEMBERED. The point a body occupied when it was clicked stops being true the
 *  moment the camera moves or that person takes a step, and both happen constantly (a replayed peer walk
 *  moves them; PLAYER mode moves the camera every frame). `visible` is false when the body is behind the
 *  camera or off the viewport — the host hides the card rather than pinning it to an edge. */
export interface Vo3dScreenAnchor {
  clientX: number;
  clientY: number;
  visible: boolean;
}

/** THE HOST'S END of the contract, pushed into the world the same way the coworker roster and the office
 *  access answer are: React owns the consequences, the world owns the scene. */
export interface Vo3dCoworkerInteractions {
  /** A coworker was selected (a click on their body, or PLAYER mode's interact key while targeting them),
   *  or the selection was dropped — a click on empty floor, a walk elsewhere. Null means "close it". */
  onSelect(selection: Vo3dCoworkerSelection | null): void;
  /** A walk started by `approachCoworker` finished AND the body finished turning to face them. This is the
   *  only signal V1 can get for "walked up to a coworker" (the walk is client-side), and it is what the
   *  host emits the Onboarding Questline's approach_arrived from — the same one OfficeMap.tsx emits. */
  onApproachArrived(email: string): void;
}
