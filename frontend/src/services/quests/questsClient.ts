import { getAuthToken } from "../api/client";

// REST client for the Onboarding Questline (backend/app/routers/quests.py). Same "chat backend"
// REST base (VITE_CHAT_SOCKET_URL) and the same dev-identity bypass as hubClient.ts. Read-only:
// progress is never written from the client — every quest event is recorded server-side from
// the authoritative action (see backend/app/services/quests/engine.py's hook list).

export type QuestMode = "once" | "unique_count";

export interface Quest {
  id: string;
  title: string;
  eventType: string;
  mode: QuestMode;
  target: number;
  order: number;
  count: number;
  completed: boolean;
  completedAt: string | null;
  // Progression & Rewards: what completing pays, and whether the caller already claimed it.
  rewardXp: number;
  rewardCoins: number;
  claimed: boolean;
  claimedAt: string | null;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Onboarding Questline — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors hubClient.ts's devEmail/setDevIdentity exactly.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

/** GET /quests/me — every registered quest with the caller's own progress, already in display
 * order (the server sorts by `order`, then id). */
export async function fetchMyQuests(): Promise<Quest[]> {
  const headers = new Headers();
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${socketBase()}/quests/me`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Quests request failed (${res.status})`);
  }
  const data = (await res.json()) as { quests: Quest[] };
  return data.quests;
}

// ---- Daily/Weekly Missions (backend/app/routers/missions.py) --------------------------------
// Same base, same identity rules, same read-only contract as /quests/me: the server draws and
// pins the missions, derives periods in UTC from its own clock, and recounts progress from the
// ledger. The client only renders. `endsAt` is when the period resets.

export type MissionCadence = "daily" | "weekly";
export type MissionMode = "once" | "unique_count" | "unique_days";

export interface Mission {
  id: string;
  title: string;
  eventType: string;
  mode: MissionMode;
  target: number;
  cadence: MissionCadence;
  count: number;
  completed: boolean;
  completedAt: string | null;
  rewardXp: number;
  rewardCoins: number;
  claimed: boolean;
  claimedAt: string | null;
}

export interface MissionPeriod {
  cadence: MissionCadence;
  periodKey: string;
  startsAt: string;
  endsAt: string;
  missions: Mission[];
}

export interface MyMissions {
  serverTime: string;
  daily: MissionPeriod;
  weekly: MissionPeriod;
}

function authHeaders(): Headers {
  const headers = new Headers();
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

/** GET /missions/me — the caller's active daily + weekly missions for the current server periods. */
export async function fetchMyMissions(): Promise<MyMissions> {
  const res = await fetch(`${socketBase()}/missions/me`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Missions request failed (${res.status})`);
  }
  return (await res.json()) as MyMissions;
}

// ---- Progression & Rewards (backend/app/routers/progression.py) -----------------------------
// XP and Coins are lifetime sums over the server's claim ledger; Level is derived from XP by the
// server. Claim is server-authoritative and idempotent: a repeat claim (double-click, second tab,
// retry after reconnect) returns the same 200 with grantedNow=false and unchanged balances.

export interface Progression {
  xp: number;
  coins: number;
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
}

export interface ClaimResult {
  questId: string;
  periodKey: string;
  grantedNow: boolean;
  reward: { xp: number; coins: number };
  progression: Progression;
}

/** GET /progression/me */
export async function fetchMyProgression(): Promise<Progression> {
  const res = await fetch(`${socketBase()}/progression/me`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Progression request failed (${res.status})`);
  }
  return (await res.json()) as Progression;
}

