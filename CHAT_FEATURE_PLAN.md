# Chat Feature — Implementation Plan

Handoff plan for a real-time-feeling chat feature in the Virtual Office app. Written to
stand alone for a fresh Claude Code session with no memory of the planning conversation
that produced it. Give this file to `master` to confirm/refine, then `worker` to build,
phase by phase — same plan → implement → review loop as the rest of this project.

## The feature, in two parts

1. **A persistent chat history / conversation view** — a normal messaging interface
   (think Messenger / Zoho Cliq / Slack): open a conversation with someone, see message
   history, scroll back, send new messages.
2. **A live in-scene visual indicator** — while two characters are actively chatting,
   a speech-bubble graphic pops up above each character's head in the office map, as a
   purely visual "they're talking" cue. No avatar thumbnail in this bubble. Ephemeral —
   not part of the permanent history.

## Context a fresh session needs

App = pure **Vite + React 19** frontend at `app/`. **No backend, no realtime** —
confirmed via repo grep (`websocket|WebSocket|EventSource|fetch(|firebase|supabase|/api/|pusher|ably`
→ zero hits in `src`, non-test). The only persistence today is `localStorage`.

### What already exists and should be reused

- **The ephemeral-bubble-over-head mechanism is ~90% built already**, as the existing
  "greeting" system:
  - `app/src/components/OfficeMap/GreetingBubble.tsx` — speech bubble, `<KeepScale>`
    keeps it a constant size under zoom, positioned via `greetingAnchor(layer)`.
  - `app/src/components/OfficeMap/panMath.ts` (`greetingAnchor()`, ~line 30) — returns
    left/top percentages placing a bubble above a character's head. Has test coverage
    in `panMath.test.ts`.
  - `app/src/components/OfficeMap/GreetingBubble.module.css` — bubble + tail + pop-in
    keyframe animation.
  - `app/src/components/OfficeMap/OfficeStage.tsx` (~line 172) renders `<GreetingBubble>`
    keyed off a `greetingCharacterId` prop.
  - `app/src/components/OfficeMap/OfficeMap.tsx` — `greeting` state
    (`{characterId, nonce, text}`), `greetTimerRef`, `greetNonceRef`,
    `playGreetingBeats()` (~line 366) drives timed, one-at-a-time bubbles.
  - **Limitation to work around:** the greeting system assumes exactly ONE active
    bubble, auto-dismissed by a timer. The talking indicator needs **two bubbles at
    once** (both chat participants), persisting for the whole exchange, not a one-shot
    timer. Build this as a **separate** `talking` state + separate `TalkingBubble`
    component — do not overload the existing `greeting` path, or check-in/checkout
    greeting beats will break.
- **The "Chat" menu entry already exists and is wired to a stub**:
  `CharacterActionMenu.tsx` (~line 34) has a "Chat" button →
  `OfficeMap.handleChoose('chat')` (~lines 546-550) currently just fires a
  `"Chat with {name} — coming soon"` toast. This is where the real chat UI attaches.
- **The "pat" action is the closest existing analog** for "ephemeral effect tied to a
  character": `handleChoose('pat')` (~line 504) walks the local character to the
  target, then plays a transient pat animation. Same shape the talking indicator
  should follow.
- **The service-seam pattern to copy** (this is the established blueprint for mocking
  a backend in this codebase): `app/src/services/avatar/` = `types.ts` +
  `MockAvatarService.ts` + `RealAvatarService.ts` + `index.ts`; `app/src/services/zoho/`
  uses the same shape (Mock + Mcp + index). `MockAvatarService` persists to
  `localStorage` under `offshorly.avatars`; `app/src/data/checkoutStorage.ts` shows the
  same localStorage idiom. **Chat should follow this exact pattern.**
