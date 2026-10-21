import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CharacterStudio.module.css";
import pc from "../ProfileCharacter.module.css";
import { HumanBasePreview, type PreviewSubject } from "./HumanBasePreview";
import { useTurntable } from "./useTurntable";
import {
  candidateUrl,
  createPhaseOf,
  fetchPhotoTraceUrl,
  getCharacterStatus,
  startCharacterPipeline,
  uploadCharacterPhoto,
  type CharacterStatus,
  type CreatePhase,
} from "../../../services/humanbase/characterStudio";
import { recordPhotoConsent, sha256Hex } from "../../../services/avatar/generationClient";

// CREATE — first-time character creation inside the Profile's character panel (DEV-ONLY: it talks to the local HumanBase Studio).
//
// Every state on this screen is read from the person's REAL pipeline (GET /hb-studio/api/self/status, polled while something is
// happening) — nothing is timed or faked. Until the person's own generated head exists, the stage shows the generic BASE character
// as a hologram and says so; the generated character replaces it with a reveal, labelled "awaiting sign-off" until it is approved.
// Paid generation never starts from here: the run stops at the first paid stage until an admin approves it in HumanBase Studio.

const POLL_MS: Partial<Record<CreatePhase, number>> = { "reading-photo": 2500, generating: 2500, "awaiting-approval": 6000 };

/** the pipeline's own stages in plain words (studio/orchestrator.mjs STAGES) */
const STAGE_WORDS: Record<string, string> = {
  illustrate: "Drawing your Offshorly portrait",
  identity: "Measuring your face",
  illustrationQA: "Checking the portrait",
  meshy: "Sculpting your 3D head",
  build: "Fitting your head and running quality checks",
  sheet: "Rendering review sheets",
  export: "Packaging your character",
};
const HEAD_STAGES = new Set(["illustrate", "identity", "illustrationQA", "meshy"]);
/** what a paid stage costs, in an employee's words (the admin sees the exact cost in HumanBase Studio) */
const COST_WORDS: Record<string, string> = { illustrate: "one AI image generation", meshy: "about 30 3D-generation credits" };
const lower1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const SIGNOFF_WORDS: Record<string, string> = { "FC-EAR-BOUNDARY": "ears", "FC-HAIR-SPIKE": "hair edges", "FC-NAPE-ROUGH": "back of the head" };

type StepState = "todo" | "active" | "wait" | "done" | "stop";
const STEPS = ["Photo", "Face read", "Your head", "Checks"] as const;

/** the four visible steps, each derived from a real field of the status */
export function stepStates(s: CharacterStatus | null, phase: CreatePhase): StepState[] {
  if (!s) return ["active", "todo", "todo", "todo"];
  if (phase === "approved" || phase === "review") return ["done", "done", "done", "done"];
  const trace: StepState = s.photoTrace ? "done" : s.photoTraceJob === "running" ? "active" : s.photoTraceJob?.startsWith("failed") ? "stop" : "todo";
  const stage = s.plan?.stage ?? null, onHead = stage !== null && HEAD_STAGES.has(stage);
  const at: StepState = phase === "generating" ? "active" : phase === "awaiting-approval" ? "wait" : phase === "failed" || phase === "blocked" ? "stop" : "todo";
  const started = Boolean(s.pipeline);
  const head: StepState = !started ? "todo" : onHead ? at : stage ? "done" : "todo";
  const checks: StepState = !started || onHead ? "todo" : stage ? at : "todo";
  return [s.photo ? "done" : "active", trace, head, checks];
}

type Props = { name: string; onApproved: () => void };

