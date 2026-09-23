// WHICH EXPERIENCE THE INTERFACE IS DRESSED FOR — one attribute on <html>, and nothing else.
//
// The UI skin (styles/halloweenTheme.css) is a stylesheet whose every rule is nested under
// `html[data-vo-experience="halloween"]`. So this module is the entire activation mechanism: setting
// the attribute dresses the interface, removing it undresses it, and there is no third state.
//
// WHY AN ATTRIBUTE AND NOT A CLASS PER COMPONENT. Two reasons, and both are about being able to take
// it off again:
//   · a component that knew the word "halloween" would need a matching branch to be REMOVED, and the
//     one that got missed would be the leak. Nothing here touches a component at all;
//   · the skin is inert until the attribute exists, so the ordinary 3D office and Classic are not
//     "reset back" to their own styling — they are never styled in the first place.
//
// IT CHANGES NO BEHAVIOUR. No layout, no size, no interaction, no business logic: a stylesheet scope
// is the only thing this can reach.
import type { OfficeExperience } from "./officeExperience";
import { seasonForExperience } from "../../dev/vo3d/season/season";

const ATTRIBUTE = "data-vo-experience";

/** Dress the interface for this experience. Safe to call repeatedly with the same value.
 *
 *  The SEASON decides, not the experience id: the ordinary 3D office and Classic both resolve to
 *  "none" and therefore to no attribute at all, which is what keeps their styling untouched. */
export function applyExperienceTheme(experience: OfficeExperience | null): void {
  if (typeof document === "undefined") return;
  const season = seasonForExperience(experience);
  const root = document.documentElement;
  if (season === "none") root.removeAttribute(ATTRIBUTE);
  else root.setAttribute(ATTRIBUTE, season);
}

/** Take it off. Idempotent, and the whole of teardown — removing the attribute un-scopes every rule
 *  in the skin at once, so no style can survive it. */
export function clearExperienceTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(ATTRIBUTE);
}

/** What the interface is currently dressed as. Tests and the verification rig read this. */
export function currentExperienceTheme(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute(ATTRIBUTE);
}
