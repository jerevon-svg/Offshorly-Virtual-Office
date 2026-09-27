// vo3d app — GO TOGETHER V1: the invitation card and the party chip, and the host of the party controller.
//
// This component RUNS app/goTogether.ts's controller against the world's port and the party store, and
// shows what it says. It moves nobody itself: the controller decides, the world walks and rides.
//
// ONE TAB DRIVES. The server names which of this person's sockets drives their body (controllerSid); only
// the tab whose party-store socket matches runs the loop — any other tab shows "running in another tab".
import { useEffect, useMemo, useRef, useState } from "react";
import type { Vo3dWorld } from "./world";
import { GoTogetherController, type GoTogetherStatus } from "./goTogether";
import {
  acceptPartyInvite,
  clearPartyNotice,
  declinePartyInvite,
  leaveParty,
  partyNet,
  useTravelParty,
} from "../../../services/party/travelPartyStore";
import { profileImageFor } from "../../../data/portraits";
import { MEETING_CONTEXT } from "./useMeetingParty";
import type { PartyPerson } from "./goTogether";
import styles from "./Vo3dGoTogether.module.css";

const TICK_MS = 250;

const REFUSALS: Record<string, string> = {
  offline: "is offline",
  dnd: "is on Do Not Disturb",
  in_party: "is already going somewhere with someone",
  already_invited: "already has an invitation",
  full: "— the party is full",
  started: "— the party has already set off",
};

const ENDINGS: Record<string, string> = {
  arrived: "Arrived together",
  ended: "Go Together ended",
  left: "You left the party",
  leader_left: "The leader left — the party ended",
  disconnected: "You were disconnected from the party",
  nobody_joined: "Nobody joined — Go Together ended",
  expired: "Go Together ended",
};

