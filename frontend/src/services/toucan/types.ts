// Shared Toucan assistant types. Framework-agnostic (no React) so the Mock/Real
// implementations and the assistant panel can share them — same convention as
// services/zoho/types.ts and services/office/types.ts.

export type ToucanTurnRole = "user" | "toucan";

/** One turn of bounded conversation history sent alongside a question. Mirrors
 *  backend/app/schemas/toucan.py's ToucanTurnIn. */
export interface ToucanTurn {
  role: ToucanTurnRole;
  text: string;
}

export interface ToucanAskRequest {
  question: string;
  /** Most recent turns first-to-last, already trimmed to TOUCAN_HISTORY_TURNS by
   *  the caller. The backend re-validates the bound — never trust these limits
   *  to have been applied client-side. */
  history: ToucanTurn[];
  /** Which persisted conversation to append this exchange to. Omitted/null means
   *  "start a new one", which is the path the very first question ever asked
   *  takes. Opaque and server-issued — supplying one only ever selects among
   *  conversations the signed-in viewer already owns. */
  conversationId?: string | null;
}

/** T8 — one PROPOSED (not executed) action riding along on an answer. Mirrors
 *  backend/app/schemas/toucan.py's ToucanActionProposalOut. Receiving one changes
 *  NOTHING: it only carries the server-minted id the explicit Confirm/Cancel
 *  buttons target, plus the server-worded exact effect to show. */
export type ToucanActionKind = "set_status" | "send_message";

export interface ToucanActionProposal {
  id: string;
  /** The action allowlist: T8's set_status plus A1's send_message. */
  action: ToucanActionKind;
  /** set_status: one of the manual statuses (AVAILABLE | BUSY | BREAK | LUNCH | DND). */
  status?: string | null;
  /** set_status: present only for DND — already validated/clamped server-side. */
  dndMinutes?: number | null;
  /** send_message: the SERVER-resolved recipient. The client never names one. */
  recipientEmail?: string | null;
  recipientLabel?: string | null;
  /** send_message: the exact outgoing text — shown verbatim on the card before Confirm. */
  message?: string | null;
  /** The exact effect, as the confirmation card must show it. */
  summary: string;
  expiresAt: string;
}

/** The outcome of confirming or cancelling one pending action. Echoes the frozen
 *  server-side args so the client applies exactly what was confirmed — never a
 *  locally cached copy that could have drifted. */
export interface ToucanActionResult {
  id: string;
  outcome: "executed" | "cancelled";
  action: ToucanActionKind;
  status?: string | null;
  dndMinutes?: number | null;
  recipientEmail?: string | null;
  recipientLabel?: string | null;
  message?: string | null;
  /** send_message, executed only: where the message landed. */
  conversationId?: string | null;
  messageId?: string | null;
  summary: string;
  /** The assistant's outcome line — also persisted into the transcript server-side. */
  text: string;
}

export interface ToucanAnswer {
  /** The one and only string shown in the assistant panel. */
  text: string;
  /** Resolved intent id, or "unsupported". Not rendered; useful for tests. */
  intent: string;
  supported: boolean;
  /** The conversation this exchange was persisted into — the one that was sent,
   *  or the freshly created one. Always present, so the panel never has to guess
   *  which conversation it is in after its first question. */
  conversationId: string;
  /** T8, optional and backward-compatible: a pending action proposal awaiting the
   *  viewer's explicit confirmation. Absent on every ordinary answer. */
  action?: ToucanActionProposal | null;
}

/** Stored role vocabulary, which differs from the wire history's `ToucanTurnRole`
 *  on purpose: the backend persists "assistant", the panel renders "toucan". The
 *  mapping happens in one place (see `turnRoleFromStored` below). */
export type ToucanStoredRole = "user" | "assistant";

/** One persisted turn. Mirrors backend/app/schemas/toucan.py's ToucanMessageOut. */
export interface ToucanStoredMessage {
  id: string;
  role: ToucanStoredRole;
  content: string;
  createdAt: string;
}

/** Conversation metadata. Note the absence of an owner field — the viewer already
 *  knows who they are, and every conversation they can reach is theirs. */
export interface ToucanConversation {
  id: string;
  /** Derived server-side from the viewer's own first question; null while empty. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToucanConversationDetail extends ToucanConversation {
  /** Oldest turn first, capped server-side — a very long conversation returns its
   *  most recent turns, never everything. */
  messages: ToucanStoredMessage[];
}

/** T4 — one explicitly saved memory, as the management surface shows it. Mirrors
 *  backend/app/schemas/toucan.py's ToucanMemoryOut.
 *
 *  Note what the wire shape does NOT carry, by construction rather than by the
 *  client choosing not to read it: no owner_email (everything the caller can
 *  list is theirs), no resource locator, no retrieval scores, no raw metadata.
 *  `id` exists only as the address DELETE needs — the panel never displays it. */
