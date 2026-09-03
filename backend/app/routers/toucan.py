from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import bearer_token_from_request, get_current_email
from app.config import settings
from app.database import get_db
from app.repositories import toucan as toucan_repo
from app.repositories import toucan_activity as toucan_activity_repo
from app.repositories import toucan_memory as toucan_memory_repo
from app.repositories import toucan_resources as toucan_resources_repo
from app.schemas.toucan import (
    ToucanActionProposalOut,
    ToucanActionResultOut,
    ToucanActivityOut,
    ToucanAnswerOut,
    ToucanAskIn,
    ToucanConversationDetailOut,
    ToucanConversationOut,
    ToucanMemoryIn,
    ToucanMemoryOut,
    ToucanResourceIn,
    ToucanResourceOut,
)
from app.services.chat_send import (
    ChatSendError,
    find_direct_conversation_id,
    send_direct_message,
)
from app.services.toucan.actions import (
    ACTION_PROPOSAL_INTENT,
    ACTION_UNAVAILABLE_DETAIL,
    SendMessageAction,
    SendMessageRequest,
    SetStatusAction,
    ToucanAction,
    cancelled_text,
    confirmation_text,
    executed_text,
    parse_action_request,
    proposal_summary,
    self_recipient_text,
    validate_ai_proposal,
)
from app.services.toucan.activity import AttentionSnapshot
from app.services.toucan.context import (
    OfficeContext,
    build_office_context,
    resolve_person,
)
from app.services.toucan.memory_commands import (
    EMPTY_FORGET_TEXT,
    EMPTY_REMEMBER_TEXT,
    MemoryCommand,
    MemoryView,
    forgotten_text,
    memories_text,
    parse_memory_command,
    saved_text,
)
from app.services.toucan.memory_retrieval import select_relevant_memories
from app.services.toucan.office_assistant import (
    ambiguous_person_text,
    answer_question,
    is_activity_question,
    unknown_person_text,
)
from app.services.toucan.pending_actions import PendingAction, pending_actions
from app.services.toucan_ai.provider import AI_INTENT, ai_enabled, generate_answer

# Toucan assistant REST layer.
#
# SCOPE, stated as what this module does NOT have (T1 changes exactly one line of this list —
# the database one — and nothing else):
#   * CHANGED IN T6: there is now an AI provider — but not here, and not in services/toucan/.
#     The SDK and the key live solely in services/toucan_ai/provider.py; this module imports a
#     seam (ai_enabled/generate_answer) and hands it the SAME OfficeContext the deterministic
#     assistant gets, from which the provider projects the bounded allowlist in
#     services/toucan/ai_context.py. The provider is consulted ONLY for questions the
#     deterministic assistant marked unsupported, so every T0-T5 answer — memory commands, the
#     activity digest, every live-state intent — is still produced with no network call beyond
#     the Atlas roster read in services/toucan/roster.py (caller's own bearer token, as ever)
#   * NEW IN T1: a database, but only for the transcript. Two tables (see models/toucan.py),
#     holding the user's own questions and the assistant's own answers. No office context
#     snapshot, no roster rows, no registry state, no token is ever written down
#   * no Socket.IO emit, so nothing here enters the realtime fan-out that
#     docs/realtime-scaling-roadmap.md's R4/R5 would have to make cross-worker. A Toucan
#     conversation has exactly one reader — its owner — so there is nobody to fan out to
#   * NEW IN T2: durable activity METADATA — counts, and only counts. See
#     app/repositories/toucan_activity.py for the rules; the short version is that Toucan can
#     now tell you HOW MUCH happened while you were gone and never what it was. Nothing about
#     T1's boundary moves: the answer-building package still owns no storage, and the counting
#     lives in its own quarantined repository rather than anywhere near context.py
#   * still no extracted memory, no summarisation of anything anybody wrote
#
# IDENTITY: `email` comes from get_current_email (bearer token verified against Atlas, or the
# hard-gated dev bypass) and is the ONLY source of caller identity. It is what scopes the
# context, and in T1 it is also the ONLY thing ever written to owner_email. The request body has
# no identity field and forbids extras (see schemas/toucan.py).
#
# OWNERSHIP: every conversation lookup below goes through repositories/toucan.py, whose helpers
# all take owner_email and filter on it inside the query. A conversation belonging to someone
# else is indistinguishable from one that does not exist — both come back as 404, never 403,
# so an id cannot be probed for existence.
#
# TOKEN FORWARDING: the raw bearer is read from the REQUEST HEADER — never the body — and is
# used solely as a forwarded credential for the roster fetch, so Atlas applies the same
# authorization it would apply to this person's own browser. It is not an identity source:
# `email` above is derived by verifying that token, not by trusting it. A caller on the dev
# bypass has no token, so they simply get no roster.

