"""HITL Protocol v0.5 — State Machine Tests (Python)."""

import pytest

VALID_TRANSITIONS = {
    "pending": ["opened", "expired", "cancelled"],
    "opened": ["in_progress", "completed", "expired", "cancelled"],
    "in_progress": ["completed", "expired", "cancelled"],
    "completed": [],
    "expired": [],
    "cancelled": [],
}


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in VALID_TRANSITIONS.get(from_status, [])


def transition(current: str, new: str) -> str:
    if not can_transition(current, new):
        raise ValueError(f"Invalid transition: {current} → {new}")
    return new


class TestValidTransitions:
    @pytest.mark.parametrize("from_s,to_s", [
        ("pending", "opened"),
        ("pending", "expired"),
        ("pending", "cancelled"),
        ("opened", "in_progress"),
        ("opened", "completed"),
        ("opened", "expired"),
        ("opened", "cancelled"),
        ("in_progress", "completed"),
        ("in_progress", "expired"),
        ("in_progress", "cancelled"),
    ])
    def test_valid(self, from_s, to_s):
        assert transition(from_s, to_s) == to_s


class TestInvalidTransitions:
    @pytest.mark.parametrize("from_s,to_s", [
        ("completed", "pending"),
        ("completed", "opened"),
        ("completed", "in_progress"),
        ("completed", "expired"),
        ("completed", "cancelled"),
        ("expired", "pending"),
        ("expired", "opened"),
        ("expired", "completed"),
        ("cancelled", "pending"),
        ("cancelled", "completed"),
        ("opened", "pending"),
        ("in_progress", "pending"),
        ("in_progress", "opened"),
        ("pending", "in_progress"),
        ("pending", "completed"),
    ])
    def test_invalid(self, from_s, to_s):
        with pytest.raises(ValueError, match="Invalid transition"):
            transition(from_s, to_s)


class TestTerminalStates:
    @pytest.mark.parametrize("state", ["completed", "expired", "cancelled"])
    def test_no_transitions(self, state):
        assert VALID_TRANSITIONS[state] == []
        for target in VALID_TRANSITIONS:
            assert not can_transition(state, target)


class TestHappyPaths:
    def test_simple_flow(self):
        s = "pending"
        s = transition(s, "opened")
        s = transition(s, "completed")
        assert s == "completed"

    def test_multi_step_flow(self):
        s = "pending"
        s = transition(s, "opened")
        s = transition(s, "in_progress")
        s = transition(s, "completed")
        assert s == "completed"

    def test_expired_before_opening(self):
        s = "pending"
        s = transition(s, "expired")
        assert s == "expired"

    def test_cancelled_during_progress(self):
        s = "pending"
        s = transition(s, "opened")
        s = transition(s, "in_progress")
        s = transition(s, "cancelled")
        assert s == "cancelled"


class TestCoverage:
    def test_six_states(self):
        assert len(VALID_TRANSITIONS) == 6

    def test_all_states(self):
        expected = {"pending", "opened", "in_progress", "completed", "expired", "cancelled"}
        assert set(VALID_TRANSITIONS.keys()) == expected
