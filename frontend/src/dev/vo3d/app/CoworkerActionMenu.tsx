// vo3d app — THE EMPLOYEE INTERACTION MENU (Phase 6D).
//
// A THIN WRAPPER, exactly as V1's CharacterActionMenu / ReceptionActionMenu / SeatActionMenu are thin
// wrappers: presentation and dismissal belong to the shared WorldActionMenu (components/OfficeMap), and
// this file decides only WHICH rows exist, in what order, with what label. That is not a convenience — it
// is why the V2 card is the same card. The office's premium/compact row treatment, its notch, its warm
// cream surface, its Escape-and-outside-press contract and its viewport flip are the ones already
// shipped; reimplementing them here would be a second design system pretending to be the first.
//
// THE ROWS ARE V1'S ROWS, in V1's order, dispatching V1's action strings to a handler that runs V1's own
// services (app/Vo3dHost.tsx). Nothing decorative is added and nothing is invented: a row exists here
// only when the thing behind it actually works.
import { STATUS_META, type OfficeStatus } from "../../../services/presence/status";
import {
  WorldActionMenu,
  type WorldActionMenuAnchor,
  type WorldActionMenuItem,
} from "../../../components/OfficeMap/WorldActionMenu";

/** The verbs Phase 6D carries over. Deliberately V1's own strings — the host's handler is a translation
 *  of OfficeMap.handleChoose's branches, and keeping the vocabulary identical is what makes that
 *  correspondence checkable rather than merely claimed.
 *
 *  V1's `walkDemo` / `patDemo` are NOT here, and their absence is the point: they drive V1's 2D sprite
 *  walk/pat animations (useCharacterWalk / SavedAvatarWalker) on a layer V2 has no equivalent of. A row
 *  that looked like the others and did nothing would be exactly the decorative button this phase rules
 *  out. */
export type Vo3dCoworkerAction = "chat" | "call" | "approach" | "viewProfile" | "askToJoin";

export interface CoworkerActionMenuProps {
  displayName: string;
  /** The person's CURRENT on-screen point, recomputed by the host from the live camera and the live body
   *  (app/interactions.ts Vo3dScreenAnchor) — never the point they were at when clicked. */
  anchor: WorldActionMenuAnchor;
  onChoose: (action: Vo3dCoworkerAction) => void;
  onClose: () => void;
  /** Their presence, from the SAME Atlas roster status V1's nameplates read. Omitted when unknown. */
  status?: OfficeStatus;
  /** Unread messages waiting from THIS person, from V1's own chat attention map. Badges the Chat row. */
  unreadCount?: number;
  /** True when the target is in a >=2-member spatial session the viewer is not part of (spatialSessionStore). */
  canAskToJoin?: boolean;
  /** True when the target is already in the viewer's own active call. Label only — the row still
   *  dispatches "call", into the one join path, exactly as V1's menu does. */
  targetInActiveCall?: boolean;
}

export function CoworkerActionMenu({
  displayName,
  anchor,
  onChoose,
  onClose,
  status,
  unreadCount,
  canAskToJoin,
  targetInActiveCall,
}: CoworkerActionMenuProps) {
  const items: WorldActionMenuItem[] = [
    { key: "chat", label: "Chat", onSelect: () => onChoose("chat"), badge: unreadCount },
    { key: "call", label: targetInActiveCall ? "Join call" : "Call", onSelect: () => onChoose("call") },
    { key: "approach", label: "Approach", onSelect: () => onChoose("approach") },
    { key: "viewProfile", label: "View Profile", onSelect: () => onChoose("viewProfile") },
  ];
  if (canAskToJoin) items.push({ key: "askToJoin", label: "Ask to Join", onSelect: () => onChoose("askToJoin") });
  const meta = status ? { color: STATUS_META[status].color, label: STATUS_META[status].label } : undefined;

  return (
    <WorldActionMenu
      anchor={{ ...anchor, notch: true }}
      onClose={onClose}
      ariaLabel={`Actions for ${displayName}`}
      title={displayName}
      meta={meta}
      items={items}
    />
  );
}

export default CoworkerActionMenu;
