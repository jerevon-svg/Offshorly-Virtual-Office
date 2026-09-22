from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# THE OFFICE EXPERIENCE VOCABULARY AND ITS PERSISTENT STATE (Phase 9A).
#
# An "office experience" is WHICH OFFICE an employee opens. Two of them are permanent and two are
# seasonal decorations of the SAME 3D world — not separate applications, not new geometry.
#
# THREE FACTS ABOUT AN EXPERIENCE, AND THEY ARE DELIBERATELY DIFFERENT THINGS:
#
#   KNOWN        this build recognises the identifier at all. An unknown identifier is a typo or a
#                tampered request and is refused at the edge, never stored.
#   IMPLEMENTED  a decoration layer for it actually exists in the deployed frontend. This is a
#                property of the CODE, so it lives here as a constant rather than in a row — a
#                database row cannot conjure geometry that was never shipped.
#   PUBLISHED    the Creator has turned it on for the company. This is a decision, so it lives in a
#                row (OfficeExperiencePublication) and changes without a deploy.
#
# Publishing something that is not IMPLEMENTED is refused (see repositories/office_experience.py):
# it would advertise an office that renders as the ordinary 3D one, which is exactly the "a card
# that promises a place that does not exist" failure the gallery was built to avoid.
#
# HOW A SEASON BECOMES PUBLISHABLE LATER, with no backend redesign: its decoration layer ships in
# the frontend, its identifier moves into IMPLEMENTED_EXPERIENCES below, and that deploy is the
# whole change. No migration, no new table, no new endpoint — the publication row and the default
# setting already exist and already mean what they will mean then.

#: The ordinary 3D office. Permanently available and the fallback for everything.
EXPERIENCE_V2 = "v2"
#: V1's original top-down floor. Permanently available — it is a place somebody may simply prefer.
EXPERIENCE_CLASSIC = "classic"
EXPERIENCE_HALLOWEEN = "halloween"
EXPERIENCE_CHRISTMAS = "christmas"

#: Always available to every employee, never publishable and never unpublishable. A request to
#: change the publication of one of these is refused rather than silently ignored, because
#: "unpublish Classic" is a mistake and answering 200 to it would hide the mistake.
PERMANENT_EXPERIENCES: tuple[str, ...] = (EXPERIENCE_V2, EXPERIENCE_CLASSIC)

#: The seasonal experiences this build has identifiers for. Being here is NOT permission to publish
#: — see IMPLEMENTED_EXPERIENCES.
SEASONAL_EXPERIENCES: tuple[str, ...] = (EXPERIENCE_HALLOWEEN, EXPERIENCE_CHRISTMAS)

#: Every identifier this build recognises.
KNOWN_EXPERIENCES: tuple[str, ...] = PERMANENT_EXPERIENCES + SEASONAL_EXPERIENCES

#: THE IMPLEMENTATION GATE. An experience is in here only once a real decoration layer for it
#: exists in the shipped frontend. Phase 9A ships the foundation and NO decoration, so the seasonal
#: identifiers are deliberately absent: they can be neither published, previewed nor selected, and
#: the server says so rather than the client deciding.
#:
#: ADDING A SEASON HERE IS THE ENTIRE BACKEND CHANGE that makes it publishable.
#:
#: HALLOWEEN JOINED IN PHASE 9B, once its decoration layer actually shipped in the frontend
#: (frontend/src/dev/vo3d/season/) — the grade, the builders, the placement rules and the layer's
#: attach/dispose. Being here does NOT publish it: it means a Creator may now preview it privately and
#: may choose to publish it. Nothing is published by this change.
#:
#: CHRISTMAS IS DELIBERATELY STILL ABSENT. Its decoration layer does not exist.
IMPLEMENTED_EXPERIENCES: frozenset[str] = frozenset({*PERMANENT_EXPERIENCES, EXPERIENCE_HALLOWEEN})

#: The company-wide default, as a key in `company_settings`. One key, one row, one meaning.
SETTING_DEFAULT_EXPERIENCE = "office_experience.default"

#: What the company default is when nobody has ever set one. Also what unpublishing the current
#: default falls back to, atomically, in the same transaction (see the repository).
DEFAULT_EXPERIENCE = EXPERIENCE_V2


class OfficeExperiencePublication(Base):
    """Whether one seasonal experience is published, and who last decided that.

    ONE ROW PER EXPERIENCE, not a JSON blob of them all, for the same reason EmployeePermission is
    one row per granted capability: the row is the audit record. `updated_by` / `updated_at` answer
    "who turned Halloween on, and when" after the fact, and a blob would overwrite that history
    every time any experience changed.

    ABSENT MEANS UNPUBLISHED. A seasonal experience with no row has never been published, which is
    the same state as a row with `published = False` — so a read never has to distinguish them and
    the table starts empty. Nothing seeds it.

    THE PERMANENT EXPERIENCES ARE NOT IN HERE AT ALL. "v2" and "classic" are available by
    construction; giving them a row would create a state in which they could be switched off."""

    __tablename__ = "office_experience_publications"

    #: One of SEASONAL_EXPERIENCES. Validated by the repository before any write.
    experience: Mapped[str] = mapped_column(String(32), primary_key=True)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: The Creator who last changed this, from the verified bearer identity — never a request body.
    updated_by: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: Free-text reason for the audit trail. Optional.
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)


class CompanySetting(Base):
    """A single company-wide setting: one key, one value, and who last wrote it.

    Phase 9A needs exactly one — SETTING_DEFAULT_EXPERIENCE — and a purpose-built
    `office_experience_default` table would have been a table per setting forever. A narrow key /
    value pair with attribution is the smallest thing that does not need replacing the next time
    the company has to remember one fact about itself.

    DELIBERATELY NOT A GENERIC CONFIG STORE. The value is a short string, there is no type system
    over it, and every key that exists has a named constant and a validating repository function in
    front of it. Nothing writes a key this build does not know about."""

    __tablename__ = "company_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The Creator who last changed it, from the verified bearer identity.
    updated_by: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
