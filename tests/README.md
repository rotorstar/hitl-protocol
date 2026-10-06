# HITL Protocol — Compliance Tests

Test suites for validating HITL Protocol compliance. Available in Node.js (Vitest) and Python (pytest).

## Test Categories

| Category | What It Tests | Node.js | Python |
|----------|--------------|:-------:|:------:|
| **Schema** | HITL example suite validates against JSON Schema | `schema.test.js` | `test_schema.py` |
| **Discovery** | `.well-known/hitl.json` validates against discovery schema | `schema.test.js` | `test_schema.py` |
| **State Machine** | All 6 states, valid/invalid transitions, terminal states | `state-machine.test.js` | `test_state_machine.py` |
| **Actual runtimes** | Tokens, body contracts, concurrent decisions, deadline checks, normalized poll output and SSE cleanup | `reference-routes.test.js`, `next-routes.test.ts`, `mcp-http.test.js` | `test_reference.py` |

## Running Tests

### Node.js (Vitest)

```bash
pnpm install   # repository root
pnpm --filter @hitl-protocol/schemas build
pnpm --filter @hitl-protocol/core build
pnpm --filter hitl-tests-node test
```

### Python (pytest)

Use a supported modern Python version (3.10 or newer) in an isolated environment.

```bash
cd tests/python
pip install -r requirements.txt
pytest -v
```

## Test Details

### Schema Tests

- Validates all example HITL objects against `hitl-object.schema.json`
- Validates all poll responses against `poll-response.schema.json`
- Validates inline submit request bodies against `submit-request.schema.json`
- Validates `.well-known/hitl.json` responses against `discovery-response.schema.json`
- Covers v0.8 verification payloads (`verification_policy`, `verification_evidence`, `submission_context`, `verification_result`)
- Tests for rejection of invalid payloads (missing fields, wrong types, invalid enums)
- Tests custom review types with `x-` prefix
- Tests minimal valid objects

### State Machine Tests

- Imports the actual shared Node runtime and FastAPI state machine; no copied transition graph
- Covers unopened inline completion and immutable terminal decisions
- Core package tests cover all 11 valid transitions and invalid terminal transitions
- HTTP tests exercise real Hono, Express, MCP and FastAPI consumers, expiry, duplicate responses, parsing interleavings and schema-valid normalized identity metadata
- Historical example tests explicitly validate against `schemas/v0.8/`

## Adding Tests for Your Implementation

Use these tests as a reference. To validate your own HITL implementation:

1. **Schema tests** — Validate v0.8 consumers against `schemas/v0.8/`; v0.9 consumers use the separate current contract
2. **State machine tests** — Verify your status transitions match the spec
3. **HTTP tests** — Test your endpoints return correct status codes (202, 304, 409, 429)
4. **Security tests** — Verify token generation, hashing, and timing-safe comparison
