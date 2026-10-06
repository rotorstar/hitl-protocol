# Changelog

All notable changes to the HITL Protocol specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-10-06

Repository release of **HITL Protocol v0.9 (Draft)**. The optional Agent Access profile remains **v0.1 (Draft)**. GitHub release versions, the wire `spec_version` (`0.9`) and npm package versions are separate; npm publication remains managed through Changesets.

### Added

- [HITL v0.9 specification](spec/v0.9/hitl-protocol.md) with explicit service-owned cases, independent reviewer authentication/authorization, immutable first decisions, direct completion and a separate business execution boundary.
- Optional [Agent Access v0.1 profile](profiles/agent-access/v0.1/README.md) with public signed requests and delegated OAuth/DPoP access, an immutable operation snapshot, authenticated owner review and fresh explicit commit.
- [Persistent Agent Access reference](implementations/agent-access/README.md) with PostgreSQL, real Keycloak/OIDC enrollment, bounded grants, native browser forms, idempotent operations and transactional local bookings.
- Real HTTP, OAuth, database and browser evals for consent, ownership, revocation, replay, expiry and execution; generated profile schemas are checked for drift.
- Illustrated [v0.9 animation](https://rotorstar.github.io/hitl-protocol/assets/hitl-protocol-flow.html) with horizontal Job search, Shopping and Research tabs, editable human selections, messenger buttons, concrete next steps and separate follow-up confirmations.
- Reproducible cropped README previews, light/dark animation screenshots and [visual/feature comparisons](docs/animation-review/README.md).

### Changed

- Canonical root schemas and source schema-package defaults now select v0.9. Public TypeScript types and runtime validators derive from those schemas; terminal poll responses and form/submission alternatives use disjoint branches. The complete explicit v0.8 export graph and archived contracts remain available.
- Refreshed the [existing playground](https://rotorstar.github.io/hitl-protocol/playground/index.html) for v0.9 while retaining all eight tabs and controls, including native messaging actions, verification step-up and detailed wire examples.
- Unified both HTML pages around the orange/slate palette, locally bundled Inter and JetBrains Mono fonts, accessible keyboard controls, shareable URL state, responsive layouts and reduced motion.
- Updated README examples, specification links, repository structure, version-handling guidance, font licence notices and screenshot references. Historical HTTP/MCP demonstrations, templates and end-to-end JSON examples remain explicitly scoped to v0.8.
- Gated npm release automation on successful complete CI for the exact main-branch commit, with explicit handling of unconfigured npm credentials.

### Fixed

- Corrected review deadline handling, direct completion and immutable terminal decisions in the shared local demo helpers.
- Hardened the Agent Access reference's replay/cache deadlines, session and CSRF rotation, admission limits, authorization freshness and rendering; public identity, reviewer consent and execution authority remain distinct.

### Verification

- Complete CI: build, types, dependency audit, unit/schema/pack checks, Node/Python compliance and Agent Access HTTP/OAuth/PostgreSQL/browser evals.
- Animation: 29 outcome variants and 85 schema-valid wire messages; playground: 226 configurations and 552 schema-valid wire messages. Browser checks pass in Chromium, Firefox and WebKit.
- Live HTML, font and screenshot assets were checked against the deployed source, including README crops, light/dark previews and actual human-selection interactions.

## [0.8.0] - 2026-07-11

The v0.8 spec draft landed 2026-03-26; this release also includes the MCP binding and standards-landscape updates from June/July 2026.

### Added
- HITL Protocol v0.8 spec in [`spec/v0.8/hitl-protocol.md`](spec/v0.8/hitl-protocol.md)
- Optional Proof-of-Human verification layer with `verification_policy`, `verification_evidence`, `submission_context`, and `verification_result`
- New JSON Schemas for verification policy, normalized verification result, and submission context
- Three new v0.8 examples covering inline PoH, step-up fallback, and browser-hosted verification
- Informative appendices for composing HITL with external Agent Auth systems and a World ID 4.x provider profile
- Informative [MCP Elicitation Binding](docs/mcp-elicitation-binding.md): delivering HITL cases via MCP URL mode elicitation (`elicitation/create`, `mode: "url"`) with `notifications/elicitation/complete` instead of agent-side polling
- MCP 2026-07-28 release-candidate coverage in the binding: Binding B (MRTR — `input_required` results + `requestState` re-issue, replacing `elicitationId`/completion notification) and Binding C (Tasks extension `io.modelcontextprotocol/tasks` for long-lived cases)
- Runnable MCP URL mode elicitation demo ([`implementations/mcp-server/`](implementations/mcp-server/)), works in Claude Code
- Approval-mechanism landscape table in [`docs/feature-matrix.md`](docs/feature-matrix.md) covering OpenClaw approvals, Hermes Agent, LangGraph `interrupt()`, OpenAI Agents SDK, MCP elicitation (both modes), MCP Tasks extension, CHEQ (IETF), and HumanLayer
- Adjacent Standards Landscape (July 2026) in [`docs/feature-matrix.md`](docs/feature-matrix.md): A2A v1.0, MCP 2026-07-28 RC, AP2 (FIDO), ACP (OpenAI/Stripe/Meta), x402, WebMCP, CHEQ, HumanLayer/gotoHuman — with sources and dates
- README: CHEQ and AP2/ACP/x402 rows in the Protocol Standards Landscape; EU AI Act Article 14 (human oversight for high-risk systems, applying from 2026-08) as a demand driver in The Gap

### Changed
- Updated root schemas and OpenAPI to v0.8, including normalized poll-response verification metadata and discovery support for external auth/profile pointers
- Tightened inline submit guidance with agent-side verification preflight and unified 403 fallback semantics for `action_not_inline`, `verification_required`, and `verification_failed`
- Updated README, examples docs, schema docs, package docs, and tests for the new verification layer and agent-auth separation
- Bumped `@hitl-protocol/schemas` to v0.8.0 and exported the new verification-related schemas, validators, and TypeScript types
- Updated spec §14.2 and README for MCP spec revision 2025-11-25: distinguishes form mode from URL mode elicitation; positions HITL as the layer that defines what happens at the elicitation URL
- Updated spec §14.2, README, and SKILL.md for the MCP 2026-07-28 release candidate: sharpened positioning — MCP adds human-review plumbing inside the MCP triangle (MRTR, Tasks `input_required`); HITL standardizes the same handoff at the open HTTP layer and defines the typed decision behind the URL
- README: new positioning section distinguishing framework-internal approvals (agent gates its own actions) from HITL (service-initiated structured decisions)
- MCP server demo: documented revision compatibility (implements the 2025-11-25 binding; MRTR/Tasks migration planned once the final 2026-07-28 spec and SDK support land)

## [0.7.1] - 2026-02-27

### Fixed
- Next.js reference review flow now posts to the correct respond endpoint (`/api/reviews/{caseId}/respond`)
- Unified inline submit `403 action_not_inline` contract across all reference implementations with `case_id` and canonical fallback guidance
- Corrected OpenAPI discovery endpoint responses: `200` now includes schema/example payload, `404` is documented as unsupported discovery
- Fixed failing schema package test for invalid `spec_version`

### Changed
- Hardened `hitl-object.schema.json` URL validation: HTTPS required for production URLs, explicit localhost/127.0.0.1 allowance for local development
- Hardened `poll-response.schema.json` with status-dependent requirements (`completed`, `expired`, `cancelled`)
- Updated v0.7 spec language for inline fallback behavior, discovery example shape, and BCP14 conventions (RFC 2119 + RFC 8174)
- Updated documentation consistency (`docs/quick-start.md`, `schemas/README.md`) to v0.7
- Added Best-Practice 2026 fixplan and verification matrix (`docs/best-practice-2026-fixplan.md`)
- Added RFC alignment section in `README.md`

## [0.5.1] - 2026-02-23

### Added
- OpenAPI 3.1.0 specification (`schemas/openapi.yaml`) covering all endpoints, webhooks, and security schemes
- Review page HTML templates for all 5 review types (`templates/`) with Pico CSS, dark mode, WCAG 2.2 AA
- Reference implementations in 4 frameworks: Express 5, Hono, Next.js (App Router), FastAPI
- Quick Start Guide (`docs/quick-start.md`) with 7 Mermaid diagrams and 5 framework walkthroughs
- SDK Design Guide (`docs/sdk-guide.md`) for community SDK development
- Compliance test suites: Node.js (Vitest, 57 tests) and Python (pytest, 46 tests)
- Schema tests validating all examples against JSON Schema Draft 2020-12
- State machine tests covering all 10 valid transitions, 15 invalid transitions, and 4 happy paths

### Changed
- Updated `hitl-object.schema.json` to support custom review types with `x-` prefix via `anyOf`

## [0.5] - 2026-02-22

### Added
- Open-source repository structure with README, CONTRIBUTING, and templates
- Standalone JSON Schema files for HITL object and poll response validation
- Agent implementation checklist as separate document
- Interactive playground (HTML) for protocol exploration
- Eight complete end-to-end examples covering all review types and form field definitions
- Discovery endpoint (`.well-known/hitl.json`) specification
- SECURITY.md for vulnerability reporting
- GitHub issue and PR templates

### Changed
- Bumped `spec_version` from `"0.1"` to `"0.5"` (spec document version from 0.4 to 0.5)
- Clarified RFC 2119 keyword usage throughout
- Improved multi-round review chain documentation (Section 15.3)
- Enhanced SSE event stream section with reconnection guidance

### Fixed
- Consistent use of ISO 8601 duration formats in timeout examples
- Corrected JSON Schema `$id` URLs to use `hitl-protocol.org` domain

## [0.4] - 2026-02-20

### Added
- SSE Event Stream transport option (Section 8.5)
- Reminder mechanism (`reminder_at` field, `review.reminder` event)
- Multi-round review chains (`previous_case_id`, `next_case_id`)
- `responded_by` field for audit trail (Section 13.7)
- `surface` field for UI format declaration (Section 11)
- Appendix F: Integration with ADL and WDL negotiation protocols
- State mapping reference between HITL, ADL, and WDL states

### Changed
- Expanded review type documentation with multi-round behavior notes
- Enhanced security considerations (Section 13) with threat model diagram

## [0.3] - 2026-02-15

### Added
- Callback interface (Section 9) with HMAC-SHA256 signature verification
- SKILL.md extension for HITL metadata declaration (Section 12)
- Agent implementation checklist (Appendix E)
- JSON Schema definitions (Appendix C)
- Discovery via `.well-known/hitl.json` (Appendix D)

### Changed
- Refined poll response schema with explicit field definitions
- Added `events_url` to HITL object for SSE support

## [0.2] - 2026-02-10

### Added
- Five review types: Approval, Selection, Input, Confirmation, Escalation
- Custom review type support with namespaced identifiers
- Response integrity via RS256 signed responses (CHEQ-inspired)
- Comparison table with alternatives (Appendix B)
- json-render component catalog for HITL (Appendix A)

### Changed
- Expanded security considerations
- Added delivery mode recommendations for different agent environments

## [0.1] - 2026-02-01

### Added
- Initial draft specification
- Core HTTP 202 response mechanism
- Review URL with opaque bearer token (SHA-256 verified)
- Poll interface with status machine
- Basic security considerations (signed URLs, one-time response, HTTPS)
- Sequence diagram for three-party flow
- Two example flows: Job Search, Deployment Approval
