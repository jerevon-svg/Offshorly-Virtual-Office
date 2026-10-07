// vo3d app — HOW TO GET THERE, after ACCEPTING an instant meeting in a Meeting Floor room from somewhere else.
//
// VO MEETINGS ARE PHYSICAL. Accepting records the intent to attend (app/meetingArrival.ts) — it does not join
// the call and it does not move the body. This card offers the ways there and the employee chooses:
//
//   Go together  the existing Go Together journey: accept a party already headed for this room, or — when other
//                people this same meeting expects are not there yet — invite them (the same picker the
//                scheduled reminder uses). Never a dead button for symmetry.
//   Walk there   the ordinary Walk There (the lift first when downstairs), completed by the world
//   Teleport     straight to a safe spot just inside the room (world.teleportToMeetingRoom)
//
// There is no "stay here": remote participation does not exist. Declining the invitation is how you don't go.
// The call is joined on ARRIVAL (inside the room or on its doorway), and this card then steps aside; a live
// meeting's director takes over from there. Scheduled meetings use their reminder card for the same choices.
import { useEffect, useState } from "react";
import type { Vo3dWorld } from "./world";
import { useCallState } from "../../../services/call/callStore";
import { acceptPartyInvite, useTravelParty } from "../../../services/party/travelPartyStore";
import { MEETING_ROOMS } from "../rooms/floor2Meeting";
import { instantTarget, type GoTogetherTarget } from "./useMeetingParty";
import HudIcon from "../../../components/HudIcon";
import styles from "./Vo3dMeetingReminder.module.css";

type Travel = "walking" | "elevator" | "teleported" | "here" | "busy" | "unreachable" | "no-space" | "unknown";

export function Vo3dMeetingTravel({ worldRef, ready, selfId, onGoTogether }: {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  selfId: string;
  /** open the Go Together picker for this meeting's still-travelling people */
  onGoTogether?: (target: GoTogetherTarget) => void;
}) {
  const call = useCallState();
  const tp = useTravelParty();
  const [tick, setTick] = useState(0);
  const [chosen, setChosen] = useState<{ meetingId: string; result: Travel } | null>(null);
  // the intent and where the body is change without React hearing about it — look again once a second
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [ready]);
  void tick;

  const pending = worldRef.current?.caveMeeting?.intent?.();
  const intent = pending?.intent ?? null;
  const room = intent?.kind === "instant" ? MEETING_ROOMS.find((r) => r.id === intent.roomId) ?? null : null;
  if (!ready || !intent || !room || pending?.phase === "joined" || tp.party) return null;
  const meetingId = intent.meetingId;
  if (call.status === "connected" && call.connectedMeetingId === meetingId) return null;

  if (pending?.arrived) {
    return (
      <div className={styles.card} role="status" data-testid="meeting-travel" data-state="here">
        <span className={styles.icon} aria-hidden="true"><HudIcon name="clock" size="30px" /></span>
        <div className={styles.body}>
          <span className={styles.title}>Meeting · {room.name}</span>
          <span className={styles.walkNote}>You're already here — joining…</span>
        </div>
      </div>
    );
  }
  const walking = chosen?.meetingId === meetingId && (chosen.result === "walking" || chosen.result === "elevator");
  const self = worldRef.current?.goTogether?.self();
  if (walking && self?.moving !== false) {
    return (
      <div className={styles.card} role="status" data-testid="meeting-travel" data-state="walking">
        <span className={styles.icon} aria-hidden="true"><HudIcon name="clock" size="30px" /></span>
        <div className={styles.body}>
          <span className={styles.title}>Meeting · {room.name}</span>
          <span className={styles.walkNote}>{chosen.result === "elevator" ? "Taking the lift to the Meeting Floor…" : `Walking to ${room.name}…`}</span>
        </div>
      </div>
    );
  }
  // GO TOGETHER: a party already headed here, else the same meeting's people who are not there yet
  const party = tp.invites.find((i) => i.party.destination.roomId === room.id) ?? null;
  const entry = call.meetings.find((m) => m.meetingId === meetingId);
  const target = entry ? instantTarget(meetingId, room.id, room.name, entry, selfId) : null;
  const canForm = !party && Boolean(onGoTogether && target && target.candidates.size > 0 && worldRef.current?.goTogether);
  const note = chosen?.meetingId === meetingId
    ? chosen.result === "busy" ? "Busy for a moment — try again"
      : chosen.result === "no-space" ? `No free spot inside ${room.name} right now`
        : chosen.result === "unreachable" || chosen.result === "unknown" ? "Couldn't start — try again, or walk there yourself"
          : null
    : null;
  return (
    <div className={styles.card} role="status" data-testid="meeting-travel" data-state="choose">
      <span className={styles.icon} aria-hidden="true"><HudIcon name="clock" size="30px" /></span>
      <div className={styles.body}>
        <span className={styles.title}>Meeting · {room.name}</span>
        <span className={styles.when}>How do you want to get there? You'll join when you arrive.</span>
        {note && <span className={styles.walkNote} data-testid="meeting-travel-note">{note}</span>}
        <div className={styles.actions}>
          {party && (
            <button type="button" className={styles.primary} data-testid="meeting-travel-go-together"
              onClick={() => acceptPartyInvite(party.inviteId)}>
              Go together
            </button>
          )}
          {canForm && target && (
            <button type="button" className={styles.primary} data-testid="meeting-travel-go-together"
              onClick={() => onGoTogether?.(target)}>
              Go together
            </button>
          )}
          <button type="button" className={party || canForm ? styles.ghost : styles.primary} data-testid="meeting-travel-walk"
            onClick={() => setChosen({ meetingId, result: worldRef.current?.walkToMeetingRoom?.(room.id) ?? "unknown" })}>
            Walk there
          </button>
          <button type="button" className={styles.ghost} data-testid="meeting-travel-teleport"
            onClick={() => setChosen({ meetingId, result: worldRef.current?.teleportToMeetingRoom?.(room.id) ?? "unknown" })}>
            Teleport
          </button>
        </div>
      </div>
    </div>
  );
}

export default Vo3dMeetingTravel;
