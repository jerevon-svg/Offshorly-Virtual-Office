// vo3d app — PHASE 7B: SPATIAL CHAT, ABOVE THE BODIES.
//
// The three world-space chat elements V1's office has always had, over V2's world:
//   • the CHAT BUBBLE — what a coworker just said in the open spatial conversation;
//   • the TYPING DOTS — that they are typing right now;
//   • the UNREAD INDICATOR — the glowing chat icon over somebody with messages waiting, which opens that
//     conversation when clicked.
//
// THE LOGIC IS V1'S, UNCHANGED. Who is typing comes from V1's chatService.onTyping through V1's own
// spatialTyping reducers; the unread state is V1's chatAttention derivation over the same conversation
// rows the dock's badge reads; the bubble text is the message V1's ConversationView already handed up.
// Nothing here stores chat state, counts anything, or talks to a backend — exactly the line V1 draws
// around these components.
//
// WHAT IS NEW IS THE ANCHORING, and it has to be: V1's TalkingBubble and ChatAttentionIndicator position
// themselves as percentages inside a scaled 2D stage, which V2 does not have. Here a real camera is asked
// where each head is (app/world.ts coworkerAnchors) and the element is placed at that point.
//
// WHY THE SIZE IS A FONT-SIZE AND NOT A `scale()`. The first version scaled each anchor with
// `transform: scale(k)` and marked it `will-change: transform`. That is the classic way to blur text: the
// element is promoted to its own compositor layer, the browser rasterises it ONCE at its layout size —
// 6px type — and the compositor then stretches that bitmap by k. Zoomed in, the pill was a magnified 6px
// image rather than text. So the scale is applied as a real FONT-SIZE on the anchor each frame, with every
// metric inside expressed in `em`; the text is laid out and rasterised at the size it is actually drawn,
// which is sharp at every zoom in every camera. The transform is left doing nothing but translation, and
// the translation is rounded to whole pixels so glyphs never straddle a device pixel either.
//
// REACT DOES NOT RUN THE FRAME LOOP. React owns WHAT is overhead — a set that changes when somebody
// starts typing or a message lands, a few times a minute. The POSITION changes every frame, for every
// body, and is written straight onto each element's style from one rAF loop through refs. Putting that in
// state would re-render this subtree sixty times a second for a room of people who are merely breathing.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import HudIcon from "../../../components/HudIcon";
import type { Vo3dWorld } from "./world";
import type { Vo3dScreenAnchor } from "./interactions";
import {
  getExperiencePreferences,
  subscribeExperience,
} from "../../../services/settings/experiencePreferences";
import styles from "./Vo3dOverheads.module.css";

/** What is drawn over one person.
 *
 *  EXACTLY ONE of bubble / dots / name-and-status, by V1's own priority — sentText > typing > status. The
 *  nameplate is REPLACED by chat, not stacked under it: V1 states this as StatusLabel and TalkingBubble
 *  being mutually exclusive, which is also why neither needs its own clearance tier.
 *
 *  The unread indicator is the one ADDITIVE pass, sitting above whichever of the three is showing — the
 *  stacking rule chatAttention.ts describes, and the reason its clearance varies by what is underneath. */
export interface Vo3dOverhead {
  email: string;
  displayName: string;
  /** The message this person just sent in the open spatial conversation, if it has not expired. */
  sentText?: string;
  /** They are typing, in any conversation — V1's `deriveAnyTypingCharacterIds` semantics. */
  typing?: boolean;
  /** Unread messages waiting FROM this person, and the conversation to open. V1's ChatAttention. */
  unread?: { conversationId: string; count: number };
  /** Their presence, as V1's StatusLabel shows it: the dot's colour, the short name, and a detail label
   *  for the statuses V1 spells out (ACTIVE_DETAIL_STATUSES). Absent when V1 has no status for them, in
   *  which case they get no pill — V1 renders none either. */
  status?: { color: string; shortName: string; detail?: string };
}

