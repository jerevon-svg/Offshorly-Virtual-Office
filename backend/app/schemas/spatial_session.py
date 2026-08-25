from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Wire shape for the `spatial_sessions` broadcast (see app/realtime/socket.py). Mirrors
# presence.py's OfflineLineup* pattern: the socket layer emits raw JSON-able dicts rather than
# model_dump()-ing these — kept here mainly as the documented/typed wire contract.


class SpatialSessionEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    members: list[str] = Field(default_factory=list)


class SpatialSessionsSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sessions: list[SpatialSessionEntry] = Field(default_factory=list)