/** POST /progression/claim — `periodKey` is "" for a permanent quest, the mission's period key otherwise. */
export async function claimReward(questId: string, periodKey = ""): Promise<ClaimResult> {
  const headers = authHeaders();
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${socketBase()}/progression/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ questId, periodKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Claim failed (${res.status})`);
  }
  return (await res.json()) as ClaimResult;
}

// ---- Badge Progression (backend/app/routers/badges.py) --------------------------------------
// Permanent tiered achievements (0 none, 1 bronze, 2 silver, 3 gold, 4 platinum) computed by the
// server from the same ledger quests and missions use. No claim, no XP/Coins: tiers are awarded
// server-side the moment a threshold is crossed. Read-only here.

export type BadgeTier = 0 | 1 | 2 | 3 | 4;
export type BadgeTierName = "none" | "bronze" | "silver" | "gold" | "platinum";

export type BadgeCategory = "engagement" | "social" | "contribution" | "growth";

export interface TierReward {
  xp: number;
  coins: number;
}

export interface Badge {
  id: string;
  title: string;
  description: string;
  category: BadgeCategory;
  /** Stable artwork key — see data/badgeEmblems.ts. */
  emblem: string;
  metricKind: string;
  metric: number;
  tier: BadgeTier;
  tierName: BadgeTierName;
  thresholds: number[];
  /** Null at Platinum. */
  nextThreshold: number | null;
  /** Index 0..3 = bronze..platinum; null where not yet awarded. */
  tiersAwardedAt: (string | null)[];
  /** Index 0..3; when that tier's XP/Coins bonus was claimed (null = unclaimed). */
  tiersClaimedAt: (string | null)[];
  /** Index 0..3; the one-time bonus each tier pays, server-defined. */
  tierRewards: TierReward[];
}

/** Period key for claiming a badge tier's bonus through POST /progression/claim. */
export function badgeTierPeriodKey(tier: number): string {
  return `t:${tier}`;
}

/** GET /badges/me */
export async function fetchMyBadges(): Promise<Badge[]> {
  const res = await fetch(`${socketBase()}/badges/me`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Badges request failed (${res.status})`);
  }
  return ((await res.json()) as { badges: Badge[] }).badges;
}

// ---- Reward Redemption (backend/app/routers/rewards.py) --------------------------------------
// Spend Coins on a code-defined demo catalog. Server-authoritative and idempotent: the client
// generates one idempotency key per Redeem press, so a double-click or retry replays the same
// redemption (createdNow=false) instead of spending twice. Every Coin movement is a row in the
// same reward ledger the HUD sums, so the response's `progression` is the new truth.

export type RedemptionStatus = "pending" | "approved" | "fulfilled" | "rejected" | "cancelled";

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  cost: number;
  category: "voucher" | "perk" | "time_off" | "custom";
  requiresApproval: boolean;
  affordable: boolean;
}

export interface Redemption {
  id: string;
  itemId: string;
  title: string;
  cost: number;
  status: RedemptionStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface RewardCatalog {
  items: CatalogItem[];
  progression: Progression;
}

export interface RedeemResult {
  redemption: Redemption;
  createdNow: boolean;
  progression: Progression;
}

export interface RedemptionActionResult {
  redemption: Redemption;
  progression: Progression;
}

/** 8-30 chars of [A-Za-z0-9_-], generated once per Redeem press. */
export function newIdempotencyKey(): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return raw.slice(0, 24);
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `${what} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function jsonHeaders(): Headers {
  const headers = authHeaders();
  headers.set("Content-Type", "application/json");
  return headers;
}

/** GET /rewards/catalog */
export async function fetchRewardCatalog(): Promise<RewardCatalog> {
  return readJson(await fetch(`${socketBase()}/rewards/catalog`, { headers: authHeaders() }), "Rewards request");
}

/** POST /rewards/redeem */
export async function redeemReward(itemId: string, idempotencyKey: string): Promise<RedeemResult> {
  const res = await fetch(`${socketBase()}/rewards/redeem`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ itemId, idempotencyKey }),
  });
  return readJson(res, "Redeem");
}

/** GET /rewards/redemptions/me */
export async function fetchMyRedemptions(): Promise<Redemption[]> {
  const data = await readJson<{ redemptions: Redemption[] }>(
    await fetch(`${socketBase()}/rewards/redemptions/me`, { headers: authHeaders() }),
    "Redemptions request",
  );
  return data.redemptions;
}

/** POST /rewards/redemptions/{id}/cancel — pending only. */
export async function cancelRedemption(id: string): Promise<RedemptionActionResult> {
  const res = await fetch(`${socketBase()}/rewards/redemptions/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
  return readJson(res, "Cancel");
}
