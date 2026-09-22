// THE OFFICE EXPERIENCE GALLERY — every office an employee can be in, in one list.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE STORE. services/settings/officeExperience owns which office
// is CHOSEN and holds the ids; this owns how each one is PRESENTED — its name, its one line, and the
// capture of it. Keeping them apart is what stops App.tsx, which only ever asks the store one question
// on boot, from pulling five screenshots into the office's own startup path.
//
// ══ WHAT IS BEING PREPARED FOR HERE ══
//
// The gallery is meant to hold more than two offices: Halloween and Christmas are coming, and they are
// SEASONAL DECORATION OF THE SAME V2 WORLD — the same rooms, the same navigation, the same seating,
// with a reversible decorative layer over them. They are not separate applications and they are not new
// geometry, so they are entries in this list rather than anything structural.
//
// NEITHER IS SHIPPED, AND NEITHER IS SHOWN. There are no Halloween or Christmas assets in this
// repository, and a card is only honest if the picture on it is a capture of a place that exists. An
// entry with `comingSoon` renders as a dimmed, labelled, genuinely unselectable preview — that is the
// seam they arrive through, and it stays unused until there is real art and a real decorative layer to
// stand behind it. Adding one is one object in the array below: no new selector, no second code path,
// no change to persistence, confirmation or the reload.
//
// WHAT THIS DELIBERATELY DOES NOT DO. Nothing here decides who may see an experience. The eventual
// model — a creator previewing privately, publishing and unpublishing a season, setting a company
// default that an employee's explicit choice still overrides — is server state, and this is a static
// presentation list in the browser. When that lands, the source of this array changes; every consumer
// below stays exactly as it is, because they already only read "what may I show, and what may I pick".
import { SELECTABLE_OFFICE_EXPERIENCES, type OfficeExperience } from "../../services/settings/officeExperience";
import office3dArt from "../../assets/experience/office-3d.webp";
import officeClassicArt from "../../assets/experience/office-classic.webp";

export interface OfficeExperienceEntry {
  value: OfficeExperience;
  label: string;
  hint: string;
  /** A real capture of this office. */
  art: string;
  /** Present and unselectable. Absent means it can be chosen today. */
  comingSoon?: boolean;
}

/** TWO OFFICES, NOT A MODE AND ITS LEGACY. Classic is described as a place somebody may simply prefer;
 *  nothing here calls it old, previous or deprecated, because it is none of those. */
export const OFFICE_EXPERIENCE_GALLERY: readonly OfficeExperienceEntry[] = [
  {
    value: "v2",
    label: "3D Office",
    hint: "Walk the office in three dimensions",
    art: office3dArt,
  },
  {
    value: "classic",
    label: "Classic Office",
    hint: "The original top-down floor",
    art: officeClassicArt,
  },
  // Seasonal offices land here — same V2 world, decorative layer on top:
  //   { value: "halloween", label: "Halloween Office", hint: "…", art: halloweenArt, comingSoon: true },
  //   { value: "christmas", label: "Christmas Office", hint: "…", art: christmasArt, comingSoon: true },
  // Neither is listed until there is a capture of a real one to put on the card.
];

/** A belt-and-braces check that the gallery and the store cannot drift: anything offered as SELECTABLE
 *  here must be a value the store will actually accept and persist. A seasonal entry that is still
 *  `comingSoon` is exempt, because it is not offered. */
export function selectableGalleryEntries(): readonly OfficeExperienceEntry[] {
  return OFFICE_EXPERIENCE_GALLERY.filter(
    (entry) => entry.comingSoon || SELECTABLE_OFFICE_EXPERIENCES.includes(entry.value),
  );
}
