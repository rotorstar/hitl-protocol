"""HITL Protocol v0.8 — Schema validation tests (Python)."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).parent.parent.parent


def make_resource(schema):
    return Resource.from_contents(schema, default_specification=DRAFT202012)


def make_registry(
    form_field_schema,
    verification_policy_schema,
    verification_result_schema,
    submission_context_schema,
):
    form_field = make_resource(form_field_schema)
    verification_policy = make_resource(verification_policy_schema)
    verification_result = make_resource(verification_result_schema)
    submission_context = make_resource(submission_context_schema)

    return Registry().with_resources(
        [
            ("form-field.json", form_field),
            ("https://hitl-protocol.org/schemas/v0.8/form-field.json", form_field),
            ("verification-policy.schema.json", verification_policy),
            ("https://hitl-protocol.org/schemas/v0.8/verification-policy.json", verification_policy),
            ("verification-result.schema.json", verification_result),
            ("https://hitl-protocol.org/schemas/v0.8/verification-result.json", verification_result),
            ("submission-context.schema.json", submission_context),
            ("https://hitl-protocol.org/schemas/v0.8/submission-context.json", submission_context),
        ]
    )


def make_validator(schema, registry):
    return Draft202012Validator(schema, registry=registry)


def collect_submit_requests(example):
    requests = []

    for step in example.get("steps", []):
        request = step.get("request", {})
        if isinstance(request.get("url"), str) and "/submit" in request["url"]:
            requests.append(request.get("body"))

        alt_request = step.get("alternative_request", {})
        if isinstance(alt_request.get("url"), str) and "/submit" in alt_request["url"]:
            requests.append(alt_request.get("body"))

    return [request for request in requests if request]


class TestHitlObjectSchema:
    """Validate HITL objects from examples against hitl-object.schema.json."""

    def test_examples_validate(
        self,
        hitl_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
        example_files,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(hitl_schema, registry)

        for example_file in example_files:
            if "well-known" in example_file.name:
                continue

            data = json.loads(example_file.read_text())
            for step in data.get("steps", []):
                hitl = step.get("response", {}).get("body", {}).get("hitl")
                if hitl:
                    errors = list(validator.iter_errors(hitl))
                    assert not errors, f"{example_file.name}: {errors}"

    def test_rejects_empty(
        self,
        hitl_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(hitl_schema, registry)
        assert not validator.is_valid({})
        assert not validator.is_valid({"spec_version": "0.8"})

    def test_accepts_minimal_v08(
        self,
        hitl_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(hitl_schema, registry)
        obj = {
            "spec_version": "0.8",
            "case_id": "review_123",
            "review_url": "https://example.com/review/123",
            "poll_url": "https://example.com/reviews/123/status",
            "type": "confirmation",
            "prompt": "Confirm",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
        }
        assert validator.is_valid(obj)

    def test_accepts_verification_policy(
        self,
        hitl_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(hitl_schema, registry)
        obj = {
            "spec_version": "0.8",
            "case_id": "review_proof",
            "review_url": "https://example.com/review/proof",
            "poll_url": "https://example.com/reviews/proof/status",
            "type": "confirmation",
            "prompt": "Confirm",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
            "verification_policy": {
                "mode": "required",
                "required_for": ["inline_submit"],
                "requirements": {
                    "any_of": [
                        {
                            "all_of": [
                                {
                                    "proof_type": "proof_of_human",
                                    "provider": "world_id",
                                    "min_assurance": "high",
                                }
                            ]
                        }
                    ]
                },
                "binding": {
                    "case_id": True,
                    "action": True,
                    "challenge": "opaque-nonce",
                    "freshness_seconds": 300,
                    "single_use": True,
                },
                "fallback": {
                    "on_missing": "browser_review",
                    "on_invalid": "browser_review",
                },
            },
        }
        assert validator.is_valid(obj)

    def test_rejects_invalid_spec_version(
        self,
        hitl_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(hitl_schema, registry)
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

    def test_rejects_non_https_for_non_local_hosts(
        self,
        hitl_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(hitl_schema, registry)
        obj = {
            "spec_version": "0.8",
            "case_id": "review_http",
            "review_url": "http://example.com/review/http?token=abc",
            "poll_url": "http://api.example.com/reviews/http/status",
            "type": "selection",
            "prompt": "Test",
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": "2026-01-02T00:00:00Z",
        }
        assert not validator.is_valid(obj)


class TestSubmitRequestSchema:
    """Validate inline submit requests against submit-request.schema.json."""

    def test_basic_submit(self, submit_request_schema):
        validator = Draft202012Validator(submit_request_schema)
        assert validator.is_valid(
            {
                "action": "confirm",
                "submitted_via": "telegram_inline_button",
                "submitted_by": {
                    "platform": "telegram",
                    "platform_user_id": "12345",
                    "display_name": "Alice",
                },
            }
        )

    def test_submit_with_verification_evidence(self, submit_request_schema):
        validator = Draft202012Validator(submit_request_schema)
        assert validator.is_valid(
            {
                "action": "confirm",
                "data": {},
                "submitted_via": "telegram_inline_button",
                "submitted_by": {
                    "platform": "telegram",
                    "platform_user_id": "12345",
                    "display_name": "Alice",
                },
                "verification_evidence": [
                    {
                        "proof_type": "proof_of_human",
                        "provider": "world_id",
                        "format": "provider_opaque",
                        "presentation": {"proof": "<opaque-provider-payload>"},
                        "binding": {
                            "case_id": "review_123",
                            "action": "confirm",
                            "challenge": "opaque-nonce",
                        },
                    }
                ],
            }
        )

    def test_rejects_missing_fields(self, submit_request_schema):
        validator = Draft202012Validator(submit_request_schema)
        assert not validator.is_valid({"action": "confirm"})

    def test_examples_validate(self, submit_request_schema, example_files):
        validator = Draft202012Validator(submit_request_schema)
        for example_file in example_files:
            if "well-known" in example_file.name:
                continue

            data = json.loads(example_file.read_text())
            for request_body in collect_submit_requests(data):
                errors = list(validator.iter_errors(request_body))
                assert not errors, f"{example_file.name}: {errors}"


class TestPollResponseSchema:
    """Validate poll responses against poll-response.schema.json."""

    def test_pending(
        self,
        poll_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(poll_schema, registry)
        assert validator.is_valid(
            {
                "status": "pending",
                "case_id": "r1",
                "created_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
            }
        )

    def test_completed_with_normalized_submission_context(
        self,
        poll_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(poll_schema, registry)
        assert validator.is_valid(
            {
                "status": "completed",
                "case_id": "r1",
                "created_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
                "completed_at": "2026-01-01T12:00:00Z",
                "result": {"action": "select", "data": {"selected": ["a"]}},
                "responded_by": {"name": "Alice"},
                "submission_context": {
                    "mode": "browser_submit",
                    "verification_result": {
                        "satisfied": True,
                        "verified_evidence": [
                            {
                                "proof_type": "proof_of_human",
                                "provider": "world_id",
                                "assurance_level": "high",
                                "bound_to_case": True,
                                "bound_to_action": True,
                                "fresh": True,
                                "single_use_enforced": True,
                            }
                        ],
                        "missing_requirements": [],
                    },
                },
            }
        )

    def test_rejects_invalid_status(
        self,
        poll_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(poll_schema, registry)
        assert not validator.is_valid(
            {
                "status": "unknown",
                "case_id": "r1",
                "created_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
            }
        )

    def test_rejects_cancelled_without_cancelled_at(
        self,
        poll_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(poll_schema, registry)
        assert not validator.is_valid({"status": "cancelled", "case_id": "r1"})

    def test_examples_validate(
        self,
        poll_schema,
        form_field_schema,
        verification_policy_schema,
        verification_result_schema,
        submission_context_schema,
        example_files,
    ):
        registry = make_registry(
            form_field_schema,
            verification_policy_schema,
            verification_result_schema,
            submission_context_schema,
        )
        validator = make_validator(poll_schema, registry)

        for example_file in example_files:
            if "well-known" in example_file.name:
                continue

            data = json.loads(example_file.read_text())
            for step in data.get("steps", []):
                body = step.get("response", {}).get("body", {})
                request_url = step.get("request", {}).get("url", "")
                is_poll_step = isinstance(request_url, str) and "/status" in request_url

                if is_poll_step and "status" in body and "case_id" in body and body.get("status") != "human_input_required":
                    errors = list(validator.iter_errors(body))
                    assert not errors, f"{example_file.name}: {errors}"


class TestDiscoveryResponseSchema:
    """Validate discovery responses against discovery-response.schema.json."""

    def test_well_known_example_validates(self, discovery_schema):
        validator = Draft202012Validator(discovery_schema)
        example = json.loads((ROOT / "examples" / "07-well-known-hitl.json").read_text())
        errors = list(validator.iter_errors(example["response"]["body"]))
        assert not errors, errors

    def test_accepts_external_auth_metadata(self, discovery_schema):
        validator = Draft202012Validator(discovery_schema)
        assert validator.is_valid(
            {
                "hitl_protocol": {
                    "spec_version": "0.8",
                    "capabilities": {
                        "supports_inline_submit": True,
                        "supports_agent_binding": True,
                    },
                    "authentication": {
                        "type": "bearer",
                        "documentation": "https://example.com/docs/agent-auth",
                        "well_known": "https://example.com/.well-known/agent-configuration",
                        "profiles": ["agent-auth/external"],
                    },
                }
            }
        )

    def test_rejects_invalid_spec_version(self, discovery_schema):
        validator = Draft202012Validator(discovery_schema)
        assert not validator.is_valid(
            {
                "hitl_protocol": {
                    "spec_version": "1.0",
                }
            }
        )
