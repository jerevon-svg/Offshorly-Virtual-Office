import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./WeatherForecastCard.module.css";
import {
  fetchCityForecast,
  searchCities,
  reverseGeocode,
  deviceQuery,
  MIN_CITY_QUERY,
  MAX_CITY_QUERY,
  type CityForecast,
  type CityMatch,
  type ForecastState,
} from "../../services/weather/forecastClient";
import { loadRememberedCity, saveRememberedCity } from "../../services/weather/cityPreference";
import clearArt from "../../assets/hub-art/weather-clear.png";
import cloudyArt from "../../assets/hub-art/weather-cloudy.png";
import rainArt from "../../assets/hub-art/weather-rain.png";
import heavyRainArt from "../../assets/hub-art/weather-heavy-rain.png";
import thunderstormArt from "../../assets/hub-art/weather-thunderstorm.png";

// THE REAL-WORLD WEATHER SLIDE — ONE component, and one slide of the Company Hub's carousel.
//
// ONE, NOT TWO. The Hub's welcome ("checkin") and review ("manual") modes are two modes of one panel,
// so this is mounted once inside CompanyHub.tsx and appears in both by construction. A separate
// "welcome forecast" would be a second thing to keep in step with this one, and they would drift.
//
// IT IS A SLIDE, NOT A FOOTER. It used to sit underneath whichever announcement was showing, which
// made it furniture attached to somebody else's content. It is now its own carousel entry, wearing
// the same hero-plus-content shape every other slide wears, so the Hub reads as one system.
//
// ---- HOW A LOCATION IS DECIDED --------------------------------------------------------------------
// A SAVED CITY ALWAYS WINS, and device location never overwrites one. Somebody who chose Cebu is
// shown Cebu on a laptop that is sitting in Manila, because they said so.
//
// THE BROWSER IS NEVER ASKED ON MOUNT. Geolocation runs only from a press of "Use my location" —
// opening the Hub must not raise a permission prompt, and a refusal is remembered for the session so
// the prompt is not raised again and again.
//
// A DEVICE FIX IS APPROXIMATE AND IS CALLED APPROXIMATE. It is coarsened to ~1.1 km before it is sent
// (deviceQuery), the forecast is fetched for that point rather than for a city centroid, and the name
// beside it is the provider's nearest place — shown only when it is genuinely near (reverseGeocode),
// and always under an "approximate" note.
//
// WHAT GETS REMEMBERED IS THE CITY, NEVER THE DEVICE POINT. Once the reverse lookup vouches for a
// place, THAT place — the provider's own public city entry, with its own published coordinates — is
// saved exactly as a hand-picked city would be, so the next visit opens on it without asking the
// browser anything. The raw fix is used for this session's forecast and then dropped; it is never
// written to storage. If nothing trustworthy comes back the slide says "Your area" for the session
// and saves NOTHING, because inventing a city to persist is worse than asking again tomorrow.
//
// INFORMATIONAL ONLY, AND SAYS SO NOWHERE ELSE. It reads /weather/forecast and renders it. It does not
// touch the V2 world's weather (the AUTO /weather/office read) and it does not touch Settings →
// Environment, which stays the only way a person changes what the office looks like. Nothing in this
// file imports either.
//
// ONE ILLUSTRATION PER NORMALIZED STATE, from the same soft-3D clay family as the Hub's other art
// (src/assets/hub-art) and framed identically to it — 640x640, transparent, content filling 0.917 of
// the frame, which is the exact framing announcement/recognition/whatsnew already use. Keyed on the
// five states the backend, this card and dev/vo3d/env/weather.ts all share, so the hero and the day
// tiles read from one table.
const STATE_ART: Record<ForecastState, string> = {
  clear: clearArt,
  cloudy: cloudyArt,
  rain: rainArt,
  heavy_rain: heavyRainArt,
  thunderstorm: thunderstormArt,
};

/** Alt text is empty on purpose everywhere this is used: the condition is already written beside the
 *  picture in words, so announcing it twice is noise for a screen reader. */
const STATE_ALT = "";

/** "Today", "Tomorrow", then the weekday — from the date the provider reported, not from a clock here. */
function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { weekday: "short" });
}

/** City, region AND country — all three, because the region alone cannot separate two places that
 *  share a name. "Mandaluyong, Cavite, Philippines" beside "Mandaluyong City, Metro Manila,
 *  Philippines" is the whole point of the search returning both. Blank parts are dropped rather than
 *  rendered as empty commas (WeatherAPI leaves `region` empty for some places, e.g. Ho Chi Minh City),
 *  and a region equal to the city name is not repeated. */
function placeLabel(city: { name: string; region?: string; country?: string }): string {
  const parts = [city.name];
  if (city.region && city.region.toLowerCase() !== city.name.toLowerCase()) parts.push(city.region);
  if (city.country) parts.push(city.country);
  return parts.join(", ");
}

