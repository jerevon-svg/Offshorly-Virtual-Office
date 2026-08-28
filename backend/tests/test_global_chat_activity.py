from app.services.global_chat_activity import GlobalChatActivityRegistry


def test_first_active_socket_flips_email_active_and_reports_changed():
    reg = GlobalChatActivityRegistry()
    assert reg.set_active("a@example.com", "sid1", True) is True
    assert reg.is_active("a@example.com") is True
    assert reg.snapshot() == ["a@example.com"]


def test_second_socket_of_same_email_does_not_report_changed():
    reg = GlobalChatActivityRegistry()
    reg.set_active("a@example.com", "sid1", True)
    assert reg.set_active("a@example.com", "sid2", True) is False
    assert reg.snapshot() == ["a@example.com"]


def test_one_socket_going_inactive_keeps_email_active_while_another_is_active():
    reg = GlobalChatActivityRegistry()
    reg.set_active("a@example.com", "sid1", True)
    reg.set_active("a@example.com", "sid2", True)
    assert reg.set_active("a@example.com", "sid1", False) is False
    assert reg.is_active("a@example.com") is True


def test_last_socket_going_inactive_flips_email_inactive_and_reports_changed():
    reg = GlobalChatActivityRegistry()
    reg.set_active("a@example.com", "sid1", True)
    reg.set_active("a@example.com", "sid2", True)
    reg.set_active("a@example.com", "sid1", False)
    assert reg.set_active("a@example.com", "sid2", False) is True
    assert reg.is_active("a@example.com") is False
    assert reg.snapshot() == []


def test_clear_sid_on_disconnect_only_flips_when_it_was_the_last_active_socket():
    reg = GlobalChatActivityRegistry()
    reg.set_active("a@example.com", "sid1", True)
    reg.set_active("a@example.com", "sid2", True)
    assert reg.clear_sid("a@example.com", "sid1") is False
    assert reg.is_active("a@example.com") is True
    assert reg.clear_sid("a@example.com", "sid2") is True
    assert reg.is_active("a@example.com") is False


def test_inactive_for_unknown_email_or_sid_is_a_noop():
    reg = GlobalChatActivityRegistry()
    assert reg.set_active("a@example.com", "sid1", False) is False
    assert reg.clear_sid("a@example.com", "sid9") is False
    reg.set_active("a@example.com", "sid1", True)
    assert reg.set_active("a@example.com", "other-sid", False) is False
    assert reg.is_active("a@example.com") is True


def test_emails_are_normalized_consistently():
    reg = GlobalChatActivityRegistry()
    reg.set_active("  A@Example.COM ", "sid1", True)
    assert reg.is_active("a@example.com") is True
    assert reg.snapshot() == ["a@example.com"]
    assert reg.clear_sid("a@example.com", "sid1") is True


def test_snapshot_is_sorted_and_only_lists_active_emails():
    reg = GlobalChatActivityRegistry()
    reg.set_active("b@example.com", "s1", True)
    reg.set_active("a@example.com", "s2", True)
    reg.set_active("c@example.com", "s3", True)
    reg.set_active("c@example.com", "s3", False)
    assert reg.snapshot() == ["a@example.com", "b@example.com"]
