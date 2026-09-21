// SETTINGS -> ENVIRONMENT, the panel. What is asserted is that this surface is a VIEW of the shared
// preference store and not a second implementation of anything: the selection it shows is whatever the
// STORE says, every click writes exactly one axis, and the choice it writes is the one that is still
// there after a reload — because the panel put it somewhere that outlives the page.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Vo3dEnvironmentPanel } from "./Vo3dEnvironmentPanel";
import { ENV_TIME_MODES } from "../env/timeOfDay";
import { WEATHER_MODES } from "../env/weather";
import {
  __resetEnvironmentPreferencesForTests,
  getEnvironmentPreferences,
  setEnvironmentPreference,
} from "../../../services/settings/environmentPreferences";

const tile = (group: string, value: string) =>
  screen.getByRole("radiogroup", { name: group }).querySelector<HTMLButtonElement>(`[data-value="${value}"]`)!;

const checked = (group: string, value: string) => tile(group, value).getAttribute("aria-checked");

beforeEach(() => {
  window.localStorage.clear();
  __resetEnvironmentPreferencesForTests();
});

describe("the Environment settings section", () => {
  it("opens on Auto for both axes when nothing has been chosen", () => {
    render(<Vo3dEnvironmentPanel />);
    expect(checked("Time of day", "auto")).toBe("true");
    expect(checked("Weather", "auto")).toBe("true");
  });

  it("opens on whatever the STORE says, not on a default of its own", () => {
    setEnvironmentPreference("time", "sunset");
    setEnvironmentPreference("weather", "rain");
    render(<Vo3dEnvironmentPanel />);
    expect(checked("Time of day", "sunset")).toBe("true");
    expect(checked("Weather", "rain")).toBe("true");
    expect(checked("Time of day", "auto")).toBe("false");
  });

  it("writes the time axis, and leaves the weather alone", () => {
    render(<Vo3dEnvironmentPanel />);
    fireEvent.click(tile("Time of day", "night"));
    expect(getEnvironmentPreferences()).toEqual({ time: "night", weather: "auto" });
    expect(checked("Time of day", "night")).toBe("true");
    expect(checked("Weather", "auto")).toBe("true");
  });

  it("writes the weather axis, and leaves the time alone", () => {
    render(<Vo3dEnvironmentPanel />);
    fireEvent.click(tile("Weather", "thunderstorm"));
    expect(getEnvironmentPreferences()).toEqual({ time: "auto", weather: "thunderstorm" });
    expect(checked("Weather", "thunderstorm")).toBe("true");
    expect(checked("Time of day", "auto")).toBe("true");
  });

  it("holds the two independent combinations the product promises", () => {
    render(<Vo3dEnvironmentPanel />);
    fireEvent.click(tile("Time of day", "sunset")); // manual sunset + auto weather
    expect(getEnvironmentPreferences()).toEqual({ time: "sunset", weather: "auto" });

    fireEvent.click(tile("Time of day", "auto")); // auto time + manual rain
    fireEvent.click(tile("Weather", "rain"));
    expect(getEnvironmentPreferences()).toEqual({ time: "auto", weather: "rain" });
  });

  it("offers AUTO on both axes — the real clock and the real provider are always reachable", () => {
    setEnvironmentPreference("time", "day");
    setEnvironmentPreference("weather", "heavy_rain");
    render(<Vo3dEnvironmentPanel />);
    fireEvent.click(tile("Time of day", "auto"));
    fireEvent.click(tile("Weather", "auto"));
    expect(getEnvironmentPreferences()).toEqual({ time: "auto", weather: "auto" });
  });

  it("repaints when the store changes underneath it", () => {
    render(<Vo3dEnvironmentPanel />);
    act(() => setEnvironmentPreference("time", "day"));
    expect(checked("Time of day", "day")).toBe("true");
  });

  it("offers exactly the vocabularies env/timeOfDay and env/weather already define", () => {
    render(<Vo3dEnvironmentPanel />);
    const values = (group: string) =>
      [...screen.getByRole("radiogroup", { name: group }).querySelectorAll("[data-value]")]
        .map((el) => el.getAttribute("data-value"));
    expect(values("Time of day")).toEqual(ENV_TIME_MODES);
    expect(values("Weather")).toEqual(WEATHER_MODES);
  });

  it("holds the choice across a view change — the panel is remounted, the preference is not", () => {
    render(<Vo3dEnvironmentPanel />);
    fireEvent.click(tile("Time of day", "night"));
    fireEvent.click(tile("Weather", "cloudy"));

    // OFFICE -> 3D -> PLAYER. Switching view tears the settings surface down and builds it again; the
    // preference lives in the store, which none of that touches.
    for (let view = 0; view < 3; view += 1) {
      cleanup();
      render(<Vo3dEnvironmentPanel />);
      expect(checked("Time of day", "night")).toBe("true");
      expect(checked("Weather", "cloudy")).toBe("true");
    }
  });

  it("walks each row with the arrow keys, one axis at a time", () => {
    render(<Vo3dEnvironmentPanel />);
    fireEvent.keyDown(tile("Time of day", "auto"), { key: "ArrowRight" });
    expect(getEnvironmentPreferences()).toEqual({ time: "day", weather: "auto" });
  });
});
