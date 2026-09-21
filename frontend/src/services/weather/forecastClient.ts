import { getAuthToken } from "../api/client";

// REST client for the REAL-WORLD weather card in the Company Hub (backend/app/routers/weather.py's
// /weather/search and /weather/forecast).
//
// SAME BASE AND SAME IDENTITY RULE as services/hub/hubClient.ts — the forecast lives in the same
// FastAPI app as the Hub itself, and is read from the Hub, so it is read the same way. No socket: a
// three-day forecast is not live data.
//
// THE KEY IS NOT HERE, AND NEITHER IS WEATHERAPI. The browser talks to this backend and nothing else;
// WeatherAPI's key, its URL, its condition codes and its icon CDN all stop on the server. What arrives
// is already this app's own vocabulary.
//
// INFORMATIONAL ONLY. Nothing in this module touches the V2 world's weather, which is the separate
// /weather/office AUTO read or a manual Settings → Environment override.

/** The app's own five states, as everywhere else (backend schemas/weather.py, dev/vo3d/env/weather.ts). */
export type ForecastState = "clear" | "cloudy" | "rain" | "heavy_rain" | "thunderstorm";

/** "weatherapi" is a real answer (which may legitimately be an EMPTY list of matches); the other two
 *  are the card's error states, and both arrive as 200s. */
export type LookupSource = "weatherapi" | "unavailable" | "rate_limited";

export interface CityMatch {
  /** What to send back as the forecast's `q`. Opaque to this client — it is the server's "lat,lon". */
  query: string;
  name: string;
  region: string;
  country: string;
}

export interface CitySearchResult {
  source: LookupSource;
  results: CityMatch[];
  attribution: string;
}

export interface ForecastDay {
  date: string;
  max_c: number;
  min_c: number;
  max_f: number;
  min_f: number;
  condition: string;
  state: ForecastState;
}

export interface CityForecast {
  source: LookupSource;
  name: string;
  region: string;
  country: string;
  temp_c: number;
  temp_f: number;
  condition: string;
  state: ForecastState;
  observed_at: number | null;
  days: ForecastDay[];
  attribution: string;
}

/** Bound the caller's text before it is a request, mirroring the server's own MAX_QUERY_LEN. */
export const MAX_CITY_QUERY = 64;
export const MIN_CITY_QUERY = 2;

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Company Hub weather card — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY identity, mirroring hubClient.ts's setDevIdentity exactly — see that module's comment.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

