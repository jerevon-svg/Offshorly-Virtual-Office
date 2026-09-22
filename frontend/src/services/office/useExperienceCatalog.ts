// THE CATALOG, AS A COMPONENT READS IT. A subscription to the session store, plus the one-shot load.
//
// IN ITS OWN FILE because it is shared by two components — the Office Experience gallery and the
// Creator Studio beside it — and a hook exported from a component module breaks Fast Refresh for
// that module. It is three lines of React over services/office/experienceCatalogStore; the store is
// still where the answer lives.
//
// SUBSCRIBED, UNLIKE IN App.tsx, and the difference is deliberate. App resolves the office ONCE and
// must never re-read it, or a change made elsewhere would swap somebody's office out from under an
// open call. A settings panel is a PICTURE of the current state and should update the moment a
// Creator publishes something next to it. Changing what is shown still moves nobody: only the
// confirmed reload in OfficeExperiencePanel does that.
import { useEffect, useSyncExternalStore } from "react";
import type { ExperienceCatalog } from "./experienceCatalog";
import {
  getExperienceCatalog,
  loadExperienceCatalog,
  subscribeExperienceCatalog,
} from "./experienceCatalogStore";

export function useExperienceCatalog(): ExperienceCatalog {
  const catalog = useSyncExternalStore(
    subscribeExperienceCatalog,
    getExperienceCatalog,
    getExperienceCatalog,
  );
  // Settings can be opened in a session that never ran App's boot read — the standalone dev rig, or
  // a boot where the read failed. One shared request, and it cannot reject.
  useEffect(() => {
    void loadExperienceCatalog();
  }, []);
  return catalog;
}
