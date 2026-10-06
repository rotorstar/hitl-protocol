"""The state contract exercises the real FastAPI state machine."""
import pytest


def test_unopened_inline_completion_and_terminal_immutability(reference_server):
    rc = {"case_id": "state_contract", "status": "pending", "version": 1}
    reference_server.transition(rc, "completed")
    assert rc["status"] == "completed"
    assert "completed_at" in rc
    assert rc["version"] == 2
    for target in reference_server.VALID_TRANSITIONS:
        with pytest.raises(ValueError):
            reference_server.transition(rc, target)
    assert rc["version"] == 2
