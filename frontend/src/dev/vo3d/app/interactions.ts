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
  /** PHASE 7B — HOW BIG A WORLD UNIT IS IN CSS PIXELS at this body's depth.
   *
   *  The overhead chat elements are world-space furniture, exactly as the nameplate above them is: they
   *  must shrink as the camera pulls back and grow as it closes in, or a bubble that reads correctly in
   *  OFFICE swamps the character in PLAYER. V1 gets this for free by living inside a scaled stage; V2 has
   *  a real camera, so the factor is measured — project the head, project a point one unit above it, and
   *  take the pixel distance. Correct for the orthographic and the perspective camera alike, and for a
   *  body at the near edge versus one across the room. */
  scale: number;
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
  /** ROOM DETAILS PARITY — A ROOM WAS SELECTED, or the selection was dropped.
   *
   *  `roomId` is the world's OWN region id (WorldState.regionAt().roomId), which is the V1 MANIFEST room
   *  layer id — "design-room", "dev-room", "central-hub" — because the ground floor's regions are built
   *  from those very rects (rooms/ground-floor.ts over adapters/v1Floor's v1Rooms). So the world is not
   *  inventing a room vocabulary here any more than it invents an email: it is handing back V1's own id.
   *
   *  Null means "no room": a click that landed on a person, on a fixture, on the shared hall, on the
   *  sidewalk, or outside the modelled world. The host closes its panel on null rather than leaving it
   *  pinned to a room the viewer has clicked away from — V1's own rule (OfficeMap clears roomSidebar on a
   *  character, seat, reception or HR-desk click).
   *
   *  THE WORLD STILL DECIDES NOTHING. It has never read a roster row and does not know who is in that
   *  room; it reports which of its own floor regions was picked and stops there. Optional, so the
   *  standalone dev page and every existing test double stay valid without stubbing it. */
  onRoomSelected?(roomId: string | null): void;
  /** PHASE 7E — A WALK-UP TO A PLACE, not to a person: the body finished walking to an entity's declared
   *  approach point AND finished turning to face it. `entityId` is the world entity's own id (for example
   *  Reception's `reception-room/kiosk-interaction`), which is all the world has and all the host needs to
   *  decide what that particular fixture means.
   *
   *  THE SAME LINE AS EVERY OTHER MEMBER HERE. The world walks the body and says where it stopped; it
   *  opens nothing, fetches nothing and knows nothing about attendance, check-in or any other workflow a
   *  fixture might stand for. That decision is the host's, in V1's own code, exactly as `onSelect` is.
   *
   *  FIRES ONCE PER APPROACH (interact/Approach.ts owns that guarantee), and never for an approach that
   *  was cancelled, interrupted or refused as unreachable. Optional so a host that has no use for world
   *  fixtures — and every existing test double — stays valid without stubbing it. */
  onInteractionArrived?(entityId: string): void;
  /** PHASE 7E — A CHECKED-IN EMPLOYEE WALKED UP TO THE EXIT while the exit is still held shut.
   *
   *  Leaving the building is a DECISION, not a door: an employee on their way out is either stepping over
   *  to the AI Lab (still checked in, still on the clock) or ending their working day (V1's Log Time →
   *  Zoho → check-out). The world cannot tell those apart and has no business guessing, so it does what it
   *  does everywhere else — it stops the body at the boundary and says so.
   *
   *  THE WORLD HOLDS THE EXIT, THE HOST OPENS IT. This fires when the body enters the entrance mat with
   *  the exit reservation still in place; nothing about attendance changes, the doors stay shut, and the
   *  employee stays exactly where they are until the host calls `setExitAuthorized(true)` — or does not.
   *  Fires on ARRIVAL, not on every frame, so walking back and forth re-asks rather than spamming. Never
   *  fires for somebody V1 has not confirmed as checked in: there is nothing to decide, and their exit was
   *  never held. */
  onExitIntercepted?(): void;
  /** PHASE 7E — THEY WALKED AWAY FROM THE EXIT without answering.
   *
   *  Walking off is an answer in itself, and the same one Cancel gives: the question was about leaving, and
   *  they are no longer leaving. Nothing is authorised, the exit stays held and the work session is
   *  untouched — this exists so a card cannot follow somebody back across the room. Re-approaching raises
   *  `onExitIntercepted` again, so nothing is lost by dismissing it. */
  onExitAbandoned?(): void;
  /** DND ROOM LOCK — the body is standing at the shut door of `roomId` (a manifest room id), kept out by a
   *  DND occupant. Raised once per approach, from the world's frame loop, whichever movement mode brought
   *  them there; the host shows V1's RoomLockedToast and owns the knock (app/roomLocks.ts). */
  onRoomLockIntercepted?(roomId: string): void;
  /** …and they walked away from that door without getting in. */
  onRoomLockAbandoned?(roomId: string): void;
  /** PHASE 7E — WHICH SIDE OF THE BUILDING'S OWN BOUNDARY THE BODY IS ON (app/access.ts `Zone`).
   *
   *  Edge-triggered. The host reads exactly one thing from it: somebody who is `outside` is out of the
   *  office — at the AI Lab, on the way there, or on the way back — and their presence should say so for
   *  the whole excursion rather than flickering as they step between the Lab's floor and the pavement.
   *
   *  RE-ENTRY IS THE ONLY WAY BACK. `outside` ends when the body is genuinely past the façade plane, which
   *  is reachable only through the entrance, so merely walking up to the building changes nothing. The
   *  world reports geography; what it MEANS for presence is the host's decision, made with V1's own store
   *  and its own precedence — nothing here forces a status. */
  onZoneChanged?(zone: "office" | "reception" | "outside"): void;
}
