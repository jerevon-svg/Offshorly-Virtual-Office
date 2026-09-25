# vo3d weather providers

Two providers implement the `WeatherProvider` seam in `../weather.ts`:

| File | Used when | Reaches the network |
|---|---|---|
| `office.ts` | `VITE_CHAT_SOCKET_URL` is set — the normal case | yes, to **our own backend** |
| `manual.ts` | no backend configured (bare dev rig) | no |

`bootstrap.ts` picks one at startup. Everything downstream of the seam is identical either way, and
**manual CLEAR/CLOUDY/RAIN/HEAVY_RAIN/THUNDERSTORM overrides never consult a provider at all** — they
are unaffected by a missing key, a dead endpoint or a slow response.

## The live source: WeatherAPI.com, behind our backend

The browser never talks to WeatherAPI and never holds a key. It calls:

    GET {VITE_CHAT_SOCKET_URL}/weather/office

`VITE_CHAT_SOCKET_URL` is the Virtual Office backend (the same base as the Hub, attendance and
chat). It is **not** `VITE_API_URL`, which is the Atlas API in production and has no such route.

and gets back a state already in the app's own vocabulary:

```json
{ "source": "weatherapi", "state": "rain", "intensity": 0.43,
  "label": "Moderate rain", "observed_at": 1700000000000,
  "attribution": "Powered by WeatherAPI.com" }
```

Everything else about WeatherAPI — the key, the host, condition codes, temperature, wind, the icon
URL — stops at `backend/app/services/weather.py`. That is the point of normalizing at the boundary:
swapping providers is a backend change with no frontend rebuild.

### Configuration (all server-side)

| Env var | Meaning |
|---|---|
| `WEATHER_API_KEY` | WeatherAPI key. **Backend only** — never mirror into a `VITE_*` var. Empty = live weather off. |
| `WEATHER_LOCATION` | The one office location, `"lat,lon"`. Defaults to the Manila office. |
| `WEATHER_CACHE_SECONDS` | How long one upstream reading serves every caller. Default 900 (15 min). |

Get a free key at weatherapi.com. See `backend/.env.example`.

### One reading for the whole office

`services/weather.py` caches process-wide, so N browsers polling `/weather/office` cost **at most one
WeatherAPI request per TTL**. At 900s that is ~96 calls/day. The client-side poll interval is a
freshness knob, not a cost knob — it cannot amplify into upstream traffic. This cache is also what
makes the endpoint safe to expose unauthenticated: it returns a public fact about one fixed place,
and request volume cannot become quota drain.

### Failure is a value, not an exception

No key, WeatherAPI down, a 401, garbage JSON, an unrecognised state — every one of them yields
`source: "unavailable"` on a **200**. `office.ts` rejects on that, and `Weather` keeps its last good
observation (or CLEAR). There is no path by which weather returns a 5xx or breaks the office.

### Attribution

WeatherAPI's terms require visible credit. The backend returns `attribution` on **every** response
including `unavailable`, so the data cannot be rendered without it, and the dev panel shows it as the
Weather folder's `data` row. It is deliberately not drawn in the 3D scene.

## Alternatives considered

**Open-Meteo** needs no key at all and would not have required a backend route; it remains the
obvious fallback if WeatherAPI's quota or terms become awkward. `stateForWmoCode()` in `../weather.ts`
already normalizes its WMO codes, so that swap stays cheap.

OpenWeatherMap, Tomorrow.io and AccuWeather all require a key and would need exactly the same backend
proxy that WeatherAPI now has — no saving.

Google Weather is not an option: it is not to be scraped, and its API is paid.
