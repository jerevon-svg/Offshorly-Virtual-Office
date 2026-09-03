from __future__ import annotations

import asyncio
import logging
import re

from app import database as app_db
from app.config import settings
from app.models.message import Message
from app.repositories import chat as chat_repo
from app.services.chat_send import (
    TOUCAN_CHAT_SENDER,
    ChatSendError,
    is_toucan_sender,
    send_chat_message,
)
from app.services.toucan_ai.provider import generate_conversation_reply

# A1.4.2 — @TOUCAN INSIDE A CONVERSATION: detection + a deterministic in-chat reply.
#
# WHAT THIS IS: a human types "@Toucan ..." into a DM or group they belong to; after their message
# has gone through the ordinary send path untouched, Toucan answers INSIDE THE SAME CONVERSATION
# as the reserved author (chat_send.TOUCAN_CHAT_SENDER), through the same persist + fan-out seam
# every message uses.
#
# A1.4.3 — THE ONE PLACE TOUCAN MAY READ MESSAGE BODIES, and only like this: the invoker has just
# been re-verified as a participant, the read is the bounded LATEST window of THAT conversation
# (SQL-limited, see chat_repo.list_recent_messages), Toucan's own earlier replies and the invoking
# message itself are dropped, every text is clamped, the whole window is clamped, and the result
# goes to the conversation-scoped provider seam (toucan_ai.generate_conversation_reply) that
# renders no office context and no memories. A bare "@Toucan" never reads anything.
#
# ORDER IS THE SAFETY PROPERTY: the socket handler calls detect_toucan_invocation only after
# send_chat_message has committed and fanned out the human's message, and schedules the reply as
# a background task. Nothing here can delay, fail, or alter the human message.
#
# NO RECURSION BY CONSTRUCTION: the only caller is the socket handler, which already refuses a
# session claiming the Toucan identity; reply_to_invocation additionally refuses a Toucan invoker;
# and the fixed replies contain no "@toucan" token, so even a future caller that re-scanned
# Toucan's own output would find nothing.

logger = logging.getLogger(__name__)

# Whole-token "@toucan", case-insensitive, anywhere in the text. Not preceded by a word character,
# "@", "." or "-" (so "email@toucan.com" and "x-@toucan" are not invocations) and not followed by a
# word character or "-" (so "@ToucanBird" is not). Punctuation after the token is fine.
_TOUCAN_TOKEN = re.compile(r"(?<![\w.@-])@toucan(?![\w-])", re.IGNORECASE)

BARE_REPLY = "Hi! I'm here. Ask me something about this conversation."
FAILURE_REPLY = "Sorry, I couldn't answer that right now."


def detect_toucan_invocation(text: str) -> str | None:
    """None when the text does not invoke Toucan. Otherwise the remaining prompt with every
    @toucan token removed and whitespace collapsed — "" for a bare invocation. Several tokens
    are still ONE invocation."""
    if not text or not _TOUCAN_TOKEN.search(text):
        return None
    return " ".join(_TOUCAN_TOKEN.sub(" ", text).split())


def author_label(email: str, *, invoker_email: str) -> str:
    """A speaker label without exposing the address: the capitalised local part ("micah@…" →
    "Micah"). The requester is additionally marked so "I/we" in the prompt resolves."""
    local = email.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
    name = " ".join(w[:1].upper() + w[1:] for w in local.split()) or "Someone"
    return f"{name} (asking)" if email.strip().lower() == invoker_email.strip().lower() else name


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: max(limit - 1, 1)].rstrip() + "…"


def build_context_window(
    messages: list[Message],
    *,
    invoker_email: str,
    invoking_message_id: str | None,
    max_messages: int | None = None,
    max_message_chars: int | None = None,
    max_total_chars: int | None = None,
) -> list[dict[str, object]]:
    """Project the latest messages of ONE conversation into what the provider may see:
    [{"author": label, "text": clipped}] oldest → newest. Drops the invoking message (the prompt
    is passed separately, so it is represented once) and Toucan's own earlier replies (derived
    output, not conversation facts), keeps at most `max_messages`, clips each text, and drops the
    OLDEST entries until the total fits `max_total_chars`. Pure — tested directly."""
    max_messages = max_messages if max_messages is not None else settings.TOUCAN_CHAT_WINDOW_MESSAGES
    max_message_chars = max_message_chars if max_message_chars is not None else settings.TOUCAN_CHAT_MAX_MESSAGE_CHARS
    max_total_chars = max_total_chars if max_total_chars is not None else settings.TOUCAN_CHAT_MAX_CONTEXT_CHARS

    ordered = sorted(messages, key=lambda m: (m.sent_at, m.id))
    kept = [
        m for m in ordered
        if m.id != invoking_message_id and not is_toucan_sender(m.sender_email) and m.text.strip()
    ][-max_messages:]
    window = [
        {"author": author_label(m.sender_email, invoker_email=invoker_email), "text": _clip(m.text, max_message_chars)}
        for m in kept
    ]
    total = sum(len(t["text"]) for t in window)
    while window and total > max_total_chars:
        total -= len(window[0]["text"])
        window.pop(0)
    return window


async def reply_to_invocation(
    conversation_id: str,
    invoker_email: str,
    prompt: str,
    invoking_message_id: str | None = None,
) -> dict | None:
    """Produce Toucan's reply inside `conversation_id`, or nothing. Re-verifies at reply time that
    the invoker is still a participant (which also proves the conversation still exists) BEFORE
    any message is read — a conversation deleted or a membership lost between the human send and
    this task means no read, no provider call, no reply. Bare "@Toucan" answers deterministically
    without reading. A prompt reads the bounded window, asks the conversation-scoped provider
    seam, and falls back to FAILURE_REPLY on any provider problem. Never raises: the human
    message stands on its own."""
    if is_toucan_sender(invoker_email):
        return None
    try:
        async with app_db.async_session_maker() as session:
            if not await chat_repo.is_participant(session, conversation_id, invoker_email):
                return None
            if not prompt:
                text = BARE_REPLY
            else:
                # +1 so the invoking message (usually the newest row) does not cost a slot.
                recent = await chat_repo.list_recent_messages(
                    session, conversation_id, settings.TOUCAN_CHAT_WINDOW_MESSAGES + 1
                )
                window = build_context_window(
                    recent, invoker_email=invoker_email, invoking_message_id=invoking_message_id
                )
                text = await generate_conversation_reply(prompt, window) or FAILURE_REPLY
            return await send_chat_message(
                session, conversation_id=conversation_id, sender_email=TOUCAN_CHAT_SENDER, text=text
            )
    except ChatSendError as err:
        logger.info("toucan in-chat reply skipped: %s", err.code)
    except Exception:
        logger.exception("toucan in-chat reply failed")
    return None


# Background tasks are kept referenced until done so the event loop cannot garbage-collect them.
_pending_replies: set[asyncio.Task] = set()


def schedule_reply(
    conversation_id: str, invoker_email: str, prompt: str, invoking_message_id: str | None = None
) -> asyncio.Task:
    task = asyncio.create_task(reply_to_invocation(conversation_id, invoker_email, prompt, invoking_message_id))
    _pending_replies.add(task)
    task.add_done_callback(_pending_replies.discard)
    return task
