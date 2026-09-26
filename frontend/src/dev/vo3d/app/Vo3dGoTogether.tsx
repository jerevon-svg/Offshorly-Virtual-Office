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
  onPartyDeparting,
  partyNet,
  useTravelParty,
} from "../../../services/party/travelPartyStore";
import styles from "./Vo3dGoTogether.module.css";

const TICK_MS = 250;

const REFUSALS: Record<string, string> = {
  offline: "is offline",
  dnd: "is on Do Not Disturb",
  in_party: "is already going somewhere with someone",
  already_invited: "already has an invitation",
  full: "— the party is full",
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
    const offDepart = onPartyDeparting((d) => ctl.onDeparting(d));
    const id = window.setInterval(() => ctl.tick(), TICK_MS);
    return () => {
      window.clearInterval(id);
      offDepart();
      unsub();
      ctl.dispose();
      ctlRef.current = null;
    };
  }, [ready, worldRef]);

  const isController = tp.party !== null && tp.controllerSid !== null && tp.controllerSid === tp.socketId;
  useEffect(() => {
    ctlRef.current?.update({ party: tp.party, selfEmail: selfId, isController, endedReason: tp.endedReason });
  }, [tp.party, selfId, isController, ready, tp.endedReason]);

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
          <span className={styles.cardSub}>to {invite.party.destination.label} — you'll walk with them, lift included</span>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} data-testid="go-together-join" onClick={() => acceptPartyInvite(invite.inviteId)}>
              Join
            </button>
            <button type="button" className={styles.ghost} data-testid="go-together-decline" onClick={() => declinePartyInvite(invite.inviteId)}>
              Decline
            </button>
          </div>
        </div>
      )}
      {party && <PartyChip status={status} label={label} nameOf={nameOf} ctl={ctl} />}
      {notice && <span className={styles.notice} role="status" data-testid="go-together-notice">{notice}</span>}
    </div>
  );
}

function PartyChip({ status, label, nameOf, ctl }: {
  status: GoTogetherStatus;
  label: string;
  nameOf: (email: string) => string;
  ctl: GoTogetherController | null;
}) {
  const end = <button type="button" className={styles.ghost} data-testid="go-together-end" onClick={leaveParty}>End</button>;
  const leave = <button type="button" className={styles.ghost} data-testid="go-together-leave" onClick={leaveParty}>Leave</button>;
  let text: React.ReactNode;
  let dot = "";
  let actions: React.ReactNode = null;
  switch (status.kind) {
    case "leader-waiting":
      dot = styles.wait;
      text = <>Go Together · {label} <span className={styles.chipSub}>· {status.joined} joined{status.pending ? `, ${status.pending} deciding` : ""}</span></>;
      actions = <>{status.joined > 0 && <button type="button" className={styles.primary} data-testid="go-together-go" onClick={() => ctl?.go()}>Go now</button>}{end}</>;
      break;
    case "leader-travelling":
      text = <>Going together to {label} <span className={styles.chipSub}>· {status.joined} with you</span></>;
      actions = end;
      break;
    case "leader-paused":
      dot = styles.idle;
      text = <>Paused — you took control <span className={styles.chipSub}>· {label}</span></>;
      actions = <><button type="button" className={styles.primary} data-testid="go-together-continue" onClick={() => ctl?.go()}>Continue</button>{end}</>;
      break;
    case "gathering":
      dot = styles.wait;
      text = status.ready > 0 ? <>Gathering party · {status.ready}/{status.total}</> : <>Gathering at the lift…</>;
      break;
    case "regrouping":
      dot = styles.wait;
      text = <>Regrouping · {status.ready}/{status.total}</>;
      break;
    case "riding":
      text = <>Riding up together <span className={styles.chipSub}>· {label}</span></>;
      break;
    case "following":
      text = <>Following {nameOf(status.leader)} <span className={styles.chipSub}>· {label}</span></>;
      actions = leave;
      break;
    case "catching-up":
      dot = styles.wait;
      text = <>Catching up with {nameOf(status.leader)}…</>;
      actions = leave;
      break;
    case "paused":
      dot = styles.idle;
      text = <>Paused following {nameOf(status.leader)}</>;
      actions = <><button type="button" className={styles.primary} data-testid="go-together-resume" onClick={() => ctl?.resume()}>Resume</button>{leave}</>;
      break;
    case "observer":
      dot = styles.idle;
      text = <>Go Together is running in another tab <span className={styles.chipSub}>· {label}</span></>;
      actions = status.leader ? end : leave;
      break;
    default:
      return null;
  }
  // The leader's gather/regroup/ride carry no End: they are a few seconds long and bounded — and a click
  // on the floor still takes control at any moment.
  if (!actions && status.kind !== "riding" && !(status.kind === "gathering" && status.ready > 0) && status.kind !== "regrouping") actions = leave;
  return (
    <div className={styles.chip} role="status" data-testid="go-together-chip" data-status={status.kind}>
      <span className={`${styles.dot} ${dot}`} aria-hidden="true" />
      <span className={styles.chipText}>{text}</span>
      {actions && <span className={styles.chipActions}>{actions}</span>}
    </div>
  );
}

export default Vo3dGoTogether;
