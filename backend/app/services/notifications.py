from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.realtime.state import sio, user_room
from app.repositories import notifications as notifications_repo
from app.schemas.notification import serialize_notification
from app.services.quests.rewards import Reward

# Global Notifications V1 — THE one place a notification is created. Feature code calls a typed
# helper here (notify_kudos_received today); nothing outside this module writes `notifications`
# or emits the realtime event.
#
# THREE RULES, in order of importance:
#
# 1. A NOTIFICATION NEVER CAUSES THE THING IT ANNOUNCES. It is created after the authoritative
#    write, from what that write actually returned. In particular it does NOT control, trigger
#    or duplicate a reward grant: reward_grants stays the source of truth for what was paid, and
#    `notify_kudos_received` can only quote a grant its caller already made. Pass reward=None and
#    the wording carries no amounts — which is exactly what a cooldown Kudos does.
#
# 2. IT NEVER BREAKS ITS CALLER. Every failure mode — a duplicate, a bad row, a dead socket — is
#    swallowed and logged. The INSERT runs inside a SAVEPOINT so a unique collision unwinds only
#    itself and never the Kudos/message/quest write it accompanies. Same contract as
#    services/quests/engine.record_quest_event and rewards.grant_kudos_received.
#
# 3. THE WORDS ARE RENDERED AT WRITE TIME. A notification quotes facts that were true when it
#    was created (the Kudos message, the amounts granted then). It is not re-derived on read, so
#    a later change to reward amounts or wording never rewrites history.
#
# EXTENDING IT: add a TYPE_* constant, a NAV_* destination if it needs a new one, and one typed
# helper that calls `notify`. No schema change, no new table, no client release required for the
# client to at least LIST the new type — an unrecognised nav kind degrades to "mark read, do
# nothing" on the client side.

_logger = logging.getLogger(__name__)

# ---- types ---------------------------------------------------------------------------------
# V1 writes only this one. Roadmap types (chat message, mention, call, ask-to-join, quest,
# mission, badge, hub, meeting, HR) each become one more constant here.
TYPE_KUDOS_RECEIVED = "kudos_received"

# ---- navigation destinations ----------------------------------------------------------------
# The closed set of places a notification can send the viewer. The client owns the mapping from
# kind -> UI action (see frontend/src/components/OfficeMap/NotificationCenter.tsx); anything it
# does not recognise is marked read and does nothing, so this list can grow safely.
NAV_PROFILE_FEED = "profile_feed"  # payload: {"email": <whose profile>, "postId": <focus>|None}
NAV_CONVERSATION = "conversation"  # payload: {"conversationId": ...}
NAV_QUESTS = "quests"  # payload: {}
NAV_MISSIONS = "missions"  # payload: {}
NAV_ACHIEVEMENTS = "achievements"  # payload: {"badgeId": ...}
NAV_HUB = "hub"  # payload: {"itemId": ...}

# The realtime event. One event, one shape: the notification plus the recipient's new badge
# value, so a client never has to refetch just to update the count.
EVENT_NOTIFICATION_NEW = "notification_new"


async def notify(
    session: AsyncSession,
    *,
    recipient: str,
    type: str,
    title: str,
    body: str | None = None,
    nav_kind: str | None = None,
    nav_payload: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Persist one notification and push it to every live socket of the recipient.

    Returns the stored row, or None when nothing was written (missing recipient, an existing
    notification with the same dedupe_key, or a logged failure). Never raises.

    `dedupe_key` should be a natural handle for the thing being announced (e.g.
    `kudos:<post id>`) so retries and re-clicks collapse onto one bell entry. Callers with no
    natural key may omit it and get a generated one, which cannot collide.
    """
    to = (recipient or "").strip().lower()
    if not to:
        _logger.error("notification rejected: no recipient type=%s", type)
        return None

    key = (dedupe_key or "").strip() or f"auto:{uuid.uuid4()}"
    try:
        async with session.begin_nested():
            row = await notifications_repo.create(
                session,
                recipient_email=to,
                type=type,
                dedupe_key=key,
                title=title,
                body=body,
                nav_kind=nav_kind,
                nav_payload=nav_payload,
                now=now,
            )
    except IntegrityError:
        return None  # already told them about this exact thing
    except Exception:  # noqa: BLE001 - a notification must never break its caller
        _logger.exception("notification insert failed recipient=%s type=%s key=%s", to, type, key)
        return None

    await _push(session, row)
    return row


async def _push(session: AsyncSession, row: dict[str, Any]) -> None:
    """Fan the new notification out to the recipient's own sockets, using the per-user room
    every connection already joins (see realtime/socket.py's connect handler) — no new socket
    plumbing, no new room, and multi-tab is handled by the room itself.

    Emit failures are logged and swallowed: the row is persisted, so the panel shows it on its
    next fetch (mount, tab focus, or reconnect) even if this push never lands."""
    to = row["recipient_email"]
    try:
        unread = await notifications_repo.unread_count(session, recipient_email=to)
        await sio.emit(
            EVENT_NOTIFICATION_NEW,
            {"notification": serialize_notification(row), "unreadCount": unread},
            room=user_room(to),
        )
    except Exception:  # noqa: BLE001
        _logger.exception("notification push failed recipient=%s id=%s", to, row.get("id"))


# ---- typed helpers -------------------------------------------------------------------------


def _display_name(email: str) -> str:
    """Best-effort human name from an email. This app has no users table — only email strings
    (same convention as the Feed and chat) — so the local part is all there is. The client
    re-resolves nicer names from the roster where it can; this is the durable fallback baked
    into the stored body."""
    local = (email or "").split("@", 1)[0]
    parts = [p for p in local.replace(".", " ").replace("_", " ").split() if p]
    return " ".join(p[:1].upper() + p[1:] for p in parts) or email


async def notify_kudos_received(
    session: AsyncSession,
    *,
    recipient: str,
    giver: str,
    post_id: str,
    message: str,
    reward: Reward | None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Tell someone a coworker gave them Kudos.

    `message` is the giver's own words, or empty for an entry point that has none (the Company
    Hub CTA) — the body then names the giver without a quote.

    `reward` MUST be the grant the caller actually made — the RewardGrant it got back from
    rewards.grant_kudos_received, or None when nothing was granted (the anti-farming cooldown,
    a self-Kudos, an idempotent replay). Nothing here reads or writes the ledger, so the
    reward line can only ever repeat a payout that really happened; a cooldown Kudos is
    announced without amounts rather than falsely claiming them.

    Keyed on the Kudos post, which both Kudos entry points already create idempotently, so the
    Feed activity, the reward grant and the bell entry all collapse together on a re-click.

    Destination: the RECIPIENT's own profile Feed, focused on this Kudos post.
    """
    dedupe = f"{TYPE_KUDOS_RECEIVED}:{post_id}"
    # First line always names the giver. A Kudos written on someone's profile carries their own
    # message and is quoted; the Company Hub CTA has no message box, so it gets the plain
    # sentence instead of an empty quote.
    who = _display_name(giver)
    text = (message or "").strip()
    lines = [f"{who}: “{text}”" if text else f"{who} gave you Kudos."]
    if reward is not None and (reward.xp or reward.coins):
        lines.append(f"+{reward.xp} XP · +{reward.coins} Coins")
    return await notify(
        session,
        recipient=recipient,
        type=TYPE_KUDOS_RECEIVED,
        title="🏆 You received Kudos!",
        body="\n".join(lines) or None,
        nav_kind=NAV_PROFILE_FEED,
        nav_payload={"email": (recipient or "").strip().lower(), "postId": post_id},
        dedupe_key=dedupe,
        now=now,
    )
