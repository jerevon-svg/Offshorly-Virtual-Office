import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HudIcon from "../HudIcon";
import { profileImageFor } from "../../data/portraits";
import type { OfficePerson } from "../../services/office/floorMerge";
import { STATUS_META } from "../../services/presence/status";
import { teamMapService } from "../../services/teamMap";
import {
  formatLocalTime,
  formatSharedAgo,
  groupByBucket,
  initialsFor,
  placeHintFor,
  resolveDepartment,
  resolveDisplayName,
  resolveMapStatus,
} from "../../services/teamMap/buckets";
import { compactDistanceLabelFor, distanceLabelFor, distanceMetersFor } from "../../services/teamMap/distance";
import { searchTeamMap } from "../../services/teamMap/search";
import type { GeoFix, TeamMapPerson, TeamMapSnapshot } from "../../services/teamMap/types";
import { TeamMapCanvas } from "./TeamMapCanvas";
import styles from "./TeamMapPanel.module.css";

// Global Team Map V1 panel. Opened from the HUD's Map button (OfficeMap.tsx) via React.lazy so
// MapLibre never loads for someone who never opens it. Shell mirrors MissionsPanel — one modal
// family. Data is fetched on every open (a snapshot, not a stream) through the teamMapService
// seam; live VO status comes from the floor roster the parent already holds.

/** Carousel filters. "nearest" needs the viewer's own shared point and is disabled without it. */
type FilterTab = "all" | "online" | "nearest";

const FILTER_TABS: readonly { key: FilterTab; label: string }[] = [
  { key: "all", label: "All teammates" },
  { key: "online", label: "Online" },
  { key: "nearest", label: "Nearest" },
];

export interface TeamMapPanelProps {
  viewerEmail: string | null;
  roster: readonly OfficePerson[];
  onClose: () => void;
  onOpenProfile: (email: string) => void;
  /** Undefined when chat is not available (mock chat mode) — the Message button is then hidden. */
  onOpenChat?: (email: string) => void;
}

interface PersonRowProps {
  person: TeamMapPerson;
  roster: readonly OfficePerson[];
  now: Date;
  onSelect: (email: string) => void;
  /** Search results only: two people share this display name, so show the email that separates
   *  them — email is the identity every selection actually uses. */
  showEmail?: boolean;
  /** "2.4 km away" from the viewer's own shared location, or null when there is none. */
  distance?: string | null;
}

function Avatar({ person, size }: { person: TeamMapPerson; size: number }) {
  const src = profileImageFor(person.email, () => "");
  const style = { width: size, height: size };
  return src ? (
    <img className={styles.avatar} style={style} src={src} alt="" />
  ) : (
    <span className={styles.avatarInitials} style={style}>
      {initialsFor(person)}
    </span>
  );
}

function PersonRow({ person, roster, now, onSelect, showEmail = false, distance = null }: PersonRowProps) {
  const status = resolveMapStatus(person, roster);
  const time = formatLocalTime(person.timezone, now);
  return (
    <li>
      <button type="button" className={styles.row} onClick={() => onSelect(person.email)}>
        <Avatar person={person} size={28} />
        <span className={styles.rowText}>
          <span className={styles.rowName}>{resolveDisplayName(person, roster)}</span>
          <span className={styles.rowMeta}>
            {showEmail ? person.email : placeHintFor(person, now)}
            {time ? ` · ${time}` : ""}
            {distance ? ` · ${distance}` : ""}
          </span>
        </span>
        <span className={styles.rowStatus} style={{ background: STATUS_META[status].color }} />
      </button>
    </li>
  );
}

