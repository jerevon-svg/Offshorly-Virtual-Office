import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMapCanvasProps } from "./TeamMapCanvas";
import type { OfficePerson } from "../../services/office/floorMerge";
import type { TeamMapPerson, TeamMapSnapshot, WorkingTodayShare } from "../../services/teamMap/types";

vi.mock("../../services/teamMap", () => ({
  teamMapService: {
    getPeople: vi.fn(),
    shareWorkingToday: vi.fn(),
    stopWorkingToday: vi.fn(),
    forgetWorkingToday: vi.fn(),
  },
}));

// MapLibre needs WebGL; the canvas is replaced with one button per mappable person plus a
// "cluster" button so the panel's selection wiring can be exercised in jsdom.
vi.mock("./TeamMapCanvas", () => ({
  TeamMapCanvas: ({ people, onSelectPerson, onSelectCluster, focus }: TeamMapCanvasProps) => (
    <div data-testid="fake-canvas" data-focus={focus ? `${focus.email}#${focus.nonce}` : ""}>
      {people
        .filter((p) => p.latitude !== null)
        .map((p) => (
          <button key={p.email} type="button" onClick={() => onSelectPerson(p.email)}>
            marker:{p.email}
          </button>
        ))}
      <button type="button" onClick={() => onSelectCluster(people.map((p) => p.email))}>
        cluster
      </button>
    </div>
  ),
}));

import { teamMapService } from "../../services/teamMap";
import { TeamMapPanel } from "./TeamMapPanel";

const getPeople = teamMapService.getPeople as unknown as ReturnType<typeof vi.fn>;
const shareWorkingToday = teamMapService.shareWorkingToday as unknown as ReturnType<typeof vi.fn>;
const stopWorkingToday = teamMapService.stopWorkingToday as unknown as ReturnType<typeof vi.fn>;
const forgetWorkingToday = teamMapService.forgetWorkingToday as unknown as ReturnType<typeof vi.fn>;

const person = (over: Partial<TeamMapPerson>): TeamMapPerson => ({
  email: "ada@offshorly.com",
  display_name: "Ada Lovelace",
  department_name: "Engineering",
  status: "ONLINE",
  bucket: "ph",
  latitude: 14.6,
  longitude: 120.98,
  country_code: "PH",
  location_label: "Manila, Philippines",
  timezone: "Asia/Manila",
  working_today: null,
  ...over,
});

const snapshot = (over: Partial<TeamMapSnapshot> = {}): TeamMapSnapshot => ({
  people: [
    person({}),
    person({
      email: "sam@offshorly.com",
      display_name: "Sam Sy",
      bucket: "elsewhere",
      latitude: 1.35,
      longitude: 103.82,
      country_code: "SG",
      location_label: "Singapore, Singapore",
      timezone: "Asia/Singapore",
    }),
    person({
      email: "nia@offshorly.com",
      display_name: "Nia None",
      bucket: "none",
      latitude: null,
      longitude: null,
      country_code: null,
      location_label: null,
      timezone: null,
    }),
  ],
  source: "atlas",
  generated_at: "2026-09-07T00:00:00Z",
  me: null,
  ...over,
});

const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60_000).toISOString();
const inTwelveHours = () => new Date(Date.now() + 12 * 3600_000).toISOString();

const liveMarker = () => ({
  shared_at: fiveMinutesAgo(),
  expires_at: inTwelveHours(),
  active: true,
  stopped_at: null,
});
const savedMarker = () => ({
  shared_at: fiveMinutesAgo(),
  expires_at: inTwelveHours(),
  active: false,
  stopped_at: new Date().toISOString(),
});

const myShare = (over: Partial<WorkingTodayShare> = {}): WorkingTodayShare => ({
  latitude: 10.316543,
  longitude: 123.891234,
  location_label: "Cebu City, Philippines",
  country_code: "PH",
  timezone: "Asia/Manila",
  ...liveMarker(),
  ...over,
});

