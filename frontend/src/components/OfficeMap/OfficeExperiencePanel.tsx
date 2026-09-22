// SETTINGS -> GENERAL -> OFFICE EXPERIENCE. Which office this employee opens.
//
// IT IS IN BOTH OFFICES, AND THAT IS THE POINT. HudSettings is the one panel V1's dock and V2's HUD both
// mount, so this section renders in each of them unconditionally. A selector that only existed in the 3D
// office would be a one-way door: an employee who chose Classic could never get back without being told
// about a URL parameter.
//
// IT OWNS NO STATE. services/settings/officeExperience is the single source of truth; this renders it,
// writes to it, and then reloads. Nothing else reads it at runtime — App.tsx asks once, after the auth
// gate opens, and holds that answer for the session.
//
// WHY A FULL DOCUMENT NAVIGATION RATHER THAN A RE-RENDER. Both directions are unsafe as a React swap, for
// two separate reasons that are both real:
//   • V1 -> V2: V1's WebGL context is the lazily-built module singleton in render3d/SharedRenderer.ts and
//     it has NO production teardown (its only dispose() is the test reset). Unmounting V1's tree leaves
//     that context alive and V2 then builds a second one.
//   • V2 -> V1: the 3D world scatters listeners and GPU state across window, document and document.body.
//     dev/vo3d/app/Vo3dHost.tsx's own back button already navigates for exactly this reason, in its own
//     words: a full document teardown is the one teardown that cannot leave anything behind.
// So the switch is a navigation, and because it is, it is CONFIRMED first — a reload during a call or a
// half-written message is a real cost and the employee gets to decline it.
//
// THE SWITCH NEVER TOUCHES ATTENDANCE. It writes one localStorage key and sets window.location. No
// check-in, no check-out, no time log, no presence transition: the work session is server-side state and
// reloading a page has never been a way to change it.
import { useState, useSyncExternalStore } from "react";
import styles from "./HudSettings.module.css";
import { ExperienceCards } from "./ExperienceCards";
import { experienceLabel, galleryFor } from "./officeExperienceGallery";
import { allowedExperiences } from "../../services/office/experienceCatalog";
import { useExperienceCatalog } from "../../services/office/useExperienceCatalog";
import {
  getOfficeExperience,
  getStoredOfficeExperience,
  setOfficeExperience,
  subscribeOfficeExperience,
  resolveOfficeExperience,
  switchUrl,
  type OfficeExperience,
} from "../../services/settings/officeExperience";

function useOfficeExperienceValue(): OfficeExperience {
  return useSyncExternalStore(subscribeOfficeExperience, getOfficeExperience, getOfficeExperience);
}

