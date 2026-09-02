from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import bearer_token_from_request, get_current_email
from app.database import get_db
from app.repositories import toucan as toucan_repo
from app.schemas.toucan import (
    ToucanAnswerOut,
    ToucanAskIn,
    ToucanConversationDetailOut,
    ToucanConversationOut,
)
from app.services.toucan.context import build_office_context
from app.services.toucan.office_assistant import answer_question

# Toucan assistant REST layer.
#
# SCOPE, stated as what this module does NOT have (T1 changes exactly one line of this list —
# the database one — and nothing else):
#   * no AI provider, no SDK, no API key. The one outbound call is the Atlas roster read in
#     services/toucan/roster.py, made with the CALLER'S OWN bearer token
#   * NEW IN T1: a database, but only for the transcript. Two tables (see models/toucan.py),
#     holding the user's own questions and the assistant's own answers. No office context
#     snapshot, no roster rows, no registry state, no token is ever written down
#   * no Socket.IO emit, so nothing here enters the realtime fan-out that
#     docs/realtime-scaling-roadmap.md's R4/R5 would have to make cross-worker. A Toucan
#     conversation has exactly one reader — its owner — so there is nobody to fan out to
#   * no persisted activity history, no "while you were away", no extracted memory
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

router = APIRouter(tags=["toucan"])

_CONVERSATION_NOT_FOUND = "Conversation not found"


@router.post("/toucan/ask", response_model=ToucanAnswerOut)
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

    context = await build_office_context(email, bearer_token=bearer_token_from_request(request))
    answer = answer_question(body.question, context)

    await toucan_repo.append_exchange(
        db, conversation=conversation, question=body.question, answer=answer.text
    )

    return ToucanAnswerOut(
        text=answer.text,
        intent=answer.intent,
        supported=answer.supported,
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
