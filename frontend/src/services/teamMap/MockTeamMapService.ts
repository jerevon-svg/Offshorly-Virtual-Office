import { characterLayers, formatCharacterName } from "../../data/office-layout";
import { mockEmailForAvatarId } from "../../data/avatarIdentity";
import { mockDepartmentFor } from "../office/MockOfficeService";
import type { PresenceStatusValue } from "../office/types";
import type {
  GeoFix,
  TeamMapBucket,
  TeamMapPerson,
  TeamMapService,
  TeamMapSnapshot,
  WorkingTodayShare,
} from "./types";

// Offline cast for the :5174 mock rig (VITE_OFFICE_INTEGRATION_MODE=mock). Every fixture is a
// COARSE public place — city centroids at two decimals, the same precision class the real
// backend emits — so mock mode can never model, or leak the shape of, a real address. Two people
// deliberately have no location and four sit outside the Philippines, so the PH / Elsewhere /
// No location paths are all exercised without Atlas.
//
// Working Today (V1.1) is mocked the same way the backend does it: the EXACT fix the user chose
// to share is kept (in localStorage, so it survives a refresh like the real row does, same 12h
// TTL); the nearest fixture place supplies only label / country / time zone context.

interface Fixture {
  label: string;
  country: string;
  lat: number;
  lng: number;
  tz: string;
}

const PH_PLACES: Fixture[] = [
  { label: "Manila, Philippines", country: "PH", lat: 14.6, lng: 120.98, tz: "Asia/Manila" },
  { label: "Quezon City, Philippines", country: "PH", lat: 14.68, lng: 121.04, tz: "Asia/Manila" },
  { label: "Makati, Philippines", country: "PH", lat: 14.55, lng: 121.02, tz: "Asia/Manila" },
  { label: "Pasig, Philippines", country: "PH", lat: 14.58, lng: 121.09, tz: "Asia/Manila" },
  { label: "Taguig, Philippines", country: "PH", lat: 14.52, lng: 121.05, tz: "Asia/Manila" },
  { label: "Antipolo, Philippines", country: "PH", lat: 14.59, lng: 121.18, tz: "Asia/Manila" },
  { label: "Cebu City, Philippines", country: "PH", lat: 10.32, lng: 123.89, tz: "Asia/Manila" },
  { label: "Davao City, Philippines", country: "PH", lat: 7.19, lng: 125.46, tz: "Asia/Manila" },
  { label: "Iloilo City, Philippines", country: "PH", lat: 10.72, lng: 122.56, tz: "Asia/Manila" },
  { label: "Baguio, Philippines", country: "PH", lat: 16.4, lng: 120.6, tz: "Asia/Manila" },
  { label: "Bacolod, Philippines", country: "PH", lat: 10.64, lng: 122.97, tz: "Asia/Manila" },
  { label: "Cagayan de Oro, Philippines", country: "PH", lat: 8.45, lng: 124.63, tz: "Asia/Manila" },
];

const ELSEWHERE_PLACES: Fixture[] = [
  { label: "Singapore, Singapore", country: "SG", lat: 1.35, lng: 103.82, tz: "Asia/Singapore" },
  { label: "Sydney, Australia", country: "AU", lat: -33.87, lng: 151.21, tz: "Australia/Sydney" },
  { label: "Toronto, Canada", country: "CA", lat: 43.65, lng: -79.38, tz: "America/Toronto" },
  { label: "London, United Kingdom", country: "GB", lat: 51.51, lng: -0.13, tz: "Europe/London" },
];

// Same cadence as office/MockOfficeService.statusFor so the two mock feeds agree on who is in.
function statusFor(index: number): PresenceStatusValue {
  if (index % 7 === 0) return "OFFLINE";
  if (index % 5 === 0) return "ON_LEAVE";
  if (index % 4 === 0) return "IN_MEETING";
  if (index % 3 === 0) return "AWAY";
  return "ONLINE";
}

// Mirrors MockOfficeService: Bon's mock identity is the real Atlas email so self-recognition
// (profile button, DM exclusion) works on the rig; everyone else follows the localpart convention.
export const MOCK_VIEWER_EMAIL = "jerevon@offshorly.com";

export function mockTeamMapEmailFor(avatarId: string): string {
  return avatarId === "bon" ? MOCK_VIEWER_EMAIL : mockEmailForAvatarId(avatarId);
}

function fixtureFor(index: number): { bucket: TeamMapBucket; place: Fixture | null } {
  // Positions 6 and 13 have no location; every 5th (offset 2) is abroad; the rest are PH.
  if (index === 6 || index === 13) return { bucket: "none", place: null };
  if (index % 5 === 2) {
    return { bucket: "elsewhere", place: ELSEWHERE_PLACES[(index / 5) | 0] ?? ELSEWHERE_PLACES[0] };
  }
  return { bucket: "ph", place: PH_PLACES[index % PH_PLACES.length] };
}

