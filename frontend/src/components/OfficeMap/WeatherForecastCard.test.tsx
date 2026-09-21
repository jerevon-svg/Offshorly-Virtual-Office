// THE REAL-WORLD WEATHER CARD. What matters here is not the layout but the boundaries: it reads the
// backend (never WeatherAPI), it remembers a city locally and nowhere else, it never asks the browser
// where it is, and every failure is a state on the card rather than a thrown Hub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import { readFileSync } from "node:fs";
import { WeatherForecastCard } from "./WeatherForecastCard";
import type { CityForecast, CitySearchResult } from "../../services/weather/forecastClient";

const { searchCities, fetchCityForecast, reverseGeocode } = vi.hoisted(() => ({
  searchCities: vi.fn(),
  fetchCityForecast: vi.fn(),
  reverseGeocode: vi.fn(),
}));
vi.mock("../../services/weather/forecastClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/weather/forecastClient")>();
  return { ...actual, searchCities, fetchCityForecast, reverseGeocode };
});

/** Drive the browser's geolocation the way a real permission prompt would answer. Returns the spy so
 *  a test can assert it was NEVER called, which is the privacy rule that matters most here. */
function stubGeolocation(behaviour: "grant" | "deny" | "missing", coords = { latitude: 14.5794, longitude: 121.0359 }) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback) => {
    if (behaviour === "grant") ok({ coords } as GeolocationPosition);
    else fail?.({ code: 1, message: "denied" } as GeolocationPositionError);
  });
  Object.defineProperty(navigator, "geolocation", {
    value: behaviour === "missing" ? undefined : { getCurrentPosition, watchPosition: vi.fn() },
    configurable: true,
  });
  return getCurrentPosition;
}

const ATTRIBUTION = "Powered by WeatherAPI.com";

function forecast(overrides: Partial<CityForecast> = {}): CityForecast {
  return {
    source: "weatherapi",
    name: "Cebu City",
    region: "Cebu",
    country: "Philippines",
    temp_c: 29.4,
    temp_f: 84.9,
    condition: "Light rain",
    state: "rain",
    observed_at: 1_700_000_000_000,
    days: [
      { date: "2026-09-21", max_c: 31, min_c: 25, max_f: 87.8, min_f: 77, condition: "Patchy rain", state: "rain" },
      { date: "2026-09-22", max_c: 32, min_c: 26, max_f: 89.6, min_f: 78.8, condition: "Sunny", state: "clear" },
      { date: "2026-09-23", max_c: 30, min_c: 24, max_f: 86, min_f: 75.2, condition: "Thundery", state: "thunderstorm" },
    ],
    attribution: ATTRIBUTION,
    ...overrides,
  };
}

function matches(): CitySearchResult {
  return {
    source: "weatherapi",
    results: [{ query: "10.3000,123.9000", name: "Cebu City", region: "Cebu", country: "Philippines" }],
    attribution: ATTRIBUTION,
  };
}

const CITY_KEY = "vo.weather.city.v1";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fetchCityForecast.mockResolvedValue(forecast());
  searchCities.mockResolvedValue(matches());
  reverseGeocode.mockResolvedValue(null);
});
afterEach(() => localStorage.clear());

/** Put the card in the state it is in for somebody who has already picked a city. */
function withRememberedCity() {
  localStorage.setItem(
    CITY_KEY,
    JSON.stringify({ query: "10.3000,123.9000", name: "Cebu City", region: "Cebu", country: "Philippines" }),
  );
}

