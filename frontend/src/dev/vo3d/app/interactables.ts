// vo3d app — INTERACTION V2: THE SHARED INTERACTION CONTRACT.
//
// ONE DESCRIPTION OF A WORLD OBJECT, read by both views. Office View hovers it, names it in a tooltip and
// lists its actions in a menu; Player View targets it and names it on the "[E]" prompt. Both then hand the
// same entity id to the same starters in app/world.ts (activateInteractable / requestElevator /
// startApproach), so there is one business rule per object, never one per control scheme.
//
// Pure: no THREE, no DOM. The world supplies the two facts that change at runtime (is it an elevator call
// plate, is the seat taken); everything else is the entity's own declared capabilities.
import type { Vec2 } from "../core/coords";
import type { Entity } from "../world/WorldState";
import { friendlyLabel } from "../player/PlayerTargeting";
import type { Vo3dObjectAction, Vo3dObjectSelection } from "./interactions";

export type { Vo3dObjectAction, Vo3dObjectActionKey, Vo3dObjectSelection } from "./interactions";

export type InteractableDescription = {
  kind: "seat" | "lounge" | "approach";
  /** the object, as a person would name it — never an asset id */
  title: string;
  /** the verb on its own, exactly what Player View's prompt says after "[E]" */
  verb: string;
  /** where a body stands to use it (a seat's stand cell, a cushion's, a fixture's walk-up point) */
  anchor: Vec2;
};

/** fixture titles authored as an imperative ("Call the elevator") read better as the thing itself */
const titleFor = (e: Entity, elevatorCall: boolean): string => {
  const c = e.capabilities;
  if (elevatorCall) return "Elevator";
  if (c.seat) return c.seat.workstation ? "Desk" : "Chair";
  if (c.lounge) return "Seat";
  return c.approach?.label ?? "Object";
};

/** THE CONTRACT for one entity, or null when it offers no interaction at all. */
export function describeInteractable(e: Entity, ctx: { elevatorCall?: boolean } = {}): InteractableDescription | null {
  const { seat, lounge, approach } = e.capabilities;
  const elevatorCall = ctx.elevatorCall === true;
  if (seat) return { kind: "seat", title: titleFor(e, false), verb: friendlyLabel("seat", { workstation: seat.workstation }), anchor: seat.approach };
  if (lounge && lounge.slots.length) return { kind: "lounge", title: titleFor(e, false), verb: friendlyLabel("lounge"), anchor: lounge.slots[0].approach };
  if (approach) return { kind: "approach", title: titleFor(e, elevatorCall), verb: friendlyLabel("approach", approach), anchor: approach.point };
  return null;
}

/** THE MENU for one entity: its own verb first, and a plain walk to it second. An occupied seat offers only the
 *  walk, and says why. */
export function objectSelectionFor(e: Entity, ctx: { elevatorCall?: boolean; occupied?: boolean } = {}): Vo3dObjectSelection | null {
  const d = describeInteractable(e, ctx);
  if (!d) return null;
  const actions: Vo3dObjectAction[] = [];
  if (!ctx.occupied) actions.push({ key: "primary", label: d.verb });
  actions.push({ key: "walk", label: "Walk over" });
  return { id: e.id, title: d.title, ...(ctx.occupied ? { subtitle: "Occupied" } : {}), actions };
}
