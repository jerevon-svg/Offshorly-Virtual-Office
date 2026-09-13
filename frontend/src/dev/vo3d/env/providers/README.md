# vo3d weather providers

`manual.ts` is the only provider in the tree. It is the dev source the CLEAR/RAIN visual proof runs on and
it touches no network.

## Recommended real provider: Open-Meteo

Nothing weather-shaped exists in this repo's configuration (no key, no proxy route, no env var). When a
live source is wanted, **Open-Meteo** is the recommendation:

- **No API key and no account.** Nothing to commit, nothing to leak, nothing to rotate. This is the
  decisive property — every alternative below requires a secret that a browser build cannot hold.
- Free for non-commercial use, CC-BY-4.0 attribution, ~10k calls/day. The office polls one fixed
  coordinate once every 10 minutes: ~144 calls/day.
- Reports **WMO present-weather codes**, which `stateForWmoCode()` in `../weather.ts` already normalizes,
  plus a `precipitation` rate that `intensityForRate()` already consumes. The adapter is a fetch and two
  function calls.

Endpoint for the Manila office:

    https://api.open-meteo.com/v1/forecast
      ?latitude=14.5995&longitude=120.9842
      &current=weather_code,precipitation
      &timezone=Asia/Manila

Required configuration: none beyond an opt-in flag, e.g. `VITE_VO3D_WEATHER=live` (default `manual`), so
the default build makes no third-party request.

## Deliberately not recommended

OpenWeatherMap, WeatherAPI, Tomorrow.io and AccuWeather all require an API key. A client-side key is a
published key, so any of them would need a backend proxy route first — the same shape as the existing VO
privacy proxy over Atlas `/office/map`. That is a backend change, out of scope here, and buys nothing over
Open-Meteo for this use.

Google Weather is not an option: it is not to be scraped, and its API is paid.
