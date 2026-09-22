// THE CATALOG, HELD FOR THE SESSION. One read on boot, one copy, every reader.
//
// WHY A STORE AND NOT A HOOK PER CONSUMER. Three things need the catalog and they need it at
// different moments: App.tsx must have it BEFORE it can decide which office to render, the Office
// Experience gallery needs it whenever Settings is opened, and the Creator Studio both reads it and
// replaces it after a write. A per-component fetch would ask the backend three times for one
// answer, and the two later answers could disagree with the office already on screen.
//
// THE OFFICE ON SCREEN IS DECIDED ONCE AND NEVER RE-DECIDED. This store may be refreshed — a Creator
// publishing something updates it immediately, because they need to see what they just did — but
// App.tsx reads it exactly once, after the auth gate, and holds that answer in a ref for the life of
// the document. So a company default changing, or a Creator publishing a season, never swaps an
// employee's office out from under an open call. It takes effect on their next ordinary load, which
// is the same rule the saved preference has always followed.
import {
  PERMANENT_FALLBACK,
  fetchExperienceCatalog,
  type ExperienceCatalog,
} from "./experienceCatalog";

let state: ExperienceCatalog = PERMANENT_FALLBACK;
let inFlight: Promise<ExperienceCatalog> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** The catalog as it stands. Before the first load — and after a failed one — this is
 *  PERMANENT_FALLBACK: the two offices that are available by construction, the 3D one as the
 *  default, and no Creator. Never null, so no consumer needs a loading branch just to render. */
export function getExperienceCatalog(): ExperienceCatalog {
  return state;
}

export function subscribeExperienceCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Load it once. Concurrent callers share the one request; later callers get the cached answer.
 *
 *  NEVER REJECTS — fetchExperienceCatalog turns every failure into PERMANENT_FALLBACK — so the boot
 *  path has no error branch and cannot be stalled by a backend that is down, slow or pre-migration.
 *
 *  A FAILED LOAD IS NOT CACHED AS SUCCESS but it IS what this session runs on. `inFlight` is kept so
 *  the boot path does not retry in a loop; a Creator who needs a fresh answer has `refreshExperienceCatalog`,
 *  and everybody else gets one on their next load. Nothing here ever writes the preference store:
 *  a backend outage must not be able to edit what an employee chose. */
export function loadExperienceCatalog(): Promise<ExperienceCatalog> {
  if (inFlight) return inFlight;
  inFlight = fetchExperienceCatalog().then((catalog) => {
    state = catalog;
    notify();
    return catalog;
  });
  return inFlight;
}

/** Ask again, ignoring the cache. For the Creator Studio's "refresh" and for a retry after a failed
 *  boot read. */
export function refreshExperienceCatalog(): Promise<ExperienceCatalog> {
  inFlight = null;
  return loadExperienceCatalog();
}

/** Adopt the catalog a WRITE answered with. Publish and default changes return the whole fresh
 *  catalog from the server, so the Studio never has to re-derive what it just changed — and the
 *  gallery beside it updates from the same object in the same tick. */
export function applyExperienceCatalog(catalog: ExperienceCatalog): void {
  state = catalog;
  inFlight = Promise.resolve(catalog);
  notify();
}

/** Tests only — back to "nothing has been loaded", without touching the listeners. */
export function __resetExperienceCatalogForTests(): void {
  state = PERMANENT_FALLBACK;
  inFlight = null;
  notify();
}
