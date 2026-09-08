import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { profileImageFor } from "../../data/portraits";
import type { OfficePerson } from "../../services/office/floorMerge";
import { STATUS_META } from "../../services/presence/status";
import { teamMapService } from "../../services/teamMap";
import {
  BUCKET_LABELS,
  formatLocalTime,
  formatSharedAgo,
  groupByBucket,
  initialsFor,
  placeHintFor,
  resolveDepartment,
  resolveDisplayName,
  resolveMapStatus,
} from "../../services/teamMap/buckets";
import { compactDistanceLabelFor, distanceLabelFor } from "../../services/teamMap/distance";
import { searchTeamMap } from "../../services/teamMap/search";
import type { GeoFix, TeamMapPerson, TeamMapSnapshot } from "../../services/teamMap/types";
import { TeamMapCanvas } from "./TeamMapCanvas";
import styles from "./TeamMapPanel.module.css";

// Global Team Map V1 panel. Opened from the HUD's Map button (OfficeMap.tsx) via React.lazy so
// MapLibre never loads for someone who never opens it. Shell mirrors MissionsPanel — one modal
// family. Data is fetched on every open (a snapshot, not a stream) through the teamMapService
// seam; live VO status comes from the floor roster the parent already holds.

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

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Global Team Map"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close team map">
          ✕
        </button>
        <header className={styles.header}>
          <div className={styles.title}>🌍 Global Team Map</div>
          <div className={styles.subtitle}>
            {loading
              ? "Loading…"
              : `${grouped.ph.length} in the Philippines · ${grouped.elsewhere.length} elsewhere · ${grouped.none.length} without a location`}
          </div>
          <div className={styles.subtitle}>
            Approximate base locations from Atlas profiles — not where people are right now.
          </div>
          <div className={styles.shareRow}>
            {snapshot?.me?.active ? (
              <>
                <span className={styles.shareStatus}>
                  {`📍 Working today${
                    formatSharedAgo(snapshot.me.shared_at, now)
                      ? ` · Shared ${formatSharedAgo(snapshot.me.shared_at, now)}`
                      : ""
                  }`}
                </span>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={stopWorkingToday}
                  disabled={shareBusy}
                >
                  Stop sharing
                </button>
                <span className={styles.shareConsent} role="note">
                  Coworkers can see your exact shared location on this map until you stop sharing or
                  it expires 12 hours after sharing. Stopping keeps your last shared location visible
                  as “not live” until you forget it.
                </span>
              </>
            ) : snapshot?.me ? (
              <>
                <span className={styles.shareStatus}>
                  {`📍 Last shared${
                    formatSharedAgo(snapshot.me.shared_at, now)
                      ? ` ${formatSharedAgo(snapshot.me.shared_at, now)}`
                      : ""
                  } · not live`}
                </span>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={shareWorkingToday}
                  disabled={shareBusy || loading}
                >
                  📍 Share my exact location today
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={forgetWorkingToday}
                  disabled={shareBusy}
                >
                  Forget saved location
                </button>
                <span className={styles.shareConsent} role="note">
                  You are not sharing live. Coworkers still see this last shared location, marked as
                  not live, until you forget it or share a new one; forgetting shows your approximate
                  Atlas base location instead.
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={shareWorkingToday}
                  disabled={shareBusy || loading}
                >
                  📍 Share my exact location today
                </button>
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
            />
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

          <aside className={styles.sidebar}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search employee…"
              aria-label="Search employee"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query.trim() !== "" && (
              <section>
                <h3 className={styles.sectionTitle}>
                  Search results <span className={styles.count}>{matches.length}</span>
                </h3>
                {matches.length === 0 ? (
                  <p className={styles.empty}>No one matches “{query.trim()}”.</p>
                ) : (
                  <ul className={styles.list} aria-label="Search results">
                    {matches.map((match) => (
                      <PersonRow
                        key={match.person.email}
                        person={match.person}
                        roster={roster}
                        now={now}
                        onSelect={locatePerson}
                        showEmail={match.ambiguous}
                        distance={distanceTo(match.person)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section>
              <h3 className={styles.sectionTitle}>
                {BUCKET_LABELS.elsewhere} <span className={styles.count}>{grouped.elsewhere.length}</span>
              </h3>
              {grouped.elsewhere.length === 0 && !loading && (
                <p className={styles.empty}>Everyone with a location is in the Philippines.</p>
              )}
              <ul className={styles.list}>
                {grouped.elsewhere.map((p) => (
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
            </section>
            <section>
              <h3 className={styles.sectionTitle}>
                {BUCKET_LABELS.none} <span className={styles.count}>{grouped.none.length}</span>
              </h3>
              {grouped.none.length === 0 && !loading && (
                <p className={styles.empty}>Everyone has a coarse location.</p>
              )}
              <ul className={styles.list}>
                {grouped.none.map((p) => (
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
            </section>
            <p className={styles.privacyNote}>
              Base locations are approximate (city or region), taken from each person's Atlas profile
              address, and may be out of date. They do not show where anyone is right now. Nobody's
              address or exact position is shown or sent to this page.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

// Default export for React.lazy in OfficeMap.tsx.
export default TeamMapPanel;
