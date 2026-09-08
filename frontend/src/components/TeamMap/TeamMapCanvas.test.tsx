import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMapPerson } from "../../services/teamMap/types";

// MapLibre needs WebGL, so the loader module is replaced with a recorder: enough of the Map
// surface for the canvas to initialise, plus captured constructor options / source options /
// click handlers to assert the zoom + clustering contract on.
const captured: {
  mapOptions: Record<string, unknown> | null;
  sourceOptions: Record<string, unknown> | null;
  clusterClick: ((event: unknown) => void) | null;
  easeTo: ReturnType<typeof vi.fn<(options: unknown) => void>>;
  render?: () => void;
  /** Source features the fake map reports back to the marker sync. */
  features: Array<Record<string, unknown>>;
  /** Marker elements the canvas built, in creation order. */
  markerElements: HTMLElement[];
} = {
  mapOptions: null,
  sourceOptions: null,
  clusterClick: null,
  easeTo: vi.fn(),
  features: [],
  markerElements: [],
};

const pointFeature = (email: string) => ({
  properties: { email },
  geometry: { type: "Point", coordinates: [121.0, 14.6] },
});

const expansionZoom = vi.fn<(id: number) => Promise<number>>();
const clusterLeaves = vi.fn(async () => [
  { properties: { email: "a@offshorly.com" } },
  { properties: { email: "b@offshorly.com" } },
]);

