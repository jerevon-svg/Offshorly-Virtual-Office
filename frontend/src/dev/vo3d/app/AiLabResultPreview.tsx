// vo3d app — THE DELIVERED RESULT, inspectable (AI-workforce demo, `?ailab=v2&aidemo=1`).
//
// Renders ONE ArtifactResult (world/agentOrchestration) — whatever produced it. Nothing about the job is written
// here: the title, the stages, the checks and the miniature page all come from the payload, so a real Agent
// Harness artifact replaces the mock one without this component changing. The payload's `source` is always
// shown: a mock result never reads as real execution.
//
// Deliberately light: a preview card, not a browser, editor or artifact platform. It is opened on ONE revision of
// the job's artifact (world/agentJob ArtifactRevision — the same record the task conversation's result card and the
// chip's View Result use). Earlier revisions stay viewable; only the latest delivered one can be reviewed.
//
// Approve / Request Changes are COMMANDS to the job system (onApprove / onRequestChanges → JobClient → the source).
// Nothing here touches the scene: the Toucan, the agents and the packet react to the records that come back.
import { useEffect, useState, type CSSProperties } from "react";
import type { LandingPageDeliverable } from "../world/agentOrchestration";
import { DEMO_FEEDBACK } from "../world/agentOrchestration";
import { reviewable, type JobSnapshot } from "../world/agentJob";
import styles from "./AiLabResultPreview.module.css";

export interface AiLabResultPreviewProps {
  job: JobSnapshot;
  revisionId: string;
  onSelect: (revisionId: string) => void;
  onClose: () => void;
  onApprove: (revisionId: string) => void;
  onRequestChanges: (revisionId: string, feedback: string) => void;
}

