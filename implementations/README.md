# Known Implementations

This page lists known implementations of the HITL Protocol. Implementations are categorized by role (Service or Agent) and compliance level.

## Compliance Levels

| Level | Requirements |
|-------|-------------|
| **Minimal** | HTTP 202 + HITL object + polling |
| **Standard** | Minimal + SSE or Callback + reminders |
| **Full** | Standard + signed responses + multi-round + `.well-known/hitl.json` |

## Service Implementations

Services that return HTTP 202 with HITL objects and host review pages.

| Service | Language | Compliance | Review Types | Description |
|---------|----------|:----------:|-------------|-------------|
| [Reference (Express 5)](reference-service/express/) | JavaScript | Standard | All 5 | Reference implementation — polling + SSE |
| [Reference (Hono)](reference-service/hono/) | JavaScript | Standard | All 5 | Edge-ready reference — Deno/Bun/CF Workers |
| [Reference (Next.js)](reference-service/nextjs/) | TypeScript | Standard | All 5 | Full-stack App Router — server-rendered pages |
| [Reference (FastAPI)](reference-service/python/) | Python | Standard | All 5 | Python reference — async + streaming |

## Agent Implementations

Agents that detect HTTP 202, forward review URLs, and poll for results.

| Agent | Language | Transport | Description |
|-------|----------|-----------|-------------|
| — | — | — | *Be the first to add your agent implementation!* |

## Libraries & SDKs

Shared libraries for HITL Protocol support.

| Library | Language | Role | Description |
|---------|----------|------|-------------|
| — | — | — | *No libraries yet. Consider building one!* |

## Adding Your Implementation

To add your implementation to this list:

1. **Open an issue** using the [Implementation Report template](https://github.com/rotorstar/hitl-protocol/issues/new?template=implementation-report.md)
2. **Or submit a PR** editing this file directly

Please include:
- Implementation name and link
- Programming language
- Role (Service / Agent / Library)
- Compliance level
- Which review types and transports are supported
- Brief description

## Validation

To validate your implementation against the spec:

1. **Schema validation** — Validate HITL objects and poll responses against the [JSON Schemas](../schemas/)
2. **Status machine** — Verify your state transitions match the spec (Section 8)
3. **Review types** — Ensure result structures match the documented schemas (Section 10)
4. **Security** — Check token hash verification, HTTPS enforcement, one-time response (Section 13)

A conformance test suite is planned for a future release.