vi.mock("./maplibreLoader", () => {
  class FakeMap {
    constructor(options: Record<string, unknown>) {
      captured.mapOptions = options;
    }
    addControl() {}
    addLayer() {}
    addSource(_id: string, options: Record<string, unknown>) {
      captured.sourceOptions = options;
    }
    getSource() {
      return { getClusterExpansionZoom: expansionZoom, getClusterLeaves: clusterLeaves, setData() {} };
    }
    getCanvas() {
      return { style: {} } as unknown as HTMLCanvasElement;
    }
    querySourceFeatures() {
      return captured.features;
    }
    on(event: string, layerOrHandler: unknown, handler?: unknown) {
      if (event === "load") (layerOrHandler as () => void)();
      if (event === "click") captured.clusterClick = handler as (e: unknown) => void;
      if (event === "render") captured.render = layerOrHandler as () => void;
    }
    easeTo(options: unknown) {
      captured.easeTo(options);
    }
    remove() {}
  }
  class FakeMarker {
    constructor({ element }: { element: HTMLElement }) {
      captured.markerElements.push(element);
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  return {
    TEAM_MAP_STYLE_URL: "https://tiles.example/style",
    loadMapLibre: async () => ({ Map: FakeMap, Marker: FakeMarker, NavigationControl: class {} }),
  };
});

import { TeamMapCanvas } from "./TeamMapCanvas";

const person = (email: string, over: Partial<TeamMapPerson> = {}): TeamMapPerson =>
  ({
    email,
    name: email,
    latitude: 14.6,
    longitude: 121.0,
    ...over,
  }) as unknown as TeamMapPerson;

const PEOPLE = [person("a@offshorly.com"), person("b@offshorly.com")];

function renderCanvas(
  onSelectCluster = vi.fn(),
  people: TeamMapPerson[] = PEOPLE,
  distanceFor?: (person: TeamMapPerson) => string | null,
) {
  const view = render(
    <TeamMapCanvas
      people={people}
      statusFor={() => "AVAILABLE"}
      onSelectPerson={vi.fn()}
      onSelectCluster={onSelectCluster}
      distanceFor={distanceFor}
    />,
  );
  const focusOn = (focus: { email: string; nonce: number } | null) =>
    view.rerender(
      <TeamMapCanvas
        people={people}
        statusFor={() => "AVAILABLE"}
        onSelectPerson={vi.fn()}
        onSelectCluster={onSelectCluster}
        distanceFor={distanceFor}
        focus={focus}
      />,
    );
  return { onSelectCluster, focusOn };
}

const clusterEvent = {
  features: [
    {
      properties: { cluster: true, cluster_id: 7 },
      geometry: { type: "Point", coordinates: [121.0, 14.6] },
    },
  ],
};

beforeEach(() => {
  captured.features = [];
  captured.markerElements = [];
});

describe("TeamMapCanvas zoom and clustering", () => {
  it("allows street-level zoom and clusters through the last zoom level", async () => {
    renderCanvas();
    await waitFor(() => expect(captured.sourceOptions).not.toBeNull());
    // Street/building level, so exact "Working today" shares a few hundred metres apart can be
    // pulled apart instead of staying one circle at the ceiling.
    expect(captured.mapOptions?.maxZoom).toBe(18);
    // Clustering runs through max zoom so people on one coordinate stay a counted group rather
    // than stacking as overlapping singleton markers.
    expect(captured.sourceOptions?.clusterMaxZoom).toBe(captured.mapOptions?.maxZoom);
    expect(captured.sourceOptions?.clusterRadius).toBe(44);
  });

  it("keeps zooming toward a cluster that can still expand", async () => {
    renderCanvas();
    await waitFor(() => expect(captured.clusterClick).not.toBeNull());
    expansionZoom.mockResolvedValue(16);
    captured.easeTo.mockClear();
    captured.clusterClick?.(clusterEvent);
    await waitFor(() =>
      expect(captured.easeTo).toHaveBeenCalledWith({ center: [121.0, 14.6], zoom: 16 }),
    );
  });

  it("opens the member list for a cluster that cannot expand further", async () => {
    const { onSelectCluster } = renderCanvas(vi.fn());
    await waitFor(() => expect(captured.clusterClick).not.toBeNull());
    expansionZoom.mockResolvedValue(19);
    captured.easeTo.mockClear();
    captured.clusterClick?.(clusterEvent);
    await waitFor(() =>
      expect(onSelectCluster).toHaveBeenCalledWith(["a@offshorly.com", "b@offshorly.com"]),
    );
    expect(captured.easeTo).not.toHaveBeenCalled();
  });

  it("flies to a located person at max zoom, deep enough to split nearby markers", async () => {
    const { focusOn } = renderCanvas();
    await waitFor(() => expect(captured.sourceOptions).not.toBeNull());
    captured.easeTo.mockClear();
    focusOn({ email: "b@offshorly.com", nonce: 1 });
    expect(captured.easeTo).toHaveBeenCalledWith({ center: [121.0, 14.6], zoom: 18 });
  });

  it("re-flies when the same person is located again", async () => {
    const { focusOn } = renderCanvas();
    await waitFor(() => expect(captured.sourceOptions).not.toBeNull());
    focusOn({ email: "b@offshorly.com", nonce: 1 });
    captured.easeTo.mockClear();
    focusOn({ email: "b@offshorly.com", nonce: 2 });
    expect(captured.easeTo).toHaveBeenCalledTimes(1);
  });

  it("does not move the map for a person with no location", async () => {
    const people = [person("a@offshorly.com"), person("n@offshorly.com", { latitude: null, longitude: null })];
    const { focusOn } = renderCanvas(vi.fn(), people);
    await waitFor(() => expect(captured.sourceOptions).not.toBeNull());
    captured.easeTo.mockClear();
    focusOn({ email: "n@offshorly.com", nonce: 1 });
    expect(captured.easeTo).not.toHaveBeenCalled();
  });
});

describe("TeamMapCanvas distance pills", () => {
  const pillOf = (el: HTMLElement) => el.querySelector("span:last-child")?.textContent ?? null;

  it("hangs a compact pill on each marker the panel gives a distance for", async () => {
    captured.features = [pointFeature("a@offshorly.com"), pointFeature("b@offshorly.com")];
    renderCanvas(vi.fn(), PEOPLE, (p) => (p.email === "a@offshorly.com" ? "2.4 km" : null));
    await waitFor(() => expect(captured.markerElements).toHaveLength(2));
    const [withPill, withoutPill] = captured.markerElements;
    expect(withPill.textContent).toContain("2.4 km");
    expect(withPill.getAttribute("aria-label")).toContain("2.4 km away");
    // No distance for b: the marker is built exactly as before, with no pill node.
    expect(withoutPill.textContent).not.toContain("km");
    expect(withoutPill.getAttribute("aria-label")).not.toContain("away");
  });

  it("never blocks a click on the avatar", async () => {
    captured.features = [pointFeature("a@offshorly.com")];
    renderCanvas(vi.fn(), PEOPLE, () => "450 m");
    await waitFor(() => expect(captured.markerElements).toHaveLength(1));
    const pill = captured.markerElements[0].lastElementChild as HTMLElement;
    expect(pill.textContent).toBe("450 m");
    expect(pill.className).toMatch(/markerDistance/);
    expect(pillOf(captured.markerElements[0])).toBe("450 m");
  });

  it("puts no pill on a cluster — clusters are skipped before a marker is ever built", async () => {
    captured.features = [
      { properties: { cluster: true, point_count: 3 }, geometry: { type: "Point", coordinates: [121, 14.6] } },
      pointFeature("a@offshorly.com"),
    ];
    renderCanvas(vi.fn(), PEOPLE, () => "1.2 km");
    await waitFor(() => expect(captured.markerElements).toHaveLength(1));
    expect(captured.markerElements[0].getAttribute("aria-label")).toContain("1.2 km away");
  });

  it("builds no pill at all when the panel supplies no distance source", async () => {
    captured.features = [pointFeature("a@offshorly.com")];
    renderCanvas();
    await waitFor(() => expect(captured.markerElements).toHaveLength(1));
    expect(captured.markerElements[0].querySelector("[class*=markerDistance]")).toBeNull();
  });
});