export interface ToucanMemory {
  id: string;
  /** "fact" or "note" — the label the user chose when saving it. */
  kind: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** Thrown when a memory id no longer resolves for this viewer — already
 *  forgotten, or never theirs. Same deliberate ambiguity the backend keeps. */
export class ToucanMemoryGoneError extends Error {
  constructor(memoryId: string) {
    super(`Toucan memory ${memoryId} is no longer available`);
    this.name = "ToucanMemoryGoneError";
  }
}

export function turnRoleFromStored(role: ToucanStoredRole): ToucanTurnRole {
  return role === "assistant" ? "toucan" : "user";
}

/** Thrown when a conversation id no longer resolves for this viewer — deleted, or
 *  never theirs. The panel treats it as "start a fresh conversation", NOT as a
 *  request failure, so a stale id in a long-open tab self-heals. */
export class ToucanConversationGoneError extends Error {
  constructor(conversationId: string) {
    super(`Toucan conversation ${conversationId} is no longer available`);
    this.name = "ToucanConversationGoneError";
  }
}

/** Thrown when a pending action id no longer resolves — expired, already
 *  confirmed/cancelled, or never this viewer's. The backend deliberately answers
 *  all of those identically, and the panel words them all as "that one's gone,
 *  ask again" rather than as a request failure. */
export class ToucanActionUnavailableError extends Error {
  constructor(actionId: string) {
    super(`Toucan action ${actionId} is no longer available`);
    this.name = "ToucanActionUnavailableError";
  }
}

/** T10 — ONE attachment a viewer has staged on the composer, before anything is
 *  uploaded, stored or sent. Deliberately the smallest shape that a preview row
 *  needs and nothing more: there is no URL, no bytes, no base64, no server id,
 *  because none of those exist yet and inventing them now would freeze a
 *  contract the backend has not agreed to.
 *
 *  NOT part of ToucanAskRequest: /toucan/ask is unchanged and text-only. When
 *  real uploads land, this grows a server-issued reference and the request gains
 *  a field — both server-driven decisions, made then rather than guessed here. */
export interface ToucanDraftAttachment {
  /** Client-local, unique for this composer session only. Never sent anywhere. */
  id: string;
  /** Display name, as the preview row shows it. */
  name: string;
  /** MIME type when known, so a preview can tell an image from a document.
   *  Optional because a future picker may not always supply one. */
  mimeType?: string;
  /** Size in bytes when known — for a preview label and, later, a client-side
   *  bound check before any upload is attempted. */
  sizeBytes?: number;
}

export interface ToucanAskOptions {
  /** Aborts an in-flight question — the panel wires this to unmount/release, so
   *  a dismissed toucan never resolves into a stale reply. */
  signal?: AbortSignal;
}

export interface ToucanService {
  /** The toucan's opening line. Owned by the service rather than the panel so
   *  each mode can introduce itself honestly (the mock says it's a demo). */
  greeting(): string;
  ask(request: ToucanAskRequest, options?: ToucanAskOptions): Promise<ToucanAnswer>;
  /** The conversation the panel reopens on summon, re-summon and page refresh,
   *  transcript included, in one round trip. `null` means the viewer has never
   *  asked anything — an ordinary answer, not an error, and the panel branches on
   *  it to show the greeting instead. */
  loadLatestConversation(options?: ToucanAskOptions): Promise<ToucanConversationDetail | null>;
  /** The panel's "New conversation" action. Created eagerly rather than lazily on
   *  the next question so "latest" moves immediately — a refresh straight after
   *  pressing New must restore the NEW conversation, not reopen the previous one. */
  createConversation(options?: ToucanAskOptions): Promise<ToucanConversation>;
  /** The viewer's saved conversations, most recently used first — metadata only,
   *  so the History list stays small however long the conversations get. Fetched
   *  on demand when History is opened, never on mount. */
  listConversations(options?: ToucanAskOptions): Promise<ToucanConversation[]>;
  /** One saved conversation with its transcript, for reopening from History.
   *  Rejects with ToucanConversationGoneError if it is no longer the viewer's. */
  loadConversation(
    conversationId: string,
    options?: ToucanAskOptions,
  ): Promise<ToucanConversationDetail>;
  /** T8 — consume one pending action proposal, exactly once, by its server-minted
   *  id. Only THIS explicit call executes anything: typing "yes" into ask() never
   *  does. Rejects with ToucanActionUnavailableError when the id is expired,
   *  already handled, or not this viewer's. */
  confirmAction(actionId: string, options?: ToucanAskOptions): Promise<ToucanActionResult>;
  /** T8 — discard one pending action proposal. Nothing executes. */
  cancelAction(actionId: string, options?: ToucanAskOptions): Promise<ToucanActionResult>;
  /** T9 — delete one of the viewer's own conversations, transcript and all. A
   *  DELETE on the T1 endpoint that already existed; hard delete, matching the
   *  backend's own reasoning that a transcript holds only what the user said and
   *  what the toucan replied. Resolves when it is gone AND when it was already
   *  gone — "make this not exist" is idempotent from the caller's side. */
  deleteConversation(conversationId: string, options?: ToucanAskOptions): Promise<void>;
  /** T9 — the viewer's own explicitly saved memories, newest first, bounded
   *  server-side. A READ: listing changes nothing and creates nothing. */
  listMemories(options?: ToucanAskOptions): Promise<ToucanMemory[]>;
  /** T9 — forget one memory by id. The counterpart of the T4 "Forget that …"
   *  chat command, addressed rather than matched on content. */
  deleteMemory(memoryId: string, options?: ToucanAskOptions): Promise<void>;
}

// Kept in step with backend/app/schemas/toucan.py's MAX_HISTORY_TURNS /
// MAX_QUESTION_CHARS. The backend enforces them; these exist so the client
// trims before sending rather than eating a 422.
export const TOUCAN_HISTORY_TURNS = 10;
export const TOUCAN_MAX_QUESTION_CHARS = 2000;
