from __future__ import annotations

from app.services.dnd_registry import DndRegistry


def test_set_dnd_true_adds_and_reports_changed():
    registry = DndRegistry()
    changed = registry.set_dnd("a@example.com", True)

    assert changed is True
    assert registry.is_dnd("a@example.com") is True
    assert registry.snapshot() == ["a@example.com"]


def test_set_dnd_true_twice_is_idempotent_and_reports_unchanged():
    registry = DndRegistry()
    registry.set_dnd("a@example.com", True)
    changed = registry.set_dnd("a@example.com", True)

    assert changed is False
    assert registry.snapshot() == ["a@example.com"]


def test_set_dnd_false_removes_and_reports_changed():
    registry = DndRegistry()
    registry.set_dnd("a@example.com", True)
    changed = registry.set_dnd("a@example.com", False)

    assert changed is True
    assert registry.is_dnd("a@example.com") is False
    assert registry.snapshot() == []


def test_set_dnd_false_for_absent_email_reports_unchanged():
    registry = DndRegistry()
    changed = registry.set_dnd("a@example.com", False)

    assert changed is False


def test_clear_removes_unconditionally():
    registry = DndRegistry()
    registry.set_dnd("a@example.com", True)

    assert registry.clear("a@example.com") is True
    assert registry.is_dnd("a@example.com") is False
    assert registry.clear("a@example.com") is False


def test_snapshot_ordering_is_stable():
    registry = DndRegistry()
    registry.set_dnd("b@example.com", True)
    registry.set_dnd("a@example.com", True)

    assert registry.snapshot() == ["a@example.com", "b@example.com"]