describe("WeatherForecastCard", () => {
  it("asks for nothing — and asks the BROWSER for nothing — until the employee acts", () => {
    const getCurrentPosition = stubGeolocation("grant");
    render(<WeatherForecastCard />);
    expect(screen.getByRole("button", { name: "Use my location" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a city" })).toBeTruthy();
    expect(fetchCityForecast).not.toHaveBeenCalled();
    // THE PRIVACY RULE: no permission prompt on mount, ever.
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("shows today plus the next two days for the remembered city", async () => {
    withRememberedCity();
    render(<WeatherForecastCard />);

    await screen.findByText("29°");
    expect(fetchCityForecast).toHaveBeenCalledWith("10.3000,123.9000");
    expect(screen.getByText("Cebu City, Cebu, Philippines")).toBeTruthy();
    // Today + the next two, and each one's own high and low.
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getAllByText(/^\d+°$/).length).toBeGreaterThanOrEqual(7); // current + 3×(high, low)
    expect(screen.getByText("31°")).toBeTruthy();
    expect(screen.getByText("25°")).toBeTruthy();
  });

  it("shows a loading state while the first reading is in flight", async () => {
    withRememberedCity();
    let release: ((f: CityForecast) => void) | null = null;
    fetchCityForecast.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<WeatherForecastCard />);
    expect(screen.getByText(/Loading forecast/i)).toBeTruthy();
    release!(forecast());
    await screen.findByText("29°");
  });

  it("searches on submit — never per keystroke, which would be one request per letter", async () => {
    render(<WeatherForecastCard />);
    fireEvent.click(screen.getByRole("button", { name: /Choose (a )?city/i }));
    const input = screen.getByLabelText("Search for a city");
    fireEvent.change(input, { target: { value: "cebu" } });
    expect(searchCities).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(searchCities).toHaveBeenCalledWith("cebu"));
  });

  it("remembers the chosen city LOCALLY, and loads it", async () => {
    render(<WeatherForecastCard />);
    fireEvent.click(screen.getByRole("button", { name: /Choose (a )?city/i }));
    fireEvent.change(screen.getByLabelText("Search for a city"), { target: { value: "cebu" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(await screen.findByRole("button", { name: "Cebu City, Cebu, Philippines" }));
    await screen.findByText("29°");

    expect(fetchCityForecast).toHaveBeenCalledWith("10.3000,123.9000");
    // LOCAL AND ONLY LOCAL: a device preference, never a posted profile field.
    expect(JSON.parse(localStorage.getItem(CITY_KEY)!).name).toBe("Cebu City");
  });

  // ---- disambiguating two places that share a name ------------------------------------------
  // The backend now returns BOTH "Mandaluyong, Cavite" and "Mandaluyong City, Metro Manila" for one
  // search (see backend/tests/test_weather.py). The card's job is to make them tellable apart and to
  // use whichever the employee actually picked.
  const MANDALUYONG_TWO: CitySearchResult = {
    source: "weatherapi",
    results: [
      { query: "14.2700,120.9200", name: "Mandaluyong", region: "Cavite", country: "Philippines" },
      { query: "14.5800,121.0400", name: "Mandaluyong City", region: "Metro Manila", country: "Philippines" },
    ],
    attribution: ATTRIBUTION,
  };

  async function searchFor(term: string) {
    render(<WeatherForecastCard />);
    fireEvent.click(screen.getByRole("button", { name: /Choose (a )?city/i }));
    fireEvent.change(screen.getByLabelText("Search for a city"), { target: { value: term } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
  }

  it("labels every result with city, region AND country, so two same-named places are tellable apart", async () => {
    searchCities.mockResolvedValue(MANDALUYONG_TWO);
    await searchFor("mandaluyong");
    expect(await screen.findByRole("button", { name: "Mandaluyong, Cavite, Philippines" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mandaluyong City, Metro Manila, Philippines" })).toBeTruthy();
  });

  it("NEVER silently picks the first result — the second one is loaded when it is the one chosen", async () => {
    searchCities.mockResolvedValue(MANDALUYONG_TWO);
    await searchFor("mandaluyong");
    fireEvent.click(await screen.findByRole("button", { name: "Mandaluyong City, Metro Manila, Philippines" }));
    await screen.findByText("29°");

    // The CHOSEN row's own coordinates, not the first row's and not a re-resolution by name.
    expect(fetchCityForecast).toHaveBeenCalledWith("14.5800,121.0400");
    expect(fetchCityForecast).not.toHaveBeenCalledWith("14.2700,120.9200");
    expect(JSON.parse(localStorage.getItem(CITY_KEY)!)).toMatchObject({
      query: "14.5800,121.0400", name: "Mandaluyong City", region: "Metro Manila",
    });
  });

  it("keeps those exact coordinates across a remount, with no second search", async () => {
    searchCities.mockResolvedValue(MANDALUYONG_TWO);
    await searchFor("mandaluyong");
    fireEvent.click(await screen.findByRole("button", { name: "Mandaluyong City, Metro Manila, Philippines" }));
    await screen.findByText("29°");
    searchCities.mockClear();
    fetchCityForecast.mockClear();

    render(<WeatherForecastCard />); // a reload, reading the saved city back
    await waitFor(() => expect(fetchCityForecast).toHaveBeenCalledWith("14.5800,121.0400"));
    expect(searchCities).not.toHaveBeenCalled();
  });

  it("drops an empty region rather than rendering a hanging comma", async () => {
    searchCities.mockResolvedValue({
      source: "weatherapi",
      results: [{ query: "10.7800,106.7000", name: "Ho Chi Minh City", region: "", country: "Vietnam" }],
      attribution: ATTRIBUTION,
    });
    await searchFor("ho chi minh");
    expect(await screen.findByRole("button", { name: "Ho Chi Minh City, Vietnam" })).toBeTruthy();
  });

  it("says so when nothing matched, which is not an error", async () => {
    searchCities.mockResolvedValue({ source: "weatherapi", results: [], attribution: ATTRIBUTION });
    render(<WeatherForecastCard />);
    fireEvent.click(screen.getByRole("button", { name: /Choose (a )?city/i }));
    fireEvent.change(screen.getByLabelText("Search for a city"), { target: { value: "zzzzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No cities matched/i)).toBeTruthy();
  });

  it("distinguishes a rate limit from a plain outage, on both lookups", async () => {
    withRememberedCity();
    fetchCityForecast.mockResolvedValue({ ...forecast(), source: "rate_limited", days: [] });
    searchCities.mockResolvedValue({ source: "rate_limited", results: [], attribution: ATTRIBUTION });
    render(<WeatherForecastCard />);
    expect(await screen.findByText(/Too many weather lookups/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Change city/i }));
    fireEvent.change(screen.getByLabelText("Search for a city"), { target: { value: "cebu" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Too many lookups/i)).toBeTruthy();
  });

  it("renders an error state rather than throwing when the request fails", async () => {
    withRememberedCity();
    fetchCityForecast.mockRejectedValue(new Error("network"));
    render(<WeatherForecastCard />);
    expect(await screen.findByText(/unavailable right now/i)).toBeTruthy();
  });

  it("treats an unavailable provider as an error state, not as an empty forecast", async () => {
    withRememberedCity();
    fetchCityForecast.mockResolvedValue({ ...forecast(), source: "unavailable", days: [] });
    render(<WeatherForecastCard />);
    expect(await screen.findByText(/unavailable right now/i)).toBeTruthy();
  });

  it("shows WeatherAPI's credit line in every state, as their terms require", async () => {
    render(<WeatherForecastCard />);
    expect(screen.getByRole("link", { name: ATTRIBUTION })).toBeTruthy(); // first-run state

    withRememberedCity();
    const view = render(<WeatherForecastCard />);
    await screen.findAllByText("29°");
    expect(view.getAllByRole("link", { name: ATTRIBUTION }).length).toBeGreaterThan(0);
  });

  it("NEVER asks the browser where the device is", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition, watchPosition: vi.fn() },
      configurable: true,
    });
    withRememberedCity();
    render(<WeatherForecastCard />);
    await screen.findByText("29°");
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("is INFORMATIONAL: it reaches nothing that drives V2's simulated environment", () => {
    // The real-world forecast and the office's own weather are two different things that happen to
    // share a provider. The card must not be able to become a third way to set the sky.
    const src = readFileSync("src/components/OfficeMap/WeatherForecastCard.tsx", "utf8");
    // IMPORT lines only — the prose above them is allowed to name the modules it is explaining.
    const imports = src.split("\n").filter((l: string) => /^\s*import\s/.test(l)).join("\n");
    for (const forbidden of ["vo3d/env", "weatherGrade", "environmentStore", "setWeather", "experience"]) {
      expect(imports).not.toContain(forbidden);
    }
  });

  // ---- "Use my location" ----------------------------------------------------------------------
  // User-initiated only, approximate and honest about it, never persisted, and never asked twice.
  describe("device location", () => {
    it("is only ever requested from the button, and fetches the DEVICE point, coarsened", async () => {
      const getCurrentPosition = stubGeolocation("grant", { latitude: 14.5794, longitude: 121.0359 });
      reverseGeocode.mockResolvedValue({
        query: "14.5800,121.0400", name: "Mandaluyong City", region: "Metro Manila", country: "Philippines",
      });
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

      await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
      // COARSENED TO ~1.1km, and it is the device's own point — not a city centroid, and not the
      // full precision the browser handed over.
      await waitFor(() => expect(fetchCityForecast).toHaveBeenCalledWith("14.58,121.04"));
      expect(await screen.findByText("Mandaluyong City, Metro Manila, Philippines")).toBeTruthy();
    });

    it("says APPROXIMATE, and never claims the fix is exact", async () => {
      stubGeolocation("grant");
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      expect(await screen.findByText("Approximate")).toBeTruthy();
      expect(screen.getByText(/approximate location/i)).toBeTruthy();
    });

    it("does NOT name a place the reverse lookup could not vouch for", async () => {
      stubGeolocation("grant");
      reverseGeocode.mockResolvedValue(null); // too far away to believe, or nothing matched
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      expect(await screen.findByText("Your area")).toBeTruthy();
      await waitFor(() => expect(fetchCityForecast).toHaveBeenCalledWith("14.58,121.04"));
    });

    it("remembers the VERIFIED CITY — never the raw device point", async () => {
      stubGeolocation("grant", { latitude: 14.5794, longitude: 121.0359 });
      reverseGeocode.mockResolvedValue({
        query: "14.5800,121.0400", name: "Mandaluyong City", region: "Metro Manila", country: "Philippines",
      });
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

      await waitFor(() => expect(localStorage.getItem(CITY_KEY)).not.toBeNull());
      const saved = JSON.parse(localStorage.getItem(CITY_KEY)!);
      // The provider's own public city entry, with ITS coordinates...
      expect(saved).toMatchObject({ name: "Mandaluyong City", region: "Metro Manila", query: "14.5800,121.0400" });
      // ...and NOT the device fix, at any precision.
      expect(localStorage.getItem(CITY_KEY)).not.toContain("14.58,121.04");
      expect(localStorage.getItem(CITY_KEY)).not.toContain("14.5794");
    });

    it("survives a reload as an ordinary saved city, asking the browser nothing", async () => {
      const getCurrentPosition = stubGeolocation("grant");
      reverseGeocode.mockResolvedValue({
        query: "14.5800,121.0400", name: "Mandaluyong City", region: "Metro Manila", country: "Philippines",
      });
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      await waitFor(() => expect(localStorage.getItem(CITY_KEY)).not.toBeNull());
      getCurrentPosition.mockClear();
      fetchCityForecast.mockClear();
      cleanup(); // a reload, not a second card beside the first

      render(<WeatherForecastCard />);
      await waitFor(() => expect(fetchCityForecast).toHaveBeenCalledWith("14.5800,121.0400"));
      expect(getCurrentPosition).not.toHaveBeenCalled();
      // A saved city is a city: no "Approximate" framing on the way back in.
      expect(screen.queryAllByText("Approximate")).toHaveLength(0);
    });

    it("saves NOTHING when the lookup cannot vouch for a city", async () => {
      stubGeolocation("grant");
      reverseGeocode.mockResolvedValue(null);
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

      expect(await screen.findByText("Your area")).toBeTruthy();
      await waitFor(() => expect(fetchCityForecast).toHaveBeenCalledWith("14.58,121.04"));
      // No invented city, and no coordinates either.
      expect(localStorage.getItem(CITY_KEY)).toBeNull();
    });

    it("on denial: offers a city instead, falls back to NOTHING, and never asks again", async () => {
      const getCurrentPosition = stubGeolocation("deny");
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

      expect(await screen.findByText(/couldn't get your location/i)).toBeTruthy();
      expect(screen.getByLabelText("Search for a city")).toBeTruthy();
      // NO silent fallback: no Manila, no office default, no forecast at all.
      expect(fetchCityForecast).not.toHaveBeenCalled();
      // ...and the prompt is not raised a second time.
      expect(screen.getByRole("button", { name: "Use my location" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it("handles a browser with no geolocation at all, without asking", async () => {
      stubGeolocation("missing");
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      expect(await screen.findByText(/can't share a location/i)).toBeTruthy();
      expect(fetchCityForecast).not.toHaveBeenCalled();
    });

    it("A SAVED CITY WINS: it loads immediately and the location prompt is not even offered", async () => {
      const getCurrentPosition = stubGeolocation("grant");
      withRememberedCity();
      render(<WeatherForecastCard />);
      await screen.findByText("29°");
      expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(fetchCityForecast).toHaveBeenCalledWith("10.3000,123.9000");
    });

    it("a manual choice after a device fix becomes the saved preference", async () => {
      stubGeolocation("grant");
      render(<WeatherForecastCard />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      await waitFor(() => expect(fetchCityForecast).toHaveBeenCalledWith("14.58,121.04"));

      fireEvent.click(screen.getByRole("button", { name: /Change city/i }));
      fireEvent.change(screen.getByLabelText("Search for a city"), { target: { value: "cebu" } });
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cebu City, Cebu, Philippines" }));

      await waitFor(() => expect(JSON.parse(localStorage.getItem(CITY_KEY)!).name).toBe("Cebu City"));
      expect(screen.queryByText("Approximate")).toBeNull();
    });
  });

  it("survives a browser that refuses localStorage", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<WeatherForecastCard />);
    expect(screen.getByRole("button", { name: "Use my location" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Choose (a )?city/i }));
    fireEvent.change(screen.getByLabelText("Search for a city"), { target: { value: "cebu" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cebu City, Cebu, Philippines" }));
    // The city is not remembered for next time, but this session still works.
    await screen.findByText("29°");
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
