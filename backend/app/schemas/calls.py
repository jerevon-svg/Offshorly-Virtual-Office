from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Wire contract for POST /calls/token (see app/routers/calls.py).


class CallTokenIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # The ONLY thing the client is trusted to send. Identity is never accepted from the client —
    # it is derived server-side from the Atlas bearer token (get_current_email).
    session_id: str = Field(alias="sessionId")


class CallTokenOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # Deliberately narrow: url + token + room + identity, and nothing else. The API key/secret
    # that signed the token never appear in any response.
    url: str
    token: str
    room: str
    identity: str