logger = logging.getLogger(__name__)

router = APIRouter(tags=["toucan"])

_CONVERSATION_NOT_FOUND = "Conversation not found"
_MEMORY_NOT_FOUND = "Memory not found"
_RESOURCE_NOT_FOUND = "Resource not found"
_RESOURCE_TARGET_NOT_FOUND = "Attachment target not found"


async def _execute_memory_command(
    db: AsyncSession, *, email: str, command: MemoryCommand
) -> tuple[str, str]:
    """Run one explicit memory command for the caller and word the outcome. Returns
    (answer_text, intent).

    T4's counterpart of the T2 snapshot split: services/toucan/memory_commands.py decided WHAT
    the message asks and will word the result, this function does the one storage step in
    between, and `email` is the bearer identity — the command carries no owner and never can."""
    if command.action == "list":
        rows = await toucan_memory_repo.list_memories(
            db, owner_email=email, limit=toucan_memory_repo.MEMORY_ANSWER_LIMIT
        )
        views = [MemoryView(kind=r["kind"], content=r["content"]) for r in rows]
        return memories_text(views), "memory_list"

    if command.action == "forget":
        if not command.content:
            return EMPTY_FORGET_TEXT, "memory_forget"
        deleted = await toucan_memory_repo.forget_by_content(
            db, owner_email=email, content=command.content
        )
        return forgotten_text(command, deleted), "memory_forget"

    # remember / save-note
    if not command.content:
        return EMPTY_REMEMBER_TEXT, "memory_save"
    await toucan_memory_repo.save_memory(
        db, owner_email=email, content=command.content, kind=command.kind
    )
    return saved_text(command), "memory_save"


async def _propose_action(
    db: AsyncSession,
    *,
    conversation,
    email: str,
    question: str,
    action: ToucanAction,
) -> ToucanAnswerOut:
    """T8 — register one VALIDATED proposal and answer with the confirmation ask. Everything
    user-facing here is server-worded from the validated action (never from model text), the
    pending entry is bound to the bearer identity, and — the entire point — NOTHING EXECUTES:
    the only paths out of pending are the explicit confirm/cancel endpoints below, or expiry."""
    summary = proposal_summary(action)
    pending = pending_actions.propose(
        owner_email=email,
        conversation_id=conversation.id,
        action=action,
        summary=summary,
        ttl_seconds=settings.TOUCAN_ACTION_TTL_SECONDS,
    )
    answer_text = confirmation_text(action)
    await toucan_repo.append_exchange(
        db, conversation=conversation, question=question, answer=answer_text
    )
    return ToucanAnswerOut(
        text=answer_text,
        intent=ACTION_PROPOSAL_INTENT,
        supported=True,
        conversation_id=conversation.id,
        action=ToucanActionProposalOut(
            id=pending.id,
            action=action.action,
            summary=summary,
            expires_at=pending.expires_at,
            **_action_fields(action),
        ),
    )


def _action_fields(action: ToucanAction) -> dict:
    """The frozen validated args, keyed the way both wire models name them. A send_message
    proposal carries the RESOLVED recipient and the exact text so the card shows both."""
    if isinstance(action, SendMessageAction):
        return {
            "recipient_email": action.recipient_email,
            "recipient_label": action.recipient_label,
            "message": action.text,
        }
    return {"status": action.status, "dnd_minutes": action.dnd_minutes}


ACTION_CLARIFY_INTENT = "send_message_clarify"


