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

The HITL Protocol's security model is documented in [Section 13 of the specification](spec/v0.5/hitl-protocol.md#13-security-considerations). Key design decisions:

| Property | Design | Rationale |
|----------|--------|-----------|
| **Bearer token URLs** | Anyone with the URL can respond | Intentional delegation model (like Google Docs links) |
| **No login required** | Opaque token in URL IS the authentication | Zero-friction for humans on any device |
| **One-time response** | 409 Conflict on duplicate submissions | Prevents response tampering |
| **Time-limited tokens** | Service tracks `expires_at` in DB | Limits exposure window |
| **HTTPS only** | All URLs must use HTTPS | Prevents URL interception |

These are deliberate design choices, not vulnerabilities. Reports about the bearer token model being "insecure" will be acknowledged but are by design.

### Threat Vectors We Track

1. **URL Leakage** — Review URL shared unintentionally (e.g., logged in server logs)
2. **Token Replay** — Opaque token reused after case completion
3. **Response Forgery** — Agent fabricates human response
4. **UI Injection** — Malicious content in review page
5. **Polling Abuse** — Agent floods poll endpoint
6. **Delegation Abuse** — URL forwarded to unauthorized party

See Section 13 of the spec for detailed mitigations.
