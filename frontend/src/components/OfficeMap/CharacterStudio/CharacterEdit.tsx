import { useEffect, useMemo, useState } from "react";
import styles from "./CharacterStudio.module.css";
import pc from "../ProfileCharacter.module.css";
import { HumanBasePreview, type PreviewOutfit, type PreviewSubject } from "./HumanBasePreview";
import { useTurntable } from "./useTurntable";
import { appearanceFor } from "../../../dev/vo3d/avatar/humanBody";
import { newEmployeeAvatar, PROOF_CATALOGUE } from "../../../dev/vo3d/human/humanCatalogue";
import { candidateUrl, type CharacterStatus } from "../../../services/humanbase/characterStudio";
import { getMyWardrobe, saveMyWardrobe, type Wardrobe } from "../../../services/avatar/wardrobeClient";
import { castIdForEmail } from "../../../services/humanbase/characterRuntimeLoader";
import { setOutfit, type OutfitSlot } from "../../../dev/vo3d/avatar/characterRuntime";

// EDIT — the person's nickname and outfit, previewed live on the production HumanBase body before anything is saved.
// Saved to the VO backend (PUT /avatar/wardrobe/me — the server writes only the verified caller's row), then worn by the
// office: this employee's own body re-dresses at once and every other viewer builds it dressed from then on.
//
// The head is never touched: no regeneration, no credits. The garments and colourways offered are the HumanBase catalogue's own
// (humanCatalogue PROOF_CATALOGUE — every top / bottom / shoe that ships colourways), never a list kept here. What is dressed:
//   approved  — the person's approved production character
//   candidate — their own generated character while it awaits sign-off (labelled so)
//   base      — nobody's face: the generic base, labelled "clothing preview only", for someone without a HumanBase character yet

const SLOTS: ReadonlyArray<{ slot: OutfitSlot; label: string }> = [
  { slot: "top", label: "Top" },
  { slot: "bottom", label: "Bottom" },
  { slot: "shoes", label: "Shoes" },
];
const NICKNAME_MAX = 40;

/** the catalogue's wearable garments for a slot (those with colourways), in catalogue order */
export function garmentsFor(slot: OutfitSlot) {
  return PROOF_CATALOGUE.filter((a) => a.slot === slot && a.colorways && Object.keys(a.colorways).length > 0);
}

/** the subject EDIT dresses, from the person's real status */
export function editSubject(status: CharacterStatus): PreviewSubject {
  if (status.approvedAvatar && appearanceFor(status.personId)) return { kind: "approved", personId: status.personId };
  const c = status.candidate;
  if (c && c.automatedPass && status.simulated.length === 0) return { kind: "candidate", personId: status.personId, url: candidateUrl(c.file), candidate: c };
  return { kind: "base" };
}

/** what the person wears today: their saved outfit over their appearance's defaults (the Offshorly uniform for a new employee) */
function startingOutfit(status: CharacterStatus, saved: Wardrobe | null): PreviewOutfit {
  const a = appearanceFor(status.personId) ?? newEmployeeAvatar(status.personId, status.candidate?.bodyPreset ?? "standard");
  const out: PreviewOutfit = {};
  for (const { slot } of SLOTS) {
    const def = a[slot] as { assetId: string | null; colorway?: string } | undefined;
    const pick = saved?.outfit?.[slot];
    const valid = pick && garmentsFor(slot).some((g) => g.id === pick.assetId && g.colorways?.[pick.colorway]);
    if (valid) out[slot] = { ...pick };
    else if (def?.assetId) out[slot] = { assetId: def.assetId, colorway: def.colorway ?? Object.keys(garmentsFor(slot).find((g) => g.id === def.assetId)?.colorways ?? {})[0] ?? "" };
  }
  return out;
}

type Props = { status: CharacterStatus; name: string; onClose: () => void };