export function AiLabResultPreview({ job, revisionId, onSelect, onClose, onApprove, onRequestChanges }: AiLabResultPreviewProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { setFeedback(null); }, [revisionId]);
  const delivered = job.artifacts.filter((a) => a.delivered);
  const rev = job.artifacts.find((a) => a.revisionId === revisionId);
  const result = rev?.result;
  if (!rev || !result) return null;
  const canReview = reviewable(job, revisionId);
  const approved = job.approvedRevisionId === revisionId;
  const latest = delivered.at(-1)?.revisionId === revisionId;
  const working = job.status === "active" || job.status === "waiting";
  return (
    <div className={styles.backdrop} onClick={onClose} data-testid="ailab-result-preview">
      <div className={styles.card} role="dialog" aria-modal="true" aria-label={`Result: ${result.title}, Revision ${result.revision}`} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>
              <span className={styles.badge}>{approved ? "Approved" : latest && !working ? "Result ready" : `Revision ${result.revision}`}</span>
              {result.revision > 1 && <span className={styles.revBadge}>Revision {result.revision}</span>}
              {result.source === "mock" && <span className={styles.mockBadge}>Mock demo result</span>}
            </div>
            <h2 className={styles.title}>{result.title}</h2>
            <p className={styles.summary}>{result.summary}</p>
            {delivered.length > 1 && (
              <div className={styles.revisions} role="tablist" aria-label="Revisions">
                {delivered.map((a) => (
                  <button key={a.revisionId} type="button" role="tab" aria-selected={a.revisionId === revisionId}
                    className={a.revisionId === revisionId ? `${styles.revTab} ${styles.revTabOn}` : styles.revTab} onClick={() => onSelect(a.revisionId)}>
                    Revision {a.revision}{a.approved ? " ✓" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close result">×</button>
        </header>
        <div className={styles.body}>
          {result.deliverable.kind === "landing-page" && <LandingPageMini page={result.deliverable} />}
          <aside className={styles.side}>
            {result.feedback && (
              <>
                <h3 className={styles.sideTitle}>Your feedback</h3>
                <p className={styles.quoteBox}>“{result.feedback}”</p>
              </>
            )}
            {result.changes && result.changes.length > 0 && (
              <>
                <h3 className={styles.sideTitle}>What changed</h3>
                <ul className={styles.checks}>{result.changes.map((c) => <li key={c}><span className={styles.dotOk} aria-hidden="true" />{c}</li>)}</ul>
              </>
            )}
            <h3 className={styles.sideTitle}>How it was made</h3>
            <ol className={styles.stages}>
              {result.stages.map((s) => (
                <li key={s.role} className={styles.stage}>
                  <span className={styles.tick} aria-hidden="true">✓</span>
                  <div>
                    <div className={styles.stageHead}><b>{s.role}</b> {s.outcome === "passed" ? "passed" : "completed"}<span className={styles.by}>{s.by}</span></div>
                    <div className={styles.note}>{s.note}</div>
                  </div>
                </li>
              ))}
            </ol>
            {result.deliverable.kind === "landing-page" && result.deliverable.checks.length > 0 && (
              <>
                <h3 className={styles.sideTitle}>Review checks</h3>
                <ul className={styles.checks}>
                  {result.deliverable.checks.map((c) => <li key={c}><span className={styles.dotOk} aria-hidden="true" />{c}</li>)}
                </ul>
              </>
            )}
            {canReview && feedback === null && (
              <div className={styles.review}>
                <button type="button" className={styles.approve} onClick={() => onApprove(revisionId)}>Approve</button>
                <button type="button" className={styles.changes} onClick={() => setFeedback("")}>Request Changes</button>
              </div>
            )}
            {canReview && feedback !== null && (
              <form className={styles.feedback} onSubmit={(e) => { e.preventDefault(); if (feedback.trim()) onRequestChanges(revisionId, feedback.trim()); }}>
                <label className={styles.sideTitle} htmlFor="ailab-feedback">What should change?</label>
                <textarea id="ailab-feedback" className={styles.textarea} rows={4} value={feedback} autoFocus
                  placeholder={DEMO_FEEDBACK} onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()} data-testid="ailab-feedback" />
                {feedback === "" && <button type="button" className={styles.example} onClick={() => setFeedback(DEMO_FEEDBACK)}>Use the example</button>}
                <div className={styles.review}>
                  <button type="submit" className={styles.approve} disabled={!feedback.trim()}>Send to Toucan</button>
                  <button type="button" className={styles.changes} onClick={() => setFeedback(null)}>Cancel</button>
                </div>
              </form>
            )}
            {approved && <p className={styles.approvedLine}>You approved this revision.</p>}
            {!canReview && !approved && latest && working && <p className={styles.approvedLine}>Revision {job.revision} is in progress — this one stays as it was.</p>}
            {!latest && <p className={styles.approvedLine}>An earlier revision, kept as delivered.</p>}
            <p className={styles.footnote}>
              {result.source === "mock"
                ? "Produced by the demo's scripted orchestration — not generated by Agent Harness."
                : "Produced by Agent Harness."}
              {" "}Requested by {result.requestedBy}.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** THE DELIVERABLE, MINIATURE: a landing page drawn from its own data (palette, copy, sections) */
function LandingPageMini({ page }: { page: LandingPageDeliverable }) {
  const p = page.palette;
  const vars = { "--lp-bg": p.bg, "--lp-surface": p.surface, "--lp-ink": p.ink, "--lp-muted": p.muted, "--lp-accent": p.accent, "--lp-accent-ink": p.accentInk } as CSSProperties;
  return (
    <figure className={styles.frame} style={vars} aria-label={`${page.brand} landing page preview`}>
      <div className={styles.chrome} aria-hidden="true">
        <span /><span /><span />
        <div className={styles.url}>{page.brand.toLowerCase()}.com</div>
      </div>
      <div className={styles.page}>
        <nav className={styles.nav}>
          <b className={styles.brand}><i className={styles.logo} />{page.brand}</b>
          <span className={styles.links}>{page.nav.map((n) => <span key={n}>{n}</span>)}</span>
          <span className={styles.navCta}>{page.hero.primaryCta}</span>
        </nav>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>{page.hero.eyebrow}</span>
            <h4 className={styles.headline}>{page.hero.headline}</h4>
            <p className={styles.subhead}>{page.hero.subhead}</p>
            <div className={styles.ctas}>
              <span className={page.ctaStyle === "bold" ? `${styles.cta} ${styles.ctaBold}` : styles.cta}>{page.hero.primaryCta}</span>
              <span className={styles.ghost}>{page.hero.secondaryCta}</span>
            </div>
          </div>
          <div className={styles.art} aria-hidden="true">
            <div className={styles.artCard}><i /><i /><i /></div>
            <div className={`${styles.artCard} ${styles.artCard2}`}><i /><i /></div>
            <div className={styles.artCircle} />
          </div>
        </section>
        <section className={styles.features}>
          {page.features.map((f) => (
            <div key={f.title} className={styles.feature}>
              <i className={styles.featureIcon} aria-hidden="true" />
              <b>{f.title}</b>
              <span>{f.body}</span>
            </div>
          ))}
        </section>
        <div className={styles.proof}>{page.proof}</div>
      </div>
    </figure>
  );
}
