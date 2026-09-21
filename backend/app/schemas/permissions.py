from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class MyPermissionsOut(BaseModel):
    """Wire shape for GET /me/permissions — the caller's OWN capabilities and nothing else.

    `permissions` is the raw list of active capability names; `timelogExempt` is the one derived
    convenience flag the Executive Access Pass work needs, kept alongside the list rather than
    replacing it so a second capability does not need a second endpoint. Both describe the caller
    only: there is no shape here that can carry another employee's permissions."""

    model_config = ConfigDict(populate_by_name=True)

    email: str
    permissions: list[str]
    timelog_exempt: bool = Field(alias="timelogExempt")
