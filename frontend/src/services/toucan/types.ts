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
}

export interface ToucanAnswer {
  /** The one and only string shown in the assistant panel. */
  text: string;
  /** Resolved intent id, or "unsupported". Not rendered; useful for tests. */
  intent: string;
  supported: boolean;
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
}

// Kept in step with backend/app/schemas/toucan.py's MAX_HISTORY_TURNS /
// MAX_QUESTION_CHARS. The backend enforces them; these exist so the client
// trims before sending rather than eating a 422.
export const TOUCAN_HISTORY_TURNS = 10;
export const TOUCAN_MAX_QUESTION_CHARS = 2000;
