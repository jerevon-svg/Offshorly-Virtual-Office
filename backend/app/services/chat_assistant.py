from __future__ import annotations

import asyncio
import logging
import re

from app import database as app_db
from app.repositories import chat as chat_repo
from app.services.chat_send import (
    TOUCAN_CHAT_SENDER,
    ChatSendError,
    is_toucan_sender,
    send_chat_message,
)

# A1.4.2 — @TOUCAN INSIDE A CONVERSATION: detection + a deterministic in-chat reply.
#
# WHAT THIS IS: a human types "@Toucan ..." into a DM or group they belong to; after their message
# has gone through the ordinary send path untouched, Toucan answers INSIDE THE SAME CONVERSATION
# as the reserved author (chat_send.TOUCAN_CHAT_SENDER), through the same persist + fan-out seam
# every message uses. WHAT THIS IS NOT (yet): no conversation history is read, nothing reaches a
# provider, no other conversation is consulted — the reply is a fixed string.
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
PROMPT_ACK_REPLY = "I'm here. Conversation assistance is coming next."


def detect_toucan_invocation(text: str) -> str | None:
    """None when the text does not invoke Toucan. Otherwise the remaining prompt with every
    @toucan token removed and whitespace collapsed — "" for a bare invocation. Several tokens
    are still ONE invocation."""
    if not text or not _TOUCAN_TOKEN.search(text):
        return None
    return " ".join(_TOUCAN_TOKEN.sub(" ", text).split())


def reply_text_for(prompt: str) -> str:
    return BARE_REPLY if not prompt else PROMPT_ACK_REPLY


async def reply_to_invocation(conversation_id: str, invoker_email: str, prompt: str) -> dict | None:
    """Produce Toucan's reply inside `conversation_id`, or nothing. Re-verifies at reply time that
    the invoker is still a participant (which also proves the conversation still exists) — a
    conversation deleted or a membership lost between the human send and this task means no
    reply. Never raises: a failure here is logged and the human message stands on its own."""
    if is_toucan_sender(invoker_email):
        return None
    try:
        async with app_db.async_session_maker() as session:
            if not await chat_repo.is_participant(session, conversation_id, invoker_email):
                return None
            return await send_chat_message(
                session,
                conversation_id=conversation_id,
                sender_email=TOUCAN_CHAT_SENDER,
                text=reply_text_for(prompt),
            )
    except ChatSendError as err:
        logger.info("toucan in-chat reply skipped: %s", err.code)
    except Exception:
        logger.exception("toucan in-chat reply failed")
    return None


# Background tasks are kept referenced until done so the event loop cannot garbage-collect them.
_pending_replies: set[asyncio.Task] = set()


def schedule_reply(conversation_id: str, invoker_email: str, prompt: str) -> asyncio.Task:
    task = asyncio.create_task(reply_to_invocation(conversation_id, invoker_email, prompt))
    _pending_replies.add(task)
    task.add_done_callback(_pending_replies.discard)
    return task