export function buildMockTeamMapPeople(): TeamMapPerson[] {
  return characterLayers.map((layer, index) => {
    const { bucket, place } = fixtureFor(index);
    return {
      email: mockTeamMapEmailFor(layer.id),
      display_name: formatCharacterName(layer),
      // Same source as the mock floor, joined by email. Cast members the mock roster does not
      // know get null (rendered as "—"), never a position-derived guess.
      department_name: mockDepartmentFor(mockTeamMapEmailFor(layer.id)),
      status: statusFor(index),
      bucket,
      latitude: place?.lat ?? null,
      longitude: place?.lng ?? null,
      country_code: place?.country ?? null,
      location_label: place?.label ?? null,
      timezone: place?.tz ?? null,
      working_today: null,
    };
  });
}

// --- Working Today (mock) -----------------------------------------------------------------------

export const MOCK_SHARE_STORAGE_KEY = "office.teamMap.workingToday";
export const MOCK_SHARE_TTL_MS = 12 * 60 * 60 * 1000;
const SNAP_RADIUS_KM = 75;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** Mock twin of the backend's snap_coarse, used here for CONTEXT only (label / country / zone):
 *  nearest fixture city within 75 km, else the centre of the containing 1° grid cell. */
export function snapMockCoarse(
  fix: GeoFix,
): Omit<WorkingTodayShare, "shared_at" | "expires_at" | "active" | "stopped_at"> {
  let best: Fixture | null = null;
  let bestKm = SNAP_RADIUS_KM;
  for (const place of [...PH_PLACES, ...ELSEWHERE_PLACES]) {
    const km = haversineKm(fix.latitude, fix.longitude, place.lat, place.lng);
    if (km <= bestKm) {
      best = place;
      bestKm = km;
    }
  }
  if (best) {
    return {
      latitude: best.lat,
      longitude: best.lng,
      location_label: best.label,
      country_code: best.country,
      timezone: best.tz,
    };
  }
  const centre = (v: number) => Math.round((Math.floor(v) + 0.5) * 100) / 100;
  return {
    latitude: centre(fix.latitude),
    longitude: centre(fix.longitude),
    location_label: "Unknown region",
    country_code: null,
    timezone: "Etc/UTC",
  };
}

function writeStoredShare(share: WorkingTodayShare | null): void {
  try {
    if (share) window.localStorage.setItem(MOCK_SHARE_STORAGE_KEY, JSON.stringify(share));
    else window.localStorage.removeItem(MOCK_SHARE_STORAGE_KEY);
  } catch {
    // Storage unavailable: the share still applies for this page load via return values.
  }
}

/** Mirrors the backend's lazy expiry: a live share past its expiry becomes the saved (inactive)
 *  last location — stopped_at = expires_at — rather than disappearing. */
function readStoredShare(now: number): WorkingTodayShare | null {
  try {
    const raw = window.localStorage.getItem(MOCK_SHARE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkingTodayShare;
    if (parsed.active && Date.parse(parsed.expires_at) <= now) {
      const expired = { ...parsed, active: false, stopped_at: parsed.expires_at };
      writeStoredShare(expired);
      return expired;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class MockTeamMapService implements TeamMapService {
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  getPeople(): Promise<TeamMapSnapshot> {
    const me = readStoredShare(this.now());
    const people = buildMockTeamMapPeople().map((p) =>
      me && p.email === MOCK_VIEWER_EMAIL
        ? {
            ...p,
            bucket: (me.country_code === "PH" ? "ph" : "elsewhere") as TeamMapBucket,
            latitude: me.latitude,
            longitude: me.longitude,
            country_code: me.country_code,
            location_label: me.location_label,
            timezone: me.timezone,
            working_today: {
              shared_at: me.shared_at,
              expires_at: me.expires_at,
              active: me.active,
              stopped_at: me.stopped_at,
            },
          }
        : p,
    );
    return Promise.resolve({
      people,
      source: "mock",
      generated_at: new Date(this.now()).toISOString(),
      me,
    });
  }

  shareWorkingToday(fix: GeoFix): Promise<WorkingTodayShare> {
    const at = this.now();
    const context = snapMockCoarse(fix);
    const share: WorkingTodayShare = {
      ...context,
      // Exact point, as shared. Context fields above are derived from it.
      latitude: fix.latitude,
      longitude: fix.longitude,
      shared_at: new Date(at).toISOString(),
      expires_at: new Date(at + MOCK_SHARE_TTL_MS).toISOString(),
      active: true,
      stopped_at: null,
    };
    writeStoredShare(share);
    return Promise.resolve(share);
  }

  stopWorkingToday(): Promise<void> {
    const current = readStoredShare(this.now());
    if (current?.active) {
      writeStoredShare({ ...current, active: false, stopped_at: new Date(this.now()).toISOString() });
    }
    return Promise.resolve();
  }

  forgetWorkingToday(): Promise<void> {
    writeStoredShare(null);
    return Promise.resolve();
  }
}

export const mockTeamMapService = new MockTeamMapService();
