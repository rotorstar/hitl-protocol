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
def form_field_schema():
    return json.loads((ROOT / "schemas" / "form-field.schema.json").read_text())


@pytest.fixture
def example_files():
    return sorted((ROOT / "examples").glob("0[1-8]*.json"))
