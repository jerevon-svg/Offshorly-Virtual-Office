import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { profileImageFor } from "../../data/portraits";
import { STATUS_META, type OfficeStatus } from "../../services/presence/status";
import { displayNameFor, initialsFor, mappable } from "../../services/teamMap/buckets";
import type { TeamMapPerson } from "../../services/teamMap/types";
import { loadMapLibre, TEAM_MAP_STYLE_URL } from "./maplibreLoader";
import styles from "./TeamMapPanel.module.css";

// MapLibre canvas for the Global Team Map. Owns the map instance and nothing else: data in via
// props, selections out via callbacks. Clustering is MapLibre's own GeoJSON clustering (on from
// day one — most of the company sits in a handful of Metro Manila centroids); single people are
// HTML avatar markers kept in sync with the clustered source on every render.
//
// Coordinates on `people` are already coarse (see services/teamMap/types.ts) — this component
// never receives, and could not display, anything more precise than a city centroid.

export interface TeamMapCanvasProps {
  people: TeamMapPerson[];
  statusFor: (person: TeamMapPerson) => OfficeStatus;
  onSelectPerson: (email: string) => void;
  /** A cluster that cannot expand further (several people at one coarse centroid). */
  onSelectCluster: (emails: string[]) => void;
  /** Compact distance for this person's marker pill ("2.4 km"), or null for no pill. Same gate
   *  as the sidebar's label — the panel derives both from one place. */
  distanceFor?: (person: TeamMapPerson) => string | null;
  /** "Show me this person": pan/zoom to their point. `nonce` re-fires the same email. A person
   *  with no coordinates leaves the map exactly where it is — the panel still selects them. */
  focus?: { email: string; nonce: number } | null;
}

const SOURCE_ID = "team-map-people";
// Street/building level. The old ceiling of 13 stopped roughly a city across, which meant two
// people who had opted into exact locations a few hundred metres apart could never be pulled
// apart — 44px at zoom 13 is ~800 m, so they stayed one circle at the deepest zoom available.
const MAX_ZOOM = 18;
// Cluster through the LAST zoom level on purpose. Several people routinely share one exact
// coordinate (a shared city centroid, or two people in the same building); if clustering stopped
// before maxZoom they would dissolve into N overlapping singleton markers at the same pixel and
// read as one person (the "San Pablo shows 4, zoomed shows 1" report, 2026-09-07). Kept
// clustered, such a group stays a counted circle and its click path (expansion zoom >
// CLUSTER_MAX_ZOOM) opens the full list.
//
// Genuinely distinct coordinates separate on their own well before the ceiling, because the
// cluster radius is in pixels and the ground it covers shrinks with every zoom level: at this
// latitude 44px is ~800 m at zoom 13, ~100 m at zoom 16 and ~25 m at zoom 18. So anything more
// than a building apart is an individual marker by the time you reach max zoom, while true
// same-coordinate groups stay grouped.
const CLUSTER_MAX_ZOOM = MAX_ZOOM;
const INITIAL_CENTER: [number, number] = [121.0, 13.5];
const INITIAL_ZOOM = 3.2;

// Structural GeoJSON for the clustered source — kept local rather than pulling @types/geojson
// into the app's own dependency list.
interface PeopleFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { email: string };
  }>;
}

function toGeoJson(people: TeamMapPerson[]): PeopleFeatureCollection {
  return {
    type: "FeatureCollection",
    features: mappable(people).map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.longitude as number, p.latitude as number] },
      properties: { email: p.email },
    })),
  };
}

function buildMarkerElement(
  person: TeamMapPerson,
  status: OfficeStatus,
  onClick: () => void,
  distance: string | null,
): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = styles.marker;
  el.setAttribute(
    "aria-label",
    `${displayNameFor(person)} · ${STATUS_META[status].label}${distance ? ` · ${distance} away` : ""}`,
  );
  el.title = displayNameFor(person);
  const img = document.createElement("img");
  img.className = styles.markerImage;
  img.alt = "";
  img.draggable = false;
  const src = profileImageFor(person.email, () => "");
  if (src) {
    img.src = src;
    el.appendChild(img);
  } else {
    const initials = document.createElement("span");
    initials.className = styles.markerInitials;
    initials.textContent = initialsFor(person);
    el.appendChild(initials);
  }
  const dot = document.createElement("span");
  dot.className = styles.markerStatus;
  dot.style.background = STATUS_META[status].color;
  el.appendChild(dot);
  // Distance pill, hung under the avatar. Present only when the panel hands one down, which it
  // does only for a located colleague other than the viewer while the viewer has a share of
  // their own. It is pointer-events: none, so it can never swallow a click meant for the avatar
  // or the map, and the marker's own aria-label already carries the same text for screen readers.
  if (distance) {
    const pill = document.createElement("span");
    pill.className = styles.markerDistance;
    pill.textContent = distance;
    el.appendChild(pill);
  }
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return el;
}

