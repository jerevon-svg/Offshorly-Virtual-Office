// vo3d app — HOW TO GET THERE, once you have JOINED a Meeting Floor room's meeting from somewhere else.
//
// Joining a meeting (accepting an invitation) connects you to it; it does not move your body. Being in
// the call and being in the room are separate facts, so this card offers the ways there and lets the
// employee choose — or stay where they are:
//
//   Walk there   the ordinary Walk There (the lift first when downstairs), completed by the world
//   Teleport     straight to a safe spot just inside the room (world.teleportToMeetingRoom)
//   Go together  ONLY when a real Go Together party heading for this room has invited them — never a dead
//                button for symmetry; accepting it is the existing party invitation
//   Stay here    dismiss; nothing ever walks them anywhere afterwards
//
// It shows only while it means something: connected to the room's meeting, not already in that room,
// not travelling with a party, not already on the way, and not dismissed. A live meeting's director takes
// over the moment the body is at the room.
import { useEffect, useState } from "react";
import type { Vo3dWorld } from "./world";
import { useCallState } from "../../../services/call/callStore";
import { acceptPartyInvite, useTravelParty } from "../../../services/party/travelPartyStore";
import { MEETING_ROOMS } from "../rooms/floor2Meeting";
import HudIcon from "../../../components/HudIcon";
import styles from "./Vo3dMeetingReminder.module.css";

type Travel = "walking" | "elevator" | "teleported" | "here" | "busy" | "unreachable" | "no-space" | "unknown";

export function Vo3dMeetingTravel({ worldRef, ready }: { worldRef: { current: Vo3dWorld | null }; ready: boolean }) {
  const call = useCallState();
  const tp = useTravelParty();
  const [tick, setTick] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ meetingId: string; result: Travel } | null>(null);
  // where the body is changes without React hearing about it — look again once a second
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [ready]);
  void tick;

  const meetingId = call.status === "connected" ? call.connectedMeetingId : null;
  const room = meetingId ? MEETING_ROOMS.find((r) => r.meetingId === meetingId) ?? null : null;
  const self = worldRef.current?.goTogether?.self();
  const inRoom = Boolean(room && self && self.room === room.id);
  if (!ready || !room || !meetingId || inRoom || tp.party || dismissed === meetingId) return null;
  const walking = chosen?.meetingId === meetingId && (chosen.result === "walking" || chosen.result === "elevator");
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
  const party = tp.invites.find((i) => i.party.destination.roomId === room.id) ?? null;
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
        <span className={styles.title}>You've joined · {room.name}</span>
        <span className={styles.when}>How do you want to get there?</span>
        {note && <span className={styles.walkNote} data-testid="meeting-travel-note">{note}</span>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} data-testid="meeting-travel-walk"
            onClick={() => setChosen({ meetingId, result: worldRef.current?.walkToMeetingRoom?.(room.id) ?? "unknown" })}>
            Walk there
          </button>
          <button type="button" className={styles.ghost} data-testid="meeting-travel-teleport"
            onClick={() => setChosen({ meetingId, result: worldRef.current?.teleportToMeetingRoom?.(room.id) ?? "unknown" })}>
            Teleport
          </button>
          {party && (
            <button type="button" className={styles.ghost} data-testid="meeting-travel-go-together"
              onClick={() => acceptPartyInvite(party.inviteId)}>
              Go together
            </button>
          )}
          <button type="button" className={styles.ghost} data-testid="meeting-travel-stay" onClick={() => setDismissed(meetingId)}>
            Stay here
          </button>
        </div>
      </div>
    </div>
  );
}

export default Vo3dMeetingTravel;
