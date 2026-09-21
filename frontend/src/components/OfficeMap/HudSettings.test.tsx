import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The audio SINGLETON is faked, not the control: HudSettings must still mount the real
// BackgroundMusicControl, and what this proves is that its existing mute/volume handlers reach
// the store unchanged now that it sits inside the settings modal.
const audio = vi.hoisted(() => ({ muted: false, volume: 0.35 }));
vi.mock("../../audio/backgroundMusic", () => ({
  armAutoplay: vi.fn(),
  getVolume: () => audio.volume,
  isMuted: () => audio.muted,
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  subscribe: () => () => {},
}));

// Privacy reaches the EXISTING team-map service. The service is faked so these tests never touch the
// network; what is under test is that the panel calls it and reports what it says.
const teamMap = vi.hoisted(() => ({
  getPeople: vi.fn(),
  stopWorkingToday: vi.fn(),
  forgetWorkingToday: vi.fn(),
}));
vi.mock("../../services/teamMap", () => ({ teamMapService: teamMap }));

import { setMuted, setVolume } from "../../audio/backgroundMusic";
import { HUD_ICONS } from "../HudIcon";
import { HudSettings } from "./HudSettings";
import {
  __resetExperiencePreferencesForTests,
  getExperiencePreferences,
} from "../../services/settings/experiencePreferences";
import { __resetGraphicsPreferenceForTests } from "../../services/render/graphicsPreferences";

const lighting = {
  phase: "sunset" as const,
  hourDecimal: 18.333,
  followingRealTime: true,
  onFollowRealTimeChange: vi.fn(),
};

