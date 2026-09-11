import { formatCharacterName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import { STATUS_META, type OfficeStatus } from "../../services/presence/status";
import { WorldActionMenu, type WorldActionMenuAnchor, type WorldActionMenuItem } from "./WorldActionMenu";

// The employee interaction menu. Presentation and dismissal are the shared WorldActionMenu's;
// this file only decides which rows exist, in what order, with what label — and every row still
// dispatches the SAME action string to the caller's SAME handler (OfficeMap's handleChoose).

type Props = {
  layer: AssetLayer;
  /** The character's on-screen centre (OfficeMap computes it from the layer and the zoom). */
  anchor: WorldActionMenuAnchor;
  onChoose: (
    action: "chat" | "call" | "approach" | "walkDemo" | "patDemo" | "askToJoin" | "viewProfile",
  ) => void;
  onClose: () => void;
  // Demo triggers for any character with a populated sprite set — alex/micah
  // (hardcoded NPCs) plus any saved avatar (e.g. "Lui") generated via the
  // real "Add Employee" pipeline, each with its own useCharacterWalk
  // instance (see OfficeMap.tsx's savedAvatarApiRef/SavedAvatarWalker).
  // Exercises walk/pat animations independent of bon's own walk/pat
  // mechanism.
  showDemos?: boolean;
  // True when the tapped target is currently a member of a >=2-member spatial session
  // (see spatialSessionStore.ts) that the viewer is NOT already a member of — computed in
  // OfficeMap.tsx, which already consumes useSpatialSessions() for the self status flip.
  canAskToJoin?: boolean;
  // True when this target is already a participant in the active call for the viewer's CURRENT
  // spatial session (computed in OfficeMap from callStore's spatial_calls state). Label only —
  // the action it dispatches is still "call", handled by the one existing join path in
  // handleChoose. There is deliberately no second join implementation.
  targetInActiveCall?: boolean;
  /** This person's current presence, from the SAME statusByLayerId the nameplates read. Shown
   *  beside the name as context only; omitted when the caller has none for them. */
  status?: OfficeStatus;
  /** Unread messages waiting from THIS person, from the existing chatAttentionByLayerId map —
   *  the same number the world-space indicator above their head shows. Badges the Chat row. */
  unreadCount?: number;
};

export function CharacterActionMenu({
  layer,
  anchor,
  onChoose,
  onClose,
  showDemos,
  canAskToJoin,
  targetInActiveCall,
  status,
  unreadCount,
}: Props) {
  const name = formatCharacterName(layer);
  const items: WorldActionMenuItem[] = [
    { key: "chat", label: "Chat", onSelect: () => onChoose("chat"), badge: unreadCount },
    { key: "call", label: targetInActiveCall ? "Join call" : "Call", onSelect: () => onChoose("call") },
    { key: "approach", label: "Approach", onSelect: () => onChoose("approach") },
    { key: "viewProfile", label: "View Profile", onSelect: () => onChoose("viewProfile") },
  ];
  if (canAskToJoin) items.push({ key: "askToJoin", label: "Ask to Join", onSelect: () => onChoose("askToJoin") });
  if (showDemos) {
    items.push(
      { key: "walkDemo", label: "Walk demo", onSelect: () => onChoose("walkDemo") },
      { key: "patDemo", label: "Pat demo", onSelect: () => onChoose("patDemo") },
    );
  }
  const meta = status ? { color: STATUS_META[status].color, label: STATUS_META[status].label } : undefined;

  return (
    <WorldActionMenu
      anchor={{ ...anchor, notch: true }}
      onClose={onClose}
      ariaLabel={`Actions for ${name}`}
      title={name}
      meta={meta}
      items={items}
    />
  );
}

export default CharacterActionMenu;
