// SETTINGS -> GENERAL -> CREATOR STUDIO. Publishing seasonal offices, and the company default.
//
// WHO SEES IT. Only a caller the SERVER reported as a Creator (`catalog.creator`, from
// GET /office/experience, derived from the `experience.creator` grant in employee_permissions). There
// is no email comparison anywhere in this file, no environment variable and no local flag — the one
// thing this component gates on is a boolean the backend computed from a verified bearer identity.
//
// HIDING IT IS NOT THE SECURITY. Every button here calls an endpoint that checks the capability again
// and answers 403 without it, so an employee who forced this section to render would get a row of
// controls that refuse. The gate is there so the Studio is not in the way of people it is not for,
// not because rendering it would give anything away.
//
// WHAT IT DELIBERATELY CANNOT DO. Grant or revoke any permission, including its own: nothing in the
// HTTP app writes employee_permissions, so a Creator cannot make a second Creator (or un-make
// themselves) from here or anywhere else. That stays an out-of-band administrative act — see
// backend/app/scripts/grant_permission.py.
//
// WHY IT IS A SECTION IN GENERAL AND NOT ITS OWN CATEGORY. It is one short list of switches about the
// thing the section directly above it shows. A category of its own would put a whole tab in the
// sidebar of one person's settings and make the gallery and the controls over it two different
// places.
import { useState } from "react";
import styles from "./HudSettings.module.css";
import { useExperienceCatalog } from "../../services/office/useExperienceCatalog";
import { PERMANENT_GALLERY, SEASONAL_PRESENTATION } from "./officeExperienceGallery";
import {
  setDefaultExperience,
  setExperiencePublication,
  type ExperiencePublication,
} from "../../services/office/experienceCatalog";
import {
  applyExperienceCatalog,
  refreshExperienceCatalog,
} from "../../services/office/experienceCatalogStore";
import { DEFAULT_OFFICE_EXPERIENCE, type OfficeExperience } from "../../services/settings/officeExperience";

/** How a publication row reads, in plain words. The three states are genuinely different and the
 *  Studio is the one place that has to tell them apart honestly:
 *
 *    not implemented  no decoration layer has shipped. Nothing to publish; the button would 400.
 *    published        the whole company can choose it.
 *    ready            implemented and unpublished — visible to this Creator alone, as a preview. */
function publicationState(record: ExperiencePublication): "unimplemented" | "published" | "ready" {
  if (!record.implemented) return "unimplemented";
  return record.published ? "published" : "ready";
}

