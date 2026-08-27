import { useSyncExternalStore } from "react";
import {
  fetchHubItems,
  dismissHubItem,
  acknowledgeHubItem,
  actOnHubItem,
  type HubItem,
} from "./hubClient";

// Module-level store for the Company Hub overlay — mirrors selfStatusStore.ts's
// useSyncExternalStore pattern for consistency with the rest of the presence/chat-adjacent
// system. Two callers open it: the check-in flow (mode "checkin", gates "Enter Office") and the
// standalone Hub button (mode "manual", reopenable anytime).

export type CompanyHubOpenMode = "checkin" | "manual";

interface CompanyHubSnapshot {
  isOpen: boolean;
  mode: CompanyHubOpenMode;
  items: HubItem[];
  loading: boolean;
  error: string | null;
}

let isOpen = false;
let mode: CompanyHubOpenMode = "manual";
let items: HubItem[] = [];
let loading = false;
let error: string | null = null;

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let cachedSnapshot: CompanyHubSnapshot = { isOpen, mode, items, loading, error };
function rebuildSnapshot(): void {
  cachedSnapshot = { isOpen, mode, items, loading, error };
}
function getSnapshot(): CompanyHubSnapshot {
  return cachedSnapshot;
}

async function loadItems(): Promise<void> {
  loading = true;
  error = null;
  rebuildSnapshot();
  notify();
  try {
    items = await fetchHubItems();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load Company Hub.";
  } finally {
    loading = false;
    rebuildSnapshot();
    notify();
  }
}

/** Opens the Hub overlay and (re)fetches the active feed. Safe to call every time the check-in
 * flow completes or the Hub button is clicked — always reflects current state, never a stale
 * cached list from a prior session. */
export function openCompanyHub(openMode: CompanyHubOpenMode = "manual"): void {
  isOpen = true;
  mode = openMode;
  rebuildSnapshot();
  notify();
  void loadItems();
}

/** Callers are responsible for only invoking this once hasBlockingRequiredItems() is false —
 * the Hub component itself disables its primary button on that condition (see
 * CompanyHub.tsx), so this function does not re-check it. */
export function closeCompanyHub(): void {
  isOpen = false;
  rebuildSnapshot();
  notify();
}

function replaceItem(updated: HubItem): void {
  items = items.map((i) => (i.id === updated.id ? updated : i));
  rebuildSnapshot();
  notify();
}

export async function dismissItem(id: string): Promise<void> {
  const updated = await dismissHubItem(id);
  replaceItem(updated);
}

export async function acknowledgeItem(id: string): Promise<void> {
  const updated = await acknowledgeHubItem(id);
  replaceItem(updated);
}

export async function actOnItem(id: string): Promise<void> {
  const updated = await actOnHubItem(id);
  replaceItem(updated);
}

export function hasBlockingRequiredItems(snapshotItems: HubItem[] = items): boolean {
  return snapshotItems.some((i) => i.priority === "required" && i.myStatus !== "acknowledged");
}

export function useCompanyHub(): CompanyHubSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-React accessor for tests — mirrors selfStatusStore.ts's getSelfStatusSnapshot(). */
export function getCompanyHubSnapshot(): CompanyHubSnapshot {
  return getSnapshot();
}

// Test-only: module state outlives a single test.
export function resetCompanyHubForTests(): void {
  isOpen = false;
  mode = "manual";
  items = [];
  loading = false;
  error = null;
  rebuildSnapshot();
  notify();
}