export function TeamMapPanel({ viewerEmail, roster, onClose, onOpenProfile, onOpenChat }: TeamMapPanelProps) {
  const [snapshot, setSnapshot] = useState<TeamMapSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [clusterEmails, setClusterEmails] = useState<string[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Employee search: the typed query, and the locate request handed to the canvas. The nonce lets
  // the same person be located twice in a row.
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ email: string; nonce: number } | null>(null);
  // Carousel filter, the ⓘ disclosure popover, and the "fit the whole team in view" request
  // handed to the canvas (a nonce, like focus, so the same request can fire twice).
  const [tab, setTab] = useState<FilterTab>("all");
  const [infoOpen, setInfoOpen] = useState(false);
  const [fit, setFit] = useState<{ nonce: number } | null>(null);
  // Carousel arrows drive the SAME overflow-x strip the wheel / trackpad / touch already scroll.
  const carouselRef = useRef<HTMLUListElement | null>(null);
  const [carouselEdge, setCarouselEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: true });

  // Working Today (V1.1): the viewer's own share state and the in-flight share/stop request.
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Snapshot load, on mount and again after a share/stop so the override shows immediately.
  // A response from a superseded load is ignored via the generation counter, so a slow first
  // load can never overwrite the post-share refetch.
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const data = await teamMapService.getPeople();
      if (generation !== loadGeneration.current) return;
      setSnapshot(data);
      setError(null);
    } catch (err: unknown) {
      if (generation !== loadGeneration.current) return;
      setError(err instanceof Error ? err.message : "Could not load the team map.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Geolocation is requested ONLY here, inside the click handler of the Share button — never on
  // mount, never watched (getCurrentPosition once). The fix is the EXACT location the user chose
  // to share; the backend stores it for up to 12 hours and every coworker with map access can see
  // it while active. The consent copy next to the button says exactly that.
  const shareWorkingToday = () => {
    setShareError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShareError("This browser cannot share a location.");
      return;
    }
    setShareBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fix: GeoFix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        teamMapService
          .shareWorkingToday(fix)
          .then(() => load())
          .catch((err: unknown) => {
            setShareError(err instanceof Error ? err.message : "Could not share your location.");
          })
          .finally(() => setShareBusy(false));
      },
      (geoError) => {
        setShareBusy(false);
        setShareError(
          geoError.code === 1
            ? "Location permission was denied. Allow location access for this site to share."
            : "Could not get your location right now.",
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const runShareAction = (action: () => Promise<void>, failure: string) => {
    setShareError(null);
    setShareBusy(true);
    action()
      .then(() => load())
      .catch((err: unknown) => {
        setShareError(err instanceof Error ? err.message : failure);
      })
      .finally(() => setShareBusy(false));
  };
  // Stop ends live sharing but keeps the last shared point (shown as "Last shared"); Forget
  // removes it entirely so the Atlas base location applies again.
  const stopWorkingToday = () =>
    runShareAction(() => teamMapService.stopWorkingToday(), "Could not stop sharing.");
  const forgetWorkingToday = () =>
    runShareAction(() => teamMapService.forgetWorkingToday(), "Could not forget the saved location.");

  // Local-time labels tick once a minute while the panel is open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const people = useMemo(() => snapshot?.people ?? [], [snapshot]);
  const grouped = useMemo(() => groupByBucket(people), [people]);
  const statusFor = useCallback(
    (person: TeamMapPerson) => resolveMapStatus(person, roster),
    [roster],
  );
  const selected = selectedEmail ? people.find((p) => p.email === selectedEmail) ?? null : null;
  const clusterPeople = clusterEmails
    ? people.filter((p) => clusterEmails.includes(p.email))
    : null;

  const selectPerson = (email: string) => {
    setClusterEmails(null);
    setSelectedEmail(email);
  };
  const selectCluster = (emails: string[]) => {
    setSelectedEmail(null);
    setClusterEmails(emails);
  };

  // Distance from the viewer's own shared point (live or saved). Null everywhere when they have
  // no share of their own — nothing is inferred from their browser and nothing is requested.
  const distanceTo = useCallback(
    (person: TeamMapPerson) => distanceLabelFor(snapshot?.me ?? null, person, viewerEmail),
    [snapshot?.me, viewerEmail],
  );

  // Same gate, shorter wording, for the pill attached to each map marker.
  const markerDistanceFor = useCallback(
    (person: TeamMapPerson) => compactDistanceLabelFor(snapshot?.me ?? null, person, viewerEmail),
    [snapshot?.me, viewerEmail],
  );

  const matches = useMemo(
    () => searchTeamMap(people, roster, query),
    [people, roster, query],
  );

  // A search hit does both halves of "find them": select the person (their card opens, which is
  // what identifies someone sitting on a shared coordinate) and ask the canvas to fly there.
  // Someone with no coordinates is selected the same way; the canvas simply does not move.
  const locatePerson = (email: string) => {
    selectPerson(email);
    setFocus((previous) => ({ email, nonce: (previous?.nonce ?? 0) + 1 }));
  };

  const isSelf = (email: string) =>
    viewerEmail !== null && email.toLowerCase() === viewerEmail.toLowerCase();


  // Which ends the strip is against, so the arrows can disable at the boundaries. Recomputed on
  // scroll, on resize, and whenever the rendered list changes.
  const syncCarouselEdges = useCallback(() => {
    const el = carouselRef.current;
    if (!el) {
      setCarouselEdge({ start: true, end: true });
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    setCarouselEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
  }, []);

  const scrollCarousel = (direction: -1 | 1) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(220, el.clientWidth * 0.8), behavior: "smooth" });
  };

  // ---- filters -------------------------------------------------------------------------------
  // "Nearest" needs a distance for everyone, and a distance exists only when the VIEWER has
  // shared a point of their own (nothing is inferred from the browser). With no share there is
  // nothing to sort by, so the tab is disabled rather than silently showing an arbitrary order.
  const nearestAvailable = Boolean(snapshot?.me);
  const activeTab: FilterTab = tab === "nearest" && !nearestAvailable ? "all" : tab;

  const metersTo = useCallback(
    (person: TeamMapPerson) => distanceMetersFor(snapshot?.me ?? null, person, viewerEmail),
    [snapshot?.me, viewerEmail],
  );

  // One list feeds the carousel: the search matches when searching (which keeps the ambiguous-
  // name handling), otherwise everyone, then the tab filter.
  const listed = useMemo(() => {
    const base =
      query.trim() === ""
        ? people.map((p) => ({ person: p, ambiguous: false }))
        : matches.map((m) => ({ person: m.person, ambiguous: m.ambiguous }));
    if (activeTab === "online") {
      return base.filter(({ person: p }) => resolveMapStatus(p, roster) !== "OFFLINE");
    }
    if (activeTab === "nearest") {
      return base
        .map((entry) => ({ ...entry, meters: metersTo(entry.person) }))
        .filter((entry): entry is typeof entry & { meters: number } => entry.meters !== null)
        .sort((a, b) => a.meters - b.meters);
    }
    return base;
  }, [activeTab, matches, metersTo, people, query, roster]);

  useEffect(() => {
    syncCarouselEdges();
    const onResize = () => syncCarouselEdges();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [syncCarouselEdges, listed]);

  // "My location" goes to the signed-in employee's OWN marker — matched by their authenticated
  // email against the snapshot, never by proximity or any other guess — through the same
  // select-and-ease path a teammate card uses. Nothing is requested and nothing is shared.
  const selfPerson = viewerEmail ? people.find((p) => isSelf(p.email)) ?? null : null;
  const canRecenter = Boolean(selfPerson && selfPerson.latitude !== null && selfPerson.longitude !== null);
  const goToMyLocation = () => {
    if (!selfPerson || selfPerson.latitude === null || selfPerson.longitude === null) return;
    locatePerson(selfPerson.email);
  };

  // Header status line: the viewer's REAL sharing state, straight off the snapshot.
  const sharingStatus = snapshot?.me?.active
    ? `Sharing exact location${
        formatSharedAgo(snapshot.me.shared_at, now) ? ` · Shared ${formatSharedAgo(snapshot.me.shared_at, now)}` : ""
      }`
    : snapshot?.me
      ? `Last shared${formatSharedAgo(snapshot.me.shared_at, now) ? ` ${formatSharedAgo(snapshot.me.shared_at, now)}` : ""} · Not live`
      : "Approximate locations · Not live";

  // Share / Stop / Forget, unchanged in behaviour, rendered beside My location in the header.
  const shareActions = snapshot?.me?.active ? (
    <button type="button" className={styles.headerAction} onClick={stopWorkingToday} disabled={shareBusy}>
      Stop sharing
    </button>
  ) : (
    <>
      <button
        type="button"
        className={styles.headerAction}
        onClick={shareWorkingToday}
        disabled={shareBusy || loading}
      >
        📍 Share my exact location today
      </button>
      {snapshot?.me && (
        <button type="button" className={styles.headerAction} onClick={forgetWorkingToday} disabled={shareBusy}>
          Forget saved location
        </button>
      )}
    </>
  );

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Global Team Map"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.headerIcon}>
            <HudIcon name="map" size="30px" />
          </span>
          <div className={styles.headerText}>
            <div className={styles.title}>Team map</div>
            <div className={styles.subtitleRow}>
              <button
                type="button"
                className={styles.infoButton}
                onClick={() => setInfoOpen((open) => !open)}
                aria-expanded={infoOpen}
                aria-label="About locations and sharing"
                title="About locations and sharing"
              >
                i
              </button>
              <span className={styles.subtitle}>{sharingStatus}</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            {shareActions}
            <button
              type="button"
              className={styles.headerAction}
              onClick={goToMyLocation}
              disabled={!canRecenter}
              title={
                canRecenter
                  ? "Centre the map on your own location"
                  : "You have no location on the map yet — share one to place yourself"
              }
            >
              📍 My location
            </button>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close team map">
            ✕
          </button>

          {/* Every word of the privacy disclosure lives here, unchanged. The Share / Stop /
              Forget controls themselves sit in the header beside My location; this popover
              carries the consent copy that belongs with each of those states. */}
          {infoOpen && (
            <div className={styles.infoPopover} role="group" aria-label="Locations and sharing">
              <p className={styles.infoLead}>
                {loading
                  ? "Loading…"
                  : `${grouped.ph.length} in the Philippines · ${grouped.elsewhere.length} elsewhere · ${grouped.none.length} without a location`}
              </p>
              <p className={styles.infoLead}>
                Approximate base locations from Atlas profiles — not where people are right now.
              </p>
              <div className={styles.shareRow}>
                {snapshot?.me?.active ? (
                  <>
                    <span className={styles.shareConsent} role="note">
                      Coworkers can see your exact shared location on this map until you stop sharing or
                      it expires 12 hours after sharing. Stopping keeps your last shared location visible
                      as “not live” until you forget it.
                    </span>
                  </>
                ) : snapshot?.me ? (
                  <>
                    <span className={styles.shareConsent} role="note">
                      You are not sharing live. Coworkers still see this last shared location, marked as
                      not live, until you forget it or share a new one; forgetting shows your approximate
                      Atlas base location instead.
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.shareConsent} role="note">
                      Your browser will ask for permission. If you allow it, coworkers can see your exact
                      location on this map for up to 12 hours or until you stop sharing.
                    </span>
                  </>
                )}
                {shareError && (
                  <span className={styles.shareError} role="alert">
                    {shareError}
                  </span>
                )}
              </div>
              <p className={styles.privacyNote}>
                Base locations are approximate (city or region), taken from each person's Atlas profile
                address, and may be out of date. They do not show where anyone is right now. Nobody's
                address or exact position is shown or sent to this page.
              </p>
            </div>
          )}
        </header>

        {snapshot?.source === "unavailable" && (
          <div className={styles.banner} role="status">
            Atlas is unavailable right now — the map has no people to show. Try again in a moment.
          </div>
        )}
        {snapshot?.source === "mock" && (
          <div className={styles.bannerMuted} role="status">
            Mock data — coarse fixture locations, no Atlas.
          </div>
        )}
        {error && (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.mapColumn}>
            <TeamMapCanvas
              people={people}
              statusFor={statusFor}
              onSelectPerson={selectPerson}
              onSelectCluster={selectCluster}
              distanceFor={markerDistanceFor}
              focus={focus}
              fit={fit}
            />

            <div className={styles.mapOverlay}>
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Find a teammate or city..."
                aria-label="Search employee"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className={styles.tabs} role="group" aria-label="Filter teammates">
                {FILTER_TABS.map(({ key, label }) => {
                  const disabled = key === "nearest" && !nearestAvailable;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={key === activeTab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setTab(key)}
                      disabled={disabled}
                      aria-pressed={key === activeTab}
                      title={
                        disabled
                          ? "Share your own location to sort teammates by distance"
                          : undefined
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className={styles.fitButton}
              onClick={() => setFit((previous) => ({ nonce: (previous?.nonce ?? 0) + 1 }))}
            >
              ⤢ Fit team
            </button>

            {selected && (
              <div
                className={styles.card}
                role="group"
                aria-label={`${resolveDisplayName(selected, roster)} details`}
              >
                <Avatar person={selected} size={48} />
                <div className={styles.cardText}>
                  <div className={styles.cardName}>{resolveDisplayName(selected, roster)}</div>
                  <div className={styles.cardMeta}>{resolveDepartment(selected, roster) ?? "—"}</div>
                  <div className={styles.cardMeta}>
                    <span
                      className={styles.rowStatus}
                      style={{ background: STATUS_META[statusFor(selected)].color }}
                    />{" "}
                    {STATUS_META[statusFor(selected)].label}
                  </div>
                  <div className={styles.cardMeta}>
                    {selected.working_today
                      ? `${placeHintFor(selected, now)} · exact location ${
                          selected.working_today.active ? "shared" : "as last shared"
                        }`
                      : selected.location_label
                        ? `Based near ${selected.location_label} (approx.)`
                        : "No base location on profile"}
                    {formatLocalTime(selected.timezone, now)
                      ? ` · ${formatLocalTime(selected.timezone, now)} local`
                      : ""}
                    {distanceTo(selected) ? ` · ${distanceTo(selected)}` : ""}
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => onOpenProfile(selected.email)}
                    >
                      👤 Profile
                    </button>
                    {onOpenChat && !isSelf(selected.email) && (
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => onOpenChat(selected.email)}
                      >
                        💬 Message
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.cardClose}
                  onClick={() => setSelectedEmail(null)}
                  aria-label="Close details"
                >
                  ✕
                </button>
              </div>
            )}
            {clusterPeople && clusterPeople.length > 0 && (
              <div className={styles.card} role="group" aria-label="People at this location">
                <div className={styles.cardText}>
                  <div className={styles.cardName}>
                    {clusterPeople[0].location_label ?? "This location"} · {clusterPeople.length}
                  </div>
                  <ul className={styles.list}>
                    {clusterPeople.map((p) => (
                      <PersonRow
                        key={p.email}
                        person={p}
                        roster={roster}
                        now={now}
                        onSelect={selectPerson}
                        distance={distanceTo(p)}
                      />
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  className={styles.cardClose}
                  onClick={() => setClusterEmails(null)}
                  aria-label="Close list"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Teammate carousel — the same rows the sidebar used, laid out horizontally under the
              map. Clicking one selects AND flies to them, exactly as a search hit always did. */}
          <section className={styles.tray}>
            <div className={styles.trayHead}>
              <h3 className={styles.sectionTitle}>
                Teammates <span className={styles.count}>{listed.length}</span>
              </h3>
            </div>
            {listed.length === 0 ? (
              <p className={styles.empty}>
                {loading
                  ? "Loading…"
                  : query.trim() !== ""
                    ? `No one matches “${query.trim()}”.`
                    : activeTab === "online"
                      ? "Nobody is online right now."
                      : "No teammates to show."}
              </p>
            ) : (
              <div className={styles.carouselWrap}>
                <button
                  type="button"
                  className={`${styles.carouselArrow} ${styles.carouselArrowStart}`}
                  onClick={() => scrollCarousel(-1)}
                  disabled={carouselEdge.start}
                  aria-label="Scroll teammates left"
                >
                  ‹
                </button>
                <ul
                  className={styles.carousel}
                  ref={carouselRef}
                  onScroll={syncCarouselEdges}
                  aria-label={query.trim() !== "" ? "Search results" : "Teammates"}
                >
                  {listed.map(({ person: p, ambiguous }) => (
                    <PersonRow
                      key={p.email}
                      person={p}
                      roster={roster}
                      now={now}
                      onSelect={locatePerson}
                      showEmail={ambiguous}
                      distance={distanceTo(p)}
                    />
                  ))}
                </ul>
                <button
                  type="button"
                  className={`${styles.carouselArrow} ${styles.carouselArrowEnd}`}
                  onClick={() => scrollCarousel(1)}
                  disabled={carouselEdge.end}
                  aria-label="Scroll teammates right"
                >
                  ›
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// Default export for React.lazy in OfficeMap.tsx.
export default TeamMapPanel;