const STATE_LABEL: Record<ReturnType<typeof publicationState>, string> = {
  unimplemented: "Not built yet",
  published: "Published to everyone",
  ready: "Ready — only you can see it",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The card's display name. A season that has shipped has a real label in the gallery's presentation
 *  table; one that has not is named after its identifier rather than invented — this section must be
 *  able to describe an office that does not exist yet without pretending it does. */
function experienceLabel(value: OfficeExperience): string {
  // The permanent offices have had proper names since Phase 8 ("3D Office", not "V2 Office"), and the
  // Studio's default line names one of them most of the time — so the gallery is asked FIRST. A
  // season that has shipped has a name in the presentation table; one that has not is named after its
  // identifier rather than invented, because this section has to be able to describe an office that
  // does not exist yet without pretending it does.
  const permanent = PERMANENT_GALLERY.find((entry) => entry.value === value);
  return permanent?.label ?? SEASONAL_PRESENTATION[value]?.label ?? `${titleCase(value)} Office`;
}

export function CreatorStudioPanel() {
  const catalog = useExperienceCatalog();
  // One request at a time, named so the row that started it can show its own spinner rather than the
  // whole section greying out.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // THE GATE. The server said this caller is not a Creator, so there is nothing here for them.
  if (!catalog.creator) return null;

  /** Every action goes through here so that loading, success and failure are handled once and the
   *  same way, and so a write's FRESH CATALOG is adopted rather than re-derived — a publish can move
   *  the company default too (unpublishing the current default restores the 3D office), and this is
   *  what keeps the row and the default line below from disagreeing for a tick. */
  const run = async (key: string, message: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(message);
    } catch (cause) {
      // The server's own words. It is the side that knows WHY — "has no decoration layer in this
      // build", "is not published, so it cannot be the company default" — and inventing a friendlier
      // sentence here would mean hiding the actual reason from the only person who can act on it.
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const publish = (experience: OfficeExperience, published: boolean): Promise<void> =>
    run(
      `publication:${experience}`,
      published
        ? `${experienceLabel(experience)} is published. Everyone can choose it now.`
        : `${experienceLabel(experience)} is unpublished. Only you can see it.`,
      async () => {
        applyExperienceCatalog(await setExperiencePublication(experience, published));
      },
    );

  const makeDefault = (experience: OfficeExperience): Promise<void> =>
    run(
      "default",
      experience === DEFAULT_OFFICE_EXPERIENCE
        ? "The 3D Office is the company default again."
        : `${experienceLabel(experience)} is the company default.`,
      async () => {
        applyExperienceCatalog(await setDefaultExperience(experience));
      },
    );

  const defaultOptions = catalog.available;

  return (
    <section className={styles.section} aria-label="Creator Studio" data-testid="creator-studio">
      <h3 className={styles.sectionTitle}>Creator Studio</h3>

      <div className={styles.card}>
        <p className={styles.cardStatus}>
          Seasonal offices are this same 3D office with decorations over it. Publishing one lets
          everybody choose it; the company default is what someone opens if they have never chosen for
          themselves. Nobody's office changes while they are in it — a change here reaches them the
          next time they open the office, and it never checks anyone in or out.
        </p>

        {/* --- publication, one row per seasonal experience --------------------------------------- */}
        {catalog.publications.length === 0 ? (
          <p className={styles.cardStatus} data-testid="creator-studio-no-seasons">
            There are no seasonal offices in this build yet.
          </p>
        ) : (
          catalog.publications.map((record) => {
            const state = publicationState(record);
            const key = `publication:${record.experience}`;
            return (
              <div className={styles.cardRow} key={record.experience} data-testid={`creator-season-${record.experience}`}>
                <div className={styles.cardText}>
                  <span className={styles.rowLabel}>{experienceLabel(record.experience)}</span>
                  <span className={styles.rowHint} data-testid={`creator-season-state-${record.experience}`}>
                    {STATE_LABEL[state]}
                    {record.updatedBy ? ` · last changed by ${record.updatedBy}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.actionButton}
                  // NOT BUILT YET IS DISABLED, AND THE SERVER AGREES. The backend refuses to publish
                  // an experience whose decoration layer has not shipped, so this is the button
                  // matching the rule rather than being the rule: pressing it anyway would 400.
                  disabled={state === "unimplemented" || busy !== null}
                  onClick={() => void publish(record.experience, !record.published)}
                >
                  {busy === key ? "Working…" : record.published ? "Unpublish" : "Publish"}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* --- the company default ------------------------------------------------------------------ */}
      <div className={styles.card}>
        <div className={styles.cardText}>
          <span className={styles.rowLabel}>Company default</span>
          <span className={styles.rowHint} data-testid="creator-default-state">
            {experienceLabel(catalog.default)} — what someone opens if they have never chosen
          </span>
        </div>
        <div className={styles.buttonRow}>
          {defaultOptions.map((experience) => (
            <button
              key={experience}
              type="button"
              className={styles.actionButton}
              data-testid={`creator-default-${experience}`}
              data-selected={experience === catalog.default ? "true" : undefined}
              disabled={busy !== null || experience === catalog.default}
              onClick={() => void makeDefault(experience)}
            >
              {experienceLabel(experience)}
            </button>
          ))}
        </div>
        <p className={styles.cardStatus}>
          Only a published office can be the default. Unpublishing the office that is currently the
          default puts the 3D Office back in the same step, so there is never a default nobody can
          open.
        </p>
      </div>

      {/* --- feedback, and a way to ask again ----------------------------------------------------- */}
      <div className={styles.card}>
        {error && (
          <p className={styles.cardStatus} role="alert" data-testid="creator-studio-error">
            {error}
          </p>
        )}
        {done && !error && (
          <p className={styles.cardStatus} role="status" data-testid="creator-studio-done">
            {done}
          </p>
        )}
        {catalog.status === "unavailable" && (
          <p className={styles.cardStatus} data-testid="creator-studio-offline">
            This is the offline view — the office could not be reached, so nothing here is confirmed.
          </p>
        )}
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.actionButton}
            disabled={busy !== null}
            data-testid="creator-studio-refresh"
            onClick={() =>
              void run("refresh", "Refreshed.", async () => {
                await refreshExperienceCatalog();
              })
            }
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
    </section>
  );
}
