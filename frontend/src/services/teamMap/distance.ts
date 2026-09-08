import type { TeamMapPerson, WorkingTodayShare } from "./types";

// "How far is this person from me" — computed entirely in the browser from coordinates the panel
// already has. No request, no geocoding, no new location facts: the reference point is the
// viewer's OWN Working Today share (live or the saved last-shared one), which the viewer chose to
// create, and the other end is whatever point that colleague's marker already sits on — their
// coarse Atlas base, their live share, or their saved last-shared location. A colleague with no
// coordinates has no distance, and neither does anyone when the viewer has no share of their own.

const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "450 m away" under a kilometre, "2.4 km away" above it. Metres are rounded to 10 and
 *  kilometres to one decimal (whole numbers past 10 km): the underlying points are approximate,
 *  so more precision than that would be a lie. */
export function formatDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters / 10) * 10} m away`;
  const km = meters / 1_000;
  return km < 10 ? `${km.toFixed(1)} km away` : `${Math.round(km)} km away`;
}

/** The one gate every distance goes through: metres from the viewer's own share to this
 *  colleague, or null when there is nothing honest to show — no share of the viewer's own, the
 *  colleague has no location, or it is the viewer themselves. Both the sidebar label and the map
 *  pill are formatted from this single result. */
export function distanceMetersFor(
  me: WorkingTodayShare | null | undefined,
  person: TeamMapPerson,
  viewerEmail: string | null,
): number | null {
  if (!me) return null;
  if (person.latitude === null || person.longitude === null) return null;
  if (viewerEmail && person.email.toLowerCase() === viewerEmail.toLowerCase()) return null;
  return haversineMeters(me, { latitude: person.latitude, longitude: person.longitude });
}

/** Sidebar / details wording: "450 m away". */
export function distanceLabelFor(
  me: WorkingTodayShare | null | undefined,
  person: TeamMapPerson,
  viewerEmail: string | null,
): string | null {
  const meters = distanceMetersFor(me, person, viewerEmail);
  return meters === null ? null : formatDistance(meters);
}

/** Map-pill wording: the same number, without the trailing "away" that a label pinned to a
 *  marker does not need ("450 m", "2.4 km"). */
export function compactDistanceLabelFor(
  me: WorkingTodayShare | null | undefined,
  person: TeamMapPerson,
  viewerEmail: string | null,
): string | null {
  const meters = distanceMetersFor(me, person, viewerEmail);
  return meters === null ? null : formatDistance(meters).replace(/ away$/, "");
}
