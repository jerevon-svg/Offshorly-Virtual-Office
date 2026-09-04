// T10 — the dictation TEXT RULE, and only the text rule.
//
// No speech API, no recorder, no microphone permission and no audio lives here
// or anywhere else yet. This module answers exactly one question: given the
// draft the viewer has already typed and a transcript some future speech layer
// hands over, what should the draft become? Keeping that pure means the seam
// can be tested today and the speech layer, whenever it arrives, has nothing to
// decide about text — it calls this and stops.

/** Folds a dictated transcript into the existing draft.
 *
 *  Appends rather than replaces: dictation is expected to arrive mid-compose,
 *  so anything already typed survives. A single space joins the two halves —
 *  never a double space, and never a leading one on an empty draft. A blank or
 *  whitespace-only transcript leaves the draft untouched, so a recogniser that
 *  emits an empty final result cannot mangle what the viewer typed. */
export function appendDictatedText(draft: string, transcript: string): string {
  const spoken = transcript.trim();
  if (spoken.length === 0) return draft;
  if (draft.trim().length === 0) return spoken;
  return `${draft.replace(/\s+$/, "")} ${spoken}`;
}
