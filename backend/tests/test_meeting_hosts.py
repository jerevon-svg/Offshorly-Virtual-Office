"""PHASE 7D — host ownership for standalone meetings.

The invariant under test is one sentence: a meeting has a host IFF it has participants. Everything the
Cave promises — Start on an empty room, Join on a live one, transfer on the host leaving, and the
meeting ending when the last person goes — is that one rule seen from different angles.
"""
from app.services.meeting_hosts import MeetingHostRegistry

KEY = "meeting:cave-all-hands"
A = "angelo@offshorly.com"
B = "bon@offshorly.com"
C = "micah@offshorly.com"


def test_first_joiner_hosts_an_empty_meeting():
    hosts = MeetingHostRegistry()
    assert hosts.host_of(KEY) is None
    assert hosts.ensure_host(KEY, A) == A
    assert hosts.host_of(KEY) == A


def test_a_later_arrival_does_not_displace_the_host():
    hosts = MeetingHostRegistry()
    hosts.ensure_host(KEY, A)
    assert hosts.ensure_host(KEY, B) == A
    assert hosts.ensure_host(KEY, C) == A
    assert hosts.host_of(KEY) == A


def test_simultaneous_joins_into_an_empty_room_yield_exactly_one_host():
    # Two handlers, each running its synchronous block to completion — the second necessarily
    # observes the first's host. This is the assertion the atomicity argument in the module reduces to.
    hosts = MeetingHostRegistry()
    first = hosts.ensure_host(KEY, A)
    second = hosts.ensure_host(KEY, B)
    assert first == second == A


def test_host_leaving_transfers_to_the_longest_present_and_not_the_alphabetical_first():
    hosts = MeetingHostRegistry()
    hosts.ensure_host(KEY, C)  # micah hosts
    # Arrival order: micah, bon, angelo. Angelo sorts FIRST alphabetically and must not win.
    assert hosts.release(KEY, [B, A]) == B
    assert hosts.host_of(KEY) == B


def test_a_non_host_leaving_changes_nothing():
    hosts = MeetingHostRegistry()
    hosts.ensure_host(KEY, A)
    assert hosts.release(KEY, [A, C]) == A


def test_the_host_closing_one_of_two_tabs_does_not_transfer():
    # Tabs are not membership: the registry still reports the host as present, so release is a no-op.
    hosts = MeetingHostRegistry()
    hosts.ensure_host(KEY, A)
    assert hosts.release(KEY, [A, B]) == A


def test_the_last_participant_leaving_ends_the_meeting():
    hosts = MeetingHostRegistry()
    hosts.ensure_host(KEY, A)
    assert hosts.release(KEY, []) is None
    assert hosts.host_of(KEY) is None
    # And the next person in starts a NEW meeting, hosting it themselves.
    assert hosts.ensure_host(KEY, B) == B


def test_two_meetings_do_not_share_a_host():
    hosts = MeetingHostRegistry()
    other = "meeting:all-hands"
    hosts.ensure_host(KEY, A)
    hosts.ensure_host(other, B)
    assert hosts.host_of(KEY) == A
    assert hosts.host_of(other) == B
    hosts.release(KEY, [])
    assert hosts.host_of(other) == B


def test_emails_are_normalised_both_ways():
    hosts = MeetingHostRegistry()
    assert hosts.ensure_host(KEY, "  Angelo@Offshorly.com ") == A
    assert hosts.release(KEY, ["  Angelo@Offshorly.com "]) == A
