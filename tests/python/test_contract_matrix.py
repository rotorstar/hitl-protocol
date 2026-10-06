"""E1: consume the same contract outcomes as Node, with an exclusively offline registry."""
import json
from pathlib import Path
from urllib.parse import urljoin

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parents[2]
MATRIX = json.loads((ROOT / "tests" / "fixtures" / "contracts.json").read_text())
CASES = MATRIX["cases"]
FORMAT_CHECKER = FormatChecker()


def deny_network(uri):
    raise AssertionError(f"Unregistered schema reference; network retrieval is forbidden: {uri}")


def canonical_validators(version):
    directory = ROOT / "schemas" / "v0.8" if version == "0.8" else ROOT / "schemas"
    schemas = {}
    resources = []
    for path in sorted(directory.glob("*.schema.json")):
        name = path.name.removesuffix(".schema.json")
        schema = json.loads(path.read_text())
        Draft202012Validator.check_schema(schema)
        schemas[name] = schema
        resource = Resource.from_contents(schema, default_specification=DRAFT202012)
        # Full canonical IDs and both historical suffix aliases resolve without HTTP.
        for alias in {schema["$id"], f"{name}.json", f"{name}.schema.json",
                      urljoin(schema["$id"], f"{name}.json"),
                      urljoin(schema["$id"], f"{name}.schema.json")}:
            resources.append((alias, resource))
    registry = Registry(retrieve=deny_network).with_resources(resources)
    return {name: Draft202012Validator(schema, registry=registry, format_checker=FORMAT_CHECKER)
            for name, schema in schemas.items()}


VALIDATORS = {version: canonical_validators(version) for version in ("0.8", "0.9")}


def test_matrix_has_both_outcomes_of_each_canonical_versioned_schema():
    assert MATRIX["format_version"] == 1
    assert len({case["id"] for case in CASES}) == len(CASES)
    for version, validators in VALIDATORS.items():
        assert len(validators) == 8
        for schema in validators:
            for valid in (True, False):
                assert any(case["version"] == version and case["schema"] == schema
                           and case["valid"] is valid for case in CASES), (version, schema, valid)


def test_required_format_dependencies_are_available():
    # Missing optional dependencies must fail loudly, not silently weaken the Python contract.
    for name, invalid in (("date-time", "not-a-timestamp"), ("uri", "not a URI"), ("email", "not an email")):
        assert not FORMAT_CHECKER.conforms(invalid, name), (
            f"{name} checking is unavailable; install jsonschema[format] or jsonschema[format-nongpl]"
        )


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_shared_canonical_contract(case):
    version = case["version"]
    data = case["input"]
    if version == "supported":
        assert case["schema"] in ("hitl-object", "discovery-response")
        if isinstance(data, dict):
            advertised = data.get("spec_version") if case["schema"] == "hitl-object" else (
                data.get("hitl_protocol", {}).get("spec_version")
                if isinstance(data.get("hitl_protocol"), dict) else None
            )
        else:
            advertised = None
        if not isinstance(advertised, str) or advertised not in VALIDATORS:
            assert case["valid"] is False
            return
        version = advertised
    validator = VALIDATORS[version][case["schema"]]
    errors = list(validator.iter_errors(data))
    assert (not errors) is case["valid"], (
        case["id"], [f"{list(error.absolute_path)}: {error.message}" for error in errors]
    )