async function restFetch(path: string): Promise<Response> {
  const headers = new Headers();
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${socketBase()}${path}`, { headers });
  if (!res.ok) {
    // Deliberately terse and never echoing the body: the card shows a state, not a server message.
    throw new Error(`Weather request failed (${res.status})`);
  }
  return res;
}

/** GET /weather/search — places matching free text. A query below the minimum never leaves the tab. */
export async function searchCities(query: string): Promise<CitySearchResult> {
  const q = query.trim().slice(0, MAX_CITY_QUERY);
  if (q.length < MIN_CITY_QUERY) {
    return { source: "weatherapi", results: [], attribution: ATTRIBUTION_FALLBACK };
  }
  const res = await restFetch(`/weather/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

/** GET /weather/forecast — current conditions plus today and the next two days for one place. */
export async function fetchCityForecast(query: string): Promise<CityForecast> {
  const q = query.trim().slice(0, MAX_CITY_QUERY);
  const res = await restFetch(`/weather/forecast?q=${encodeURIComponent(q)}`);
  return res.json();
}

/** HOW PRECISE A DEVICE FIX IS ALLOWED TO GET before it becomes a request.
 *
 *  2 decimal places is ~1.1 km. Weather at that resolution is identical to weather at the metre, and
 *  it is still far better than a city centroid — but it means the coordinate string that ends up in a
 *  URL, and therefore in any server access log, is a neighbourhood rather than a doorstep. Nothing is
 *  gained by sending more, so nothing more is sent. */
export const DEVICE_COORD_DP = 2;

/** How far the provider's nearest named place may be from the device before its LABEL is not
 *  trustworthy. WeatherAPI answers a reverse lookup with the nearest entry in its gazetteer, which in
 *  a sparse region can be a different town; past this distance the card says "your area" rather than
 *  naming somewhere the employee is not. The FORECAST is unaffected — that is always fetched for the
 *  device's own point, never for the matched place's. */
export const REVERSE_LABEL_MAX_KM = 25;

/** Coarsened "lat,lon" for a device fix — the only form of a device position this app ever sends. */
export function deviceQuery(latitude: number, longitude: number): string {
  return `${latitude.toFixed(DEVICE_COORD_DP)},${longitude.toFixed(DEVICE_COORD_DP)}`;
}

/** Kilometres between two points. Equirectangular: at these distances the error is metres, and the
 *  answer is only ever compared against a 25 km threshold. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const x = (bLon - aLon) * toRad * Math.cos(((aLat + bLat) / 2) * toRad);
  const y = (bLat - aLat) * toRad;
  return Math.sqrt(x * x + y * y) * 6371;
}

function parsePoint(query: string): { lat: number; lon: number } | null {
  const [lat, lon] = query.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** How far the ADMINISTRATIVE REGION the provider names may sit from the device before its label is
 *  rejected. Generous, because a region is an area and its representative point can legitimately be a
 *  long way from a device inside it — but nothing like the ~500 km the Manila/Negros mislabel needs. */
export const REVERSE_REGION_MAX_KM = 200;

/** WHERE IS THIS, ROUGHLY? Reverse geocoding through the EXISTING search endpoint — WeatherAPI's
 *  search.json answers a "lat,lon" query with its nearest named place. No new provider, no new
 *  credentials, no new endpoint.
 *
 *  A LABEL IS ONLY RETURNED WHEN THE PROVIDER AGREES WITH ITSELF ABOUT IT, because for this provider
 *  a reverse answer is not evidence that the label is right. Asked about 14.58,121.04 — Metro Manila —
 *  it replies "San Jose, Negros Occidental". The echoed coordinates always match the question, so
 *  proximity alone can never catch that.
 *
 *  THE REGION IS WHAT GETS CHECKED, not the place name. The region is the field that is wrong in every
 *  case observed here, and unlike a neighbourhood name it is administrative and barely ambiguous —
 *  putting the NAME back through the search rejects far too much, because a reverse answer is usually
 *  a neighbourhood and neighbourhood names repeat all over a country:
 *
 *    device in Tokyo   -> "Horinouchi, Tokyo"            -> search "Tokyo"             ->   ~5 km  KEEP
 *    device in Bangkok -> "Bangkok, Krung Thep"          -> search "Krung Thep"        ->    0 km  KEEP
 *    device in Manila  -> "San Jose, Negros Occidental"  -> search "Negros Occidental" -> ~500 km  DROP
 *
 *  (Searching "Horinouchi" instead lands in Niigata, 210 km away, and would throw away a label that
 *  was perfectly good — which is exactly why the region is the thing asked about.)
 *
 *  That is the provider contradicting itself, observed, not a guess about geography, and no place name
 *  is hardcoded anywhere. `null` means "we know roughly where you are but not what it is called",
 *  which the card renders honestly as "Your area" rather than naming somewhere you are not.
 *
 *  Costs one extra search, bounded and cached server-side like every other lookup — and regions repeat
 *  across employees, so it is nearly always a cache hit. */
export async function reverseGeocode(query: string): Promise<CityMatch | null> {
  const asked = parsePoint(query);
  if (!asked) return null;

  const res = await searchCities(query);
  if (res.source !== "weatherapi" || res.results.length === 0) return null;
  const best = res.results[0];
  const found = parsePoint(best.query);
  if (!found) return null;
  if (distanceKm(asked.lat, asked.lon, found.lat, found.lon) > REVERSE_LABEL_MAX_KM) return null;

  // No region to check (the provider leaves it empty for some places, e.g. Ho Chi Minh City) — then
  // the name is all there is, and it is checked instead.
  const subject = best.region || best.name;
  if (!subject) return null;

  // A failure here is treated as "cannot vouch for it" rather than as a pass: an unverified label is
  // exactly what this exists to avoid showing.
  let confirm: CitySearchResult;
  try {
    confirm = await searchCities(subject);
  } catch {
    return null;
  }
  if (confirm.source !== "weatherapi") return null;
  const agrees = confirm.results.some((candidate) => {
    const point = parsePoint(candidate.query);
    return point !== null && distanceKm(asked.lat, asked.lon, point.lat, point.lon) <= REVERSE_REGION_MAX_KM;
  });
  return agrees ? best : null;
}

/** Only ever used for a response the server never sent (a query short-circuited above). Every real
 *  payload carries the server's own attribution string, which is the one that gets rendered. */
export const ATTRIBUTION_FALLBACK = "Powered by WeatherAPI.com";