async def _resolve_send_request(
    db: AsyncSession,
    *,
    conversation,
    email: str,
    question: str,
    request: SendMessageRequest,
    context: OfficeContext,
) -> ToucanAnswerOut:
    """A1 — turn an UNRESOLVED send request into a proposal, or ask. The recipient is resolved
    server-side against the caller's own office context: exactly one match becomes a
    SendMessageAction (frozen recipient + exact text); nobody, several people, or the caller
    themselves gets a clarifying answer and NO proposal — a recipient is never guessed. An
    existing DM id is looked up read-only here; a missing DM is created only at Confirm, so a
    cancelled or expired proposal leaves no empty conversation behind."""
    match = resolve_person(context, request.recipient)
    if match.is_ambiguous:
        answer_text = ambiguous_person_text(request.recipient, match.matches)
    elif match.person is None:
        answer_text = unknown_person_text(request.recipient, roster_available=context.roster_available)
    elif match.person.email == email:
        answer_text = self_recipient_text()
    else:
        person = match.person
        action = SendMessageAction(
            recipient_email=person.email,
            recipient_label=person.display_name or person.email,
            text=request.text,
            conversation_id=await find_direct_conversation_id(db, email, person.email),
        )
        return await _propose_action(
            db, conversation=conversation, email=email, question=question, action=action
        )
    await toucan_repo.append_exchange(db, conversation=conversation, question=question, answer=answer_text)
    return ToucanAnswerOut(
        text=answer_text, intent=ACTION_CLARIFY_INTENT, supported=True, conversation_id=conversation.id
    )


def _action_result(
    pending: PendingAction, *, outcome: str, text: str, sent: dict | None = None
) -> ToucanActionResultOut:
    return ToucanActionResultOut(
        id=pending.id,
        outcome=outcome,
        action=pending.action.action,
        summary=pending.summary,
        text=text,
        conversation_id=sent["conversationId"] if sent else None,
        message_id=sent["id"] if sent else None,
        **_action_fields(pending.action),
    )


async def _append_action_note(db: AsyncSession, pending: PendingAction, *, email: str, text: str) -> None:
    """Write the confirm/cancel outcome line into the transcript the proposal came from — if
    that conversation still exists and still belongs to the caller (re-verified, like every
    conversation lookup). A deleted conversation just means no transcript line; the action
    outcome itself is unaffected."""
    conversation = await toucan_repo.get_conversation(
        db, conversation_id=pending.conversation_id, owner_email=email
    )
    if conversation is not None:
        await toucan_repo.append_assistant_message(db, conversation=conversation, content=text)


