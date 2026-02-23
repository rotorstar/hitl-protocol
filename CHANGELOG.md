# Changelog

All notable changes to the HITL Protocol specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5] - 2026-02-22

### Added
- Open-source repository structure with README, CONTRIBUTING, and templates
- Standalone JSON Schema files for HITL object and poll response validation
- Agent implementation checklist as separate document
- Interactive playground (HTML) for protocol exploration
- Six complete end-to-end examples covering all review types
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