/** The reserved key for the viewer's own row. It is not an email on purpose: self has no coworker body
 *  and no `coworkerAnchor`, and keying it off the signed-in address would make it look like one. */
export const SELF_OVERHEAD_KEY = "__self__";

export interface Vo3dOverheadsProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** Everybody's overhead. The viewer's own row, when present, carries `email === SELF_OVERHEAD_KEY` and
   *  is anchored to their own avatar rather than to a coworker body. */
  overheads: readonly Vo3dOverhead[];
  /** Opening the conversation an unread indicator points at — the caller's EXISTING opener, never a new
   *  chat path. Marking-as-read is left entirely to the panel that opens, which is what makes the
   *  indicator disappear (V1's rule). */
  onOpenConversation: (email: string, conversationId: string) => void;
}

/** THE PILL'S TYPE SIZE IN WORLD UNITS — V1's 6px, in a frame where a character is ~37 units tall, which
 *  is also V2's body height. Multiplied by the anchor's measured pixels-per-world-unit to get the real
 *  font-size, so everything below it in `em` follows. */
const BASE_FONT_UNITS = 6;
/** Never let the type collapse to an unreadable smear when the camera is all the way out, and never let it
 *  swell past a sensible nameplate up close. V1's stage has the same practical bounds via its zoom limits. */
const MIN_FONT_PX = 7;
const MAX_FONT_PX = 22;
/** World units of clearance above the head for the bubble/dots row — V1's own head gap, in world space so
 *  it scales with the body exactly as the nameplate does. */
const HEAD_GAP = 4;
/** THE UNREAD INDICATOR'S SIZE, in the same `em` the pills are built from — so it rides the anchor's
 *  measured camera scale exactly as the nameplate does, with no second scaling system.
 *
 *  It is passed to HudIcon as its `size`, and that is load-bearing: HudIcon writes width/height as an
 *  INLINE style, which beats any stylesheet rule. Passing a px value there (as this did) pinned the icon
 *  to a fixed on-screen size at every zoom — small beside the pill up close, and floating far too large
 *  when the camera pulled back. An `em` keeps it proportional to the name pill at every distance.
 *
 *  2.15em against the pill's ~1.74em box: the attention element reads slightly heavier than the quiet
 *  nameplate beneath it, which is the hierarchy V1's own indicator has. */
const UNREAD_ICON_EM = "2.15em";

/** Extra world units the unread indicator sits above whatever is already overhead. Mirrors V1's
 *  OVERHEAD_CLEARANCE_PX ordering: a taller element underneath pushes the badge further up. */
const CLEARANCE = { sentText: 13, typing: 8, status: 7, none: 2 };

