import { useEffect, useSyncExternalStore } from "react";
import { setAutoCondition } from "../presence/selfStatusStore";
import { subscribeDelegationEnded, subscribeToucanChannelConnected } from "./delegationClient";
import { toucanService } from "./index";
import type { ToucanDelegation } from "./types";

// AWAY MODE V1 — "Toucan is handling my messages" shown as Away, for the viewer and their coworkers.
//
// ONE AUTHORITY. Whether Toucan may answer for somebody is decided only by the server's delegation
// row (GET /toucan/delegation), re-checked on every automatic reply. This module MIRRORS that row
// into the self-status store's `delegated` auto condition so the effective status reads AWAY while
// it is active — it never grants, extends or starts anything, and a client that is wrong here can
// only show the wrong pill, never send a message.
//
// NOTHING IS OVERWRITTEN. `delegated` is an auto condition beside idle-Away, so the person's own
// manual status stays exactly as chosen underneath and reappears the moment the delegation ends;
// DND, calls, meetings and Offline keep their precedence (status.ts resolveCurrentStatus).
//
// KEPT IN STEP by: the initial fetch on mount, the owner-only `delegation_ended` event, every
// (re)connect of the Toucan channel, a timer at the row's own expiry, and a localStorage ping
// between this viewer's tabs when one of them starts or ends it.

const TAB_PING_KEY = "toucan:away-mode:changed";

let active: ToucanDelegation | null = null;
// Bumped by every local change, so a fetch that started before a Stop cannot land after it and
// bring a just-ended delegation back for a moment.
let generation = 0;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let mounts = 0;
let teardown: (() => void) | null = null;
const listeners = new Set<() => void>();

function isLive(delegation: ToucanDelegation | null, nowMs = Date.now()): delegation is ToucanDelegation {
  if (!delegation || delegation.status !== "active") return false;
  const ends = delegation.expiresAt ? Date.parse(delegation.expiresAt) : NaN;
  return !Number.isFinite(ends) || ends > nowMs;
}

function apply(next: ToucanDelegation | null): void {
  active = isLive(next) ? next : null;
  setAutoCondition("delegated", active !== null);
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const ends = active?.expiresAt ? Date.parse(active.expiresAt) : NaN;
  if (Number.isFinite(ends)) {
    // Ask the server once the row is due; its own lazy expiry answers null. Capped so a far-off
    // expiry never overflows the timer.
    expiryTimer = setTimeout(() => void refreshAwayMode(), Math.min(Math.max(0, ends - Date.now()) + 1_000, 2 ** 30));
  }
  for (const listener of listeners) listener();
}

function pingOtherTabs(): void {
  try {
    window.localStorage.setItem(TAB_PING_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: other tabs catch up on their next reconnect or refresh.
  }
}

/** The panel's confirmed start / Stop / "I'm back" result, applied at once rather than waiting for a
 *  round trip. Other tabs of the same viewer are told to refetch. */
export function setAwayModeDelegation(next: ToucanDelegation | null): void {
  generation += 1;
  apply(next);
  pingOtherTabs();
}

/** Re-read the server's answer. A failed read keeps the current state rather than guessing. */
export async function refreshAwayMode(): Promise<void> {
  const mine = ++generation;
  try {
    const next = await toucanService.getDelegation();
    if (mine === generation) apply(next);
  } catch {
    // Signed out, offline or mock without a server: leave the mirror as it is.
  }
}

function start(): () => void {
  void refreshAwayMode();
  const offEnded = subscribeDelegationEnded((event) => {
    if (event.delegationId && active && event.delegationId !== active.id) return;
    generation += 1;
    apply(null);
  });
  const offConnected = subscribeToucanChannelConnected(() => void refreshAwayMode());
  const onStorage = (event: StorageEvent) => {
    if (event.key === TAB_PING_KEY) void refreshAwayMode();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    offEnded();
    offConnected();
    window.removeEventListener("storage", onStorage);
  };
}

/** Mount once per office host (V1 OfficeMap, V2 overlay). Reference-counted, so both mounting at
 *  once shares one subscription; the last unmount clears the condition it set. */
export function useAwayModeSync(): void {
  useEffect(() => {
    mounts += 1;
    if (mounts === 1) teardown = start();
    return () => {
      mounts -= 1;
      if (mounts > 0) return;
      teardown?.();
      teardown = null;
      generation += 1;
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      expiryTimer = null;
      active = null;
      setAutoCondition("delegated", false);
    };
  }, []);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The viewer's own active delegation as last confirmed by the server, or null. */
export function useAwayMode(): ToucanDelegation | null {
  return useSyncExternalStore(subscribe, () => active, () => null);
}

/** "Back around 7:00 PM" only when the person explicitly gave that time; otherwise "Until you're back". */
export function awayReturnLine(delegation: Pick<ToucanDelegation, "returnLabel">): string {
  return delegation.returnLabel ? `Back around ${delegation.returnLabel}` : "Until you're back";
}

export function resetAwayModeForTests(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  teardown?.();
  teardown = null;
  mounts = 0;
  generation = 0;
  active = null;
  listeners.clear();
  setAutoCondition("delegated", false);
}