/** Open a category by its own tab, which is the only way to reach its rows now. */
function openCategory(name: string) {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`, "i") }));
}

beforeEach(() => {
  window.localStorage.clear();
  __resetExperiencePreferencesForTests();
  __resetGraphicsPreferenceForTests();
  audio.muted = false;
  audio.volume = 0.35;
  vi.mocked(setMuted).mockReset();
  vi.mocked(setVolume).mockReset();
  lighting.onFollowRealTimeChange.mockReset();
  teamMap.getPeople.mockReset().mockResolvedValue({ people: [], source: "mock", generated_at: "", me: null });
  teamMap.stopWorkingToday.mockReset().mockResolvedValue(undefined);
  teamMap.forgetWorkingToday.mockReset().mockResolvedValue(undefined);
});

describe("the settings shell", () => {
  it("is a modal that closes from its own close button, the scrim and Esc", () => {
    const onClose = vi.fn();
    render(<HudSettings onClose={onClose} lighting={lighting} />);
    const panel = screen.getByRole("dialog", { name: "Settings" });
    expect(panel).toHaveAttribute("aria-modal", "true");

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // A press on the scrim itself dismisses; a press inside the panel must not.
    fireEvent.pointerDown(panel);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId("hud-settings-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("says changes are immediate, which is what every row here does", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.getByText(/changes apply immediately/i)).toBeInTheDocument();
  });
});

describe("the category navigation", () => {
  it("offers only the categories this caller actually backs, and opens on the first one", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    // A 2D-office caller: no world to apply Controls or Interface to, and no DEV tools passed.
    expect(screen.getByRole("tab", { name: /^General/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /^Controls/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Interface/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Developer/ })).not.toBeInTheDocument();
    for (const name of [/^Graphics/, /^Audio/, /^Privacy/]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("adds Controls and Interface only where a 3D world is listening", () => {
    render(<HudSettings onClose={() => {}} worldExperience />);
    expect(screen.getByRole("tab", { name: /^Controls/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Interface/ })).toBeInTheDocument();
  });

  it("describes each category by what this caller actually put in it", () => {
    // A hint that named a row the caller does not supply is the same dead promise a dead control is.
    const { unmount } = render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.getByRole("tab", { name: /^General/ })).toHaveTextContent("Office lighting");
    expect(screen.getByRole("tab", { name: /^Audio/ })).toHaveTextContent("Office background music");
    unmount();

    render(<HudSettings onClose={() => {}} worldExperience />);
    expect(screen.getByRole("tab", { name: /^General/ })).toHaveTextContent("How the office opens");
    expect(screen.getByRole("tab", { name: /^Audio/ })).toHaveTextContent("Music and office ambience");
  });

  it("shows one category at a time, and marks the chosen one", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.getByTestId("lighting-status")).toBeInTheDocument();

    openCategory("Graphics");
    expect(screen.getByRole("tab", { name: /^Graphics/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^General/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("lighting-status")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Graphics and display" })).toBeInTheDocument();
  });

  it("walks the list with the arrow keys, as a tablist is expected to", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    const tablist = screen.getByRole("tablist", { name: "Settings categories" });
    fireEvent.keyDown(tablist, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: /^Graphics/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: /^Privacy/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { name: /^General/ })).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to a real category when the one in view stops being supplied", () => {
    const { rerender } = render(<HudSettings onClose={() => {}} lighting={lighting} worldExperience />);
    openCategory("Interface");
    expect(screen.getByRole("tab", { name: /^Interface/ })).toHaveAttribute("aria-selected", "true");

    rerender(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.queryByRole("tab", { name: /^Interface/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^General/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Audio", () => {
  // PHASE 7C — two sound systems, one control shape. What is asserted is that the unified card still
  // reaches the EXISTING singleton (audio/backgroundMusic), not a second audio path.
  it("drives music mute and volume through the audio singleton", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    openCategory("Audio");

    fireEvent.change(screen.getByRole("slider", { name: "Music volume" }), { target: { value: "0.8" } });
    expect(setVolume).toHaveBeenCalledWith(0.8);

    // The switch is "on", so turning it OFF is a mute — one concept, stated the way the ambience row
    // states it rather than as an icon button with the opposite polarity.
    fireEvent.click(screen.getByRole("checkbox", { name: "Office music" }));
    expect(setMuted).toHaveBeenCalledWith(true);
  });

  it("gives music and ambience the same card: a switch, a full-width slider and a percentage", () => {
    audio.volume = 0.35;
    render(<HudSettings onClose={() => {}} worldExperience />);
    openCategory("Audio");

    expect(screen.getByTestId("music-volume")).toHaveTextContent("35%");
    expect(screen.getByTestId("ambience-volume")).toHaveTextContent("50%");
    for (const name of ["Music volume", "Ambience volume"]) {
      expect(screen.getByRole("slider", { name })).toBeInTheDocument();
    }
    for (const name of ["Office music", "Office ambience"]) {
      expect(screen.getByRole("checkbox", { name })).toBeInTheDocument();
    }
  });

  it("disables each slider while its sound is off, so a drag cannot un-mute behind the switch", () => {
    audio.muted = true;
    render(<HudSettings onClose={() => {}} worldExperience />);
    openCategory("Audio");
    expect(screen.getByRole("checkbox", { name: "Office music" })).not.toBeChecked();
    expect(screen.getByRole("slider", { name: "Music volume" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Office ambience" }));
    expect(getExperiencePreferences().ambientAudio).toBe(false);
    expect(screen.getByRole("slider", { name: "Ambience volume" })).toBeDisabled();
  });

  it("offers the world's ambience only where there is a world, and persists it", () => {
    const { unmount } = render(<HudSettings onClose={() => {}} lighting={lighting} />);
    openCategory("Audio");
    expect(screen.queryByRole("checkbox", { name: "Office ambience" })).not.toBeInTheDocument();
    unmount();

    render(<HudSettings onClose={() => {}} worldExperience />);
    openCategory("Audio");
    fireEvent.change(screen.getByRole("slider", { name: "Ambience volume" }), { target: { value: "0.2" } });
    expect(getExperiencePreferences().ambientVolume).toBeCloseTo(0.2);
    expect(JSON.parse(window.localStorage.getItem("vo:experience:v1")!).ambientVolume).toBeCloseTo(0.2);
  });
});

describe("General — the existing day/night behaviour", () => {
  it("quotes the real phase and hour the office is lit by", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.getByTestId("lighting-status")).toHaveTextContent("Sunset · 18:20 · Real time");
  });

  it("leads the row with the dedicated lighting icon, not the borrowed clock", () => {
    const { container } = render(<HudSettings onClose={() => {}} lighting={lighting} />);
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(HUD_ICONS.lighting).toBeDefined();
    expect(sources).toContain(HUD_ICONS.lighting);
    // clock.png was the placeholder while the sun icon did not exist yet.
    expect(sources).not.toContain(HUD_ICONS.clock);
  });

  it("turns following off and back on through the caller's own setter", () => {
    const { rerender } = render(<HudSettings onClose={() => {}} lighting={lighting} />);
    const toggle = screen.getByRole("checkbox", { name: /office lighting follows the time of day/i });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(lighting.onFollowRealTimeChange).toHaveBeenCalledWith(false);

    rerender(<HudSettings onClose={() => {}} lighting={{ ...lighting, followingRealTime: false }} />);
    expect(screen.getByTestId("lighting-status")).toHaveTextContent("Sunset · 18:20 · Held");
    fireEvent.click(screen.getByRole("checkbox", { name: /office lighting follows the time of day/i }));
    expect(lighting.onFollowRealTimeChange).toHaveBeenLastCalledWith(true);
  });

  it("renders no lighting row at all rather than a dead one when there is no phase state", () => {
    render(<HudSettings onClose={() => {}} worldExperience />);
    expect(screen.queryByTestId("lighting-status")).not.toBeInTheDocument();
  });

  it("persists the starting view, which is the only General row a 3D caller gets", () => {
    render(<HudSettings onClose={() => {}} worldExperience />);
    const group = screen.getByRole("radiogroup", { name: "Starting view" });
    expect(within(group).getByRole("radio", { name: /Office/ })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: /Player/ }));
    expect(getExperiencePreferences().defaultView).toBe("player");
    expect(JSON.parse(window.localStorage.getItem("vo:experience:v1")!).defaultView).toBe("player");
  });
});

describe("Controls", () => {
  it("writes look sensitivity and invert straight to the store the camera reads", () => {
    render(<HudSettings onClose={() => {}} worldExperience />);
    openCategory("Controls");

    fireEvent.change(screen.getByRole("slider", { name: "Look sensitivity" }), { target: { value: "1.6" } });
    expect(getExperiencePreferences().lookSensitivity).toBeCloseTo(1.6);
    expect(screen.getByTestId("look-sensitivity-value")).toHaveTextContent("1.60×");

    fireEvent.click(screen.getByRole("checkbox", { name: "Invert vertical look" }));
    expect(getExperiencePreferences().invertLook).toBe(true);
  });

  it("states the bindings the input layer actually hard-codes", () => {
    render(<HudSettings onClose={() => {}} worldExperience />);
    openCategory("Controls");
    const pane = screen.getByTestId("settings-pane-controls");
    for (const key of ["W A S D", "Shift", "Space", "E", "V", "Esc", "Right-click"]) {
      expect(within(pane).getByText(key)).toBeInTheDocument();
    }
  });
});

describe("Interface", () => {
  it("persists the two in-world display switches", () => {
    render(<HudSettings onClose={() => {}} worldExperience />);
    openCategory("Interface");

    fireEvent.click(screen.getByRole("checkbox", { name: "Show nameplates above coworkers" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show chat above the world" }));
    expect(getExperiencePreferences().nameplates).toBe(false);
    expect(getExperiencePreferences().worldChatIndicators).toBe(false);

    const stored = JSON.parse(window.localStorage.getItem("vo:experience:v1")!);
    expect(stored).toMatchObject({ nameplates: false, worldChatIndicators: false });
  });
});

describe("Privacy", () => {
  it("asks the existing service only when the category is opened", async () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(teamMap.getPeople).not.toHaveBeenCalled();

    openCategory("Privacy");
    expect(await screen.findByText(/Nothing of yours is saved/i)).toBeInTheDocument();
    expect(teamMap.getPeople).toHaveBeenCalledTimes(1);
  });

  it("revokes a live share through the service's own calls", async () => {
    teamMap.getPeople.mockResolvedValue({
      people: [],
      source: "mock",
      generated_at: "",
      me: {
        active: true,
        shared_at: "2026-09-19T01:00:00Z",
        expires_at: "2026-09-19T13:00:00Z",
        stopped_at: null,
        latitude: 14.5,
        longitude: 121,
        location_label: "Cebu City",
        country_code: "PH",
        timezone: "Asia/Manila",
      },
    });
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    openCategory("Privacy");

    expect(await screen.findByTestId("privacy-share-status")).toHaveTextContent("Sharing Cebu City");
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(teamMap.stopWorkingToday).toHaveBeenCalledTimes(1);

    expect(await screen.findByRole("button", { name: "Remove saved location" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove saved location" }));
    expect(teamMap.forgetWorkingToday).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when it cannot check, rather than claiming nothing is shared", async () => {
    teamMap.getPeople.mockRejectedValue(new Error("offline"));
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    openCategory("Privacy");
    expect(await screen.findByTestId("privacy-share-status")).toHaveTextContent(/could not check/i);
  });
});

describe("DEV gating", () => {
  // Production builds pass neither prop (OfficeMap gates both on import.meta.env.DEV), and the
  // category must then not exist — not merely be empty.
  it("hides Developer entirely when no DEV handler is supplied", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.queryByRole("tab", { name: /^Developer/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/reset hub demo state/i)).not.toBeInTheDocument();
  });

  it("keeps the technical tools in their own category, away from every employee setting", () => {
    const onResetHubDemo = vi.fn();
    render(
      <HudSettings
        onClose={() => {}}
        lighting={lighting}
        worldExperience
        onResetHubDemo={onResetHubDemo}
        devTools={<div data-testid="dev-panels" />}
      />,
    );
    // Not reachable from any employee-facing pane.
    for (const name of ["General", "Controls", "Interface", "Graphics", "Audio"]) {
      openCategory(name);
      expect(screen.queryByTestId("dev-panels")).not.toBeInTheDocument();
    }

    openCategory("Developer");
    expect(screen.getByTestId("dev-panels")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset hub demo state/i }));
    expect(onResetHubDemo).toHaveBeenCalledTimes(1);
  });

  it("offers no room editing, seating, navigation or stress control of its own", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} worldExperience />);
    for (const name of ["General", "Controls", "Interface", "Graphics", "Audio"]) {
      openCategory(name);
      const pane = screen.getByRole("tabpanel");
      expect(pane.textContent ?? "").not.toMatch(/room editor|seat facing|stress|navmesh|click-to-walk grid/i);
    }
  });
});

// TEMPORARY — PRESENTATION ENVIRONMENT SWITCHER (demo only). Delete this block with the `environment`
// prop. What matters is that it is strictly OPT-IN: V1's office passes nothing and must be unable to
// tell the prop exists, and supplying it must not disturb the Developer category or anything else.
describe("the temporary Environment category", () => {
  it("does not exist at all for a caller that supplies no environment section", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} worldExperience />);
    expect(screen.queryByRole("tab", { name: /environment/i })).not.toBeInTheDocument();
  });

  it("appears as its own category, above Developer, and shows the caller's section", () => {
    render(
      <HudSettings
        onClose={() => {}}
        worldExperience
        environment={<div data-testid="env-section" />}
        devTools={<div data-testid="dev-panels" />}
      />,
    );
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    const env = tabs.findIndex((t) => /Environment/.test(t));
    const dev = tabs.findIndex((t) => /Developer/.test(t));
    expect(env).toBeGreaterThan(-1);
    expect(env).toBeLessThan(dev);

    openCategory("Environment");
    expect(screen.getByTestId("env-section")).toBeInTheDocument();
    // It is NOT the Developer pane wearing another name: the rig's own tools are not here.
    expect(screen.queryByTestId("dev-panels")).not.toBeInTheDocument();
  });

  it("leaves the Developer category exactly where it was and still reachable", () => {
    render(
      <HudSettings
        onClose={() => {}}
        worldExperience
        environment={<div data-testid="env-section" />}
        devTools={<div data-testid="dev-panels" />}
      />,
    );
    openCategory("Developer");
    expect(screen.getByTestId("dev-panels")).toBeInTheDocument();
    expect(screen.queryByTestId("env-section")).not.toBeInTheDocument();
  });
});
