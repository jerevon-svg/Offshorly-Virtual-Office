from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Sequence

# W5-C — Toucan Whiteboard Context V1. A PURE projection of ONE whiteboard's stored document into
# the bounded, text-only facts Toucan may see, plus the deterministic answer used when no AI
# provider is available. Same rules as ai_context.py: this module reads dicts it is handed and
# imports no repository, registry, database or auth (asserted by tests/test_toucan_privacy.py).
#
# WHAT GETS IN: the text of Excalidraw `text` elements — free-standing text, and the label text
# bound to a container (that is what a sticky note is: a rectangle plus a bound text element).
# Deleted elements are skipped. Items are read top-to-bottom, left-to-right.
# WHAT NEVER GETS IN: element geometry, ids, colours, files/images, appState, and anything that is
# not part of the persisted document at all — cursor chat, pointers and the voice flag live only in
# realtime presence and have no field here. Collaborator NAMES (not sids, not pointers, not voice
# state) may be supplied by the router when they help ("who is working on this board").
#
# Toucan is READ-ONLY to the board in W5-C: nothing here produces or accepts an element.

BOARD_CONTEXT_MAX_CHARS = 4000
BOARD_ITEM_MAX_CHARS = 300
BOARD_TITLE_MAX_CHARS = 120
MAX_COLLABORATORS = 12
BOARD_INTENT = "whiteboard_context"

_WS = re.compile(r"\s+")


@dataclass(frozen=True)
class BoardItem:
    kind: str  # "note" (text bound to a sticky-note container) | "text" (free-standing text)
    text: str


@dataclass(frozen=True)
class BoardContext:
    board_id: str
    title: str
    scope: str  # "conversation" | "room"
    items: tuple[BoardItem, ...]
    items_omitted: int
    collaborators: tuple[str, ...]

    def as_payload(self) -> dict[str, object]:
        """The exact JSON the provider sees — text only."""
        return {
            "title": self.title,
            "scope": self.scope,
            "items": [{"kind": i.kind, "text": i.text} for i in self.items],
            "items_omitted": self.items_omitted,
            "collaborators_now": list(self.collaborators),
        }


def _clean(text: str) -> str:
    return _WS.sub(" ", text).strip()


def _number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def extract_board_items(document: Any) -> list[BoardItem]:
    """Every non-deleted text element's text, in reading order. Anything that is not an
    Excalidraw document (None, the previous editor's format, junk) yields no items."""
    if not isinstance(document, dict):
        return []
    elements = document.get("elements")
    if not isinstance(elements, list):
        return []
    ordered: list[tuple[float, float, BoardItem]] = []
    for element in elements:
        if not isinstance(element, dict) or element.get("isDeleted"):
            continue
        if element.get("type") != "text":
            continue
        text = element.get("text")
        if not isinstance(text, str):
            continue
        cleaned = _clean(text)
        if not cleaned:
            continue
        kind = "note" if element.get("containerId") else "text"
        ordered.append((_number(element.get("y")), _number(element.get("x")), BoardItem(kind, cleaned)))
    ordered.sort(key=lambda row: (row[0], row[1]))
    return [item for _, _, item in ordered]


def build_board_context(
    board: dict[str, Any], *, collaborators: Sequence[str] = ()
) -> BoardContext:
    """Bound the board to ~BOARD_CONTEXT_MAX_CHARS of text: each item is clipped, and items past
    the budget are counted in `items_omitted` rather than silently dropped, so the answer can
    say "and N more" instead of pretending the board ends there."""
    title = _clean(str(board.get("title") or "Untitled board"))[:BOARD_TITLE_MAX_CHARS]
    scope = "conversation" if board.get("conversation_id") else "room"
    names = tuple(dict.fromkeys(_clean(n) for n in collaborators if _clean(n)))[:MAX_COLLABORATORS]

    kept: list[BoardItem] = []
    used = len(title) + sum(len(n) for n in names)
    omitted = 0
    for item in extract_board_items(board.get("document")):
        text = item.text if len(item.text) <= BOARD_ITEM_MAX_CHARS else item.text[: BOARD_ITEM_MAX_CHARS - 1] + "…"
        if used + len(text) > BOARD_CONTEXT_MAX_CHARS:
            omitted += 1
            continue
        used += len(text)
        kept.append(BoardItem(item.kind, text))
    return BoardContext(
        board_id=str(board.get("id", "")),
        title=title,
        scope=scope,
        items=tuple(kept),
        items_omitted=omitted,
        collaborators=names,
    )


def board_fallback_answer(ctx: BoardContext) -> str:
    """Deterministic answer when no provider is available: what the board says, verbatim and
    bounded. No interpretation is attempted — that is the provider's job."""
    if not ctx.items:
        who = f" {_join(ctx.collaborators)} {'is' if len(ctx.collaborators) == 1 else 'are'} on it right now." if ctx.collaborators else ""
        return f"“{ctx.title}” has no text or sticky notes yet, so there is nothing for me to summarise.{who}"
    lines = [f"Here is what is on “{ctx.title}” ({len(ctx.items)} item{'s' if len(ctx.items) != 1 else ''}):"]
    for item in ctx.items[:25]:
        lines.append(f"• {item.text}" if item.kind == "text" else f"• 📝 {item.text}")
    remaining = ctx.items_omitted + max(0, len(ctx.items) - 25)
    if remaining:
        lines.append(f"…and {remaining} more.")
    if ctx.collaborators:
        lines.append(f"On the board right now: {_join(ctx.collaborators)}.")
    lines.append("I can only read the board — I can't add or change anything on it.")
    return "\n".join(lines)


def _join(names: Sequence[str]) -> str:
    names = list(names)
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]
