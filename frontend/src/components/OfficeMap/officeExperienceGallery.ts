// THE OFFICE EXPERIENCE GALLERY — every office an employee can be in, in one list.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE STORE. services/settings/officeExperience owns which office
// is CHOSEN and holds the ids; services/office/experienceCatalog owns which ones this employee MAY
// choose; this owns how each one is PRESENTED — its name, its one line, and the capture of it.
// Keeping them apart is what stops App.tsx, which only ever asks two questions on boot, from pulling
// five screenshots into the office's own startup path.
//
// ══ WHAT CHANGED IN PHASE 9A ══
//
// The list stopped being a constant and became a FUNCTION OF THE SERVER'S ANSWER. Which offices are
// shown is now `galleryFor(catalog)`: the two permanent ones always, plus whichever seasonal offices
// the server listed for this verified identity — as available to everyone, or as a Creator's private
// preview. Nothing here decides that; it renders it.
//
// ══ A SEASON NEEDS BOTH HALVES ══
//
// A card is only honest if the picture on it is a capture of a place that exists, so a season appears
// here only when its decoration layer has actually shipped AND somebody has photographed it. Halloween
// arrived that way in Phase 9B (season/halloween + a real capture of the decorated Central Hub), and
// White Christmas the same way in the checkpoint after it (season/christmas + its own capture).
//
// An experience the server lists but that has no presentation here produces NO CARD at all. That is a
// belt-and-braces second lock, not the real one — the real one is the server's IMPLEMENTED_EXPERIENCES
// gate, which refuses to publish or preview a season whose layer has not shipped, so the catalog
// cannot list one in the first place. This file's silence means that even a server which somehow did
// list one could not put an unbacked card in front of anybody.
//
// ADDING A SEASON IS ONE OBJECT IN SEASONAL_PRESENTATION plus its captured art — no new selector, no
// second code path, no change to persistence, confirmation or the reload.
import type { ExperienceCatalog } from "../../services/office/experienceCatalog";
import { PERMANENT_OFFICE_EXPERIENCES, type OfficeExperience } from "../../services/settings/officeExperience";
import office3dArt from "../../assets/experience/office-3d.webp";
import officeClassicArt from "../../assets/experience/office-classic.webp";
import officeHalloweenArt from "../../assets/experience/office-halloween.webp";
import officeChristmasArt from "../../assets/experience/office-christmas.webp";

export interface OfficeExperienceEntry {
  value: OfficeExperience;
  label: string;
  hint: string;
  /** A real capture of this office. */
  art: string;
  /** Present and unselectable. Absent means it can be chosen today. */
  comingSoon?: boolean;
  /** A CREATOR'S PRIVATE PREVIEW: listed for this caller, not published to the company. Selectable —
   *  previewing it on the live site is the point — but labelled, so a Creator is never in any doubt
   *  about whether their colleagues can see what they are looking at. */
  unpublished?: boolean;
}

/** How each seasonal office is PRESENTED, once one exists.
 *
 *  An entry here is the frontend half of making a season real; the backend half is its identifier
 *  joining IMPLEMENTED_EXPERIENCES. Neither half alone shows anybody anything.
 *
 *  THE ART IS A REAL CAPTURE, like every other card in this gallery — the decorated Central Hub,
 *  photographed through the app's own camera with the HUD off (src/assets/experience/*.webp). This
 *  gallery has never put a drawing or a generated image on a card and does not start now: a card is
 *  a promise that the place on it exists. Both seasonal captures are frames the local rig actually
 *  rendered; neither is concept art, and nothing here was generated. */
export const SEASONAL_PRESENTATION: Partial<Record<OfficeExperience, Omit<OfficeExperienceEntry, "value">>> = {
  halloween: {
    label: "Halloween Office",
    hint: "The same office, after dark",
    art: officeHalloweenArt,
  },
  christmas: {
    label: "White Christmas Office",
    hint: "The same office, under snow",
    art: officeChristmasArt,
  },
};

/** TWO OFFICES, NOT A MODE AND ITS LEGACY. Classic is described as a place somebody may simply prefer;
 *  nothing here calls it old, previous or deprecated, because it is none of those. */
export const PERMANENT_GALLERY: readonly OfficeExperienceEntry[] = [
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
];

/** @deprecated Phase 9A made the gallery a function of the server's catalog. This is the permanent
 *  part of it, kept under its old name so nothing that only ever wanted the two offices breaks. */
export const OFFICE_EXPERIENCE_GALLERY = PERMANENT_GALLERY;

/** The cards to show this employee: the permanent offices, then any seasonal office the SERVER
 *  listed for them and that this build can actually picture.
 *
 *  A listed experience with no entry in SEASONAL_PRESENTATION is SKIPPED IN SILENCE rather than
 *  rendered as a placeholder. A card with no picture is a promise with nothing behind it, and this
 *  gallery's oldest rule is that it never makes one. */
export function galleryFor(catalog: ExperienceCatalog): readonly OfficeExperienceEntry[] {
  const seasonal: OfficeExperienceEntry[] = [];
  const seen = new Set<OfficeExperience>(PERMANENT_OFFICE_EXPERIENCES);
  const add = (value: OfficeExperience, unpublished: boolean): void => {
    if (seen.has(value)) return;
    const presentation = SEASONAL_PRESENTATION[value];
    if (!presentation) return;
    seen.add(value);
    seasonal.push({ value, ...presentation, ...(unpublished ? { unpublished: true } : {}) });
  };
  for (const value of catalog.available) add(value, false);
  for (const value of catalog.previewable) add(value, true);
  return [...PERMANENT_GALLERY, ...seasonal];
}

/** THE NAME OF ONE OFFICE, wherever it has to be said in a sentence rather than drawn on a card.
 *
 *  Two callers need it and they used to disagree: CreatorStudioPanel had a private copy while
 *  OfficeExperiencePanel's status line had none at all and simply assumed every office was either the
 *  3D one or the Classic one — so it told a Creator standing in the Halloween office that they were in
 *  the Classic Office. One helper, asked in both places, is what stops a third caller repeating it.
 *
 *  The permanent gallery is asked FIRST (those offices have had proper names since Phase 8), then the
 *  seasonal presentation table. An identifier with neither is named after itself rather than invented,
 *  because the Studio has to be able to describe a season that has not shipped without pretending it
 *  has. */
export function experienceLabel(value: OfficeExperience): string {
  const permanent = PERMANENT_GALLERY.find((entry) => entry.value === value);
  if (permanent) return permanent.label;
  const seasonal = SEASONAL_PRESENTATION[value];
  if (seasonal) return seasonal.label;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)} Office`;
}

/** A belt-and-braces check that the gallery and the server cannot drift: every entry offered as
 *  SELECTABLE must be one the catalog actually allows. A `comingSoon` entry is exempt, because it is
 *  not offered. Used by the panel, and by tests, to assert the property rather than assume it. */
export function selectableGalleryEntries(
  entries: readonly OfficeExperienceEntry[],
  allowed: readonly OfficeExperience[],
): readonly OfficeExperienceEntry[] {
  return entries.filter((entry) => entry.comingSoon || allowed.includes(entry.value));
}