export function CharacterEdit({ status, name, onClose }: Props) {
  const subject = useMemo(() => editSubject(status), [status]);
  const [saved, setSaved] = useState<Wardrobe | null>(null);
  const [nickname, setNickname] = useState("");
  const [outfit, setPreviewOutfit] = useState<PreviewOutfit>(() => startingOutfit(status, null));
  const [loadError, setLoadError] = useState<string | null>(null);
  // the controls wait for the saved wardrobe: an answer arriving after the first edit would otherwise overwrite it
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const { heading, handlers } = useTurntable(!previewFailed);

  // the saved wardrobe, from the office backend
  useEffect(() => {
    let off = false;
    getMyWardrobe()
      .then((w) => {
        if (off) return;
        setSaved(w);
        setNickname(w.nickname ?? "");
        setPreviewOutfit(startingOutfit(status, w));
        setLoadError(null);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (off) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);   // editable from the defaults; a save then states the outfit in full
      });
    return () => {
      off = true;
    };
  }, [status]);

  const initial = useMemo(() => JSON.stringify({ n: saved?.nickname ?? "", o: startingOutfit(status, saved) }), [status, saved]);
  const dirty = JSON.stringify({ n: nickname.trim(), o: outfit }) !== initial;

  function pick(slot: OutfitSlot, assetId: string, colorway?: string) {
    const g = garmentsFor(slot).find((x) => x.id === assetId);
    if (!g?.colorways) return;
    const cw = colorway && g.colorways[colorway] ? colorway : outfit[slot]?.assetId === assetId ? outfit[slot]!.colorway : Object.keys(g.colorways)[0];
    setPreviewOutfit((o) => ({ ...o, [slot]: { assetId, colorway: cw } }));
    setJustSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const w = await saveMyWardrobe({ nickname: nickname.trim() || null, outfit });
      setSaved(w);
      setJustSaved(true);
      // the office wears it: this employee's character, by the same cast id the office resolves for them — nobody else's
      const castId = castIdForEmail(status.email);
      if (castId) {
        setOutfit(castId, w.outfit);
        window.dispatchEvent(new CustomEvent("vo:character-outfit", { detail: { castId, outfit: w.outfit } }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const chip =
    subject.kind === "base" ? "Base character — clothing preview only" : subject.kind === "candidate" ? `${name.split(" ")[0]} · awaiting sign-off` : null;

  return (
    <div className={styles.wrap} data-testid="character-edit">
      <header className={styles.head}>
        <div>
          <h3 className={pc.title}>Edit your character</h3>
          <p className={pc.subtitle}>Your face stays exactly as it is — no regeneration, no credits.</p>
        </div>
        <button type="button" className={styles.ghost} onClick={onClose}>
          Done
        </button>
      </header>

      {/* stage beside the controls: the whole wardrobe and Save stay in view at the Profile modal's height */}
      <div className={styles.editGrid}>
        <div className={`${pc.stage} ${styles.stageFit}`} data-live="true" {...handlers}>
          {!previewFailed ? (
            <div className={styles.model}>
              <HumanBasePreview subject={subject} headingDegrees={heading} pose="idle" outfit={outfit} width={340} height={400} onError={() => setPreviewFailed(true)} />
            </div>
          ) : (
            <p className={styles.note}>The 3D preview could not load.</p>
          )}
          {chip && <span className={styles.chip}>{chip}</span>}
        </div>

        <fieldset className={styles.controls} disabled={!loaded} aria-busy={!loaded}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="character-nickname">
              Nickname
            </label>
            <input
              id="character-nickname"
              className={styles.input}
              value={nickname}
              maxLength={NICKNAME_MAX}
              placeholder={name.split(" ")[0]}
              onChange={(e) => {
                setNickname(e.target.value);
                setJustSaved(false);
              }}
            />
          </div>

          {SLOTS.map(({ slot, label }) => {
            const current = outfit[slot];
            const garment = garmentsFor(slot).find((g) => g.id === current?.assetId);
            return (
              <div key={slot} className={styles.field}>
                <span className={styles.fieldLabel}>{label}</span>
                <select className={styles.select} value={current?.assetId ?? ""} onChange={(e) => pick(slot, e.target.value)} aria-label={`${label} garment`}>
                  {garmentsFor(slot).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <div className={styles.swatches} role="radiogroup" aria-label={`${label} colour`}>
                  {Object.entries(garment?.colorways ?? {}).map(([cw, c]) => (
                    <button
                      key={cw}
                      type="button"
                      role="radio"
                      aria-checked={current?.colorway === cw}
                      aria-label={cw}
                      title={cw}
                      className={current?.colorway === cw ? `${styles.swatch} ${styles.swatchOn}` : styles.swatch}
                      style={{ background: c.main }}
                      onClick={() => current && pick(slot, current.assetId, cw)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          <div className={styles.saveRow}>
            <p className={`${styles.note} ${error ? styles.error : ""}`} role="status" aria-live="polite">
              {error ?? loadError ?? (justSaved ? "Saved — your character in the office is wearing it." : dirty ? "Previewing — not saved yet." : "")}
            </p>
            <button type="button" className={styles.primary} disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

export default CharacterEdit;
