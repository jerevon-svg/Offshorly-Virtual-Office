from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings

# AUTHORITATIVE EMPLOYEE UNIVERSE for Toucan.
#
# WHY THIS EXISTS: the realtime registries only know people who have already *done* something
# this session (moved, entered a room, clustered, joined a call, set DND, checked out). A real
# colleague who is simply sitting still was invisible to Toucan, so "where is Angelo?" answered
# "I don't know anyone called angelo". This module supplies identity — and ONLY identity.
#
# AUTH: the caller's own Atlas bearer token is forwarded verbatim, so Atlas applies exactly the
# authorization it would apply to that person's own browser. There is no service account, no
# second credential, and no identity of any kind read from the request body. A caller with no
# bearer token (the hard-gated dev bypass) simply gets no roster — never a fallback credential.
#
# THIS IS THE ONLY MODULE IN THE TOUCAN FEATURE THAT MAKES AN OUTBOUND REQUEST, and it may only
# ever call the one endpoint below. tests/test_toucan_privacy.py enforces both.

_logger = logging.getLogger(__name__)

# Atlas's full-roster feed (frontend/src/services/office/types.ts :: FloorPerson).
ROSTER_PATH = "/api/v1/office/floor"

# Short by design: Toucan answers a chat message, so a slow roster must degrade to "identity
# unknown" quickly rather than hold the reply open.
ROSTER_TIMEOUT_SECONDS = 3.0


@dataclass(frozen=True)
class RosterPerson:
    """The COMPLETE set of Atlas fields Toucan is allowed to learn: a stable identity and a name
    to recognise it by. Nothing else from the response is read.

    ALLOWLIST, NOT DENYLIST. `_to_roster_person` names the two keys it wants and ignores the rest
    of the row, so a field Atlas adds later cannot arrive here by default. Atlas's FloorPerson
    also carries `last_message` (a Cliq message preview), `current_activity`, `status`,
    `job_title`, `department_name`, `team_room_id`, `current_room_id` and `source` — none of
    which are read, and the first two of which Toucan is explicitly forbidden to expose.

    `status` and `current_room_id` are deliberately NOT read even though they look useful:
    roster membership must never be turned into a claim about someone's live office state. That
    is the realtime registries' job (see context.PersonView.live_state_known).
    """

    email: str
    display_name: str | None


def _to_roster_person(row: object) -> RosterPerson | None:
    if not isinstance(row, dict):
        return None
    email = row.get("user_email")
    if not isinstance(email, str) or not email.strip():
        return None
    display_name = row.get("display_name")
    if not isinstance(display_name, str) or not display_name.strip():
        display_name = None
    return RosterPerson(email=email.strip().lower(), display_name=display_name)


async def fetch_roster(
    bearer_token: str | None, *, client: httpx.AsyncClient | None = None
) -> tuple[RosterPerson, ...]:
    """Fetch the authoritative employee list as the calling employee.

    NEVER RAISES. Every failure path — no token, Atlas down, non-2xx, malformed body — returns
    an empty tuple and logs server-side, so Toucan keeps answering every realtime-registry
    question it could answer before. Atlas's error text and the token itself never reach the
    caller; the user just sees a Toucan that doesn't recognise a name.

    `client` is injectable for tests, mirroring app/auth/atlas.py's verify_atlas_token.
    """
    if not bearer_token:
        return ()

    url = f"{settings.ATLAS_API_URL.rstrip('/')}{ROSTER_PATH}"
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=ROSTER_TIMEOUT_SECONDS)
    try:
        res = await http_client.get(url, headers={"Authorization": f"Bearer {bearer_token}"})
    except Exception as exc:  # noqa: BLE001 - any transport failure degrades to "no roster"
        _logger.warning("Toucan roster fetch failed: %s", type(exc).__name__)
        return ()
    finally:
        if owns_client:
            await http_client.aclose()

    if res.status_code < 200 or res.status_code >= 300:
        _logger.warning("Toucan roster fetch returned HTTP %s", res.status_code)
        return ()

    try:
        body = res.json()
    except ValueError:
        _logger.warning("Toucan roster response was not JSON")
        return ()

    if not isinstance(body, list):
        _logger.warning("Toucan roster response was not a list")
        return ()

    people = [person for person in (_to_roster_person(row) for row in body) if person is not None]
    # Deduplicate on email, keeping the first row that supplied a display name.
    by_email: dict[str, RosterPerson] = {}
    for person in people:
        existing = by_email.get(person.email)
        if existing is None or (existing.display_name is None and person.display_name):
            by_email[person.email] = person
    return tuple(by_email[email] for email in sorted(by_email))
