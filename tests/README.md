# HITL Protocol — Compliance Tests

Test suites for validating HITL Protocol compliance. Available in Node.js (Vitest) and Python (pytest).

## Test Categories

| Category | What It Tests | Node.js | Python |
|----------|--------------|:-------:|:------:|
| **Schema** | All 12 examples validate against JSON Schema | `schema.test.js` | `test_schema.py` |
| **State Machine** | All 6 states, valid/invalid transitions, terminal states | `state-machine.test.js` | `test_state_machine.py` |

## Running Tests

### Node.js (Vitest)

```bash
cd tests/node
npm install
npm test
```

### Python (pytest)

```bash
cd tests/python
pip install -r requirements.txt
pytest -v
```

## Test Details

### Schema Tests

- Validates all example HITL objects against `hitl-object.schema.json`
- Validates all poll responses against `poll-response.schema.json`
- Tests for rejection of invalid payloads (missing fields, wrong types, invalid enums)
- Tests custom review types with `x-` prefix
- Tests minimal valid objects

### State Machine Tests

- Validates all 10 valid transitions
- Rejects all 15+ invalid transitions
- Verifies terminal states have no outgoing transitions
- Tests 4 happy path flows (simple, multi-step, expired, cancelled)
- Verifies exactly 6 states exist

## Adding Tests for Your Implementation

Use these tests as a reference. To validate your own HITL implementation:

1. **Schema tests** — Validate your HITL objects and poll responses against the schemas in `schemas/`
2. **State machine tests** — Verify your status transitions match the spec
3. **HTTP tests** — Test your endpoints return correct status codes (202, 304, 409, 429)
4. **Security tests** — Verify token generation, hashing, and timing-safe comparison
