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
| MCP URL mode elicitation | MCP server | MCP server ↔ MCP client | Whatever is at the URL (opaque to MCP) | No (out-of-band) | MCP clients only | Transports a URL + consent envelope; HITL defines the page — see [MCP Elicitation Binding](mcp-elicitation-binding.md). Delivery changes in MCP 2026-07-28: completion notification removed, replaced by MRTR re-issue |
| MCP Tasks extension (2026-07-28 RC) | MCP server | MCP server ↔ MCP client | Via attached elicitation payloads (form/URL) | Task result after completion | MCP clients only | `io.modelcontextprotocol/tasks` (SEP-2663): durable task handle, `input_required` status, `tasks/get` polling — HITL-like lifecycle semantics, but only inside the MCP triangle; page/schema undefined |
| CHEQ (IETF, expired drafts) | External service (draft -00) | Service → agent → human | Confirmation-server URI (-00) | Yes (signed responses) | Design goal; never adopted | Closest prior art: `draft-rosenberg-cheq-00` (2025-07-24) used HTTP 202 + URI package + polling; successor `draft-rosenberg-aiproto-cheq` pivoted to signed objects over MCP/A2A and expired ~2026-04 without WG adoption |
| HumanLayer (commercial) | Developer SDK | Tool-call layer in own app | Slack/email routing | Yes | SDK required | Hosted product, not an open standard; focus shifted to CodeLayer |

**Conclusion:** framework-internal approvals and HITL are complementary layers. An agent SHOULD gate its own dangerous actions with its runtime's approval mechanism *and* relay HITL cases when services it calls return HTTP 202. A HITL case is protocol state on the service side — it cannot be lost to prompt drift or context compaction.

## Adjacent Standards Landscape (July 2026)

Adjacent standards frequently compared with HITL, evaluated against HITL's load-bearing axes — **service-initiated · cross-agent · plain HTTP · service-hosted review UI · domain-general · typed flows**. Evidence checked 2026-07-11; verify dates before citing externally.

| Standard | Status (as of 2026-07) | Human-decision mechanism | Overlap with HITL | Evidence |
|---|---|---|---|---|
| **A2A** (Linux Foundation) | v1.0 (~2026-04); 150+ orgs | `input-required` task state; the calling agent renders the interaction in its own UI | Partial: same pause-for-human shape; no service-hosted review page, no typed flows | [a2a-protocol.org](https://a2a-protocol.org/v1.0.0/specification/); [LF press 2026-04](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) |
| **MCP 2026-07-28** | Release candidate (locked 2026-05-21; final targeted 2026-07-28) | MRTR `input_required` results, URL-mode elicitation, Tasks extension with polling | Partial: HITL-like lifecycle *inside* the MCP client/server triangle; review page and result schema undefined | [RC announcement 2026-05-21](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/); [draft changelog](https://modelcontextprotocol.io/specification/draft/changelog) |
| **AP2** (FIDO Alliance) | v0.2.0 (2026-04); donated by Google to FIDO | Cryptographically signed mandates (human-present / human-not-present) | Partial, payments-only: authorization credential, not a review-flow/UI protocol | [ap2-protocol.org](https://ap2-protocol.org/); [FIDO donation](https://fidoalliance.org/google-donates-agent-payments-protocol-to-fido-alliance/) |
| **ACP** (OpenAI/Stripe/Meta) | Spec 2026-04-17; Instant Checkout in ChatGPT | Purchase confirmation rendered in the agent client's UI; delegated payment tokens | Partial, commerce-only; human UI lives in the agent client, not the service | [Stripe ACP docs](https://docs.stripe.com/agentic-commerce/acp); [spec repo](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) |
| **x402** (Coinbase/Cloudflare) | Active 2026 | HTTP 402 + machine-readable payment terms; agent pays and retries | Structural cousin (status code + typed payload hands control back), payments-only | [Cloudflare x402](https://blog.cloudflare.com/x402/) |
| **WebMCP** (W3C Web ML CG) | Chrome 146 early preview (2026-02) | `navigator.modelContext` page tools; `requestUserInteraction` for in-page human confirmation | Partial: human confirmation, but browser-mediated for the *visiting* agent — no cross-agent hosted review handoff | [webmcp.link](https://webmcp.link/) |
| **CHEQ** (IETF individual drafts) | Both drafts expired; no WG adoption | -00 (2025-07-24): HTTP 202 + URI package (confirmation/resource/result URIs) + polling; successor (2025-10-19, expired ~2026-04): signed confirmation objects carried over MCP/A2A/N-ACT | High (historic): closest prior art for HITL's wire pattern; inactive | [draft-rosenberg-cheq](https://datatracker.ietf.org/doc/draft-rosenberg-cheq/); [draft-rosenberg-aiproto-cheq](https://datatracker.ietf.org/doc/draft-rosenberg-aiproto-cheq/) |
| **HumanLayer / gotoHuman** | Active products | Agent contacts a human via Slack/Email or a SaaS approval UI | Partial: products/SDKs, not open wire standards; agent-initiated, vendor-hosted UI | [humanlayer](https://pypi.org/project/humanlayer/); [gotohuman.com](https://www.gotohuman.com/) |

**Reading:** as of July 2026, no active standard combines all six HITL axes. Payment standards own the commerce slice, MCP/A2A own the in-protocol slice, WebMCP owns the in-page slice — the service-initiated, cross-agent, service-hosted review handoff remains HITL's slot. Demand-side, the EU AI Act's human-oversight duties for high-risk systems ([Art. 14](https://artificialintelligenceact.eu/article/14/), applying from 2026-08) require demonstrable oversight — which favors auditable protocol state over prompt-level approvals.

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
