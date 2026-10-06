# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the HITL Protocol specification or reference implementations, please report it responsibly.

**Do NOT open a public issue for security vulnerabilities.**

### How to Report

Use [GitHub Security Advisories](https://github.com/rotorstar/hitl-protocol/security/advisories/new) to report privately.

Include:
- Description of the vulnerability
- Which part of the specification is affected (section number)
- Potential impact (e.g., response forgery, URL leakage, token replay)
- Suggested mitigation if you have one

### Response Timeline

- **Acknowledgment**: within 48 hours
- **Assessment**: within 7 days
- **Fix/Disclosure**: coordinated with reporter, typically within 30 days

### Scope

This security policy covers:

- The HITL Protocol specification text
- JSON Schema definitions in this repository
- Security recommendations in Section 13 of the spec
- Reference implementation code (if present)

### Known Security Model

The current security model is documented in [HITL v0.9](spec/v0.9/hitl-protocol.md#13-security-considerations). Historical v0.8 contracts remain available unchanged. Review interaction, verified identity, delegation and execution authorization are separate checks.

| Property | Design | Rationale |
|----------|--------|-----------|
| **Review URL** | Baseline capability, with additional profile checks when required | A signed URL does not establish a human identity or execution authority |
| **Browser identity** | The Agent Access profile requires its own recent OIDC owner session | Agent credentials cannot authenticate the reviewer |
| **Terminal decisions** | Exactly one decision wins; terminal results cannot change | Concurrent submissions cannot overwrite the winner |
| **Deadline** | Rechecked using DB time after locks and at the write boundary | Timer delays do not extend authorization |
| **Execution** | Explicit fresh OAuth/DPoP commit with current local grant and immutable operation | Confirmation does not book or expand permissions |
| **HTTPS only** | All URLs must use HTTPS | Prevents URL interception |

The historical HTTP/MCP demos are local, in-memory examples and do not implement this complete security model. The new [Agent Access reference](implementations/agent-access/README.md) persists authoritative state in PostgreSQL. Its explicit insecure-loopback configuration and fixture credentials are restricted to development/evals.

Public Web attribution proves control of the resolved directory URL/key pair. It does not prove a vendor, a human, or delegated user rights. Directory retrieval blocks private destinations, redirects and DNS rebinding; shared persistent stores enforce replay protection and quotas across processes. No review capability or agent access token is persisted in plaintext.

Proof acceptance, replay expiration and execution freshness use the same database clock. Browser login rotates the session and CSRF secret; switching owner clears case bindings. Admission limits apply before nonce challenges, provider calls and browser-session creation. The [2026-10-06 security re-audit](implementations/agent-access/security-review.md) records confirmed defects, corrective acceptance criteria and verification separately from the initial functional eval report.

Local revocation and local execution use one transaction/lock order. External authorization-server revocation has an observation window after live introspection; it is not atomic with the local database. Confirmation is not proof of human presence, and UI/surface payloads never convey authorization. The profile remains a draft pending independent interoperability and threat-model review.

### Threat Vectors We Track

1. **URL Leakage** — Review URL shared unintentionally (e.g., logged in server logs)
2. **Token Replay** — Opaque token reused after case completion
3. **Response Forgery** — Agent fabricates human response
4. **UI Injection** — Malicious content in review page
5. **Polling Abuse** — Agent floods poll endpoint
6. **Delegation Abuse** — URL forwarded to unauthorized party

See Section 13 of the spec for detailed mitigations.
