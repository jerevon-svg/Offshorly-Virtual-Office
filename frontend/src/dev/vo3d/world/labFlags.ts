// vo3d world — THE AI WORKFORCE's one remaining switch, read in ONE place (Phase 6B.0; trimmed in 6B.8).
//
//   normal VO   → the treehouse Lab with the AI Workforce, as a labelled Preview
//   ?aidemo=1   → DEVELOPER/DEMO TOOLING only (Reset, Re-enter, example feedback)
//
// Phase 6B.8 retired the temporary rollbacks (`?ailab=v1` — the original Lab — and `?aiworkforce=0`): both are now
// ignored. Unrelated flags (`?veg=2`, `?monkeyplay=1`, `?labscenario=`, …) stay where they are.

export type LabFlags = {
  /** the developer/demo controls are shown */
  demoTools: boolean;
};

export function resolveLabFlags(search: string): LabFlags {
  return { demoTools: new URLSearchParams(search).get("aidemo") === "1" };
}

export const LAB_FLAGS: LabFlags = (() => {
  try {
    return resolveLabFlags(typeof location !== "undefined" ? location.search : "");
  } catch {
    return resolveLabFlags("");
  }
})();