export function Vo3dOverheads({ worldRef, ready, overheads: incoming, onOpenConversation }: Vo3dOverheadsProps) {
  // SETTINGS -> INTERFACE, applied here and only here. Two switches, and each one removes ELEMENTS from
  // the rows below rather than changing any of them: the nameplate, the bubble, the dots and the badge
  // are exactly the approved designs, they are simply not drawn for somebody who asked for a clear view.
  // Filtering the data (rather than hiding with CSS) is deliberate — a hidden unread badge is still a
  // focusable button, and an overhead with nothing left in it should not occupy an anchor at all.
  const prefs = useSyncExternalStore(subscribeExperience, getExperiencePreferences, getExperiencePreferences);
  const overheads = useMemo(() => {
    if (prefs.nameplates && prefs.worldChatIndicators) return incoming;
    const kept: Vo3dOverhead[] = [];
    for (const o of incoming) {
      const next: Vo3dOverhead = { email: o.email, displayName: o.displayName };
      if (prefs.nameplates) next.status = o.status;
      if (prefs.worldChatIndicators) {
        next.sentText = o.sentText;
        next.typing = o.typing;
        next.unread = o.unread;
      }
      if (next.status || next.sentText || next.typing || next.unread) kept.push(next);
    }
    return kept;
  }, [incoming, prefs.nameplates, prefs.worldChatIndicators]);

  const nodes = useRef(new Map<string, HTMLDivElement | null>());
  const emails = useMemo(() => overheads.map((o) => o.email), [overheads]);
  // Read by the frame loop without re-subscribing it every time the set changes.
  const emailsRef = useRef(emails);
  emailsRef.current = emails;

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const list = emailsRef.current;
      if (list.length === 0) return;
      const peers = list.filter((e) => e !== SELF_OVERHEAD_KEY);
      const anchors: Record<string, Vo3dScreenAnchor | null> = world.coworkerAnchors(peers);
      if (peers.length !== list.length) anchors[SELF_OVERHEAD_KEY] = world.selfAnchor();
      for (const email of list) {
        const node = nodes.current.get(email);
        if (!node) continue;
        const a = anchors[email];
        if (!a || !a.visible) {
          // Hidden rather than unmounted: a body walking behind the camera for a moment must not
          // destroy and rebuild its bubble (and restart its entrance animation) on the way back.
          node.style.visibility = "hidden";
          continue;
        }
        node.style.visibility = "visible";
        // WHOLE PIXELS: a fractional translate leaves glyphs straddling device pixels, which reads as
        // softness even without a compositor layer involved.
        const x = Math.round(a.clientX);
        const y = Math.round(a.clientY);
        node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        // THE SIZE. A real font-size, not a scale — see the header.
        const px = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, BASE_FONT_UNITS * a.scale));
        node.style.fontSize = `${px.toFixed(2)}px`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, worldRef]);

  return (
    <div className={styles.layer} data-testid="vo3d-overheads">
      {overheads.map((o) => {
        // V1's priority, and the whole of it: what they just said, else that they are typing, else who
        // they are. Never two of them at once.
        const kind = o.sentText ? "sentText" : o.typing ? "typing" : o.status ? "status" : "none";
        return (
          <div
            key={o.email}
            ref={(el) => {
              nodes.current.set(o.email, el);
            }}
            className={styles.anchor}
            // Hidden until the first frame places it — otherwise it flashes at the top-left corner.
            style={{ visibility: "hidden" }}
            data-testid={`overhead-${o.email}`}
          >
            <div className={styles.stack} style={{ paddingBottom: `${HEAD_GAP / BASE_FONT_UNITS}em` }}>
              {o.unread && (
                <button
                  type="button"
                  className={styles.unread}
                  style={{ marginBottom: `${CLEARANCE[kind] / BASE_FONT_UNITS}em` }}
                  aria-label={`${o.unread.count} unread ${o.unread.count === 1 ? "message" : "messages"} from ${o.displayName}`}
                  data-testid={`overhead-unread-${o.email}`}
                  onClick={() => onOpenConversation(o.email, o.unread!.conversationId)}
                >
                  <span className={styles.unreadIcon} aria-hidden="true">
                    <HudIcon name="chat" size={UNREAD_ICON_EM} />
                  </span>
                  <span className={styles.unreadCount} aria-hidden="true">
                    {o.unread.count > 9 ? "9+" : o.unread.count}
                  </span>
                </button>
              )}
              {o.sentText ? (
                <div className={styles.bubbleText} data-testid={`overhead-text-${o.email}`}>
                  {o.sentText}
                </div>
              ) : o.typing ? (
                <div className={styles.bubble} data-testid={`overhead-typing-${o.email}`} aria-label={`${o.displayName} is typing`}>
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                </div>
              ) : o.status ? (
                <div className={styles.pill} data-testid={`overhead-status-${o.email}`}>
                  <span className={styles.statusDot} style={{ backgroundColor: o.status.color }} />
                  <span className={styles.pillText}>
                    {o.status.shortName}
                    {o.status.detail ? ` · ${o.status.detail}` : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Vo3dOverheads;