const ATTRIBUTION_URL = "https://www.weatherapi.com/";

/** What the slide is currently showing a forecast FOR. A saved city is a preference and persists; a
 *  device fix is a one-off and does not (see the header). */
type Place =
  | { kind: "city"; city: CityMatch }
  | { kind: "device"; query: string; label: CityMatch | null };

function placeQuery(place: Place): string {
  return place.kind === "city" ? place.city.query : place.query;
}

export function WeatherForecastCard() {
  const remembered = useMemo(() => loadRememberedCity(), []);
  const [place, setPlace] = useState<Place | null>(remembered ? { kind: "city", city: remembered } : null);
  const [forecast, setForecast] = useState<CityForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CityMatch[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPending, setSearchPending] = useState(false);

  /** The device-location leg. `locating` is the in-flight prompt; `locateError` is what to say after
   *  a refusal or a failure; `locateBlocked` makes sure we ask the browser AT MOST ONCE per mount. */
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locateBlocked, setLocateBlocked] = useState(false);

  /** Only the LATEST request may write state — an earlier, slower answer must not overwrite a newer
   *  one, which is the classic way a search box ends up showing the wrong city. */
  const forecastRunRef = useRef(0);
  const searchRunRef = useRef(0);

  const load = useCallback((target: Place) => {
    const run = ++forecastRunRef.current;
    setLoading(true);
    setError(null);
    fetchCityForecast(placeQuery(target))
      .then((data) => {
        if (run !== forecastRunRef.current) return;
        if (data.source === "rate_limited") {
          setForecast(null);
          setError("Too many weather lookups just now. Try again in a minute.");
          return;
        }
        if (data.source !== "weatherapi" || data.days.length === 0) {
          setForecast(null);
          setError("Weather is unavailable right now.");
          return;
        }
        setForecast(data);
      })
      .catch(() => {
        if (run !== forecastRunRef.current) return;
        setForecast(null);
        setError("Weather is unavailable right now.");
      })
      .finally(() => {
        if (run === forecastRunRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (place) load(place);
  }, [place, load]);

  /** USE MY LOCATION. Runs only from the button — never on mount, never automatically, and never a
   *  second time in one mount after the browser has said no. */
  function useMyLocation() {
    if (locating || locateBlocked) return;
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) {
      setLocateBlocked(true);
      setLocateError("This browser can't share a location. Choose a city instead.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    geo.getCurrentPosition(
      (position) => {
        // COARSENED FIRST. Nothing downstream — the request, the label lookup, the URL — ever sees
        // more precision than this.
        const q = deviceQuery(position.coords.latitude, position.coords.longitude);
        setLocating(false);
        setSearching(false);
        setPlace({ kind: "device", query: q, label: null });
        // The NAME is a separate, best-effort question, and a failure to answer it changes nothing
        // about the forecast, which is already loading for the exact point above.
        reverseGeocode(q)
          .then((label) => {
            setPlace((prev) => (prev?.kind === "device" && prev.query === q ? { ...prev, label } : prev));
            // A VERIFIED city becomes the remembered preference — the city's own entry, not the fix.
            // Nothing is saved when the lookup could not vouch for anywhere.
            if (label) saveRememberedCity(label);
          })
          .catch(() => {});
      },
      () => {
        // Denied, unavailable or timed out — all one outcome here, and all of them stop us asking
        // again. NOTHING is guessed: no default city, no office fallback.
        setLocating(false);
        setLocateBlocked(true);
        setLocateError("We couldn't get your location. Choose a city instead.");
        setSearching(true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  function runSearch(raw: string) {
    const q = raw.trim();
    const run = ++searchRunRef.current;
    if (q.length < MIN_CITY_QUERY) {
      setMatches(null);
      setSearchError(null);
      setSearchPending(false);
      return;
    }
    setSearchPending(true);
    setSearchError(null);
    searchCities(q)
      .then((res) => {
        if (run !== searchRunRef.current) return;
        if (res.source === "rate_limited") {
          setMatches(null);
          setSearchError("Too many lookups just now. Try again in a minute.");
          return;
        }
        if (res.source !== "weatherapi") {
          setMatches(null);
          setSearchError("City search is unavailable right now.");
          return;
        }
        setMatches(res.results);
      })
      .catch(() => {
        if (run !== searchRunRef.current) return;
        setMatches(null);
        setSearchError("City search is unavailable right now.");
      })
      .finally(() => {
        if (run === searchRunRef.current) setSearchPending(false);
      });
  }

  /** A CHOSEN city is a preference: saved, and respected on every future visit. Never chosen for
   *  them — this only ever runs from a press on a specific row. */
  function choose(match: CityMatch) {
    saveRememberedCity(match);
    setPlace({ kind: "city", city: match });
    setSearching(false);
    setQuery("");
    setMatches(null);
    setSearchError(null);
    setLocateError(null);
  }

  const attribution = forecast?.attribution || "Powered by WeatherAPI.com";
  const approximate = place?.kind === "device";
  const heading = !place
    ? "Weather"
    : place.kind === "city"
      ? placeLabel(place.city)
      : place.label
        ? placeLabel(place.label)
        : "Your area";

  return (
    <section className={styles.slide} aria-label="Weather forecast">
      {/* THE HERO. The same 240px box and mint blob every other Hub slide uses; the illustration is
          `object-fit: contain` inside it, so it scales on mobile without cropping or distortion.
          Before a forecast exists there is no condition to illustrate, so the blob stands alone. */}
      <div className={styles.hero}>
        <span className={styles.heroGlow} aria-hidden="true" />
        {forecast && <img className={styles.heroArt} src={STATE_ART[forecast.state]} alt={STATE_ALT} />}
      </div>

      <div className={styles.content}>
        <div className={styles.eyebrowRow}>
          <span className={styles.eyebrow}>Weather</span>
          {approximate && <span className={styles.approxBadge}>Approximate</span>}
        </div>
        <h2 className={styles.headline}>{heading}</h2>

        {!place && (
          <>
            <p className={styles.lead}>
              See today's weather and the next two days. Nothing is shared with your team.
            </p>
            <div className={styles.firstRun}>
              <button
                type="button"
                className={styles.primaryAction}
                disabled={locating || locateBlocked}
                onClick={useMyLocation}
              >
                {locating ? "Locating…" : "Use my location"}
              </button>
              <button type="button" className={styles.secondaryAction} onClick={() => setSearching(true)}>
                Choose a city
              </button>
            </div>
            {locateError && <div className={styles.searchError}>{locateError}</div>}
          </>
        )}

        {place && (
          <div className={styles.placeRow}>
            {approximate && <span className={styles.approxNote}>Based on your device's approximate location</span>}
            <button
              type="button"
              className={styles.changeButton}
              aria-expanded={searching}
              onClick={() => setSearching((open) => !open)}
            >
              Change city
            </button>
          </div>
        )}

        {searching && (
          <div className={styles.search}>
            <label className={styles.srOnly} htmlFor="weather-city-search">
              Search for a city
            </label>
            <input
              id="weather-city-search"
              className={styles.searchInput}
              type="text"
              autoComplete="off"
              /* Bounded in the field as well as in the client and again on the server. */
              maxLength={MAX_CITY_QUERY}
              placeholder="Search for a city…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Searched on submit, not per keystroke: every keystroke would be a request against
                // a metered provider key, and the server's cache cannot help with text nobody repeats.
                setMatches(null);
                setSearchError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch(query);
                }
              }}
            />
            <button type="button" className={styles.searchButton} onClick={() => runSearch(query)}>
              Search
            </button>

            {searchPending && <div className={styles.searchNote}>Searching…</div>}
            {searchError && <div className={styles.searchError}>{searchError}</div>}
            {!searchPending && !searchError && matches?.length === 0 && (
              <div className={styles.searchNote}>No cities matched that.</div>
            )}
            {!searchPending && matches && matches.length > 0 && (
              /* EVERY match is offered, each with its city, region and country, and none is chosen
                 for them — "Mandaluyong, Cavite" and "Mandaluyong City, Metro Manila" are two rows. */
              <ul className={styles.results}>
                {matches.map((match) => (
                  <li key={match.query}>
                    <button type="button" className={styles.resultRow} onClick={() => choose(match)}>
                      {placeLabel(match)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {place && loading && !forecast && <div className={styles.empty}>Loading forecast…</div>}
        {place && error && !loading && <div className={styles.error}>{error}</div>}

        {place && forecast && !error && (
          <>
            <div className={styles.now}>
              <span className={styles.nowTemp}>{Math.round(forecast.temp_c)}°</span>
              <span className={styles.nowCondition}>{forecast.condition}</span>
            </div>

            <ul className={styles.days}>
              {forecast.days.map((day, i) => (
                <li className={styles.day} key={day.date}>
                  <span className={styles.dayName}>{dayLabel(day.date, i)}</span>
                  <img className={styles.dayGlyph} src={STATE_ART[day.state]} alt={STATE_ALT} />
                  <span className={styles.dayCondition}>{day.condition}</span>
                  <span className={styles.dayTemps}>
                    <strong>{Math.round(day.max_c)}°</strong>
                    <span className={styles.dayLow}>{Math.round(day.min_c)}°</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* WeatherAPI's terms require visible credit wherever the data is shown, so it is rendered
            unconditionally — including on the first-run and error states, where it costs nothing. */}
        <a className={styles.attribution} href={ATTRIBUTION_URL} target="_blank" rel="noreferrer noopener">
          {attribution}
        </a>
      </div>
    </section>
  );
}

export default WeatherForecastCard;