export function CharacterCreate({ name, onApproved }: Props) {
  const [status, setStatus] = useState<CharacterStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState<"standard" | "feminine">("standard");
  const [hair, setHair] = useState("natural");
  const [traceUrl, setTraceUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  // CONSENT: the employee says, explicitly and per photo, that it is them and that it may be used for their character
  const [consented, setConsented] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { heading, handlers } = useTurntable(!previewFailed);

  const phase = createPhaseOf(status);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getCharacterStatus());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // poll only while something real is happening (or waiting on an admin); the server keeps running if this panel closes
  useEffect(() => {
    const ms = POLL_MS[phase];
    if (!ms || loadError) return;
    const t = setTimeout(() => void refresh(), ms);
    return () => clearTimeout(t);
  }, [phase, status, loadError, refresh]);

  // the photo's real face trace, fetched once it exists (owner-only endpoint)
  const hasTrace = Boolean(status?.photoTrace);
  const photoKey = status?.photo ?? null;
  useEffect(() => {
    if (!hasTrace) return;
    let url: string | null = null;
    let off = false;
    void fetchPhotoTraceUrl().then((u) => {
      if (off) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setTraceUrl(u);
    });
    return () => {
      off = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [hasTrace, photoKey]);

  useEffect(() => {
    if (phase === "approved") onApproved();
  }, [phase, onApproved]);

  async function act(fn: () => Promise<CharacterStatus>) {
    setBusy(true);
    setActionError(null);
    try {
      setStatus(await fn());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) {
      setActionError("Choose a PNG or JPEG photo.");
      return;
    }
    if (!consented) {
      setActionError("Tick the box to confirm this is a photo of you.");
      return;
    }
    setTraceUrl(null);
    // the consent is recorded with the office FIRST, against the exact bytes about to be sent — no consent, no upload
    void act(async () => {
      try {
        await recordPhotoConsent(await sha256Hex(f));
      } catch (e) {
        throw new Error(`Your consent could not be recorded, so the photo was not sent. ${e instanceof Error ? e.message : ""}`.trim());
      }
      return uploadCharacterPhoto(f, { hair, body });
    });
  }

  const candidate = status?.candidate ?? null;
  const showCandidate = Boolean(candidate && status && candidate.automatedPass && phase === "review");
  const subject: PreviewSubject =
    showCandidate && candidate && status
      ? { kind: "candidate", personId: status.personId, url: candidateUrl(candidate.file), candidate }
      : { kind: "base" };
  const simulated = status?.simulated ?? [];
  const steps = stepStates(status, phase);
  const stageWords = status?.plan?.stage ? STAGE_WORDS[status.plan.stage] ?? status.plan.stage : null;
  const interrupted = status?.pipeline?.status === "interrupted";
  const traceFailed = Boolean(status?.photoTraceJob?.startsWith("failed"));

  const chooseButton = (label: string, primary = true) => (
    <>
      <label className={styles.consent}>
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
        This is a photo of me, and it may be used to create my Offshorly character.
      </label>
      <button type="button" className={primary ? styles.primary : styles.ghost} disabled={busy || !consented} onClick={() => fileRef.current?.click()}>
        {label}
      </button>
    </>
  );

  return (
    <div className={styles.wrap} data-testid="character-create" data-phase={phase}>
      <header className={styles.head}>
        <div>
          <h3 className={pc.title}>Create your character</h3>
          <p className={pc.subtitle}>A little you, in the office — made from your photo.</p>
        </div>
      </header>

      <div className={`${pc.stage} ${styles.stageFit}`} data-live="true" {...handlers}>
        {!previewFailed ? (
          <div className={styles.model}>
            <HumanBasePreview subject={subject} reveal={subject.kind === "candidate"} headingDegrees={heading} pose="idle" width={340} height={360} onError={() => setPreviewFailed(true)} />
          </div>
        ) : (
          <p className={styles.note}>The 3D preview could not load.</p>
        )}
        {subject.kind === "base" ? (
          <span className={styles.chip}>Base character — not you yet</span>
        ) : simulated.length > 0 ? (
          <span className={`${styles.chip} ${styles.chipTest}`}>Test run — not your face ({simulated.join(", ")} simulated)</span>
        ) : (
          <span className={styles.chip}>{name.split(" ")[0]} · awaiting sign-off</span>
        )}
      </div>

      <ol className={styles.steps} aria-label="Progress">
        {STEPS.map((label, i) => {
          const st = steps[i];
          const cls = st === "done" ? styles.stepDone : st === "active" ? styles.stepActive : st === "wait" ? styles.stepWait : st === "stop" ? styles.stepStop : "";
          return (
            <li key={label} className={`${styles.step} ${cls}`} data-state={st}>
              <span className={styles.bar}>
                {st === "done" && <span className={styles.barFill} />}
                {st === "active" && <span className={styles.barActive} />}
                {st === "wait" && <span className={styles.barWait} />}
                {st === "stop" && <span className={styles.barStop} />}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      <input ref={fileRef} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg" onChange={onFile} aria-label="Photo" tabIndex={-1} />

      <div className={styles.panel} role="status" aria-live="polite">
        {traceUrl && phase !== "review" && <img className={styles.trace} src={traceUrl} alt="Your face, as read from the photo" />}
        <div className={styles.panelText}>
          {loadError && !status ? (
            <>
              <strong>Character Studio isn't reachable</strong>
              {loadError}
            </>
          ) : phase === "no-photo" ? (
            <>
              <strong>Start with a photo</strong>
              A clear, front-facing photo of your face. It is used only to create your character.
            </>
          ) : phase === "reading-photo" ? (
            <>
              <strong>Reading your face…</strong>
              Finding your features in the photo.
            </>
          ) : phase === "ready-to-generate" ? (
            traceFailed ? (
              <>
                <strong>We couldn't read a face in this photo</strong>
                A brighter, front-facing photo works best.
              </>
            ) : (
              <>
                <strong>{interrupted ? "Your last run was interrupted" : "Your face is read"}</strong>
                {interrupted ? "Continue where it stopped — finished steps are kept." : "Generating your character uses paid AI services, so an admin approves it first."}
              </>
            )
          ) : phase === "generating" ? (
            <>
              <strong>Creating your character</strong>
              {stageWords ?? "Working…"} — you can close this, progress is kept.
            </>
          ) : phase === "awaiting-approval" ? (
            <>
              <strong>Waiting for approval</strong>
              Next: {stageWords ? lower1(stageWords) : "the next step"}. It uses {(status?.plan?.stage && COST_WORDS[status.plan.stage]) ?? "paid generation"}, so an
              admin approves it in HumanBase Studio — nothing is spent until then.
            </>
          ) : phase === "failed" ? (
            <>
              <strong>Something went wrong{stageWords ? ` — ${lower1(stageWords)}` : ""}</strong>
              <span className={styles.error}>{status?.pipeline?.error ?? "The step did not finish."}</span> Try again picks up from this step.
            </>
          ) : phase === "blocked" ? (
            <>
              <strong>Paused for a person to look at it</strong>
              {status?.plan?.reason ?? "An automatic check stopped the run."}
            </>
          ) : phase === "review" ? (
            <>
              <strong>Your character passed the automatic checks</strong>
              {status?.gate?.signoff?.length
                ? `A reviewer signs off the ${status.gate.signoff.map((c) => SIGNOFF_WORDS[c] ?? c).join(", ")} before it goes live in the office.`
                : "A reviewer signs it off before it goes live in the office."}
            </>
          ) : (
            <>
              <strong>Your character is live</strong>
            </>
          )}
          {actionError && (
            <span className={styles.error}>
              {" "}
              {actionError}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          {loadError && !status && (
            <button type="button" className={styles.ghost} onClick={() => void refresh()}>
              Retry
            </button>
          )}
          {status && phase === "no-photo" && (
            <>
              <select className={styles.select} value={body} onChange={(e) => setBody(e.target.value as "standard" | "feminine")} aria-label="Body">
                <option value="standard">Standard body</option>
                <option value="feminine">Feminine body</option>
              </select>
              <select className={styles.select} value={hair} onChange={(e) => setHair(e.target.value)} aria-label="Hair length">
                <option value="natural">Short hair</option>
                <option value="chin">Chin-length hair</option>
                <option value="shoulder">Shoulder-length hair</option>
                <option value="upperBack">Long hair</option>
              </select>
              {chooseButton(busy ? "Uploading…" : "Choose photo")}
            </>
          )}
          {phase === "ready-to-generate" && (
            <>
              {chooseButton("Another photo", traceFailed)}
              <button type="button" className={traceFailed ? styles.ghost : styles.primary} disabled={busy} onClick={() => void act(startCharacterPipeline)}>
                {interrupted ? "Continue" : traceFailed ? "Continue anyway" : "Generate my character"}
              </button>
            </>
          )}
          {(phase === "failed" || phase === "blocked") && (
            <>
              {chooseButton("Another photo", false)}
              <button type="button" className={styles.primary} disabled={busy} onClick={() => void act(startCharacterPipeline)}>
                {phase === "failed" ? "Try again" : "Check again"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CharacterCreate;
