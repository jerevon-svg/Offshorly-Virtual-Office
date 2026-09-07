// Global Team Map — wire mirror of backend/app/schemas/team_map.py (TeamMapPerson /
// TeamMapResponse / WorkingTodayShareOut). Field names and nullability copied verbatim, same rule
// as office/types.ts.
//
// This is the COMPLETE set of location facts the browser ever learns about a colleague. There
// is no home address and no Atlas geocode on these types by construction: an Atlas-derived
// latitude/longitude is always the backend's coarse projection (a public city centroid or a
// ~111 km grid-cell centre, two decimals). The one exception is an active Working Today share —
// the colleague explicitly chose to show coworkers their exact current location, and
// `working_today` marks exactly those rows. Do not add fields here without the backend first.

export type TeamMapBucket = "ph" | "elsewhere" | "none";
export type TeamMapSource = "atlas" | "unavailable" | "mock";

/** Marker on a colleague: their position is an EXACT location they chose to share, not the
 *  coarse Atlas base. `active` = live "Working today"; false = the LAST SHARED location kept
 *  after Stop sharing / expiry — never to be presented as current. */
export interface WorkingTodayMarker {
  shared_at: string;
  expires_at: string;
  active: boolean;
  stopped_at: string | null;
}

/** The viewer's OWN active share: the exact point plus nearest-city context. */
export interface WorkingTodayShare extends WorkingTodayMarker {
  latitude: number;
  longitude: number;
  location_label: string;
  country_code: string | null;
  timezone: string;
}

/** A browser geolocation fix the user explicitly chose to share. Handed to the service once,
 *  right after the Share click; the backend stores it for up to 12 hours. Never stored on the
 *  client. */
export interface GeoFix {
  latitude: number;
  longitude: number;
}

export interface TeamMapPerson {
  email: string;
  display_name: string | null;
  department_name: string | null;
  /** Atlas PresenceStatus string ("ONLINE", "AWAY", "IN_MEETING", "ON_LEAVE", "OFFLINE"). */
  status: string;
  bucket: TeamMapBucket;
  latitude: number | null;
  longitude: number | null;
  country_code: string | null;
  location_label: string | null;
  /** IANA zone derived from the coarse place, e.g. "Asia/Manila". Null when bucket is "none". */
  timezone: string | null;
  /** Present when the fields above come from an active Working Today share. */
  working_today?: WorkingTodayMarker | null;
}

export interface TeamMapSnapshot {
  people: TeamMapPerson[];
  source: TeamMapSource;
  generated_at: string;
  /** The viewer's own active share, independent of Atlas availability. */
  me?: WorkingTodayShare | null;
}

export interface TeamMapService {
  getPeople(): Promise<TeamMapSnapshot>;
  shareWorkingToday(fix: GeoFix): Promise<WorkingTodayShare>;
  /** End live sharing; the last shared point is kept as "Last shared". */
  stopWorkingToday(): Promise<void>;
  /** Remove the saved location entirely; the Atlas base location applies again. */
  forgetWorkingToday(): Promise<void>;
}
