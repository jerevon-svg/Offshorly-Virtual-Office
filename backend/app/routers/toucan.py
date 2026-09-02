from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.auth.deps import bearer_token_from_request, get_current_email
from app.schemas.toucan import ToucanAnswerOut, ToucanAskIn
from app.services.toucan.context import build_office_context
from app.services.toucan.office_assistant import answer_question

# Toucan assistant REST layer.
#
# T0 SCOPE, stated as what this module does NOT have:
#   * no AI provider, no SDK, no API key. The one outbound call is the Atlas roster read in
#     services/toucan/roster.py, made with the CALLER'S OWN bearer token
#   * no `db: AsyncSession = Depends(get_db)` — Toucan touches no table and needs no migration
#   * no Socket.IO emit, so nothing here enters the realtime fan-out that
#     docs/realtime-scaling-roadmap.md's R4/R5 would have to make cross-worker
#   * no persisted activity history
#
# IDENTITY: `email` comes from get_current_email (bearer token verified against Atlas, or the
# hard-gated dev bypass) and is the ONLY source of caller identity. It is what scopes the
# context; the request body has no identity field and forbids extras (see schemas/toucan.py).
#
# TOKEN FORWARDING: the raw bearer is read from the REQUEST HEADER — never the body — and is
# used solely as a forwarded credential for the roster fetch, so Atlas applies the same
# authorization it would apply to this person's own browser. It is not an identity source:
# `email` above is derived by verifying that token, not by trusting it. A caller on the dev
# bypass has no token, so they simply get no roster.

router = APIRouter(tags=["toucan"])


@router.post("/toucan/ask", response_model=ToucanAnswerOut)
async def ask_toucan(
    request: Request,
    body: ToucanAskIn,
    email: str = Depends(get_current_email),
) -> ToucanAnswerOut:
    """Answer one live-office question for the authenticated caller.

    Three steps, in this order, and the order is the privacy boundary: derive identity, build a
    caller-scoped context out of the allowlisted fields in services/toucan/context.py (Atlas
    identity + realtime state, merged there and only there), then word an answer in
    services/toucan/office_assistant.py. Nothing reaches the wording layer that did not pass
    through the context layer first.
    """
    context = await build_office_context(email, bearer_token=bearer_token_from_request(request))
    answer = answer_question(body.question, context)
    return ToucanAnswerOut(text=answer.text, intent=answer.intent, supported=answer.supported)
