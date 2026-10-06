# Known Implementations

This page lists repository implementations by role, protocol version and demonstrated capabilities.

## Scope and Versions

The historical HTTP/MCP examples emit v0.8 and run locally with process-local state. They do not authenticate the reviewer, execute business actions, provide reminders or callbacks, or prove production conformance. Select `@hitl-protocol/schemas/v0.8` and the [archived v0.8 schemas](../schemas/v0.8/) when testing them. Unversioned schema imports select v0.9.

The separate draft [Agent Access reference](agent-access/README.md) composes v0.9 with public attribution, PKCE/OIDC owner enrollment, DPoP grants, PostgreSQL state and explicit booking commit. Review completion and execution success remain separate.

## Service Implementations

| Service | Language/runtime | Contract | Review types | Implemented transport and scope |
|---------|------------------|----------|--------------|---------------------------------|
| [Express](reference-service/express/) | Node.js JavaScript | Local v0.8 demo | All 5 | Polling and SSE |
| [Hono](reference-service/hono/) | Node.js JavaScript, filesystem/crypto APIs | Local v0.8 demo | All 5 | Polling and SSE; this example is not an Edge/Deno/Worker runtime |
| [Next.js](reference-service/nextjs/) | Node.js TypeScript | Local v0.8 demo | All 5 | Polling, SSE and server-rendered review pages |
| [FastAPI](reference-service/python/) | Python | Local v0.8 demo | All 5 | Polling and SSE |
| [MCP embedded service](mcp-server/) | Node.js JavaScript | Local v0.8 demo | Confirmation | Polling and MCP 2025-11-25 URL elicitation; records decisions only |
| [Agent Access reference](agent-access/) | Node.js TypeScript and PostgreSQL | Draft v0.9 plus Agent Access v0.1 | Confirmation | Protected HTTP polling, OIDC owner review and explicit DPoP commit |

## Agent Examples

| Agent | Language | Transport | Scope |
|-------|----------|-----------|-------|
| [Agent Access example client](agent-access/reference/src/agent-client.ts) | TypeScript | OAuth/DPoP and HTTP | Local reference flow; not a generic SDK |
| [Independent eval client](agent-access/reference/evals/independent-client.ts) | TypeScript | Discovery, OAuth/DPoP and HTTP | Acceptance consumer without the repository verifier SDK |

## Workspace Libraries

| Library | Role | Scope |
|---------|------|-------|
| [Schemas](../packages/schemas/) | Generated types, schemas and validators | Default v0.9; explicit v0.8 archive |
| [Core](../packages/core/) | Tokens, rate limits, local state/completion helpers | Historical v0.8 demos; no distributed business transaction guarantee |
| [Agent Access](../packages/agent-access/) | Profile DTOs, OAuth/DPoP and Public Web verification | Private workspace package for the draft reference |

## Adding Your Implementation

To add your implementation to this list:

1. **Open an issue** using the [Implementation Report template](https://github.com/rotorstar/hitl-protocol/issues/new?template=implementation-report.md)
2. **Or submit a PR** editing this file directly

Please include:
- Implementation name and link
- Programming language
- Role (Service / Agent / Library)
- Protocol version, supported capabilities and verification evidence
- Which review types and transports are supported
- Brief description

## Validation

To validate your implementation against the spec:

1. **Schema validation** — Select the correct [versioned JSON Schemas](../schemas/): archived v0.8 for the historical demos, current v0.9 for the Agent Access reference
2. **Status machine** — Verify your state transitions match the spec (Section 8)
3. **Review types** — Ensure result structures match the documented schemas (Section 10)
4. **Security** — Check token hash verification, HTTPS enforcement, one-time response (Section 13)

The [Node/Python runtime tests](../tests/README.md) exercise actual legacy endpoints. The separate [Agent Access evals](agent-access/README.md#verification) require real PostgreSQL, Keycloak and browser infrastructure; missing infrastructure fails the gate rather than skipping it.
