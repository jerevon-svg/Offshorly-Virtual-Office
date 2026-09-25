// vo3d env — THE OFFICE WEATHER PROVIDER. Real weather, read from OUR backend.
//
// WHY IT TALKS TO THE BACKEND AND NOT TO WeatherAPI. WeatherAPI needs a key, and a key in a browser
// bundle is a published key — so the key lives in the backend's environment (WEATHER_API_KEY) and
// is used only by backend/app/services/weather.py. This provider never sees a key, never sees
// WeatherAPI's URL, and never learns a WeatherAPI condition code: the backend hands back a state
// already in the app's own vocabulary, which is the whole point of the WeatherProvider seam.
//
// ONE UPSTREAM CALL FOR THE WHOLE OFFICE. The backend caches the reading process-wide for
// WEATHER_CACHE_SECONDS, so every browser polling this endpoint shares one WeatherAPI request.
// The polling interval on this side (env/weather.ts's Weather) is therefore a freshness knob, not
// a cost knob — it cannot amplify into upstream traffic.
//
// IT CANNOT BREAK THE OFFICE. Every failure path — no API base configured, transport error, non-2xx,
// malformed body, a state string we do not recognise, an "unavailable" reading — rejects, and
// env/weather.ts's Weather keeps the last good observation (or CLEAR). Manual overrides never
// consult a provider at all, so they are unaffected by anything that happens in here.
import { WEATHER_STATES, type WeatherObservation, type WeatherProvider, type WeatherState } from "../weather";

/** Shape of GET /weather/office. Only the fields actually consumed are declared. */
type OfficeWeatherPayload = {
  source?: unknown;
  state?: unknown;
  intensity?: unknown;
  label?: unknown;
  observed_at?: unknown;
  attribution?: unknown;
};

/** WeatherAPI's terms require visible attribution. The backend returns it on every response; this
 *  is the fallback string for before the first successful read, so the credit line is never blank. */
export const WEATHER_ATTRIBUTION = "Powered by WeatherAPI.com";

const PATH = "weather/office";
const TIMEOUT_MS = 6000;

/** Absolute URL on the VIRTUAL OFFICE backend, or null when there is no backend configured.
 *
 *  GET /weather/office is served by our own FastAPI app (backend/app/routers/weather.py), so it is
 *  addressed from VITE_CHAT_SOCKET_URL — the same base every other VO-backend client uses (Hub,
 *  attendance, the Hub weather card in services/weather/forecastClient.ts). It is NOT an Atlas
 *  route: VITE_API_URL is the Atlas API in production, where this path does not exist.
 *
 *  Deliberately non-throwing, unlike those clients' socketBase(): the vo3d dev entry must boot on a
 *  machine with no backend at all. Missing config here is a normal state — the office runs on the
 *  manual provider — not an error. */
export function officeWeatherUrl(): string | null {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return `${raw.trim().replace(/\/+$/, "")}/${PATH}`;
}

const isState = (v: unknown): v is WeatherState => typeof v === "string" && (WEATHER_STATES as string[]).includes(v);

export class OfficeWeatherProvider implements WeatherProvider {
  readonly id = "office";
  readonly label = "WeatherAPI.com (via backend)";
  /** the attribution line last seen from the server; the dev panel reads this */
  attribution = WEATHER_ATTRIBUTION;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async read(signal?: AbortSignal): Promise<WeatherObservation> {
    // Own timeout, so a hung request cannot leave the poll's in-flight flag stuck forever.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    signal?.addEventListener("abort", () => ctl.abort(), { once: true });
    let res: Response;
    try {
      res = await fetch(this.url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`office weather HTTP ${res.status}`);

    const body = (await res.json()) as OfficeWeatherPayload;
    if (typeof body.attribution === "string" && body.attribution.trim()) this.attribution = body.attribution;
    // "unavailable" is a normal 200 from the backend (no key, upstream down). It is NOT a reading,
    // so it rejects: the caller keeps its last good value rather than being told it is CLEAR.
    if (body.source !== "weatherapi") throw new Error("office weather unavailable");
    if (!isState(body.state)) throw new Error(`office weather returned an unknown state`);

    const intensity = typeof body.intensity === "number" && Number.isFinite(body.intensity) ? Math.max(0, Math.min(1, body.intensity)) : 1;
    const observedAt = typeof body.observed_at === "number" && Number.isFinite(body.observed_at) ? body.observed_at : Date.now();
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : body.state;
    return { state: body.state, intensity, label, observedAt };
  }
}

/** The real provider when a backend is configured, else null so the caller falls back to manual. */
export function officeWeatherProvider(): OfficeWeatherProvider | null {
  const url = officeWeatherUrl();
  return url ? new OfficeWeatherProvider(url) : null;
}
