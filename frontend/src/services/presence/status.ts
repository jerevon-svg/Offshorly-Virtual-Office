// Office presence status: the local, richer 9-value palette layered on top
// of Atlas's 5-value PresenceStatusValue (see office/types.ts). Self's
// status is computed client-side (see selfStatusStore.ts); peers' status is
// derived from the Atlas feed via mapAtlasToOfficeStatus below. No backend
// writes, no new endpoints — v1 is client-side-only for self (see the
// confirmed plan).

import type { PresenceStatusValue } from "../office/types";

export type OfficeStatus =
  | "AVAILABLE"
  | "BUSY"
  | "AWAY"
  | "BREAK"
  | "LUNCH"
  | "IN_CONVERSATION"
  | "IN_CALL"
  | "DND"
  | "OFFLINE";

export interface StatusMeta {
  label: string;
  color: string;
  emoji: string;
  /** "manual" = user-settable via StatusPicker. "auto" = system-derived,
   *  never offered as a manual picker option. */
  kind: "manual" | "auto";
}

export const STATUS_META: Record<OfficeStatus, StatusMeta> = {
  AVAILABLE: { label: "Available", color: "#22C55E", emoji: "🟢", kind: "manual" },
  BUSY: { label: "Busy", color: "#F59E0B", emoji: "🟠", kind: "manual" },
  AWAY: { label: "Away", color: "#EAB308", emoji: "🟡", kind: "auto" },
  BREAK: { label: "Break", color: "#14B8A6", emoji: "🩵", kind: "manual" },
  LUNCH: { label: "Lunch", color: "#D97706", emoji: "🟤", kind: "manual" },
  IN_CONVERSATION: { label: "In Conversation", color: "#3B82F6", emoji: "🔵", kind: "auto" },
  IN_CALL: { label: "In Call", color: "#8B5CF6", emoji: "🟣", kind: "auto" },
  DND: { label: "DND", color: "#EF4444", emoji: "🔴", kind: "manual" },
  OFFLINE: { label: "Offline", color: "#6B7280", emoji: "⚫", kind: "auto" },
};

// The 5 statuses a person can pick for themselves via StatusPicker. Order
// matches the confirmed spec.
export const MANUAL_STATUSES: OfficeStatus[] = ["AVAILABLE", "BUSY", "BREAK", "LUNCH", "DND"];

export function isManualStatus(value: OfficeStatus): boolean {
  return MANUAL_STATUSES.includes(value);
}

// Statuses whose floating name tag gets a " · Label" suffix (see
// StatusLabel.tsx). All other statuses show just "{emoji} {name}".
export const ACTIVE_DETAIL_STATUSES: Set<OfficeStatus> = new Set([
  "IN_CONVERSATION",
  "IN_CALL",
  "DND",
]);

// Atlas's 5-value feed -> our 9-value palette, for PEERS only (read-only,
// no write-back). Confirmed mapping:
//   ONLINE -> AVAILABLE, AWAY -> AWAY, IN_MEETING -> IN_CALL,
//   ON_LEAVE -> BREAK, OFFLINE -> OFFLINE.
export function mapAtlasToOfficeStatus(atlas: PresenceStatusValue): OfficeStatus {
  switch (atlas) {
    case "ONLINE":
      return "AVAILABLE";
    case "AWAY":
      return "AWAY";
    case "IN_MEETING":
      return "IN_CALL";
    case "ON_LEAVE":
      return "BREAK";
    case "OFFLINE":
      return "OFFLINE";
    default:
      return "OFFLINE";
  }
}

export interface AutoConditions {
  away: boolean;
  inConversation: boolean;
  inCall: boolean;
  offline: boolean;
}

// Precedence (highest to lowest):
//   OFFLINE > DND (manual short-circuit) > IN_CALL > IN_CONVERSATION > AWAY > manualStatus
//
// Offline always wins over everything (hard disconnect/checkout). DND is a
// deliberate manual choice and suppresses automatic overrides (Away, In
// Conversation, In Call) — checked right after Offline, before any auto
// condition is applied. Otherwise the auto conditions apply in the stated
// order, falling back to the raw manualStatus when none apply.
export function resolveCurrentStatus(
  manualStatus: OfficeStatus,
  autoConditions: AutoConditions,
): OfficeStatus {
  if (autoConditions.offline) return "OFFLINE";
  if (manualStatus === "DND") return "DND";
  if (autoConditions.inCall) return "IN_CALL";
  if (autoConditions.inConversation) return "IN_CONVERSATION";
  if (autoConditions.away) return "AWAY";
  return manualStatus;
}

// Overtime limits for the manual statuses that represent a bounded break
// away from work. Only BREAK/LUNCH carry a limit — all other statuses are
// unbounded (no entry). See useStatusOvertime.ts for the consumer.
export const STATUS_TIME_LIMITS_MS: Partial<Record<OfficeStatus, number>> = {
  BREAK: 15 * 60_000,
  LUNCH: 60 * 60_000,
};

export function getStatusTimeLimitMs(status: OfficeStatus): number | undefined {
  return STATUS_TIME_LIMITS_MS[status];
}
