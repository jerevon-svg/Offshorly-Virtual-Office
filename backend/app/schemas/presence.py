from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Wire shape for the `offline_lineup` broadcast (see app/realtime/socket.py and
# frontend/src/services/presence/offlineLineupClient.ts). Mirrors serialize_message_dict's
# plain-dict-emit pattern in app/schemas/chat.py: the socket layer emits raw JSON-able dicts
# rather than model_dump()-ing these — kept here mainly as the documented/typed wire contract.


class OfflineLineupEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    slot: int


class OfflineLineupSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    entries: list[OfflineLineupEntry] = Field(default_factory=list)
