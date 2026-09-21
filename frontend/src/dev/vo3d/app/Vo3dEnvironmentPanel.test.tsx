// TEMPORARY — PRESENTATION ENVIRONMENT SWITCHER (demo only). Delete with the panel it covers.
//
// What is asserted is that this surface is a VIEW and not a second implementation: every click goes
// straight to the world's existing env/weather setters (the dev GUI's own handler bodies), the selection
// it shows is whatever the WORLD says afterwards rather than what was clicked, and nothing about the
// world is remounted or reset on the way.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dEnvironmentPanel } from "./Vo3dEnvironmentPanel";
import type { Vo3dWorld } from "./world";
import type { EnvTimeMode } from "../env/timeOfDay";
import type { WeatherMode } from "../env/weather";

let time: EnvTimeMode;
let weather: WeatherMode;
const setTime = vi.fn((m: EnvTimeMode) => { time = m; });
const setWeather = vi.fn((m: WeatherMode) => { weather = m; });
/** Everything else on the world, so a call to anything but the two setters is a visible failure. */
const dispose = vi.fn();
const setCoworkers = vi.fn();
const setViewMode = vi.fn();

const worldRef = {
  current: {
    presentationEnv: { time: () => time, setTime, weather: () => weather, setWeather },
    dispose, setCoworkers, setViewMode,
  } as unknown as Vo3dWorld,
};

const tile = (group: string, label: string) =>
  screen.getByRole("radiogroup", { name: group }).querySelector<HTMLButtonElement>(`[data-value="${label}"]`)!;

beforeEach(() => {
  vi.clearAllMocks();
  time = "auto";
  weather = "auto";
});

describe("the presentation environment switcher", () => {
  it("opens on whatever the WORLD currently says, not on a default of its own", () => {
    time = "sunset";
    weather = "rain";
    render(<Vo3dEnvironmentPanel worldRef={worldRef} />);
    expect(tile("Time of day", "sunset").getAttribute("aria-checked")).toBe("true");
    expect(tile("Weather", "rain").getAttribute("aria-checked")).toBe("true");
    expect(tile("Time of day", "auto").getAttribute("aria-checked")).toBe("false");
  });

  it("drives the EXISTING time setter, and shows the world's answer", () => {
    render(<Vo3dEnvironmentPanel worldRef={worldRef} />);
    fireEvent.click(tile("Time of day", "night"));
    expect(setTime).toHaveBeenCalledWith("night");
    expect(tile("Time of day", "night").getAttribute("aria-checked")).toBe("true");
    // The other axis is untouched: weather composes WITH the time, it does not replace it.
    expect(setWeather).not.toHaveBeenCalled();
    expect(tile("Weather", "auto").getAttribute("aria-checked")).toBe("true");
  });

  it("drives the EXISTING weather setter, and leaves the time alone", () => {
    render(<Vo3dEnvironmentPanel worldRef={worldRef} />);
    fireEvent.click(tile("Weather", "thunderstorm"));
    expect(setWeather).toHaveBeenCalledWith("thunderstorm");
    expect(tile("Weather", "thunderstorm").getAttribute("aria-checked")).toBe("true");
    expect(setTime).not.toHaveBeenCalled();
  });

  it("offers AUTO on both axes — the real clock and the real provider are reachable again", () => {
    time = "day";
    weather = "heavy_rain";
    render(<Vo3dEnvironmentPanel worldRef={worldRef} />);
    fireEvent.click(tile("Time of day", "auto"));
    fireEvent.click(tile("Weather", "auto"));
    expect(setTime).toHaveBeenCalledWith("auto");
    expect(setWeather).toHaveBeenCalledWith("auto");
  });

  it("offers exactly the vocabularies env/timeOfDay and env/weather already define", async () => {
    const { ENV_TIME_MODES } = await import("../env/timeOfDay");
    const { WEATHER_MODES } = await import("../env/weather");
    render(<Vo3dEnvironmentPanel worldRef={worldRef} />);
    const values = (group: string) =>
      [...screen.getByRole("radiogroup", { name: group }).querySelectorAll("[data-value]")]
        .map((el) => el.getAttribute("data-value"));
    expect(values("Time of day")).toEqual(ENV_TIME_MODES);
    expect(values("Weather")).toEqual(WEATHER_MODES);
  });

  it("touches nothing else about the world — no remount, no reset", () => {
    render(<Vo3dEnvironmentPanel worldRef={worldRef} />);
    fireEvent.click(tile("Time of day", "sunset"));
    fireEvent.click(tile("Weather", "cloudy"));
    expect(dispose).not.toHaveBeenCalled();
    expect(setCoworkers).not.toHaveBeenCalled();
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it("renders harmlessly before the world exists, and works once it does", () => {
    const empty = { current: null } as { current: Vo3dWorld | null };
    render(<Vo3dEnvironmentPanel worldRef={empty} />);
    expect(tile("Time of day", "auto").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tile("Time of day", "day")); // must not throw
    expect(tile("Time of day", "day").getAttribute("aria-checked")).toBe("true");
  });
});
