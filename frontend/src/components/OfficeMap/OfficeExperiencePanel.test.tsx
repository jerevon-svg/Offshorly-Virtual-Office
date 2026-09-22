import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PHASE 9A — the panel asks the server which offices this employee may open. Mocked at the network
// seam so each case states an answer; an unmocked case gets a rejection, which is the offline
// fallback (the two permanent offices), which is exactly what the pre-9A cases below assume.
const apiFetch = vi.fn();
// THE TRANSPORT SEAM. experienceCatalog talks to the VO backend directly (VITE_CHAT_SOCKET_URL),
// like every other VO-backend client — not through apiFetch, which targets Atlas. So global fetch is
// what these cases stub, and getAuthToken supplies the identity that makes the module willing to ask.
vi.stubGlobal("fetch", (...args: unknown[]) => apiFetch(...args));
vi.mock("../../services/api/client", () => ({ getAuthToken: () => "a-token" }));
vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://vo-backend.test");

import { OfficeExperiencePanel } from "./OfficeExperiencePanel";
import { SEASONAL_PRESENTATION } from "./officeExperienceGallery";
import { __resetExperienceCatalogForTests } from "../../services/office/experienceCatalogStore";
import {
  getOfficeExperience,
  __resetOfficeExperienceForTests,
} from "../../services/settings/officeExperience";
import { resetCurrentUserForTests } from "../../auth/currentUserStore";

beforeEach(() => {
  window.localStorage.clear();
  resetCurrentUserForTests();
  __resetOfficeExperienceForTests();
  __resetExperienceCatalogForTests();
  apiFetch.mockReset();
  apiFetch.mockRejectedValue(new Error("offline"));
});

function serverAnswer(overrides: Record<string, unknown> = {}) {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      available: ["v2", "classic"],
      previewable: [],
      default: "v2",
      creator: false,
      publications: [],
      ...overrides,
    }),
  });
}

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

// ══ PHASE 9A — THE PANEL IS A PICTURE OF THE SERVER'S ANSWER ══

describe("what the gallery shows", () => {
  it("shows the two permanent offices and nothing else, because no season has shipped", async () => {
    serverAnswer();
    render(<OfficeExperiencePanel />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("http://vo-backend.test/office/experience", expect.anything()));
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("shows Halloween as an ordinary card once the server lists it", async () => {
    serverAnswer({ available: ["v2", "classic", "halloween"] });
    render(<OfficeExperiencePanel />);
    await screen.findByRole("radio", { name: /halloween/i });
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("does not invent a card for a season the server lists but this build cannot picture", async () => {
    // The server should never list one before its decoration ships — but if it did, a card with no
    // capture behind it is the one thing this gallery has never been willing to draw.
    //
    // BOTH SHIPPED SEASONS ARE NOW PICTURABLE, so the unpicturable case is created here by taking one
    // presentation back out. That is exactly the state the NEXT season starts in, and it is the state
    // this rule exists for — naming whichever season happens to be unshipped today would have made
    // this test expire the moment it shipped.
    const saved = SEASONAL_PRESENTATION.christmas;
    delete SEASONAL_PRESENTATION.christmas;
    try {
      serverAnswer({ available: ["v2", "classic", "christmas"] });
      render(<OfficeExperiencePanel />);
      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      expect(screen.queryByRole("radio", { name: /christmas/i })).toBeNull();
    } finally {
      SEASONAL_PRESENTATION.christmas = saved;
    }
  });

  it("shows the White Christmas card once the server lists it", async () => {
    serverAnswer({ available: ["v2", "classic", "christmas"] });
    render(<OfficeExperiencePanel />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /christmas/i })).toBeTruthy();
  });
});

describe("when the catalog cannot be read", () => {
  it("says so, rather than quietly showing a shorter list", async () => {
    render(<OfficeExperiencePanel />); // beforeEach already made apiFetch reject
    expect(await screen.findByTestId("office-experience-catalog-offline")).toHaveTextContent(
      /has not been changed/i,
    );
  });

  it("still offers both permanent offices, and still writes nothing on its own", async () => {
    render(<OfficeExperiencePanel />);
    await screen.findByTestId("office-experience-catalog-offline");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    // AN OUTAGE IS NOT A PREFERENCE CHANGE. Nothing about a failed read may touch what was chosen.
    expect(window.localStorage.length).toBe(0);
  });

  it("is silent when the read succeeds", async () => {
    serverAnswer();
    render(<OfficeExperiencePanel />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("office-experience-catalog-offline")).toBeNull();
  });
});
