from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PublicationOut(BaseModel):
    """One seasonal experience's state, for the Creator Studio.

    `implemented` is the honest half: it is why a season can be listed and still not be publishable,
    and it lets the Studio say "no decoration layer yet" instead of offering a button that 400s."""

    model_config = ConfigDict(populate_by_name=True)

    experience: str
    published: bool
    implemented: bool
    updated_by: str | None = Field(default=None, alias="updatedBy")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")


class ExperienceCatalogOut(BaseModel):
    """Wire shape for GET /office/experience — WHICH OFFICES THIS CALLER MAY OPEN.

    `available` is public. `previewable` is the Creator's private set and is `[]` for everyone else,
    so the response itself never reveals an unpublished season to an ordinary employee. `creator`
    is the one flag the UI gates on, and it comes from the server's own permission read."""

    model_config = ConfigDict(populate_by_name=True)

    available: list[str]
    previewable: list[str]
    default: str
    creator: bool
    publications: list[PublicationOut]


class PublicationIn(BaseModel):
    """Creator-only body for a publication change. Carries no identity and no experience name — the
    experience is in the path and the identity is the verified bearer token."""

    published: bool
    note: str | None = Field(default=None, max_length=255)


class DefaultIn(BaseModel):
    """Creator-only body for a company-default change. `experience` is validated server-side
    against what is actually available; the length bound here only keeps a hostile body small."""

    experience: str = Field(min_length=1, max_length=32)
