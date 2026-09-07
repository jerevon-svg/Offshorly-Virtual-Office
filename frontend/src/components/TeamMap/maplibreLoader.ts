// The one place maplibre-gl is imported. Dynamic so the ~250 KB library stays out of the main
// bundle until someone opens the map (same reason Excalidraw is React.lazy'd), and so tests can
// vi.mock this module instead of needing WebGL in jsdom.
export type MapLibreModule = typeof import("maplibre-gl");

export async function loadMapLibre(): Promise<MapLibreModule> {
  const [mod] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  return mod;
}

// OpenFreeMap: free vector tiles, no API key, no per-user telemetry — the only third party the
// map talks to. Swap for a self-hosted PMTiles style later without touching the canvas code.
export const TEAM_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
