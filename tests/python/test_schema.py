"""HITL Protocol v0.7 — Schema Validation Tests (Python)."""

import json

import pytest
from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012


def make_validator(schema, form_field_schema):
    """Create a validator with form-field.json referenced."""
    resource = Resource.from_contents(form_field_schema, default_specification=DRAFT202012)
    registry = Registry().with_resources([
        ("form-field.json", resource),
        ("https://hitl-protocol.org/schemas/v0.7/form-field.json", resource),
    ])
    return Draft202012Validator(schema, registry=registry)


class TestHitlObjectSchema:
    """Validate hitl objects from examples against hitl-object.schema.json."""

    def test_examples_validate(self, hitl_schema, form_field_schema, example_files):
        validator = make_validator(hitl_schema, form_field_schema)
        for f in example_files:
            if "well-known" in f.name:
                continue
            data = json.loads(f.read_text())
            for step in data.get("steps", []):
                hitl = step.get("response", {}).get("body", {}).get("hitl")
                if hitl:
                    errors = list(validator.iter_errors(hitl))
                    assert not errors, f"{f.name}: {errors}"

    def test_rejects_empty(self, hitl_schema, form_field_schema):
        validator = make_validator(hitl_schema, form_field_schema)
        assert not validator.is_valid({})

    def test_rejects_invalid_spec_version(self, hitl_schema, form_field_schema):
        validator = make_validator(hitl_schema, form_field_schema)
        obj = {
            "spec_version": "1.0",
            "case_id": "test",
            "review_url": "https://example.com/review",
            "poll_url": "https://example.com/poll",
            "type": "selection",
            "prompt": "Test",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
        }
        assert not validator.is_valid(obj)

    def test_rejects_invalid_type(self, hitl_schema, form_field_schema):
        validator = make_validator(hitl_schema, form_field_schema)
        obj = {
            "spec_version": "0.7",
            "case_id": "test",
            "review_url": "https://example.com/review",
            "poll_url": "https://example.com/poll",
            "type": "unknown",
            "prompt": "Test",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
        }
        assert not validator.is_valid(obj)

    def test_accepts_custom_x_prefix_type(self, hitl_schema, form_field_schema):
        validator = make_validator(hitl_schema, form_field_schema)
        obj = {
            "spec_version": "0.7",
            "case_id": "test",
            "review_url": "https://example.com/review",
            "poll_url": "https://example.com/poll",
            "type": "x-custom",
            "prompt": "Test",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
        }
        assert validator.is_valid(obj)

    def test_minimal_valid(self, hitl_schema, form_field_schema):
        validator = make_validator(hitl_schema, form_field_schema)
        obj = {
            "spec_version": "0.7",
            "case_id": "review_123",
            "review_url": "https://example.com/review/123",
            "poll_url": "https://example.com/reviews/123/status",
            "type": "confirmation",
            "prompt": "Confirm",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
        }
        assert validator.is_valid(obj)


class TestPollResponseSchema:
    """Validate poll responses against poll-response.schema.json."""

    def test_pending(self, poll_schema):
        v = Draft202012Validator(poll_schema)
        assert v.is_valid({"status": "pending", "case_id": "r1", "created_at": "2026-01-01T00:00:00Z", "expires_at": "2026-01-02T00:00:00Z"})

    def test_completed_with_result(self, poll_schema):
        v = Draft202012Validator(poll_schema)
        assert v.is_valid({
            "status": "completed", "case_id": "r1",
            "created_at": "2026-01-01T00:00:00Z", "expires_at": "2026-01-02T00:00:00Z",
            "completed_at": "2026-01-01T12:00:00Z",
            "result": {"action": "select", "data": {"selected": ["a"]}},
            "responded_by": {"name": "Alice"},
        })

    def test_in_progress_with_progress(self, poll_schema):
        v = Draft202012Validator(poll_schema)
        assert v.is_valid({
            "status": "in_progress", "case_id": "r1",
            "created_at": "2026-01-01T00:00:00Z", "expires_at": "2026-01-02T00:00:00Z",
            "progress": {"current_step": 2, "total_steps": 3},
        })

    def test_rejects_invalid_status(self, poll_schema):
        v = Draft202012Validator(poll_schema)
        assert not v.is_valid({"status": "unknown", "case_id": "r1", "created_at": "2026-01-01T00:00:00Z", "expires_at": "2026-01-02T00:00:00Z"})

    def test_rejects_empty(self, poll_schema):
        v = Draft202012Validator(poll_schema)
        assert not v.is_valid({})

    def test_examples_validate(self, poll_schema, example_files):
        v = Draft202012Validator(poll_schema)
        for f in example_files:
            if "well-known" in f.name:
                continue
            data = json.loads(f.read_text())
            for step in data.get("steps", []):
                body = step.get("response", {}).get("body", {})
                if "status" in body and "case_id" in body and body.get("status") != "human_input_required":
                    errors = list(v.iter_errors(body))
                    assert not errors, f"{f.name}: {errors}"
