import type { CityMatch } from "./forecastClient";

// WHICH CITY THIS BROWSER LAST LOOKED AT. Local, per-device, and deliberately nowhere else.
//
// NOT A PROFILE FIELD. It is never posted, never broadcast over the presence/chat sockets and never
// visible to a coworker — where somebody keeps an eye on the weather can say where they live, and this
// app has no reason to know that. localStorage is the whole storage model on purpose.
//
// NO GEOLOCATION EITHER. The employee types a city; the browser is never asked where it is.
//
// Every read and write is wrapped: a private window, cleared site data or a disabled storage quota
// must degrade to "no remembered city", never to a card that throws.

const KEY = "vo.weather.city.v1";

export interface RememberedCity {
  query: string;
  name: string;
  region: string;
  country: string;
}

function isCity(value: unknown): value is RememberedCity {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.query === "string" && c.query.length > 0 && typeof c.name === "string";
}

export function loadRememberedCity(): RememberedCity | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCity(parsed)) return null;
    return {
      query: parsed.query,
      name: parsed.name,
      region: typeof parsed.region === "string" ? parsed.region : "",
      country: typeof parsed.country === "string" ? parsed.country : "",
    };
  } catch {
    return null;
  }
}

export function saveRememberedCity(city: CityMatch | RememberedCity): void {
  try {
    const { query, name, region, country } = city;
    window.localStorage.setItem(KEY, JSON.stringify({ query, name, region, country }));
  } catch {
    // A browser that will not store it simply does not remember it. Nothing else changes.
  }
}

export function clearRememberedCity(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}
