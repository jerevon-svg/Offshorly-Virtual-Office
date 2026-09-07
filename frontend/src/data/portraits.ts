// Shared profile-portrait resolver for the Player HUD and the Employee Profile UI.
//
// Source: /Users/lekoffshorly/Downloads/Offshorly-Branding/New Portraits (team folders), copied
// into public/portraits/<email-localpart>.png at 320px. Only CLEAR identity matches are mapped —
// a portrait whose filename is exactly the employee's known first name / email localpart. Nothing
// is guessed (e.g. "Janna.png" is NOT assumed to be jan@). Anyone without an entry falls back to
// whatever the caller already used (today: the in-world sprite's front idle frame). The in-world
// 2D/3D characters are untouched; this is portrait imagery only.

const PORTRAIT_BY_LOCALPART: Readonly<Record<string, string>> = {
  jerevon: "jerevon.png", // Bon — Design Team/Jerevon.png
  micah: "micah.png", // Design Team/Micah.png
  angelo: "angelo.png", // Design Team/Angelo.png
  alex: "alex.png", // Operations & Management/Alex.png
  lui: "lui.png", // Developer Team/Lui.png
};

/** URL of the New Portrait for `email`, or null when no clear match exists. */
export function portraitSrcFor(email: string | null | undefined): string | null {
  if (!email) return null;
  const localpart = email.trim().toLowerCase().split("@")[0];
  const file = PORTRAIT_BY_LOCALPART[localpart];
  return file ? `${import.meta.env.BASE_URL}portraits/${file}` : null;
}

/** New Portrait when one exists, otherwise the caller's existing image. */
export function profileImageFor(email: string | null | undefined, fallback: () => string): string {
  return portraitSrcFor(email) ?? fallback();
}

/** Localparts with a New Portrait — for tests/reporting only. */
export const PORTRAIT_LOCALPARTS: readonly string[] = Object.keys(PORTRAIT_BY_LOCALPART);
