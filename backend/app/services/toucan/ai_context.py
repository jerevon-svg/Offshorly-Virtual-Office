from __future__ import annotations

from app.services.toucan.context import OfficeContext, PersonView

# THE ONLY DOOR BETWEEN THE OFFICE AND THE AI PROVIDER (T6).
#
# Everything the model is allowed to know about the live office is what this module copies —
# field by field, from the already-allowlisted PersonView — into a small plain dict. The
# provider module (app/services/toucan_ai/provider.py) renders that dict into its prompt and
# NOTHING else: it is handed this projection, never an OfficeContext, never a registry, never a
# session. So the model's whole view of the office is reviewable in this one file, exactly the
# way Toucan's whole view of the registries is reviewable in context.py.
#
# DELIBERATELY IN THIS PACKAGE, not next to the provider: every static privacy test that sweeps
# services/toucan/ (tests/test_toucan_privacy.py) sweeps this file automatically — the forbidden
# field names, the forbidden imports, the storage-free rule and the network-free rule all apply
# here with no test change. The SDK-touching code lives outside the package for the same reason,
# so the sweep's "no provider in the deterministic surface" rule keeps meaning something.
#
# WHAT IS PROJECTED, PER PERSON: identity (email + display name — the same two-field Atlas
# allowlist as everywhere else), and the live-state booleans PersonView already carries. Raw
# floor coordinates are NOT projected — the deterministic wording never renders them at users,
# and neither may the model. Media/session identifiers are NOT projected: the model learns "in a
# call", never which call. And a person whose live state is unknown is projected as exactly
# that, so the model has nothing to convert into a fabricated "online".

# Display names come from an external directory and are ultimately human-typed text. The bound
# keeps a hostile or broken name from bloating the prompt; it is NOT the injection defence (that
# is the provider's data-not-instructions framing) — it is a token-cost bound.
_MAX_NAME_CHARS = 80


def _status(person: PersonView) -> str:
    """One word per person, and 'unknown' is a first-class value — the projection never turns
    the absence of evidence into a state."""
    if not person.live_state_known:
        return "unknown"
    if person.checked_out:
        return "checked_out"
    return "checked_in"


def _person_entry(person: PersonView) -> dict[str, object]:
    entry: dict[str, object] = {
        "email": person.email,
        "name": (person.display_name or "")[:_MAX_NAME_CHARS] or None,
        "status": _status(person),
    }
    # Live detail only for someone whose live state is actually known and who is here — a
    # roster-only or checked-out person gets identity and status, nothing else.
    if person.present:
        entry["room"] = person.room_id
        entry["in_call"] = person.in_call
        entry["in_conversation"] = person.in_conversation
        entry["dnd"] = person.dnd
        # True when we know they are somewhere on the floor without a room; coordinates
        # themselves are deliberately not part of the projection.
        entry["on_floor"] = person.position is not None and person.room_id is None
    return entry


def project_safe_context(ctx: OfficeContext, *, max_people: int) -> dict[str, object]:
    """The complete, bounded payload of office facts the AI provider may see.

    People with known live state come first, so truncation under `max_people` drops the
    roster-only tail (identities with nothing to say) before it drops anyone with live state.
    The viewer always survives truncation — "my own status" must never fall off the end.
    """
    viewer = ctx.viewer
    ranked = sorted(
        ctx.people,
        key=lambda p: (p.email != ctx.viewer_email, not p.live_state_known, p.email),
    )
    kept = ranked[:max_people]
    if viewer is not None and viewer not in kept:
        kept = [viewer, *kept][:max_people]

    return {
        "viewer_email": ctx.viewer_email,
        "directory_available": ctx.roster_available,
        "people": [_person_entry(p) for p in kept],
        "people_omitted": max(0, len(ctx.people) - len(kept)),
    }
