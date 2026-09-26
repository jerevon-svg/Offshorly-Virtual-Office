// vo3d app — THE 5-MINUTE MEETING REMINDER, and its travel actions: Walk There, and Go Together (walk there
// WITH the other attendees — app/goTogether.ts; the host owns the picker, this card only offers it).
//
// WHAT SAYS "REMIND ME". The server's own reminder notification (backend meeting_notifications.sweep_once)
// — persisted, deduped, pushed through the notifications store like every other bell entry. This card is
// that notification made actionable; it creates no reminder of its own and keeps no timer that could
// disagree with the server.
//
// WHAT SAYS "ABOUT WHAT". The meeting AS IT IS NOW, from the scheduled-meetings store — never the words
// frozen into the notification. So an edited time or room is shown as edited, and the card simply
// disappears when the meeting is cancelled, the viewer declines or is removed, it ends, or it was moved
// out of the next few minutes (its new time brings a new reminder). A stale notification therefore can
// never send anybody to the previous room.
//
// Dismiss marks the notification read — the same read the bell performs — so it stays dismissed across
// tabs and reloads. Arriving in the room (or being in its call) retires the card: the room's own panel
// takes over with the scheduled Start / Join.
import { useEffect, useMemo, useState } from "react";
import type { Vo3dWorld } from "./world";
import { markRead, useNotifications } from "../../../services/notifications/notificationsStore";
import { useNow, useScheduledMeetings } from "../../../services/meetings/scheduledMeetingsStore";
import { formatTime } from "../../../services/meetings/meetingTime";
import type { ScheduledMeeting } from "../../../services/meetings/scheduledMeetingsClient";
import HudIcon from "../../../components/HudIcon";
import styles from "./Vo3dMeetingReminder.module.css";

/** A reminder is actionable from shortly before the reminder window until the meeting ends. */
const SHOW_FROM_MS = 6 * 60_000;

type WalkResult = ReturnType<NonNullable<Vo3dWorld["walkToMeetingRoom"]>>;

const roomName = (roomId: string): string => {
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

export function Vo3dMeetingReminder({ worldRef, ready, selfId, onOpen, onGoTogether, inParty = false }: {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  selfId: string;
  /** open the Meetings panel on this meeting */
  onOpen: (meetingId: string) => void;
  /** GO TOGETHER — offer to pick attendees to walk there with. Absent: the button is not shown. */
  onGoTogether?: (meeting: ScheduledMeeting) => void;
  /** already travelling with a party: Go Together is not offered again (Walk There still is) */
  inParty?: boolean;
}) {
  const bell = useNotifications();
  const schedule = useScheduledMeetings();
  const now = useNow(5_000);
  const [where, setWhere] = useState<{ roomId: string }>({ roomId: "" });
  const [walk, setWalk] = useState<{ meetingId: string; result: WalkResult } | null>(null);

  // Which Meeting Floor room the viewer is standing in (a room whose call they are in follows them out).
  useEffect(() => {
    const cm = worldRef.current?.caveMeeting;
    if (!ready || !cm) return;
    return cm.subscribe((s) => setWhere((w) => (w.roomId === (s.roomId ?? "") ? w : { roomId: s.roomId ?? "" })));
  }, [ready, worldRef]);

  const current = useMemo(() => {
    for (const n of bell.notifications) {
      if (n.type !== "meeting_reminder" || n.readAt) continue;
      const id = typeof n.navPayload?.meetingId === "string" ? n.navPayload.meetingId : null;
      const m = id ? schedule.mine.find((x) => x.id === id) : undefined;
      if (!m || m.status !== "scheduled") continue;
      const me = m.invitees.find((i) => i.email === selfId);
      if (!me || me.response === "declined") continue;
      const start = Date.parse(m.startsAt);
      if (now < start - SHOW_FROM_MS || now >= Date.parse(m.endsAt)) continue;
      if (where.roomId === m.roomId) continue; // arrived: the room's own panel takes over
      return { notificationId: n.id, meeting: m };
    }
    return null;
  }, [bell.notifications, schedule.mine, selfId, now, where.roomId]);

  if (!current) return null;
  const { meeting: m, notificationId } = current;
  const room = roomName(m.roomId);
  const start = Date.parse(m.startsAt);
  const minutes = Math.max(0, Math.round((start - now) / 60_000));
  const when = start > now
    ? minutes <= 0 ? `Starting now · ${formatTime(m.startsAt)}` : `Starts in ${minutes} min · ${formatTime(m.startsAt)}`
    : `Started at ${formatTime(m.startsAt)}`;

  // THE ROOM RIGHT NOW, from the server's meeting_presence: whose session (if any) is live in it.
  const presence = schedule.presence[`mf-${m.roomId.split("/")[1]}`];
  const ours = presence?.booking && Date.parse(presence.booking.startsAt) === start;
  const status = !presence?.live
    ? { text: `${room} is free`, tone: styles.free }
    : ours
      ? { text: `In progress in ${room}`, tone: styles.live }
      : { text: `${room} is still occupied — head there and wait nearby`, tone: styles.busy };

  const walking = walk?.meetingId === m.id ? walk.result : null;
  const walkNote =
    walking === "elevator" ? "Taking the lift to the Meeting Floor…"
      : walking === "walking" ? `Walking to ${room}…`
        : walking === "here" ? `You're at ${room}`
          : walking ? "Couldn't start walking — try again, or walk there yourself"
            : null;

  return (
    <div className={styles.card} role="status" data-testid="meeting-reminder" data-meeting-id={m.id}>
      <span className={styles.icon} aria-hidden="true"><HudIcon name="clock" size="30px" /></span>
      <div className={styles.body}>
        <button type="button" className={styles.title} onClick={() => onOpen(m.id)} title="Open in Meetings">
          {m.title}
          {m.isPrivate && <span className={styles.private}> · Private</span>}
        </button>
        <span className={styles.when} data-testid="meeting-reminder-when">{when} · {room}</span>
        <span className={`${styles.status} ${status.tone}`} data-testid="meeting-reminder-room">{status.text}</span>
        {walkNote && <span className={styles.walkNote} data-testid="meeting-reminder-walk">{walkNote}</span>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} data-testid="meeting-reminder-walk-there"
            // Never locked while walking: a movement key or a click cancels Walk There, and pressing it
            // again simply resumes from wherever the body now is.
            disabled={!worldRef.current?.walkToMeetingRoom}
            onClick={() => {
              const result = worldRef.current?.walkToMeetingRoom?.(m.roomId) ?? "unknown";
              setWalk({ meetingId: m.id, result });
            }}>
            Walk there
          </button>
          {onGoTogether && !inParty && worldRef.current?.goTogether && (
            // OPTIONAL IMMERSION: Walk There stays right beside it and never depends on it.
            <button type="button" className={styles.ghost} data-testid="meeting-reminder-go-together"
              onClick={() => onGoTogether(m)}>
              Go together
            </button>
          )}
          <button type="button" className={styles.ghost} data-testid="meeting-reminder-dismiss"
            onClick={() => void markRead(notificationId)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default Vo3dMeetingReminder;
