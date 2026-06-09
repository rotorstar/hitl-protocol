# HITL Feature Matrix

This document is the evidence-backed comparison source of truth. It covers two distinct questions:

1. **Approval-mechanism landscape** — how HITL relates to framework-internal approvals and adjacent protocols (MCP elicitation, LangGraph, OpenAI Agents SDK, HumanLayer).
2. **Surface comparison** — how HITL core relates to declarative UI layers (`json-render`, A2UI).

## Approval-Mechanism Landscape

The key distinction is **who initiates the human decision**: the agent gating its *own* tool calls, or an *external service* requesting a structured decision from the human behind the agent.

| Mechanism | Initiator | Scope | UI for the human | Structured result back | Cross-agent portable | Notes |
|-----------|-----------|-------|------------------|------------------------|:---:|-------|
| **HITL Protocol** | External service | Service → agent → human | Service-hosted review page + inline buttons | Yes (typed, schema-validated) | Yes (plain HTTP) | The only mechanism in this table where the *service* defines the decision |
| OpenClaw approvals | Agent runtime | Agent's own tool calls | Chat prompt / allowlist | Approve/deny only | No (OpenClaw-internal) | Safety interlock on top of tool policy; prompt-based instructions can be lost to context compaction |
| Hermes Agent `/approve` `/deny` | Agent runtime | Agent's own dangerous commands | Chat commands, native keyboards (Telegram/Discord) | Approve/deny only | No (Hermes-internal) | Defense-in-depth alongside sandboxing |
| LangGraph `interrupt()` | Orchestration graph | A node in the developer's own graph | Developer-built | Developer-defined | No (LangGraph-internal) | Natural integration point: an interrupt node can relay a HITL case |
| OpenAI Agents SDK HITL | Agent runtime | Agent's own tool calls | Developer-built | Approve/reject + resume | No (SDK-internal) | Pause/resume around tool execution |
| MCP form mode elicitation | MCP server | MCP server ↔ MCP client | Client-rendered flat form | Yes (primitives only) | MCP clients only | Flat objects, primitive types by design |
| MCP URL mode elicitation | MCP server | MCP server ↔ MCP client | Whatever is at the URL (opaque to MCP) | No (out-of-band) | MCP clients only | Transports a URL + completion signal; HITL defines the page — see [MCP Elicitation Binding](mcp-elicitation-binding.md) |
| HumanLayer (commercial) | Developer SDK | Tool-call layer in own app | Slack/email routing | Yes | SDK required | Hosted product, not an open standard; focus shifted to CodeLayer |

**Conclusion:** framework-internal approvals and HITL are complementary layers. An agent SHOULD gate its own dangerous actions with its runtime's approval mechanism *and* relay HITL cases when services it calls return HTTP 202. A HITL case is protocol state on the service side — it cannot be lost to prompt drift or context compaction.

## Surface Comparison

This matrix compares HITL core, `json-render`, and A2UI.

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