export function OfficeExperiencePanel() {
  // TWO ANSWERS, BECAUSE THEY CAN DISAGREE, and reading only one of them made this panel lie.
  //
  //   `saved`   what this employee has chosen, which is what an ordinary load will open.
  //   `open`    the office actually on screen right now.
  //
  // `?world=v1` is a per-tab override that beats the preference (a support lever, and the failure
  // screen's escape hatch), so somebody can be LOOKING AT Classic while their saved office is the 3D
  // one. Showing `saved` as the selected card then told them "You are in the 3D Office" over a Classic
  // floor. The card now marks the office they are in, which is the question a picture answers.
  const saved = useOfficeExperienceValue();
  const catalog = useExperienceCatalog();
  const allowed = allowedExperiences(catalog);
  const gallery = galleryFor(catalog);
  // Resolved against the SAME allowed set App.tsx used, so a card is never marked as the office you
  // are in when the server would not have let you into it.
  const open = resolveOfficeExperience(window.location.search, allowed, catalog.default);
  // WHAT AN ORDINARY LOAD WOULD OPEN — the same resolution with the URL's say taken away. This, not
  // `saved`, is what "your saved office" means in the status line below: somebody who has never chosen
  // still HAS an office they get every morning (the company default), and telling them their saved
  // office was the 3D one when the company default had been moved to Classic was the same class of
  // lie as naming a season after the wrong office.
  const wouldOpen = resolveOfficeExperience("", allowed, catalog.default);
  // The employee's own EXPLICIT choice, or null. Only used to tell "this is simply what opens" apart
  // from "this is what you picked", and to notice a saved office the server no longer lists.
  const chosen = getStoredOfficeExperience();
  const strandedChoice =
    catalog.status === "ok" && chosen !== null && !allowed.includes(chosen) ? chosen : null;
  // The choice picked but not yet confirmed. Null means nothing is pending.
  const [pending, setPending] = useState<OfficeExperience | null>(null);
  const current = open;

  const confirm = (): void => {
    if (!pending) return;
    setOfficeExperience(pending);
    // Written first, navigated second: the next document reads the preference on its way up, so the
    // order is the whole mechanism rather than a nicety.
    window.location.href = switchUrl(window.location.href);
  };

  return (
    <section className={styles.section} aria-label="Office Experience" data-testid="office-experience-settings">
      <h3 className={styles.sectionTitle}>Office Experience</h3>
      <div className={styles.card}>
        <ExperienceCards
          name="office-experience"
          ariaLabel="Office Experience"
          options={gallery}
          value={pending ?? current}
          // A switch is offered whenever confirming would CHANGE something — either the office on screen
          // or the saved choice. That second half is what lets somebody who arrived on `?world=v1` make
          // Classic their actual preference: the card they are on is already selected, but their saved
          // office is still the 3D one, so picking it is a real change and not a no-op.
          onChange={(value) => setPending(value === open && value === saved ? null : value)}
        />
        {/* A CATALOG THAT COULD NOT BE READ IS SAID OUT LOUD, never quietly absorbed. "your season is
            missing because the office could not be reached" and "your season was unpublished" are
            different facts, and an employee whose saved office is not on screen is owed the
            difference. Nothing was written to their preference — it is still exactly what they chose,
            and the next successful load honours it. */}
        {catalog.status === "unavailable" && (
          <p className={styles.cardStatus} data-testid="office-experience-catalog-offline">
            Could not reach the office to check which experiences are available, so only the 3D and
            Classic offices are shown. Your saved choice has not been changed.
          </p>
        )}
        {pending ? (
          <>
            <p className={styles.cardStatus} data-testid="office-experience-confirm">
              Switching reloads the office. Open panels close, and anything in progress — a call, a
              meeting, an unsent message — is interrupted. Your work session is not affected: this never
              checks you in or out.
            </p>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.actionButton} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className={styles.actionButton} onClick={confirm}>
                Switch and reload
              </button>
            </div>
          </>
        ) : (
          <p className={styles.cardStatus} data-testid="office-experience-status">
            {/* EVERY OFFICE IS NAMED, never assumed. This line used to be two hardcoded sentences about
                the 3D office and the Classic one, written before a season could be either of them —
                so a Creator previewing Halloween was told "You are in the Classic Office", and an
                employee sent to `?world=v1` with Christmas saved was told their saved office was the
                3D one. Both were flatly false, on the one surface whose whole job is to say where you
                are. */}
            {open !== wouldOpen
              ? `You are in the ${experienceLabel(open)} for this tab only — your saved office is the ${experienceLabel(wouldOpen)}. Pick ${experienceLabel(open)} to keep it.`
              : strandedChoice !== null
                ? /* Their choice survived the season being unpublished (services/settings/officeExperience
                     keeps it on purpose); what changed is that the company turned it off. Saying so is the
                     difference between "your office moved" and "somebody moved your office". */
                  `You are in the ${experienceLabel(open)}. The ${experienceLabel(strandedChoice)} you chose is not available right now, so this one opens until it is back.`
                : chosen === null
                  ? `You are in the ${experienceLabel(open)}. It opens by default.`
                  : `You are in the ${experienceLabel(open)}. It opens every time you sign in until you change this.`}
          </p>
        )}
      </div>
    </section>
  );
}