function renderPanel(props: Partial<React.ComponentProps<typeof TeamMapPanel>> = {}) {
  const onOpenProfile = vi.fn();
  const onOpenChat = vi.fn();
  const onClose = vi.fn();
  render(
    <TeamMapPanel
      viewerEmail="ada@offshorly.com"
      roster={[]}
      onClose={onClose}
      onOpenProfile={onOpenProfile}
      onOpenChat={onOpenChat}
      {...props}
    />,
  );
  return { onOpenProfile, onOpenChat, onClose };
}

function stubGeolocation(impl: (success: PositionCallback, error?: PositionErrorCallback) => void) {
  const getCurrentPosition = vi.fn(impl);
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition, watchPosition: vi.fn() } });
  return getCurrentPosition;
}

describe("TeamMapPanel", () => {
  beforeEach(() => {
    getPeople.mockReset();
    shareWorkingToday.mockReset();
    stopWorkingToday.mockReset();
    forgetWorkingToday.mockReset();
    vi.unstubAllGlobals();
  });

  // The disclosure copy and every sharing control live behind the header's ⓘ button now; open it
  // the way a user does before asserting on any of it.
  const openInfo = () => fireEvent.click(screen.getByRole("button", { name: "About locations and sharing" }));

  it("summarises the buckets and lists Elsewhere / No location people with local time", async () => {
    getPeople.mockResolvedValue(snapshot());
    renderPanel();
    await screen.findByText("Sam Sy");
    openInfo();
    expect(screen.getByText(/1 in the Philippines · 1 elsewhere · 1 without a location/)).toBeInTheDocument();
    expect(screen.getByText("Sam Sy")).toBeInTheDocument();
    expect(screen.getByText("Nia None")).toBeInTheDocument();
    // Singapore row carries a wall-clock time; the no-location row does not.
    expect(screen.getByText(/Based near Singapore, Singapore · \d/)).toBeInTheDocument();
    expect(screen.getByText("No location", { selector: "span" })).toBeInTheDocument();
  });

  it("labels locations as approximate profile base locations, never as current position", async () => {
    getPeople.mockResolvedValue(snapshot());
    renderPanel();
    await screen.findByText("Sam Sy");
    openInfo();
    expect(screen.getByText(/Approximate base locations from Atlas profiles/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("marker:sam@offshorly.com"));
    const card = screen.getByRole("group", { name: /Sam Sy details/ });
    expect(card).toHaveTextContent(/Based near Singapore, Singapore \(approx\.\)/);
    expect(screen.getByRole("dialog").textContent).not.toMatch(/current location|live location/i);
  });

  it("opens a details card from a marker and routes Profile / Message to the parent", async () => {
    getPeople.mockResolvedValue(snapshot());
    const { onOpenProfile, onOpenChat } = renderPanel();
    fireEvent.click(await screen.findByText("marker:sam@offshorly.com"));
    const card = screen.getByRole("group", { name: /Sam Sy details/ });
    expect(card).toHaveTextContent("Engineering");
    expect(card).toHaveTextContent(/local/);
    fireEvent.click(screen.getByRole("button", { name: /Profile/ }));
    expect(onOpenProfile).toHaveBeenCalledWith("sam@offshorly.com");
    fireEvent.click(screen.getByRole("button", { name: /Message/ }));
    expect(onOpenChat).toHaveBeenCalledWith("sam@offshorly.com");
  });

  it("hides Message for the viewer's own marker and when chat is unavailable", async () => {
    getPeople.mockResolvedValue(snapshot());
    renderPanel();
    fireEvent.click(await screen.findByText("marker:ada@offshorly.com"));
    expect(screen.queryByRole("button", { name: /Message/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));

    fireEvent.click(screen.getByText("marker:sam@offshorly.com"));
    expect(screen.getByRole("button", { name: /Message/ })).toBeInTheDocument();
  });

  it("omits Message entirely when no chat handler is provided", async () => {
    getPeople.mockResolvedValue(snapshot());
    renderPanel({ onOpenChat: undefined });
    fireEvent.click(await screen.findByText("marker:sam@offshorly.com"));
    expect(screen.queryByRole("button", { name: /Message/ })).toBeNull();
  });

  it("shows a cluster list and lets a row open that person's card", async () => {
    getPeople.mockResolvedValue(snapshot());
    renderPanel();
    fireEvent.click(await screen.findByText("cluster"));
    const list = screen.getByRole("group", { name: "People at this location" });
    expect(list).toHaveTextContent("Ada Lovelace");
    fireEvent.click(screen.getAllByText("Sam Sy")[0]);
    expect(screen.getByRole("group", { name: /Sam Sy details/ })).toBeInTheDocument();
  });

  it("degrades to an Atlas-unavailable banner instead of an empty globe", async () => {
    getPeople.mockResolvedValue(snapshot({ people: [], source: "unavailable" }));
    renderPanel();
    expect(await screen.findByRole("status")).toHaveTextContent(/Atlas is unavailable/);
    openInfo();
    expect(screen.getByText(/0 in the Philippines · 0 elsewhere · 0 without a location/)).toBeInTheDocument();
  });

  it("surfaces a fetch failure as an alert", async () => {
    getPeople.mockRejectedValue(new Error("Team map request failed (503)"));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(/503/);
  });

  it("keeps name and department bound to the email when map rows and roster arrive in different orders", async () => {
    const rosterRow = (email: string, displayName: string, departmentName: string): OfficePerson => ({
      email,
      displayName,
      status: "ONLINE",
      departmentName,
      jobTitle: null,
      currentActivity: null,
      lastMessage: null,
      avatarId: null,
      roomId: "lobby",
      atlasRoomId: null,
      inEphemeralRoom: false,
    });
    // Roster (authoritative, from Atlas /floor via VO) lists Sam then Ada; the map feed lists Ada
    // then Sam and carries stale/wrong departments. Any index-based join would swap them.
    const roster = [
      rosterRow("sam@offshorly.com", "Sam Sy", "Operations"),
      rosterRow("ada@offshorly.com", "Ada Lovelace", "Design"),
    ];
    getPeople.mockResolvedValue(
      snapshot({
        people: [
          person({ department_name: "Marketing" }),
          person({
            email: "sam@offshorly.com",
            display_name: "Sam Sy",
            department_name: "QA",
            latitude: 1.35,
            longitude: 103.82,
            bucket: "elsewhere",
            country_code: "SG",
            location_label: "Singapore, Singapore",
            timezone: "Asia/Singapore",
          }),
        ],
      }),
    );
    renderPanel({ roster });
    fireEvent.click(await screen.findByText("marker:ada@offshorly.com"));
    expect(screen.getByRole("group", { name: /Ada Lovelace details/ })).toHaveTextContent("Design");
    fireEvent.click(screen.getByText("marker:sam@offshorly.com"));
    const sam = screen.getByRole("group", { name: /Sam Sy details/ });
    expect(sam).toHaveTextContent("Operations");
    expect(sam).not.toHaveTextContent("QA");
  });

  it("closes on Escape", async () => {
    getPeople.mockResolvedValue(snapshot());
    const { onClose } = renderPanel();
    await screen.findByText("Sam Sy");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  describe("My location", () => {
    it("focuses the SIGNED-IN employee's own marker, not the nearest or first person", async () => {
      // Sam sits first among the mappable non-viewer people and Ada (the viewer) is elsewhere in
      // the list — the button must still go to Ada, matched by her authenticated email.
      getPeople.mockResolvedValue(snapshot());
      renderPanel({ viewerEmail: "ada@offshorly.com" });
      await screen.findByText("Sam Sy");

      fireEvent.click(screen.getByRole("button", { name: /My location/ }));
      expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("ada@offshorly.com#1");
      expect(screen.getByRole("group", { name: /Ada Lovelace details/ })).toBeInTheDocument();
    });

    it("is disabled when the viewer has no usable coordinates of their own", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel({ viewerEmail: "nia@offshorly.com" }); // Nia has null lat/lng
      await screen.findByText("Sam Sy");
      expect(screen.getByRole("button", { name: /My location/ })).toBeDisabled();
    });

    it("is disabled when the viewer is not on the map at all", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel({ viewerEmail: "ghost@offshorly.com" });
      await screen.findByText("Sam Sy");
      expect(screen.getByRole("button", { name: /My location/ })).toBeDisabled();
    });
  });

  describe("teammate carousel", () => {
    it("selects the clicked teammate and eases the map to their marker", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel();
      const strip = within(await screen.findByRole("list", { name: "Teammates" }));

      fireEvent.click(strip.getByText("Sam Sy"));
      expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("sam@offshorly.com#1");
      expect(screen.getByRole("group", { name: /Sam Sy details/ })).toBeInTheDocument();

      // A second card replaces both the selection and the camera target.
      fireEvent.click(strip.getByText("Nia None"));
      expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("nia@offshorly.com#2");
      expect(screen.getByRole("group", { name: /Nia None details/ })).toBeInTheDocument();
    });

    it("disables both arrows while the strip has nothing to scroll", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel();
      await screen.findByText("Sam Sy");
      // jsdom reports zero layout, so the strip is at both ends at once.
      expect(screen.getByRole("button", { name: "Scroll teammates left" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Scroll teammates right" })).toBeDisabled();
    });
  });

  describe("Working Today", () => {
    it("never asks for location on mount, only after the explicit Share click, and sends the exact fix once", async () => {
      const getCurrentPosition = stubGeolocation((success) =>
        success({ coords: { latitude: 14.551234, longitude: 121.027654 } } as GeolocationPosition),
      );
      getPeople.mockResolvedValueOnce(snapshot());
      renderPanel();
      await screen.findByText("Sam Sy");
      expect(getCurrentPosition).not.toHaveBeenCalled();
      openInfo();
      // Consent copy is visible BEFORE the click, alongside the Share button itself.
      expect(screen.getByRole("note")).toHaveTextContent(/coworkers can see your exact location/i);

      shareWorkingToday.mockResolvedValue(myShare());
      getPeople.mockResolvedValueOnce(
        snapshot({
          me: myShare(),
          people: [
            person({
              latitude: 10.316543,
              longitude: 123.891234,
              location_label: "Cebu City, Philippines",
              working_today: liveMarker(),
            }),
          ],
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: /Share my exact location today/ }));
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect((getCurrentPosition.mock.calls[0] as unknown[])[2]).toMatchObject({ enableHighAccuracy: true });
      await waitFor(() =>
        expect(shareWorkingToday).toHaveBeenCalledWith({ latitude: 14.551234, longitude: 121.027654 }),
      );
      await screen.findByText(/Sharing exact location · Shared \d+ min ago/);
      expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
      expect(screen.getByRole("note")).toHaveTextContent(/coworkers can see your exact shared location/i);
      expect(screen.queryByRole("button", { name: /Share my exact location today/ })).toBeNull();
    });

    it("renders a colleague's active share as Working today, overriding Based near", async () => {
      getPeople.mockResolvedValue(
        snapshot({
          people: [
            person({
              email: "sam@offshorly.com",
              display_name: "Sam Sy",
              bucket: "elsewhere",
              latitude: 1.35,
              longitude: 103.82,
              country_code: "SG",
              location_label: "Singapore, Singapore",
              timezone: "Asia/Singapore",
              working_today: liveMarker(),
            }),
          ],
        }),
      );
      renderPanel();
      expect(await screen.findByText(/Working today · Shared \d+ min ago/)).toBeInTheDocument();
      expect(screen.queryByText(/Based near Singapore/)).toBeNull();
      fireEvent.click(screen.getByText("marker:sam@offshorly.com"));
      expect(screen.getByRole("group", { name: /Sam Sy details/ })).toHaveTextContent(/Working today · Shared \d+ min ago · exact location shared/);
    });

    it("stop ends live sharing but keeps the last shared location, marked not live, with a Forget action", async () => {
      getPeople.mockResolvedValueOnce(snapshot({ me: myShare() }));
      renderPanel();
      await screen.findByText(/Sharing exact location · Shared/);
      stopWorkingToday.mockResolvedValue(undefined);
      getPeople.mockResolvedValueOnce(
        snapshot({
          me: myShare(savedMarker()),
          people: [person({ latitude: 10.316543, longitude: 123.891234, working_today: savedMarker() })],
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
      await waitFor(() => expect(stopWorkingToday).toHaveBeenCalledTimes(1));
      await screen.findByText(/Last shared \d+ min ago · Not live/);
      expect(screen.queryByText(/Working today/)).toBeNull();
      expect(screen.getByRole("button", { name: /Share my exact location today/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Forget saved location" })).toBeInTheDocument();
      openInfo();
      expect(screen.getByRole("note")).toHaveTextContent(/not sharing live/i);
      fireEvent.click(screen.getByText("marker:ada@offshorly.com"));
      expect(screen.getByRole("group", { name: /Ada Lovelace details/ })).toHaveTextContent(
        /Last shared \d+ min ago · not live · exact location as last shared/,
      );
    });

    it("restores a saved (not live) share after a refresh and Forget falls back to Atlas", async () => {
      getPeople.mockResolvedValueOnce(snapshot({ me: myShare(savedMarker()) }));
      renderPanel();
      await screen.findByText(/Last shared \d+ min ago · Not live/);
      forgetWorkingToday.mockResolvedValue(undefined);
      getPeople.mockResolvedValueOnce(snapshot());
      fireEvent.click(screen.getByRole("button", { name: "Forget saved location" }));
      await waitFor(() => expect(forgetWorkingToday).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByText(/Last shared/)).toBeNull());
      expect(screen.getByRole("button", { name: /Share my exact location today/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Forget saved location" })).toBeNull();
      expect(screen.getByText(/Based near Singapore, Singapore/)).toBeInTheDocument();
    });

    it("renders a colleague's saved location as Last shared, never as Working today", async () => {
      getPeople.mockResolvedValue(
        snapshot({
          people: [
            person({
              email: "sam@offshorly.com",
              display_name: "Sam Sy",
              bucket: "elsewhere",
              latitude: 1.35,
              longitude: 103.82,
              country_code: "SG",
              location_label: "Singapore, Singapore",
              timezone: "Asia/Singapore",
              working_today: savedMarker(),
            }),
          ],
        }),
      );
      renderPanel();
      expect(await screen.findByText(/Last shared \d+ min ago · not live/)).toBeInTheDocument();
      expect(screen.queryByText(/Working today/)).toBeNull();
    });

    it("explains a denied permission and shares nothing", async () => {
      stubGeolocation((_success, error) =>
        error?.({ code: 1, message: "denied" } as GeolocationPositionError),
      );
      getPeople.mockResolvedValue(snapshot());
      renderPanel();
      await screen.findByText("Sam Sy");
      openInfo();
      fireEvent.click(screen.getByRole("button", { name: /Share my exact location today/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/permission was denied/);
      expect(shareWorkingToday).not.toHaveBeenCalled();
    });
  });

  describe("employee search", () => {
    const type = (value: string) =>
      fireEvent.change(screen.getByLabelText("Search employee"), { target: { value } });
    // The fake canvas renders a button per person, so every result assertion is scoped to the
    // search results list itself.
    const results = () => within(screen.getByRole("list", { name: "Search results" }));

    it("filters as the viewer types, case-insensitively", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel();
      await screen.findByText("Sam Sy");
      type("ad");
      await screen.findByRole("list", { name: "Search results" });
      expect(results().getByText("Ada Lovelace")).toBeInTheDocument();
      expect(results().queryByText("Sam Sy")).not.toBeInTheDocument();
      type("SAM");
      await waitFor(() => expect(results().getByText("Sam Sy")).toBeInTheDocument());
      expect(results().queryByText("Ada Lovelace")).not.toBeInTheDocument();
      type("zzz");
      expect(await screen.findByText(/No one matches/)).toBeInTheDocument();
    });

    it("locates a result: selects the person and asks the canvas to fly there", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel();
      await screen.findByText("Sam Sy");
      type("ada");
      await screen.findByRole("list", { name: "Search results" });
      fireEvent.click(results().getByText("Ada Lovelace"));
      expect(await screen.findByRole("group", { name: "Ada Lovelace details" })).toBeInTheDocument();
      expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("ada@offshorly.com#1");
    });

    it("selects a person with no location without moving the map", async () => {
      getPeople.mockResolvedValue(snapshot());
      renderPanel();
      await screen.findByText("Sam Sy");
      type("nia");
      await screen.findByRole("list", { name: "Search results" });
      fireEvent.click(results().getByText("Nia None"));
      expect(await screen.findByRole("group", { name: "Nia None details" })).toBeInTheDocument();
      // The canvas is still told who to show — it is the canvas that declines to move for a
      // person with no coordinates (see TeamMapCanvas.test.tsx).
      expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("nia@offshorly.com#1");
    });

    it("shows the email when two people share a display name", async () => {
      getPeople.mockResolvedValue(
        snapshot({
          people: [
            person({}),
            person({ email: "ada2@offshorly.com", display_name: "Ada Lovelace", bucket: "elsewhere" }),
          ],
        }),
      );
      renderPanel();
      await screen.findAllByText("Ada Lovelace");
      type("ada");
      await screen.findByRole("list", { name: "Search results" });
      expect(results().getByText(/ada2@offshorly\.com/)).toBeInTheDocument();
      expect(results().getByText(/^ada@offshorly\.com/)).toBeInTheDocument();
    });
  });

  describe("distance from me", () => {
    // Manila reference share; Sam is ~4 km north of it, Nia has no location at all.
    const nearby = () =>
      snapshot({
        me: myShare({ latitude: 14.5995, longitude: 120.9842 }),
        people: [
          person({}),
          person({
            email: "sam@offshorly.com",
            display_name: "Sam Sy",
            bucket: "elsewhere",
            latitude: 14.6355,
            longitude: 120.9842,
          }),
          person({
            email: "nia@offshorly.com",
            display_name: "Nia None",
            bucket: "none",
            latitude: null,
            longitude: null,
            location_label: null,
            timezone: null,
          }),
        ],
      });

    it("shows the distance on a located colleague's row and card", async () => {
      getPeople.mockResolvedValue(nearby());
      renderPanel();
      const row = (await screen.findByText("Sam Sy")).closest("button");
      expect(row).toHaveTextContent("4.0 km away");
      fireEvent.click(row as HTMLElement);
      expect(await screen.findByRole("group", { name: "Sam Sy details" })).toHaveTextContent(
        "4.0 km away",
      );
    });

    it("shows nothing for a colleague with no location, or for the viewer", async () => {
      getPeople.mockResolvedValue(nearby());
      renderPanel();
      const nia = (await screen.findByText("Nia None")).closest("button");
      expect(nia).not.toHaveTextContent("away");
      // Ada is the viewer (viewerEmail defaults to ada@offshorly.com in renderPanel).
      fireEvent.click(screen.getByText("marker:ada@offshorly.com"));
      expect(await screen.findByRole("group", { name: "Ada Lovelace details" })).not.toHaveTextContent(
        "away",
      );
    });

    it("shows nothing at all when the viewer has no shared or saved location", async () => {
      getPeople.mockResolvedValue(snapshot({ me: null }));
      renderPanel();
      const row = (await screen.findByText("Sam Sy")).closest("button");
      expect(row).not.toHaveTextContent("away");
    });

    it("still measures from a saved last-shared location that is no longer live", async () => {
      const base = nearby();
      getPeople.mockResolvedValue(
        snapshot({
          ...base,
          me: myShare({ latitude: 14.5995, longitude: 120.9842, ...savedMarker() }),
        }),
      );
      renderPanel();
      expect((await screen.findByText("Sam Sy")).closest("button")).toHaveTextContent("4.0 km away");
    });
  });
});
