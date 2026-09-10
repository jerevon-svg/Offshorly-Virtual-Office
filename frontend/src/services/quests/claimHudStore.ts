import { useSyncExternalStore } from "react";

// VISIBILITY ONLY for the claim-time progression strip (see components/OfficeMap/ClaimHud.tsx).
//
// Tasks hides the bottom dock, which is where the reward particles normally land, so a claim made
// from Tasks flew its coins and XP at an off-screen target. This store decides WHEN a compact
// stand-in strip is on screen. It holds no progression numbers and no claim state of its own —
// ClaimHud reads the existing progression store, exactly as the Player HUD does.
//
// Reference-counted so Claim All stays up for the WHOLE sequential run instead of flashing once
// per item: each claim opens a session, and the strip only starts its exit once the last one has
// closed and the reward FX has had time to land.

/** Covers the FX's burst + stagger + travel (see rewardFx.ts) plus a beat to read the new total. */
const HOLD_MS = 1500;

let active = 0;
let visible = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function setVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isClaimHudVisible(): boolean {
  return visible;
}

/** A claim is starting — show the strip and keep it up. Safe to nest for Claim All. */
export function beginClaimSession(): void {
  active += 1;
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  setVisible(true);
}

/** A claim finished. The strip stays until the last one ends AND the FX has landed. */
export function endClaimSession(): void {
  active = Math.max(0, active - 1);
  if (active > 0) return;
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (active === 0) setVisible(false);
  }, HOLD_MS);
}

/** Test seam — mirrors the reset helpers the other stores expose. */
export function resetClaimHudForTests(): void {
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
  active = 0;
  visible = false;
  listeners.clear();
}

export function useClaimHudVisible(): boolean {
  return useSyncExternalStore(subscribe, isClaimHudVisible, isClaimHudVisible);
}
