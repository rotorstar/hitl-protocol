"""Shared fixtures for HITL Protocol tests."""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent.parent


@pytest.fixture
def hitl_schema():
    return json.loads((ROOT / "schemas" / "hitl-object.schema.json").read_text())


@pytest.fixture
def poll_schema():
    return json.loads((ROOT / "schemas" / "poll-response.schema.json").read_text())


@pytest.fixture
def submit_request_schema():
    return json.loads((ROOT / "schemas" / "submit-request.schema.json").read_text())


@pytest.fixture
def form_field_schema():
    return json.loads((ROOT / "schemas" / "form-field.schema.json").read_text())


@pytest.fixture
def verification_policy_schema():
    return json.loads((ROOT / "schemas" / "verification-policy.schema.json").read_text())


@pytest.fixture
def verification_result_schema():
    return json.loads((ROOT / "schemas" / "verification-result.schema.json").read_text())


@pytest.fixture
def submission_context_schema():
    return json.loads((ROOT / "schemas" / "submission-context.schema.json").read_text())


@pytest.fixture
def discovery_schema():
    return json.loads((ROOT / "schemas" / "discovery-response.schema.json").read_text())


@pytest.fixture
def example_files():
    return sorted((ROOT / "examples").glob("*.json"))
