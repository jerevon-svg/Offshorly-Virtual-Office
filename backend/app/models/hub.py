from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class HubItem(BaseModel):
    """Company Hub content item (announcement/birthday/recognition/survey/whatsnew). No users
    table in this codebase — audience_email is a plain email string, same convention as
    ConversationRequest.requester_email. `audience_email = None` means visible to everyone."""

    __tablename__ = "hub_items"

    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    start_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    priority: Mapped[str] = mapped_column(String(10), nullable=False, server_default="normal", index=True)
    cta_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cta_action: Mapped[str | None] = mapped_column(String(255), nullable=True)
    audience_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    # Who a birthday/recognition item is ABOUT (distinct from audience_email, which is who SEES
    # the item — birthday/recognition items stay visible to everyone, audience_email=None, while
    # this field is read by the Hub->Feed wiring (see routers/hub.py's act_on_hub_item) to know
    # whose feed the "Wish Happy Birthday"/"Congratulate" action should post to. None for item
    # types that don't have a subject (announcement/survey/whatsnew).
    target_employee_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)


class HubItemState(BaseModel):
    """Per-employee seen/dismissed/acknowledged state for a HubItem, plus whether they performed
    the item's CTA action (persisted so Birthday/Recognition interactions can later feed the
    Employee Feed — see Company Hub V1 spec). One row per (hub_item, employee_email)."""

    __tablename__ = "hub_item_states"

    __table_args__ = (
        Index("uq_hub_item_state", "hub_item_id", "employee_email", unique=True),
    )

    hub_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("hub_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="seen")
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