export function Vo3dGoTogether({ worldRef, ready, selfId, nameOf }: {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  selfId: string;
  nameOf: (email: string) => string;
}) {
  const tp = useTravelParty();
  const ctlRef = useRef<GoTogetherController | null>(null);
  const [status, setStatus] = useState<GoTogetherStatus>({ kind: "none" });

  // The controller lives as long as the world does.
  useEffect(() => {
    const port = worldRef.current?.goTogether;
    if (!ready || !port) return;
    const ctl = new GoTogetherController(port, partyNet);
    ctlRef.current = ctl;
    const unsub = ctl.subscribe(setStatus);
    const id = window.setInterval(() => ctl.tick(), TICK_MS);
    return () => {
      window.clearInterval(id);
      unsub();
      ctl.dispose();
      ctlRef.current = null;
    };
  }, [ready, worldRef]);

  const isController = tp.party !== null && tp.controllerSid !== null && tp.controllerSid === tp.socketId;
  useEffect(() => {
    ctlRef.current?.update({ party: tp.party, selfEmail: selfId, isController });
  }, [tp.party, selfId, isController, ready]);

  // Notices fade on their own.
  const notice = useMemo(() => {
    if (tp.endedReason) return ENDINGS[tp.endedReason] ?? "Go Together ended";
    const refused = (tp.lastResults ?? []).filter((r) => !r.ok);
    if (refused.length === 0) return null;
    return refused.map((r) => `${nameOf(r.email)} ${REFUSALS[r.reason ?? ""] ?? "couldn't be invited"}`).join(" · ");
  }, [tp.endedReason, tp.lastResults, nameOf]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(clearPartyNotice, 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const invite = tp.invites[0] ?? null;
  const party = tp.party;
  if (!invite && !party && !notice) return null;
  const label = party?.destination.label ?? "";
  const ctl = ctlRef.current;

  return (
    <div className={styles.wrap} data-testid="go-together">
      {invite && !party && (
        <div className={styles.card} role="dialog" aria-label="Go Together invitation" data-testid="go-together-invite">
          <span className={styles.cardTitle}>{nameOf(invite.fromEmail)} wants to go together</span>
          <span className={styles.cardSub}>{invite.party.destination.label}</span>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} data-testid="go-together-join" onClick={() => acceptPartyInvite(invite.inviteId)}>
              Join
            </button>
            {/* For a meeting this turns down the WALK, never the meeting: attendance is untouched and the
                reminder's own Walk There comes back for the same meeting. */}
            <button type="button" className={styles.ghost} data-testid="go-together-decline" onClick={() => declinePartyInvite(invite.inviteId)}>
              {invite.party.destination.context?.kind === MEETING_CONTEXT ? "I'll walk there" : "Decline"}
            </button>
          </div>
        </div>
      )}
      {party && <PartyChip status={status} label={label} leader={party.leaderEmail} self={selfId} nameOf={nameOf} ctl={ctl} />}
      {notice && <span className={styles.notice} role="status" data-testid="go-together-notice">{notice}</span>}
    </div>
  );
}

const PERSON_LABEL: Record<PartyPerson["state"], string> = {
  joined: "Joined", waiting: "Waiting", declined: "Walking there alone", ready: "Ready", "on-the-way": "On the way", paused: "Paused",
};

/** ONE FACE PER PERSON: full colour once they are in (joined / ready / on the way), muted while waiting or
 *  out; a small badge says which (✓ joined or ready, ✕ declined, … on the way). The leader carries a thin
 *  ring. The name is the tooltip and the accessible label. */
function PartyFaces({ people, nameOf }: { people: PartyPerson[]; nameOf: (email: string) => string }) {
  return (
    <ul className={styles.faces} data-testid="go-together-people">
      {people.map((p) => {
        const src = profileImageFor(p.email, () => "");
        const name = nameOf(p.email);
        const muted = p.state === "waiting" || p.state === "declined" || p.state === "paused";
        const badge = p.state === "joined" || p.state === "ready" ? "✓" : p.state === "declined" ? "✕" : p.state === "on-the-way" ? "…" : null;
        const label = `${name}${p.leader ? " (leading)" : ""} · ${PERSON_LABEL[p.state]}`;
        return (
          <li key={p.email} className={`${styles.face} ${muted ? styles.faceMuted : ""} ${p.leader ? styles.faceLeader : ""}`}
            title={label} aria-label={label} data-state={p.state} data-email={p.email}>
            {src ? <img src={src} alt="" draggable={false} /> : <span className={styles.faceInitial}>{name.trim().charAt(0).toUpperCase() || "?"}</span>}
            {badge && <span className={`${styles.badge} ${badge === "✓" ? styles.badgeOk : badge === "✕" ? styles.badgeNo : styles.badgeWait}`} aria-hidden="true">{badge}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function PartyChip({ status, label, leader, self, nameOf, ctl }: {
  status: GoTogetherStatus;
  label: string;
  leader: string;
  self: string;
  nameOf: (email: string) => string;
  ctl: GoTogetherController | null;
}) {
  const end = <button type="button" className={styles.ghost} data-testid="go-together-end" onClick={leaveParty}>End</button>;
  const leave = <button type="button" className={styles.ghost} data-testid="go-together-leave" onClick={leaveParty}>Leave</button>;
  let text: React.ReactNode;
  let dot = "";
  let actions: React.ReactNode = null;
  // Forming and gathering are a small card: the line, an optional place line, then the faces with the
  // actions beside them (so the destination on the first line is never squeezed by buttons).
  let people: PartyPerson[] | null = null;
  let place: string | null = null;
  let sub: string | null = null;
  // The truthful guidance while the system walks this body — no promise of a chat that does not exist yet.
  const guidance = "Auto-travel active · Esc to leave";
  switch (status.kind) {
    case "leader-forming":
      dot = styles.wait;
      text = <>Going Together · {label}</>;
      people = status.people;
      // Pointer lock: Esc frees the cursor (nothing is guided yet, so Esc does nothing else) — then click.
      actions = <>{status.canStart && <button type="button" className={styles.primary} data-testid="go-together-start" onClick={() => ctl?.startWalking()}>Start Walking</button>}{end}</>;
      break;
    case "forming":
      dot = styles.wait;
      text = <>Going Together · {label}</>;
      place = `Waiting for ${nameOf(status.leader)} to start walking`;
      people = status.people;
      actions = leave;
      break;
    case "rendezvous":
      dot = styles.wait;
      text = <>Going Together · {label}</>;
      place = status.place === "hub" ? "Meeting at Central Hub" : "Gathering here";
      sub = guidance;
      people = status.people;
      actions = leader === self ? end : leave;
      break;
    case "party-ready":
      text = <>Going Together · {label}</>;
      place = "Everyone's here — setting off together";
      people = status.people;
      actions = leader === self ? end : leave;
      break;
    case "journey":
      text = status.riding || status.leg === "ride" ? <>Riding together · {label}</> : <>Going together · {label}</>;
      place = status.leg === "to_lift" ? "Heading to the lift" : status.leg === "ride" ? "Taking the lift together" : "Walking to the room";
      sub = guidance;
      people = status.people;
      // Mid-ride the lift owns the body (Esc is refused there too); Leave/End come back at the doors.
      actions = status.riding ? null : leader === self ? end : leave;
      break;
    case "paused":
      dot = styles.idle;
      text = <>Paused — you took control <span className={styles.chipSub}>· {label}</span></>;
      actions = <><button type="button" className={styles.primary} data-testid="go-together-resume" onClick={() => ctl?.resume()}>Resume</button>{status.leader ? end : leave}</>;
      break;
    case "observer":
      dot = styles.idle;
      text = <>Go Together is running in another tab <span className={styles.chipSub}>· {label}</span></>;
      actions = status.leader ? end : leave;
      break;
    default:
      return null;
  }
  if (people) {
    return (
      <div className={`${styles.chip} ${styles.chipList}`} role="status" data-testid="go-together-chip" data-status={status.kind}>
        <div className={styles.chipRow}>
          <span className={`${styles.dot} ${dot}`} aria-hidden="true" />
          <span className={styles.chipText}>{text}</span>
        </div>
        {place && <span className={styles.place}>{place}</span>}
        {sub && <span className={styles.guidance} data-testid="go-together-guidance">{sub}</span>}
        <div className={styles.facesRow}>
          <PartyFaces people={people} nameOf={nameOf} />
          {actions && <span className={styles.chipActions}>{actions}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.chip} role="status" data-testid="go-together-chip" data-status={status.kind}>
      <span className={`${styles.dot} ${dot}`} aria-hidden="true" />
      <span className={styles.chipText}>{text}</span>
      {actions && <span className={styles.chipActions}>{actions}</span>}
    </div>
  );
}

export default Vo3dGoTogether;