# response_model_exclude_none keeps the pre-T8 wire BYTE-IDENTICAL: of the five fields only
# `action` can be None, so an answer without a proposal is still exactly the T0 four-field
# contract (asserted in test_toucan_ai/test_toucan_privacy), and `action` appears only when a
# proposal is actually pending.
@router.post("/toucan/ask", response_model=ToucanAnswerOut, response_model_exclude_none=True)
async def ask_toucan(
    request: Request,
    body: ToucanAskIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanAnswerOut:
    """Answer one live-office question for the authenticated caller, and persist the exchange.

    Order of operations, and the order is the privacy boundary: resolve the conversation
    (proving ownership BEFORE any work is done on the caller's behalf), derive identity, build a
    caller-scoped context out of the allowlisted fields in services/toucan/context.py (Atlas
    identity + realtime state, merged there and only there), word an answer in
    services/toucan/office_assistant.py, then write down the question and the answer — and
    nothing else. Nothing reaches the wording layer that did not pass through the context layer
    first, and nothing reaches the database that was not typed by the user or worded for them.
    """
    if body.conversation_id:
        conversation = await toucan_repo.get_conversation(
            db, conversation_id=body.conversation_id, owner_email=email
        )
        if conversation is None:
            # Covers both "no such id" and "somebody else's id" — see the module note above.
            raise HTTPException(status_code=404, detail=_CONVERSATION_NOT_FOUND)
    else:
        conversation = await toucan_repo.create_conversation(db, owner_email=email)

    # T4 FIRST — before the office context is even built. An explicit remember/list/forget is a
    # command about the caller's own durable memory: it needs no roster fetch and no registry
    # read, and nothing about it may depend on live office state. Only these deterministic
    # phrasings take this branch (see services/toucan/memory_commands.py); every other message
    # flows on exactly as before, which is what keeps "an ordinary message never becomes a
    # memory" structural rather than filtered.
    memory_command = parse_memory_command(body.question)
    if memory_command is not None:
        answer_text, memory_intent = await _execute_memory_command(
            db, email=email, command=memory_command
        )
        await toucan_repo.append_exchange(
            db, conversation=conversation, question=body.question, answer=answer_text
        )
        return ToucanAnswerOut(
            text=answer_text,
            intent=memory_intent,
            supported=True,
            conversation_id=conversation.id,
        )

    # T8 SECOND — the deterministic action phrasings, still before any context is built (a
    # set-my-status request needs no roster and no registry read to become a PROPOSAL; live
    # state only matters at execution, which hasn't happened and may never happen). Like the
    # memory commands above, only the explicit self-scoped imperatives in
    # services/toucan/actions.py take this branch — and even they only produce a pending
    # proposal that the confirm endpoint alone can execute.
    action_request = parse_action_request(body.question)
    if isinstance(action_request, SetStatusAction):
        return await _propose_action(
            db, conversation=conversation, email=email, question=body.question, action=action_request
        )

    context = await build_office_context(email, bearer_token=bearer_token_from_request(request))

    # A1 — an explicit "message <person> <text>" phrasing. Unlike set_status it needs the
    # context, but only to resolve the recipient onto exactly one known person; nothing is
    # sent, and an unresolved name is answered with a question rather than a guess.
    if isinstance(action_request, SendMessageRequest):
        return await _resolve_send_request(
            db,
            conversation=conversation,
            email=email,
            question=body.question,
            request=action_request,
            context=context,
        )

    # T2: only the handful of "what did I miss" phrasings pay for a database round trip. Every
    # live-state question costs exactly what it cost at T1. The predicate and the resolver share
    # one pattern table (see office_assistant._ACTIVITY_INTENTS), so they cannot drift into a
    # state where a question is claimed here and answered without a snapshot there.
    activity = None
    if is_activity_question(body.question):
        activity = AttentionSnapshot.from_dict(
            await toucan_activity_repo.attention_snapshot(db, viewer_email=email)
        )

    answer = answer_question(body.question, context, activity=activity)
    answer_text, intent, supported = answer.text, answer.intent, answer.supported

    # T6: DETERMINISTIC FIRST, AI FOR THE UNSUPPORTED TAIL. A question any T0-T5 intent claimed
    # (supported=True) is already answered from registry truth and never reaches the provider —
    # so the model cannot re-word real state, memory commands and the digest stay off the
    # network, and the per-question cost of everything that worked yesterday stays zero. Only
    # the fallback case asks the provider, handing it the same caller-scoped context (projected
    # through services/toucan/ai_context.py) plus the request's own bounded history. None —
    # disabled, error, timeout, empty — keeps the deterministic fallback: an LLM failure can
    # degrade an answer, never fail the request.
    if not supported and ai_enabled():
        # T7: RETRIEVE → FILTER → PROJECT → AI, and only on this branch — deterministic answers
        # never pay for the memory read. The candidate pool is the caller's own rows, filtered
        # on owner_email in the repository's SQL and bounded there; the relevance pass and the
        # {kind, content} projection are the pure function in services/toucan/memory_retrieval.py,
        # so what can reach the provider is decided entirely inside the swept package. An
        # irrelevant or empty pool projects to [] and the provider renders no memory block.
        memory_rows = await toucan_memory_repo.list_memories(
            db, owner_email=email, limit=toucan_memory_repo.MAX_MEMORIES_RETURNED
        )
        reply = await generate_answer(
            body.question,
            context,
            [(turn.role, turn.text) for turn in body.history],
            memories=select_relevant_memories(body.question, memory_rows),
        )
        if reply is not None:
            # T8: the model may have PROPOSED an action — raw, untrusted {name, args}. The one
            # door it can pass through is the server-owned validator; anything that is not
            # exactly an allowlisted action with exactly the allowed args comes back None and
            # the request continues as an ordinary answer. A valid proposal becomes a pending
            # entry awaiting the explicit confirm endpoint — nothing executes here, and the
            # confirmation ask is worded by the server from the VALIDATED action, never taken
            # from the model's own text.
            if reply.action_name is not None:
                proposed = validate_ai_proposal(reply.action_name, reply.action_args)
                if isinstance(proposed, SendMessageRequest):
                    # The model named a recipient; only the server resolves who that is.
                    return await _resolve_send_request(
                        db,
                        conversation=conversation,
                        email=email,
                        question=body.question,
                        request=proposed,
                        context=context,
                    )
                if proposed is not None:
                    return await _propose_action(
                        db,
                        conversation=conversation,
                        email=email,
                        question=body.question,
                        action=proposed,
                    )
                logger.warning("toucan ai proposal rejected by validator")
            if reply.text:
                answer_text, intent, supported = reply.text, AI_INTENT, True

    await toucan_repo.append_exchange(
        db, conversation=conversation, question=body.question, answer=answer_text
    )

    return ToucanAnswerOut(
        text=answer_text,
        intent=intent,
        supported=supported,
        conversation_id=conversation.id,
    )


@router.post("/toucan/conversations", response_model=ToucanConversationOut, status_code=201)
async def create_toucan_conversation(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanConversationOut:
    """Start a fresh, empty conversation — the panel's "New conversation" action.

    Created eagerly rather than lazily on the next question so that "latest" moves immediately:
    a refresh straight after pressing New must restore the new empty conversation, not silently
    reopen the previous one. There is no request body at all, so there is nothing to forbid."""
    conversation = await toucan_repo.create_conversation(db, owner_email=email)
    return ToucanConversationOut.from_dict(toucan_repo.conversation_to_dict(conversation))


@router.get("/toucan/conversations", response_model=list[ToucanConversationOut])
async def list_toucan_conversations(
    limit: int = Query(
        default=toucan_repo.DEFAULT_CONVERSATIONS_RETURNED,
        ge=1,
        le=toucan_repo.MAX_CONVERSATIONS_RETURNED,
    ),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[ToucanConversationOut]:
    """The caller's own conversations, most recently used first. Metadata only — no transcripts,
    so the list stays small however long the conversations get."""
    rows = await toucan_repo.list_conversations(db, owner_email=email, limit=limit)
    return [ToucanConversationOut.from_dict(r) for r in rows]


@router.get("/toucan/conversations/latest", response_model=ToucanConversationDetailOut | None)
async def get_latest_toucan_conversation(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanConversationDetailOut | None:
    """What the panel opens on summon, re-summon and page refresh, in ONE round trip.

    Returns null (200, not 404) when the caller has never talked to the toucan — "you have no
    conversations yet" is an ordinary answer, not an error, and the panel branches on it to show
    the greeting instead. Declared BEFORE the /{conversation_id} route below so the literal path
    wins over the parameterised one."""
    conversation = await toucan_repo.get_latest_conversation(db, owner_email=email)
    if conversation is None:
        return None
    messages = await toucan_repo.list_messages(db, conversation_id=conversation.id)
    return ToucanConversationDetailOut.from_rows(
        toucan_repo.conversation_to_dict(conversation), messages
    )


@router.get("/toucan/conversations/{conversation_id}", response_model=ToucanConversationDetailOut)
async def get_toucan_conversation(
    conversation_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanConversationDetailOut:
    conversation = await toucan_repo.get_conversation(
        db, conversation_id=conversation_id, owner_email=email
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail=_CONVERSATION_NOT_FOUND)
    messages = await toucan_repo.list_messages(db, conversation_id=conversation.id)
    return ToucanConversationDetailOut.from_rows(
        toucan_repo.conversation_to_dict(conversation), messages
    )


@router.delete("/toucan/conversations/{conversation_id}", status_code=204)
async def delete_toucan_conversation(
    conversation_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Hard delete, transcript and all. Deliberately not a soft "archived" flag: T1 stores only
    what the user said and what the toucan replied, so there is no analytics or audit reason to
    keep a row the user asked to be rid of."""
    deleted = await toucan_repo.delete_conversation(
        db, conversation_id=conversation_id, owner_email=email
    )
    if not deleted:
        raise HTTPException(status_code=404, detail=_CONVERSATION_NOT_FOUND)
    return Response(status_code=204)


# --- T8: safe actions — explicit confirmation ---------------------------------------------------
#
# STRUCTURAL, NOT CONVERSATIONAL: a pending action is confirmed by POSTing its server-minted id
# to these endpoints — never by typing "yes" into /toucan/ask, hitting Enter, or anything the
# model could be talked into. The id is the whole ceremony: it exists only if the server itself
# validated and registered the proposal, it is bound to the bearer identity, it works exactly
# once, and it expires. Every failure mode — unknown id, someone else's id, expired, replayed,
# already cancelled — is the same 404 with the same detail, so nothing can be probed.
#
# WHAT "EXECUTE" MEANS FOR set_status: the user's office status is a client-owned product
# concept (frontend/src/services/presence/selfStatusStore.ts + localStorage; only the DND bit
# reaches this server, via the dnd_set socket event the client emits on transition). So the
# server's execution step is everything the server CAN authoritatively do: consume the one-time
# pending entry, log the audit line (who confirmed which allowlisted action), persist the
# outcome into the transcript, and return the frozen validated effect — which the caller's own
# client then applies through the exact same setManualStatus/startDnd path the StatusPicker
# uses, keeping every existing side effect (DND broadcast, room locks, allowance policy)
# consistent. Self-scoped by construction: the effect goes back to the confirming caller and
# nobody else, so "set someone else's status" has no representation anywhere in this flow.


@router.post("/toucan/actions/{action_id}/confirm", response_model=ToucanActionResultOut)
async def confirm_toucan_action(
    action_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanActionResultOut:
    pending = pending_actions.take(action_id, owner_email=email)
    if pending is None:
        raise HTTPException(status_code=404, detail=ACTION_UNAVAILABLE_DETAIL)
    sent: dict | None = None
    if isinstance(pending.action, SendMessageAction):
        # A1 — the one action the server executes itself, and it does so through the SAME chat
        # write path the Socket.IO handler uses (services/chat_send.py): the sender is the
        # bearer identity that owns the pending entry, the DM is upserted only now (never at
        # proposal time), and persistence, membership, unread and live fan-out are the chat
        # seam's — nothing is duplicated here. The audit line names who and to whom, never
        # the text.
        try:
            sent = await send_direct_message(
                db,
                sender_email=email,
                recipient_email=pending.action.recipient_email,
                text=pending.action.text,
            )
        except ChatSendError as err:
            raise HTTPException(status_code=409, detail=err.message) from err
        logger.info(
            "toucan action executed: owner=%s action=%s recipient=%s id=%s",
            email,
            pending.action.action,
            pending.action.recipient_email,
            pending.id,
        )
    else:
        # The audit line: who confirmed, which allowlisted action, with which validated args.
        # No secrets, no prompt, no free-form payload exists to leak.
        logger.info(
            "toucan action executed: owner=%s action=%s status=%s dnd_minutes=%s id=%s",
            email,
            pending.action.action,
            pending.action.status,
            pending.action.dnd_minutes,
            pending.id,
        )
    text = executed_text(pending.action)
    await _append_action_note(db, pending, email=email, text=text)
    return _action_result(pending, outcome="executed", text=text, sent=sent)


@router.post("/toucan/actions/{action_id}/cancel", response_model=ToucanActionResultOut)
async def cancel_toucan_action(
    action_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanActionResultOut:
    pending = pending_actions.cancel(action_id, owner_email=email)
    if pending is None:
        raise HTTPException(status_code=404, detail=ACTION_UNAVAILABLE_DETAIL)
    logger.info(
        "toucan action cancelled: owner=%s action=%s id=%s", email, pending.action.action, pending.id
    )
    text = cancelled_text(pending.action)
    await _append_action_note(db, pending, email=email, text=text)
    return _action_result(pending, outcome="cancelled", text=text)


@router.get("/toucan/activity", response_model=ToucanActivityOut)
async def get_toucan_activity(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanActivityOut:
    """The caller's own attention snapshot — the same numbers the deterministic "what did I
    miss" answer is worded from, as structured data.

    Exists so the counts are independently readable and testable without going through the
    wording layer, and so a future badge or panel affordance has a contract to call. It adds no
    new capability: the snapshot is built by exactly the same viewer-scoped repository call the
    ask path uses, and returns exactly the same nine scalars.

    NO PARAMETERS BY DESIGN. There is no `email`, no `since`, no window override — the caller is
    the bearer identity and the window is server-derived (see repositories/toucan_activity.py's
    attention_window). A caller therefore cannot widen their own window to sweep up history
    from before they were being tracked, nor name anybody else."""
    snapshot = await toucan_activity_repo.attention_snapshot(db, viewer_email=email)
    return ToucanActivityOut.from_dict(snapshot)


# --- T4: important memory --------------------------------------------------------------------
#
# The REST twins of the chat commands, and the contract T9's management UI will call. Ownership
# discipline is identical to conversations: the body has no identity field, every repository
# call filters on the bearer email, and someone else's memory id is a 404 — never a 403, so an
# id cannot be probed for existence.


@router.post("/toucan/memories", response_model=ToucanMemoryOut, status_code=201)
async def create_toucan_memory(
    body: ToucanMemoryIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanMemoryOut:
    row = await toucan_memory_repo.save_memory(
        db, owner_email=email, content=body.content, kind=body.kind
    )
    return ToucanMemoryOut.from_dict(row)


@router.get("/toucan/memories", response_model=list[ToucanMemoryOut])
async def list_toucan_memories(
    limit: int = Query(
        default=toucan_memory_repo.DEFAULT_MEMORIES_RETURNED,
        ge=1,
        le=toucan_memory_repo.MAX_MEMORIES_RETURNED,
    ),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[ToucanMemoryOut]:
    """The caller's own explicitly saved memories, newest first, bounded — the same rows and the
    same order the "What do you remember?" chat answer is worded from."""
    rows = await toucan_memory_repo.list_memories(db, owner_email=email, limit=limit)
    return [ToucanMemoryOut.from_dict(r) for r in rows]


@router.delete("/toucan/memories/{memory_id}", status_code=204)
async def delete_toucan_memory(
    memory_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """ID-addressed forget — the precise counterpart of the chat command's exact-content match.
    Hard delete, like conversations: a memory is only ever the user's own words, so there is
    nothing to retain once they ask for it gone."""
    deleted = await toucan_memory_repo.delete_memory(db, memory_id=memory_id, owner_email=email)
    if not deleted:
        raise HTTPException(status_code=404, detail=_MEMORY_NOT_FOUND)
    return Response(status_code=204)


# --- T4: resource references -----------------------------------------------------------------
#
# Metadata and references ONLY — the honest foundation for future file understanding (T7). The
# codebase has no object storage at T4, so there is no upload endpoint here and no content
# column behind these routes; `locator` records where a thing lives (a URL today, a storage key
# once the object-storage layer exists). See models/toucan.py's ToucanResource.


@router.post("/toucan/resources", response_model=ToucanResourceOut, status_code=201)
async def create_toucan_resource(
    body: ToucanResourceIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ToucanResourceOut:
    row = await toucan_resources_repo.create_resource(
        db,
        owner_email=email,
        display_name=body.display_name,
        locator=body.locator,
        media_type=body.media_type,
        conversation_id=body.conversation_id,
        memory_id=body.memory_id,
    )
    if row is None:
        # The optional conversation/memory link named something the caller does not own —
        # indistinguishable from something that does not exist, as everywhere in Toucan.
        raise HTTPException(status_code=404, detail=_RESOURCE_TARGET_NOT_FOUND)
    return ToucanResourceOut.from_dict(row)


@router.get("/toucan/resources", response_model=list[ToucanResourceOut])
async def list_toucan_resources(
    limit: int = Query(
        default=toucan_resources_repo.DEFAULT_RESOURCES_RETURNED,
        ge=1,
        le=toucan_resources_repo.MAX_RESOURCES_RETURNED,
    ),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[ToucanResourceOut]:
    rows = await toucan_resources_repo.list_resources(db, owner_email=email, limit=limit)
    return [ToucanResourceOut.from_dict(r) for r in rows]


@router.delete("/toucan/resources/{resource_id}", status_code=204)
async def delete_toucan_resource(
    resource_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> Response:
    deleted = await toucan_resources_repo.delete_resource(
        db, resource_id=resource_id, owner_email=email
    )
    if not deleted:
        raise HTTPException(status_code=404, detail=_RESOURCE_NOT_FOUND)
    return Response(status_code=204)
