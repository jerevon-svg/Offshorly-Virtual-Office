// Settings → Graphics & Display, as an employee meets it.
//
// The store is NOT mocked. The point of these tests is the seam between the panel and the persisted
// preference the 3D renderer reads — mocking it would test the panel against a fiction.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { HudGraphicsSettings } from "./HudGraphicsSettings";
import {
  __resetGraphicsPreferenceForTests,
  getCustomGraphics,
  getGraphicsMode,
} from "../../services/render/graphicsPreferences";
import { FULL_GRAPHICS } from "../../services/render/graphicsQuality";

beforeEach(() => {
  window.localStorage.clear();
  __resetGraphicsPreferenceForTests();
});

const modeRadio = (name: RegExp) => screen.getByRole("radio", { name });

describe("the mode choice", () => {
  it("offers exactly the three modes, with Smooth selected and marked as recommended", () => {
    render(<HudGraphicsSettings />);
    const group = screen.getByRole("radiogroup", { name: "Graphics mode" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(modeRadio(/Smooth — Recommended/)).toBeChecked();
    expect(modeRadio(/Full Graphics/)).toBeInTheDocument();
    expect(modeRadio(/Custom/)).toBeInTheDocument();
  });

  it("does not leak the internal quality profile names to the employee", () => {
    render(<HudGraphicsSettings />);
    const panel = screen.getByRole("region", { name: "Graphics and display" });
    for (const word of [/\blow\b/i, /\bmedium\b/i, /\bultra\b/i, /rung/i]) {
      expect(panel.textContent ?? "").not.toMatch(word);
    }
  });

  it("writes the chosen mode through to the store", () => {
    render(<HudGraphicsSettings />);
    fireEvent.click(modeRadio(/Full Graphics/));
    expect(getGraphicsMode()).toBe("full");
    expect(modeRadio(/Full Graphics/)).toBeChecked();
  });

  it("says plainly that Full Graphics is not adjusted automatically", () => {
    render(<HudGraphicsSettings />);
    fireEvent.click(modeRadio(/Full Graphics/));
    expect(screen.getByTestId("graphics-mode-status").textContent).toMatch(/never|Nothing is adjusted/i);
  });
});

describe("the individual controls", () => {
  it("shows the Full baseline values while nothing has been overridden", () => {
    render(<HudGraphicsSettings />);
    expect(screen.getByLabelText("Render quality")).toHaveValue(String(FULL_GRAPHICS.renderScale));
    expect(screen.getByLabelText("Shadows")).toHaveValue("true");
    expect(screen.getByLabelText("Ambient occlusion")).toHaveValue("true");
    expect(screen.getByLabelText("Character detail")).toHaveValue("high");
  });

  it("switches the mode to Custom when one is changed", () => {
    render(<HudGraphicsSettings />);
    expect(getGraphicsMode()).toBe("smooth");
    fireEvent.change(screen.getByLabelText("Shadows"), { target: { value: "false" } });
    expect(getGraphicsMode()).toBe("custom");
    expect(modeRadio(/Custom/)).toBeChecked();
  });

  it("maps each control onto the right stored setting", () => {
    render(<HudGraphicsSettings />);
    fireEvent.change(screen.getByLabelText("Render quality"), { target: { value: "0.75" } });
    fireEvent.change(screen.getByLabelText("Environment detail"), { target: { value: "reduced" } });
    fireEvent.change(screen.getByLabelText("Foliage movement"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("Character detail"), { target: { value: "standard" } });
    expect(getCustomGraphics()).toEqual({
      renderScale: 0.75,
      effectsDetail: "reduced",
      foliageSway: false,
      avatarDetail: "standard",
    });
  });

  it("keeps everything untouched at full quality", () => {
    render(<HudGraphicsSettings />);
    fireEvent.change(screen.getByLabelText("Shadows"), { target: { value: "false" } });
    expect(screen.getByLabelText("Ambient occlusion")).toHaveValue("true");
    expect(screen.getByLabelText("Render quality")).toHaveValue("1");
  });

  it("exposes no authored art or debug parameter", () => {
    // Asserted on the CONTROLS, not on the copy: "Sunlight and contact shadows" is a description of
    // what the shadow switch does, and scanning prose for the word would only teach the next person
    // to write a worse hint.
    render(<HudGraphicsSettings />);
    const panel = screen.getByRole("region", { name: "Graphics and display" });
    const labels = within(panel).getAllByRole("combobox").map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Render quality", "Shadows", "Ambient occlusion", "Environment detail", "Weather effects",
      "Foliage movement", "Character detail",
    ]);
    for (const banned of ["Sun intensity", "Sun warmth", "Moon colour", "Moon color", "Exposure", "Shadow bias",
      "SSAO radius", "Ambient intensity", "Static batching", "Room culling"]) {
      expect(labels).not.toContain(banned);
    }
  });
});

describe("persistence", () => {
  it("re-renders from the stored preference, the way a reload would", () => {
    const first = render(<HudGraphicsSettings />);
    fireEvent.change(screen.getByLabelText("Render quality"), { target: { value: "0.65" } });
    first.unmount();

    __resetGraphicsPreferenceForTests(); // re-read storage, as a page load does
    render(<HudGraphicsSettings />);
    expect(modeRadio(/Custom/)).toBeChecked();
    expect(screen.getByLabelText("Render quality")).toHaveValue("0.65");
  });
});
