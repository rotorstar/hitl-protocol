# Contributing to HITL Protocol

Thank you for your interest in contributing to the HITL Protocol specification. This document provides guidelines for contributing.

## How to Contribute

### Reporting Issues

- **Spec ambiguity** — If the specification is unclear or contradictory, [open an issue](https://github.com/rotorstar/hitl-protocol/issues/new?template=bug-report.md) describing the ambiguity and your interpretation.
- **Spec change proposal** — If you want to propose a change to the specification, [open an issue](https://github.com/rotorstar/hitl-protocol/issues/new?template=spec-change.md) first to discuss the change before submitting a PR.
- **Implementation report** — If you've built an implementation, [let us know](https://github.com/rotorstar/hitl-protocol/issues/new?template=implementation-report.md) so we can list it.

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main` with a descriptive name (e.g., `spec/clarify-poll-retry`, `examples/add-cicd-approval`)
3. **Make your changes**
4. **Submit a PR** with a clear description of what changed and why

### What We Accept

| Contribution Type | Process |
|-------------------|---------|
| Typo / grammar fixes | Direct PR |
| Clarification of existing spec text | Direct PR |
| New examples | Direct PR |
| New implementation listing | Direct PR |
| Schema corrections | Issue first, then PR |
| New spec section | Issue + discussion first |
| Breaking change (review types, field names, status codes) | Issue + RFC process |

## Specification Change Process

Changes to the normative specification follow this process:

### Minor Changes (patch version)
- Clarifications, typo fixes, better examples
- No behavioral change for implementations
- Reviewed by one maintainer

### Additive Changes (minor version)
- New optional fields, new optional transport mechanisms
- Backwards-compatible — existing implementations continue to work
- Issue discussion required, reviewed by two maintainers

### Breaking Changes (major version)
- Changes to required fields, status codes, review types
- Existing implementations may need updates
- RFC process: Issue → Discussion (30 days) → PR → Review by all maintainers

## RFC Process for Breaking Changes

1. **Open an issue** with the `rfc` label describing the proposed change
2. **Include**: motivation, proposed change, migration path, impact assessment
3. **Discussion period**: minimum 30 days for community feedback
4. **Decision**: maintainers evaluate feedback and accept/reject/modify
5. **Implementation**: if accepted, PR with spec change + migration guide

## Writing Style

The specification uses [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) key words (MUST, SHOULD, MAY, etc.). When contributing spec text:

- Use present tense
- Be precise — avoid ambiguous wording
- Include examples for new concepts
- Distinguish normative ("MUST") from informational text
- Keep field descriptions concise — one sentence preferred

## JSON Schema Changes

When modifying JSON schemas in `schemas/`:

- Validate against [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema)
- Ensure `$id` URLs are consistent
- Add `description` fields to all new properties
- Test with at least two JSON Schema validators

## Examples

When adding examples in `examples/`:

- Use realistic data (not `foo`/`bar`)
- Include both the request and the response
- Cover the complete flow (trigger → response → poll → result)
- Validate against the JSON schemas
- Name files with a numbered prefix and descriptive name

## Code of Conduct

- Be respectful and constructive
- Focus on the technical merits of proposals
- Acknowledge that different agent ecosystems have different needs
- We aim for a protocol that works for the broadest set of agent architectures

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Open a [discussion](https://github.com/rotorstar/hitl-protocol/discussions) or reach out to the maintainers via issues.