- **Identity data already available**: `AssetLayer` has `id` + `name`;
  `formatCharacterName()` lives in `app/src/data/office-layout.ts`. The local user is
  currently hardcoded as the string `"bon"` (see `useCheckoutFlow({employeeId:"bon"})`).
  Everyone else is either a static NPC (alex/arisha/angelo + 16 more) or a saved avatar
  (id `saved-avatar-${avatarId}`, carries `nickname` + `roomId`, from
  `app/src/services/avatar/types.ts`'s `SavedAvatar`). A chat "partner" = any character
  id from either group.

### What's genuinely missing

- No message/conversation data model, no chat store, no chat UI at all today.
- No mechanism for a message to leave this one browser — every character besides the
  local "bon" is a non-interactive sprite. **Real-time chat between two actual people
  is not possible today without new backend/realtime infrastructure.**
- No real user identity/auth beyond the literal hardcoded string `"bon"`.

## Plan

Build behind a `ChatService` seam (mirrors `services/avatar`) so swapping Mock → Real
later never touches UI code. Phases 0–2 are pure frontend, buildable immediately with
no new infrastructure. Phase 3 needs infrastructure that doesn't exist yet and is
gated on a decision below — don't start it without that decision made.

**Phase 0 — data model + service seam (pure frontend)**
1. New `app/src/services/chat/types.ts`:
   `ChatMessage { id, conversationId, senderId, text, sentAt }`,
   `Conversation { id, participantIds: string[], lastMessageAt }`, and a `ChatService`
   interface: `listConversations()`, `getMessages(conversationId)`,
   `sendMessage({conversationId, senderId, text})`, `openConversationWith(peerId, selfId)`,
   plus a subscribe hook `onMessage(cb)` (so a future Real implementation can push).
2. New `app/src/services/chat/MockChatService.ts`: localStorage-backed
   (key `offshorly.chat`), same idioms as `MockAvatarService`/`checkoutStorage`.
   Deterministic conversation id derived from sorted participant ids. `sendMessage`
   appends + persists. Optionally: a short-delayed scripted/echo "reply" from the peer
   so a thread looks alive (see Decision Point 2 — must stay clearly labeled as mock).
3. New `app/src/services/chat/index.ts`: exports a singleton
   (`chatService = mockChatService`) — the one line Phase 3 flips to Real.

**Phase 1 — in-scene "talking" indicator (pure frontend, reuses the greeting mechanism)**
4. Generalize `OfficeStage` to render bubbles over MULTIPLE characters: add a prop
   `talkingCharacterIds?: string[]`, distinct from the existing single
   `greetingCharacterId`. For each id, render a lightweight bubble via the existing
   `greetingAnchor` positioning — animated (e.g. typing-dots), **no avatar thumbnail**
   (explicitly not wanted), **no auto-dismiss timer** (persists while the exchange is
   actually live).
5. New `app/src/components/OfficeMap/TalkingBubble.tsx` (+ `.module.css`) — cloned from
   `GreetingBubble` but with a looping dots animation instead of a one-shot pop. Reuse
   `<KeepScale>` + `greetingAnchor`.
6. In `OfficeMap.tsx`: add `talking` state (e.g. a `Set<characterId>` or a `{a, b}`
   pair). Populate it when a conversation becomes active between two participants;
   clear it on close or an idle timeout. Pass it to BOTH render sites — the main
   `<OfficeStage>` AND the mini-camera picture-in-picture `<OfficeStage>` (~line 700 in
   `OfficeMap.tsx` today) — the PiP renders a second time and will silently miss the
   bubble if this prop isn't passed to both.

**Phase 2 — chat history / conversation view (pure frontend, local-only)**
7. New `app/src/components/Chat/ConversationView.tsx` (+ `.module.css`): header (peer
   name via `formatCharacterName`), scrollable message list (scrollback, own-vs-peer
   alignment), composer (textarea + send button). Reads/writes through `chatService`.
8. New `app/src/components/Chat/ConversationList.tsx` — optional for this phase; a list
   of existing threads. MVP can skip this and open straight into the single
   conversation from the character action menu.
9. Rewire `OfficeMap.handleChoose('chat')` (~lines 546-550): replace the coming-soon
   toast with opening `ConversationView` for the target character (peer) vs. the local
   user (self). Add an `openChat` state in `OfficeMap`; render `<ConversationView>` as
   an overlay panel, matching the existing overlay idiom used by checkout modals /
   `RoomSidebar`. On open, populate the Phase-1 `talking` pair; on close, clear it.
10. Introduce a single `CURRENT_USER_ID = "bon"` constant (or a small `useCurrentUser`
    hook) instead of scattering the literal `"bon"` string — this is what Phase 3 will
    later swap for real identity, and centralizing it now avoids a painful find-and-fix
    later.

**Phase 3 — real cross-user delivery (REQUIRES A BACKEND — do not start without the
Decision Point below being resolved)**
11. New `app/src/services/chat/RealChatService.ts` implementing the same Phase-0
    interface against whichever realtime backend is chosen (a websocket server, or a
    hosted service like Firebase / Supabase / Ably / Pusher). Needs presence,
    server-side persistence, and message push via `onMessage`. Flip the `index.ts`
    singleton to point at it.
12. Real identity/auth to replace `CURRENT_USER_ID`. A presence feed should drive the
    Phase-1 talking indicator from real remote state ("X is chatting with Y"), not
    local-only fakery.

## Tests to add (Vitest, colocated `.test.ts`, matching existing repo convention)

- `MockChatService.test.ts` — persistence round-trip, deterministic conversation id,
  message ordering, that `sendMessage` actually appends.
- Talking-indicator state/reducer + `TalkingBubble` render — add/remove a pair,
  multi-bubble rendering (React Testing Library, mirroring the existing
  `OfficeMap.test.tsx` patterns).
- `ConversationView` — renders history correctly, send calls the service, scrollback
  ordering is correct.
- Existing `panMath.test.ts` coverage already exercises `greetingAnchor` — no new work
  needed there, just confirm the talking bubble reuses it correctly.

**Suggested build order:** 0 → 1 → 2 (each phase is independently demoable, all pure
frontend, no new infra) → **pause here for the Decision Points below** → 3 only if
genuine multi-user chat is actually chosen as the goal.

## Risks

- **Single-bubble → multi-bubble refactor risk.** The existing greeting system assumes
  one active, timer-dismissed bubble. Don't bend that system to also handle the talking
  indicator — build `talking` as a fully separate state and `TalkingBubble` as a fully
  separate component, or check-in/checkout greeting beats will likely break.
- **Bubble collision.** Two chatting characters in the same room may render bubbles
  that overlap (saved avatars are grid-spread only ~26px apart in
  `savedAvatarLayers.ts`) — may need a small anchor/offset tweak.
- **Mock realism trap.** A canned/echo NPC reply can read as "real chat working" when
  it isn't. Keep mock threads clearly labeled internally, and keep the Mock→Real swap a
  single line in `index.ts` so there's no UI rework required at Phase 3.
- **Hardcoded `"bon"` self-id.** If this literal string gets scattered across new chat
  code instead of centralized, Phase 3's real-identity work becomes much more painful
  later. Centralize it now (see step 10).
- **PiP double-render.** `OfficeStage` renders twice — once for the main view, once for
  the mini-camera picture-in-picture. Any new prop like `talkingCharacterIds` must be
  passed to both render sites or the bubble will silently vanish in the PiP view.
- **localStorage cross-tab illusion.** A `MockChatService` running in two browser tabs
  on the SAME machine could appear to sync via `storage` events — tempting to treat as
  "multi-user working," but it's same-machine only and is not real message delivery.
  Don't let this masquerade as Phase 3 being done.

## Decision Points — resolve before building Phase 3 (Phases 0–2 need none of this)

1. **Mock-first, or genuinely multi-user from day one?** This is the single biggest
   architectural fork here, bigger than any of the UI work.
   - **Recommended: mock-first** (Phases 0–2), the same pattern the avatar-generation
     feature started with (`MockAvatarService` before any real provider was wired up).
     Fully demoable in one browser: the chat history UI and the in-scene talking bubble
     both work end-to-end. Zero new infrastructure needed.
   - **Genuine multi-user** (Phase 3) needs realtime backend infrastructure that
     doesn't exist in this repo today — either a self-hosted websocket server or a
     hosted realtime service (Firebase / Supabase / Ably / Pusher) — plus real
     identity/auth, presence tracking, and server-side message persistence. This is a
     much larger scope with ongoing hosting cost, not a small add-on.
2. **If mock-first: should the other character "reply"?** Options: (a) no reply — the
   thread only stores the local user's own messages; (b) a simple canned/echo
   auto-reply so the conversation feels alive. Recommendation: (b), but clearly flagged
   internally as mock behavior, not presented as if it were a real person replying.
3. **If genuine multi-user is chosen: which backend?** A hosted service (Firebase /
   Supabase / Ably / Pusher — fastest to stand up) vs. a self-hosted websocket server.
   This depends on infra/cost preference — there's no objectively correct answer here,
   it needs a human call.

**Bottom-line recommendation:** approve and build Phases 0–2 now (pure frontend, no
infra risk, unblocks a fully working mock of both the chat history view and the
in-scene talking indicator), and defer the Phase-3 decision until after that mock has
been seen/demoed.

## Files already investigated (for a fresh session's reference)

- `app/src/components/OfficeMap/OfficeMap.tsx`
- `app/src/components/OfficeMap/OfficeStage.tsx`
- `app/src/components/OfficeMap/GreetingBubble.tsx` + `.module.css`
- `app/src/components/OfficeMap/CharacterActionMenu.tsx`
- `app/src/components/OfficeMap/panMath.ts`
- `app/src/services/avatar/{types.ts,MockAvatarService.ts,index.ts}`
- `app/src/data/{savedAvatarLayers.ts,checkoutStorage.ts,office-layout.ts}`
