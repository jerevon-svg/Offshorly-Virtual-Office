import { fireEvent, render, screen } from "@testing-library/react";
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

import { setMuted, setVolume } from "../../audio/backgroundMusic";
import { HUD_ICONS } from "../HudIcon";
import { HudSettings } from "./HudSettings";

const lighting = {
  phase: "sunset" as const,
  hourDecimal: 18.333,
  followingRealTime: true,
  onFollowRealTimeChange: vi.fn(),
};

beforeEach(() => {
  vi.mocked(setMuted).mockReset();
  vi.mocked(setVolume).mockReset();
  lighting.onFollowRealTimeChange.mockReset();
});

describe("the settings shell", () => {
  it("is a modal that closes from its own close button and from the scrim", () => {
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
  });

  it("says changes are immediate, which is what every row here does", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.getByText(/changes apply immediately/i)).toBeInTheDocument();
  });
});

describe("Sound — the existing BackgroundMusicControl", () => {
  it("still drives mute and volume through the audio singleton", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    fireEvent.click(screen.getByRole("button", { name: "Mute background music" }));
    expect(setMuted).toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByRole("slider", { name: "Background music volume" }), {
      target: { value: "0.8" },
    });
    expect(setVolume).toHaveBeenCalledWith(0.8);
  });
});

describe("Appearance — the existing day/night behaviour", () => {
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

  it("renders no Appearance section at all rather than a dead row when there is no phase state", () => {
    render(<HudSettings onClose={() => {}} />);
    expect(screen.queryByTestId("lighting-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("DEV gating", () => {
  // Production builds pass neither prop (OfficeMap gates both on import.meta.env.DEV), and the
  // section must then not exist — not merely be empty.
  it("hides Developer tools entirely when no DEV handler is supplied", () => {
    render(<HudSettings onClose={() => {}} lighting={lighting} />);
    expect(screen.queryByText(/developer tools/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reset hub demo state/i)).not.toBeInTheDocument();
  });

  it("shows Developer tools, with the caller's existing handler, when DEV supplies one", () => {
    const onResetHubDemo = vi.fn();
    render(<HudSettings onClose={() => {}} lighting={lighting} onResetHubDemo={onResetHubDemo} />);
    expect(screen.getByText(/developer tools/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset hub demo state/i }));
    expect(onResetHubDemo).toHaveBeenCalledTimes(1);
  });

  it("carries the relocated DEV panels through untouched", () => {
    render(
      <HudSettings onClose={() => {}} lighting={lighting} devTools={<div data-testid="dev-panels" />} />,
    );
    expect(screen.getByTestId("dev-panels")).toBeInTheDocument();
  });
});
