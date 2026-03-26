# HITL Surface Feature Matrix

This matrix is the evidence-backed comparison source of truth for HITL core, `json-render`, and A2UI.

## Scope

- **HITL Core**: open transport for service-hosted human decisions
- **json-render**: generative UI framework
- **A2UI**: embedded UI protocol for AI clients

## Matrix

| Dimension | HITL Core | `json-render` | A2UI | HITL Alignment | Evidence |
|-----------|-----------|---------------|------|----------------|----------|
| Goal / Layer | Human-decision transport | Declarative generative UI framework | Declarative embedded UI protocol | HITL should integrate, not absorb | [README](../README.md), [spec v0.7](../spec/v0.7/hitl-protocol.md) |
| Transport model | HTTP 202 + poll/SSE/callback | Host-defined | Transport-agnostic message stream | Keep HITL transport minimal | [spec v0.7](../spec/v0.7/hitl-protocol.md) |
| UI hosting | Service-hosted browser UI | Host app renderer | AI client renderer | Browser remains canonical fallback | [README](../README.md) |
| URL fallback | Required | Not intrinsic | Not intrinsic | Core differentiator | [README](../README.md), [spec v0.7](../spec/v0.7/hitl-protocol.md) |
| Payload model | `hitl` object only | Flat `root + elements + state` spec | `createSurface`, `updateComponents`, `updateDataModel` envelopes | Do not move renderer payloads into core | [profiles](../profiles/surface-interop/v0.1/README.md) |
| State / data separation | Minimal in core | Embedded state inside spec | Explicit structure/data split | Profile layer can project either model | [profiles](../profiles/surface-interop/v0.1/README.md) |
| Data binding | Core only standardizes `context.form` | `$state`, `$bindState`, `$bindItem`, `repeat`, `watch` | data bindings and function calls | Keep binding semantics renderer-specific | [spec v0.7](../spec/v0.7/hitl-protocol.md), upstream renderer docs |
| Action model | Submit via browser or `submit_url` | Event bindings to actions | Event actions or local function calls | HITL actions stay semantic, adapters map them | [profiles](../profiles/surface-interop/v0.1/README.md) |
| Streaming / updates | Status streaming only | RFC 6902 JSON patch streams | Incremental message envelopes | Core streams status, profiles stream UI | [spec v0.7](../spec/v0.7/hitl-protocol.md), upstream protocol docs |
| Component catalog | None in core | Catalog-constrained components | Catalog-constrained components | Do not standardize catalogs in core | [spec v0.7](../spec/v0.7/hitl-protocol.md) |
| Validation / error feedback | Schema + state machine | Schema + renderer validation | Schema + client error feedback | Add formal discovery validation in HITL | [schemas](../schemas/README.md) |
| Security boundary | Signed URL bearer token, service-owned page | Host-defined renderer boundary | Client-defined renderer boundary | Browser fallback preserves strongest universal path | [README](../README.md), [spec v0.7](../spec/v0.7/hitl-protocol.md) |
| Accessibility / mobile | Required for review page | Depends on renderer implementation | Depends on client implementation | Documented as non-negotiable across all paths | [docs/flow-verification.md](flow-verification.md) |
| Versioning / drift risk | Repo-controlled | External upstream | External upstream | Use profiles, not hard core coupling | [profiles](../profiles/surface-interop/v0.1/README.md) |

## Implementation Guidance

- Keep HITL core unchanged when adding embedded surface support.
- Advertise optional declarative surfaces only through discovery capabilities and profile docs.
- Require clients to ignore unsupported formats and use `review_url`.
- Treat upstream renderer details as moving dependencies and cite version/date in docs when relevant.
