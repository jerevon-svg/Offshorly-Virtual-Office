import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeExperiencePanel } from "./OfficeExperiencePanel";
import {
  getOfficeExperience,
  __resetOfficeExperienceForTests,
} from "../../services/settings/officeExperience";
import { resetCurrentUserForTests } from "../../auth/currentUserStore";

beforeEach(() => {
  window.localStorage.clear();
  resetCurrentUserForTests();
  __resetOfficeExperienceForTests();
});

// THE SWITCH IS A NAVIGATION, so it is confirmed first — and until it is confirmed NOTHING has happened.
// These cases are about that gap: picking the other office is a question, not an answer.
describe("choosing the other office", () => {
  it("opens showing where the employee actually is", () => {
    render(<OfficeExperiencePanel />);
    expect(screen.getByRole("radio", { name: /3D Office/i })).toBeChecked();
    expect(screen.getByTestId("office-experience-status")).toBeInTheDocument();
    expect(screen.queryByTestId("office-experience-confirm")).toBeNull();
  });

  it("asks before it reloads, and writes nothing while it is asking", () => {
    render(<OfficeExperiencePanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Classic Office/i }));

    expect(screen.getByTestId("office-experience-confirm")).toHaveTextContent(/reloads the office/i);
    // The warning says what it costs, and says what it does NOT cost — attendance.
    expect(screen.getByTestId("office-experience-confirm")).toHaveTextContent(/never checks you in or out/i);
    // NOT SAVED YET. A person who selects and walks away is still in the office they were in.
    expect(getOfficeExperience()).toBe("v2");
    expect(window.localStorage.length).toBe(0);
  });

  it("puts everything back on Cancel", () => {
    render(<OfficeExperiencePanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Classic Office/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByRole("radio", { name: /3D Office/i })).toBeChecked();
    expect(screen.queryByTestId("office-experience-confirm")).toBeNull();
    expect(getOfficeExperience()).toBe("v2");
  });

  it("saves only once the switch is confirmed", () => {
    render(<OfficeExperiencePanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Classic Office/i }));
    fireEvent.click(screen.getByRole("button", { name: /Switch and reload/i }));
    // jsdom cannot perform the navigation itself and logs that it did not; the preference is the part
    // that has to be right, because it is what the next document reads on its way up.
    expect(getOfficeExperience()).toBe("classic");
  });

  it("re-selecting the office you are already in is not a pending switch", () => {
    render(<OfficeExperiencePanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Classic Office/i }));
    fireEvent.click(screen.getByRole("radio", { name: /3D Office/i }));
    expect(screen.queryByTestId("office-experience-confirm")).toBeNull();
    expect(screen.getByTestId("office-experience-status")).toBeInTheDocument();
  });
});

// THE URL OVERRIDE AND THE SAVED CHOICE CAN DISAGREE, and the card marks the office you are LOOKING AT.
// `?world=v1` beats the preference for this tab (the support lever, and the failure screen's escape
// hatch), so somebody can be standing in Classic with the 3D office saved. Reading only the preference
// made this panel say "You are in the 3D Office" over a Classic floor.
describe("when the URL override disagrees with the saved office", () => {
  beforeEach(() => { window.history.replaceState({}, "", "/?world=v1"); });
  afterEach(() => { window.history.replaceState({}, "", "/"); });

  it("marks the office on screen, and says the saved one is different", () => {
    render(<OfficeExperiencePanel />);
    expect(screen.getByRole("radio", { name: /Classic Office/i })).toBeChecked();
    expect(screen.getByTestId("office-experience-status")).toHaveTextContent(/this tab only/i);
    expect(screen.getByTestId("office-experience-status")).toHaveTextContent(/saved office is the 3D Office/i);
  });

  it("lets the employee KEEP the office they were sent to, rather than treating it as a no-op", () => {
    render(<OfficeExperiencePanel />);
    // The Classic card is already the selected one, but the saved office is still the 3D one — so
    // choosing it is a real change and has to be offered as one.
    fireEvent.click(screen.getByRole("radio", { name: /Classic Office/i }));
    expect(screen.getByTestId("office-experience-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Switch and reload/i }));
    expect(getOfficeExperience()).toBe("classic");
  });
});
