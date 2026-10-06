"""Shared fixtures for HITL Protocol tests."""

import json
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent.parent
SCHEMAS = ROOT / "schemas" / "v0.8"


@pytest.fixture
def hitl_schema():
    return json.loads((SCHEMAS / "hitl-object.schema.json").read_text())


@pytest.fixture
def poll_schema():
    return json.loads((SCHEMAS / "poll-response.schema.json").read_text())


@pytest.fixture
def submit_request_schema():
    return json.loads((SCHEMAS / "submit-request.schema.json").read_text())


@pytest.fixture
def form_field_schema():
    return json.loads((SCHEMAS / "form-field.schema.json").read_text())


@pytest.fixture
def verification_policy_schema():
    return json.loads((SCHEMAS / "verification-policy.schema.json").read_text())


@pytest.fixture
def verification_result_schema():
    return json.loads((SCHEMAS / "verification-result.schema.json").read_text())


@pytest.fixture
def submission_context_schema():
    return json.loads((SCHEMAS / "submission-context.schema.json").read_text())


@pytest.fixture
def discovery_schema():
    return json.loads((SCHEMAS / "discovery-response.schema.json").read_text())


@pytest.fixture
def example_files():
    return sorted((ROOT / "examples").glob("*.json"))


@pytest.fixture(scope="session")
def reference_server():
    spec = importlib.util.spec_from_file_location("hitl_fastapi_reference", ROOT / "implementations" / "reference-service" / "python" / "server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