export function TeamMapCanvas({
  people,
  statusFor,
  onSelectPerson,
  onSelectCluster,
  distanceFor,
  focus = null,
}: TeamMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const loadedRef = useRef(false);
  // Latest props for the render-loop marker sync, which is registered once.
  const peopleRef = useRef(people);
  const statusForRef = useRef(statusFor);
  const distanceForRef = useRef(distanceFor);
  const onSelectPersonRef = useRef(onSelectPerson);
  const onSelectClusterRef = useRef(onSelectCluster);
  peopleRef.current = people;
  statusForRef.current = statusFor;
  distanceForRef.current = distanceFor;
  onSelectPersonRef.current = onSelectPerson;
  onSelectClusterRef.current = onSelectCluster;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let map: MapLibreMap | null = null;
    let maplibre: Awaited<ReturnType<typeof loadMapLibre>> | null = null;
    const markers = markersRef.current;

    const syncMarkers = () => {
      if (!map || !loadedRef.current || !maplibre) return;
      const byEmail = new Map(peopleRef.current.map((p) => [p.email, p]));
      const visible = new Set<string>();
      for (const feature of map.querySourceFeatures(SOURCE_ID)) {
        if (feature.properties?.cluster) continue;
        const email = feature.properties?.email as string | undefined;
        const person = email ? byEmail.get(email) : undefined;
        if (!person || feature.geometry.type !== "Point") continue;
        visible.add(email as string);
        if (!markers.has(email as string)) {
          const el = buildMarkerElement(
            person,
            statusForRef.current(person),
            () => onSelectPersonRef.current(person.email),
            distanceForRef.current?.(person) ?? null,
          );
          const marker = new maplibre.Marker({ element: el, anchor: "center" })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .addTo(map);
          markers.set(email as string, marker);
        }
      }
      for (const [email, marker] of markers) {
        if (!visible.has(email)) {
          marker.remove();
          markers.delete(email);
        }
      }
    };

    void loadMapLibre().then((mod) => {
      if (disposed) return;
      maplibre = mod;
      map = new mod.Map({
        container,
        style: TEAM_MAP_STYLE_URL,
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        minZoom: 1.2,
        maxZoom: MAX_ZOOM,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new mod.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (!map) return;
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: toGeoJson(peopleRef.current),
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
        });
        map.addLayer({
          id: `${SOURCE_ID}-clusters`,
          type: "circle",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#6d5dfc",
            "circle-stroke-color": "rgba(255,255,255,0.85)",
            "circle-stroke-width": 2,
            "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 15, 26],
          },
        });
        map.addLayer({
          id: `${SOURCE_ID}-cluster-count`,
          type: "symbol",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 13,
            "text-font": ["Noto Sans Bold"],
          },
          paint: { "text-color": "#ffffff" },
        });
        map.on("click", `${SOURCE_ID}-clusters`, (event) => {
          if (!map) return;
          const feature = event.features?.[0];
          const clusterId = feature?.properties?.cluster_id as number | undefined;
          if (feature === undefined || clusterId === undefined || feature.geometry.type !== "Point") return;
          const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
          if (!source) return;
          const coordinates = feature.geometry.coordinates as [number, number];
          void source.getClusterExpansionZoom(clusterId).then((zoom) => {
            if (!map) return;
            if (zoom > CLUSTER_MAX_ZOOM) {
              void source.getClusterLeaves(clusterId, 200, 0).then((leaves) => {
                const emails = leaves
                  .map((leaf) => leaf.properties?.email as string | undefined)
                  .filter((email): email is string => Boolean(email));
                onSelectClusterRef.current(emails);
              });
              return;
            }
            map.easeTo({ center: coordinates, zoom });
          });
        });
        map.on("mouseenter", `${SOURCE_ID}-clusters`, () => {
          if (map) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", `${SOURCE_ID}-clusters`, () => {
          if (map) map.getCanvas().style.cursor = "";
        });
        map.on("render", syncMarkers);
        loadedRef.current = true;
        syncMarkers();
      });
    });

    return () => {
      disposed = true;
      loadedRef.current = false;
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Locate-a-person (search result click). Eases to MAX_ZOOM rather than a gentler level on
  // purpose: the cluster radius is in pixels, so the deepest zoom is where two nearby-but-
  // distinct coordinates are guaranteed to have split into their own markers. People who really
  // do share one coordinate stay a cluster there — the panel's own selection opens their card,
  // which is what identifies them. No coordinates (bucket "none") means no camera move at all.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !focus) return;
    const person = people.find((p) => p.email === focus.email);
    if (!person || person.latitude === null || person.longitude === null) return;
    map.easeTo({ center: [person.longitude, person.latitude], zoom: MAX_ZOOM });
  }, [focus, people]);

  // Data refresh: push new coordinates into the clustered source and drop stale markers so the
  // next render rebuilds them with fresh status colours.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toGeoJson(people));
    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();
  }, [people, statusFor, distanceFor]);

  return <div ref={containerRef} className={styles.canvas} data-testid="team-map-canvas" />;
}
