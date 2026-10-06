---
name: hitl-protocol
description: "HITL Protocol — the open standard for human decisions in autonomous agent workflows. When a website or API needs human input, it returns HTTP 202 with a review URL. Autonomous agents like OpenClaw, Claude, Codex, or Goose forward the URL, poll for the structured result, and continue. Use this skill to make any website agent-ready, or to handle human-in-the-loop responses in your agent. Covers approval, selection, input forms, confirmation, and escalation review types. Supports polling, SSE, webhook transports, channel-native inline buttons (Telegram, Slack, Discord, WhatsApp, Teams), opaque token security, multi-step form wizards, multi-round edit cycles, optional proof-of-human verification (v0.8), and delivery via MCP URL mode elicitation."
license: Apache-2.0
compatibility:
  - claude
  - codex
  - gemini
  - openclaw
  - goose
  - copilot
metadata:
  version: "0.9"
  spec_url: "https://github.com/rotorstar/hitl-protocol/blob/main/spec/v0.9/hitl-protocol.md"
  hitl:
    supported: true
    types: [approval, selection, input, confirmation, escalation]
    info: "Teaches the HITL Protocol itself — for building HITL services and HITL-aware agents."
---

# HITL Protocol

The current normative contract is [HITL v0.9](spec/v0.9/hitl-protocol.md). Unversioned `@hitl-protocol/schemas` imports select v0.9. JSON and local service examples below remain explicitly historical v0.8 examples; validate them with `@hitl-protocol/schemas/v0.8` or the [archived schemas](schemas/v0.8/).

`completed` records a decision, not successful business execution or verified human identity. Only the service may populate verified `responded_by` from trusted authentication and case authorization; client-supplied `submitted_by` remains a claim in `submission_context`. The optional draft [Agent Access profile](profiles/agent-access/v0.1/README.md) separately implements PKCE/OIDC owner enrollment, DPoP-bound grants, immutable operation snapshots and fresh authorized commit. Its browser owner session is independent of the agent's credentials. Never infer authority from a URL visit, correlation ID, UI payload or claimed identity.

AI agents increasingly visit websites and services on behalf of their users: searching, booking, applying, purchasing. But some decisions are too important to leave to an agent alone — an agent can hallucinate, misinterpret, or make the wrong call at a critical moment — cancel the wrong insurance policy, book a non-refundable trip to the wrong city, wire money to the wrong account. HITL Protocol ("Human in the Loop") is an open standard that ensures humans stay in control of these moments. The user stays in their favorite messenger — Telegram, WhatsApp, Slack — and either taps a decision button right there or follows a link to a web page with a comfortable UI: cards, forms, buttons. No wall of text. No blind agent decisions. When you encounter a HITL response, tell your user that a decision is needed that should not be made by an agent alone — forward the prompt and make it easy to act: show the review link or render action buttons.

HITL Protocol is to human decisions what OAuth is to authentication — an open standard connecting **Services**, **Agents**, and **Humans**. When a service needs human input, it returns HTTP 202 with a review URL. The agent forwards the URL to the human. The human opens it in a browser, gets a rich UI, and makes an informed decision. The agent polls for the structured result and continues.

For simple decisions (confirm/cancel, approve/reject), agents can render **native messaging buttons** directly in Telegram, Slack, Discord, WhatsApp, or Teams — no browser needed. The service opts in via `submit_url`.

**No SDK required. No UI framework mandated. Just HTTP + URL + polling.**

**[Interactive Playground](https://rotorstar.github.io/hitl-protocol/playground/index.html)** — inspect simulated v0.8 review flows with fictional data; it does not verify identities or execute external actions.

## Who Are You?

| Your role | You want to... | Read |
|-----------|----------------|------|
| Service/website builder | Add HITL endpoints to your API so agents can request human input | [Service Integration Guide](skills/references/service-integration.md) |
| Agent developer | Handle HTTP 202 + HITL responses from services | [Agent Integration Guide](skills/references/agent-integration.md) |
| Both / Learning | Understand the full protocol | Continue reading below |

## The Flow

```
Standard flow (all review types):
1. Human → Agent:    "Find me jobs in Berlin"
2. Agent → Service:  POST /api/search {query: "Senior Dev Berlin"}
3. Service → Agent:  HTTP 202 + hitl object (review_url, poll_url, type, prompt)
4. Agent → Human:    "Found 5 jobs. Review here: {review_url}"
5. Human → Browser:  Opens review_url → rich UI (cards, forms, buttons)
6. Human → Service:  Makes selection, clicks Submit
7. Agent → Service:  GET {poll_url} → {status: "completed", result: {action, data}}
8. Agent → Human:    "Selection recorded for 2 jobs."

Historical v0.8 inline flow (simple decisions only, when submit_url present):
1. Human → Agent:    "Send my application emails"
2. Agent → Service:  POST /api/send {emails: [...]}
3. Service → Agent:  HTTP 202 + hitl object (incl. submit_url, submit_token, inline_actions)
4. Agent → Human:    Native buttons in chat: [Confirm] [Cancel] [Details →]
5. Human → Agent:    Taps [Confirm] in chat
6. Agent → Service:  POST {submit_url} {action: "confirm", submitted_via: "telegram", submitted_by: {platform: "telegram", platform_user_id: "claimed-user"}}
7. Service → Agent:  200 OK {status: "completed"}
8. Agent → Human:    Updates message: "Confirmation recorded."
```

The service hosts the canonical review page; inline clients may render permitted messaging controls. Poll results and HITL context are visible to the authorized caller and may contain personal data. Minimize those payloads instead of assuming browser input stays private. Report an action as executed only after the service's business execution contract returns authoritative success.

## Feature Matrix

This lists protocol capabilities, not features guaranteed by every implementation. The [local v0.8 references](implementations/reference-service/README.md) advertise their actual subset and do not provide reviewer identity verification, reminders, callbacks or business execution.

| Feature | Details |
|---------|---------|
| **Review types** | `approval`, `selection`, `input`, `confirmation`, `escalation` |
| **Form field types** | `text`, `textarea`, `number`, `date`, `email`, `url`, `boolean`, `select`, `multiselect`, `range`, custom `x-*` |
| **Transport** | Polling (required), SSE (optional), Callback/Webhook (optional) |
| **Inline submit** | `submit_url` + native messaging buttons (Telegram, Slack, Discord, WhatsApp, Teams) — service opt-in |
| **States** | `pending` → `opened` → `in_progress` → `completed` / `expired` / `cancelled` |
| **Security** | Opaque tokens (43 chars, base64url, 256-bit entropy), SHA-256 hash storage, timing-safe comparison, HTTPS only |
| **Multi-round** | `previous_case_id` / `next_case_id` for iterative edit cycles (Approval type) |
| **Forms** | Single-step fields, multi-step wizard, conditional visibility, validation rules, progress tracking |
| **Timeouts** | ISO 8601 duration, `default_action`: `skip` / `approve` / `reject` / `abort` |
| **Discovery** | `.well-known/hitl.json`, SKILL.md `metadata.hitl` extension |
| **Reminders** | `reminder_at` timestamps, `review.reminder` SSE event |
| **Rate limiting** | 60 requests/min per case on poll endpoint, `Retry-After` header |

## Five Review Types

| Type | Actions | Multi-round | Form fields | Use case |
|------|---------|:-----------:|:-----------:|----------|
| **Approval** | `approve`, `edit`, `reject` | Yes | No | Artifact review (CV, email, deployment plan) |
| **Selection** | `select` | No | No | Choose from options (job listings, targets) |
| **Input** | `submit` | No | Yes | Structured data entry (salary, dates, preferences) |
| **Confirmation** | `confirm`, `cancel` | No | No | Irreversible action gate (send emails, deploy) |
| **Escalation** | `retry`, `skip`, `abort` | No | No | Error recovery (deployment failed, API error) |

## Historical v0.8 HITL Object Example

This v0.8 example accompanies the local demos. New v0.9 services use the current versioned contract:

```json
{
  "status": "human_input_required",
  "message": "5 matching jobs found. Please select which ones to apply for.",
  "hitl": {
    "spec_version": "0.8",
    "case_id": "review_abc123",
    "review_url": "https://service.example.com/review/abc123?token=K7xR2mN4pQ...",
    "poll_url": "https://api.service.example.com/v1/reviews/abc123/status",
    "type": "selection",
    "prompt": "Select which jobs to apply for",
    "timeout": "24h",
    "default_action": "skip",
    "created_at": "2026-02-22T10:00:00Z",
    "expires_at": "2026-02-23T10:00:00Z",
    "context": {
      "total_options": 5,
      "query": "Senior Dev Berlin"
    }
  }
}
```

### Historical v0.8 Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `spec_version` | `"0.8"` | Protocol version |
| `case_id` | string | Unique, URL-safe identifier (e.g. `review_{random}`) |
| `review_url` | URL | HTTPS URL to review page with opaque bearer token |
| `poll_url` | URL | Status polling endpoint |
| `type` | enum | `approval` / `selection` / `input` / `confirmation` / `escalation` / `x-*` |
| `prompt` | string | What the human needs to decide (max 500 chars) |
| `created_at` | datetime | ISO 8601 creation timestamp |
| `expires_at` | datetime | ISO 8601 expiration timestamp |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `timeout` | duration | How long the review stays open (`24h`, `PT24H`, `P7D`) |
| `default_action` | enum | `skip` / `approve` / `reject` / `abort` — action on expiry |
| `callback_url` | URL / null | Echoed callback URL if agent provided one |
| `events_url` | URL | SSE endpoint for real-time status events |
| `context` | object | Service-defined data exposed to the authorized caller and review page |
| `reminder_at` | datetime / datetime[] | When to re-send the review URL |
| `previous_case_id` | string | Links to prior case in multi-round chain |
| `surface` | object | UI format declaration (`format`, `version`) |
| `submit_url` | URL | Agent-submit endpoint for channel-native inline buttons (v0.7) |
| `submit_token` | string | Bearer token for `submit_url` authentication (required if `submit_url` set) |
| `inline_actions` | string[] | Actions permitted via `submit_url` (e.g. `["confirm", "cancel"]`). If absent, all actions for the type are allowed. |

## Historical v0.8 Poll Response Example

```json
{
  "status": "completed",
  "case_id": "review_abc123",
  "completed_at": "2026-02-22T10:15:00Z",
  "result": {
    "action": "select",
    "data": {
      "selected": ["job_001", "job_003"]
    }
  }
}
```

The `result` object is present only when `status` is `"completed"`. It contains `action` and may contain a service-defined `data` object. It records the decision; execution success requires a separate authoritative business result.

### Poll Response Statuses

| Status | Terminal | Description | Key fields |
|--------|:--------:|-------------|------------|
| `pending` | No | Case created, no recorded interaction | `expires_at` |
| `opened` | No | Review URL loaded; human presence not established | `opened_at` |
| `in_progress` | No | Service records interaction progress | `progress` (optional) |
| `completed` | Yes | Validated decision recorded | `result`, `completed_at`; verified `responded_by` only when available |
| `expired` | Yes | Timeout reached | `expired_at`, `default_action` |
| `cancelled` | Yes | Case cancelled by the service | `cancelled_at`, optional `reason` |

## State Machine

```
            +---------------------------------------------+
            |                                             v
[created] -> pending -> opened -> in_progress -> completed [terminal]
               |         |          |
               |         |          +---------> cancelled  [terminal]
               |         |
               |         +--> completed     [terminal]
               |         +--> expired       [terminal]
               |         +--> cancelled     [terminal]
               |
               +----------> expired          [terminal]
               +----------> cancelled        [terminal]
```

Terminal states (`completed`, `expired`, `cancelled`) are immutable — no further transitions.

Direct `pending → completed` is valid for an inline response. `in_progress → expired` is also valid. A confirmation action `cancel` completes the case with that decision; cancelling the case itself is a separate lifecycle event.

## For Services: Quick Start

Return HTTP 202 when human input is needed:

The following is application-specific v0.8 pseudocode, not the complete server. Use the [tested reference handlers](implementations/reference-service/README.md) for validation, token purposes, request-time expiry and atomic completion.

```javascript
// Express / Hono / any HTTP framework
app.post('/api/search', async (req, res) => {
  const results = await searchJobs(req.body.query);

  // Create review case with opaque token
  const caseId = `review_${crypto.randomBytes(16).toString('hex')}`;
  const token = crypto.randomBytes(32).toString('base64url'); // 43 chars
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  store.set(caseId, {
    status: 'pending',
    tokenHash,
    results,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });

  res.status(202).json({
    status: 'human_input_required',
    message: `${results.length} jobs found. Please select which ones to apply for.`,
    hitl: {
      spec_version: '0.8',
      case_id: caseId,
      review_url: `https://yourservice.com/review/${caseId}?token=${token}`,
      poll_url: `https://api.yourservice.com/v1/reviews/${caseId}/status`,
      type: 'selection',
      prompt: 'Select which jobs to apply for',
      timeout: '24h',
      default_action: 'skip',
      created_at: store.get(caseId).created_at,
      expires_at: store.get(caseId).expires_at,
    },
  });
});
```

You also need: a review page (any web framework), a poll endpoint (`GET /reviews/:caseId/status`), and a response endpoint (`POST /reviews/:caseId/respond`). See [Service Integration Guide](skills/references/service-integration.md) for full details.

## For Agents: Quick Start

This illustrative v0.8 client uses the browser fallback whenever a verification policy is declared or no explicit inline actions are supplied. Production clients must also validate responses and handle authentication, timeouts and transport errors.

```python
import time, httpx

response = httpx.post("https://api.jobboard.com/search", json=query)

if response.status_code == 202:
    hitl = response.json()["hitl"]

    # Conservative fallback: do not assume a declared policy is satisfied.
    if (hitl.get("submit_url") and hitl.get("submit_token")
            and hitl.get("inline_actions") and not hitl.get("verification_policy")):
        # Render native buttons in messaging platform (e.g. Telegram, Slack)
        send_inline_buttons(hitl["prompt"], hitl["inline_actions"], hitl["review_url"])
        # When human taps button → POST to submit_url (see Agent Integration Guide)
    else:
        # Standard flow: forward URL to human
        send_to_user(f"{hitl['prompt']}\n{hitl['review_url']}")

    # Poll for result (standard flow or fallback)
    while True:
        time.sleep(30)
        poll = httpx.get(hitl["poll_url"], headers=auth).json()

        if poll["status"] == "completed":
            result = poll["result"]  # {action: "select", data: {...}}
            break
        if poll["status"] in ("expired", "cancelled"):
            break
```

No SDK. No UI rendering. Just HTTP + URL forwarding + polling. See [Agent Integration Guide](skills/references/agent-integration.md) for inline submit, SSE, callbacks, multi-round, and edge cases.

## Three Transport Modes

| Transport | Agent needs public endpoint? | Real-time? | Complexity |
|-----------|:---------------------------:|:----------:|:----------:|
| **Polling** (default) | No | No | Minimal |
| **SSE** (optional) | No | Yes | Low |
| **Callback** (optional) | Yes | Yes | Medium |

Polling is the baseline — every HITL-compliant service MUST support it. SSE and callbacks are optional enhancements.

## Channel-Native Inline Actions

For simple decisions, agents can render **native messaging buttons** instead of sending a URL. The human taps a button directly in the chat — no browser switch needed.

**How it works:** The service includes `submit_url` + `submit_token` in the HITL object. The agent detects these fields and renders platform-native buttons. When the human taps a button, the agent POSTs the action to `submit_url`. The messaging platform is passive — it renders whatever the agent sends. No messenger auto-detects HITL support.

**When to use inline buttons:**

| Review type | Inline possible? | Reason |
|-------------|:----------------:|--------|
| **Confirmation** | Yes | 2 buttons: Confirm / Cancel |
| **Escalation** | Yes | 3 buttons: Retry / Skip / Abort |
| **Approval** (simple) | Yes | 2 buttons: Approve / Reject (without edit) |
| **Approval** (with edit) | URL only | Edit requires rich UI |
| **Selection** | URL only | Needs list/cards UI |
| **Input** | URL only | Needs form fields |

**Always include a URL fallback button** (e.g. "Details &#8594;") linking to `review_url` — the human can always switch to the full review page.

**Platform requirements:** The agent must be a platform bot (Telegram Bot via BotFather, Slack App, Discord Bot, WhatsApp Business API, Teams Bot) to send native buttons. See [Agent Integration Guide](skills/references/agent-integration.md) for platform-specific rendering patterns.

## Proof of Human (v0.8)

v0.8 adds an optional verification layer for decisions where the service needs evidence that a human (not the agent) decided:

- `verification_policy` declares when proof is `optional`, `required`, or step-up-only — and for which paths (`inline_submit`, `browser_submit`).
- Before rendering inline buttons, agents MUST preflight the policy: if `inline_submit` requires verification the agent cannot satisfy, fall back to `review_url`.
- `submission_context.verification_result` in poll responses returns normalized, provider-agnostic results. Agents MUST NOT self-attest human verification.
- Browser review is the preferred step-up path — verification happens on the service-hosted page.

See [spec Section 13](spec/v0.8/hitl-protocol.md) and Examples 14–16.

## Delivery via MCP (URL Mode Elicitation)

If your service is exposed through an MCP server, deliver the `review_url` as a URL mode elicitation. MCP standardizes how the handoff reaches the user; HITL defines what happens at the URL and the shape of the structured result. The mechanism depends on the client's MCP revision:

- **MCP 2025-11-25:** the local demo implements `elicitation/create` (`mode: "url"`) and `notifications/elicitation/complete` for clients using this historical binding.
- **MCP 2026-07-28:** the [published specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/) uses MRTR `resultType: "input_required"`; Tasks is a separate optional extension. These mappings are informative and are not implemented by the local MCP demo.

`poll_url` remains the universal fallback in both revisions. See the [MCP Elicitation Binding](docs/mcp-elicitation-binding.md) for per-revision mappings and the runnable [MCP server demo](implementations/mcp-server/) (implements the 2025-11-25 binding).

## Non-Goals

- **Does NOT render review UI** — the service hosts and renders the review page. The agent is a messenger.
- **Does NOT define the review page framework** — any web technology works (React, plain HTML, etc.).
- **Does NOT replace OAuth** — HITL is for decisions, not authentication.
- **Does NOT establish identity or execution authority** — inline channel metadata and browser presence are not trusted human verification; services enforce their declared policy independently.

## SKILL.md Extension for Services

Services that use HITL can declare support in their own SKILL.md frontmatter:

```yaml
metadata:
  hitl:
    supported: true
    types: [selection, confirmation]
    supports_inline_submit: true
    review_base_url: "https://yourservice.com/review"
    timeout_default: "24h"
    info: "May ask user to select preferred jobs or confirm applications."
```

See the [current specification](spec/v0.9/hitl-protocol.md) for the full field reference.

### Service Policy and Optional Preferences

`prefer_hitl` and `skip_hitl` are optional application preferences, not authorization. A service must reject unauthorized callers and independently decide whether review is required. `skip_hitl: true` cannot bypass policy; missing preferences do not disable review. Validate boolean preferences and reject an ambiguous request setting both to true.

Prepare the immutable operation before any side effect. Record an authorized decision separately from execution; recheck current grant, policy, operation version and expiry at commit. The Agent Access profile uses its protected prepare/review/commit APIs rather than a preference flag as an execution grant.

See [Service Integration Guide — Applying Service Policy](skills/references/service-integration.md#applying-service-policy) for explicitly application-specific examples.

### Optional: Quality Improvement Signal

Services can include `improvement_suggestions` in successful (non-202) responses to give agents structured feedback they can act on — without requiring a new HITL flow.

Declare support in your SKILL.md:

```yaml
metadata:
  hitl:
    supported: true
    supports_improvement_suggestions: true
    info: "Returns improvement_suggestions in 201 responses. Agents may offer up to 2 improvement cycles."
```

**Suggestion object schema:**

| Field | Type | Description |
|-------|------|-------------|
| `field` | string | Which data field can be improved |
| `issue` | string | What is missing or suboptimal |
| `agent_action` | string | Exact question/action for the agent to take |
| `impact` | string | Human-readable benefit (e.g. `"+25 quality points"`) |
| `priority` | `"high"` / `"medium"` / `"low"` | Order of importance |

**Agent behavior:**
- Always share the primary result first
- Offer up to **2 improvement cycles** — one question per suggestion, re-submit with enriched data
- Stop when `improvement_suggestions` is empty or `maxAttempts` reached
- Never loop indefinitely

See [Agent Checklist — Quality Improvement Loop](agents/checklist.md#enhanced-quality-improvement-loop) and [Example 13](examples/13-quality-improvement-loop.json).

## RFC Alignment

This protocol and skill documentation are aligned with these core RFCs:

- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) — HTTP semantics (`202 Accepted`, conditional requests, retry behavior)
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) + [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) — normative terms (`MUST`, `SHOULD`, `MAY`)
- [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339) — timestamp formats used by HITL case lifecycle fields
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) — bearer token usage for review and inline submit authorization

For the complete implementation matrix, see [README RFC Alignment](README.md#rfc-alignment).

## Resources

- [Current Specification (v0.9)](spec/v0.9/hitl-protocol.md)
- [Historical Specification (v0.8)](spec/v0.8/hitl-protocol.md)
- [Historical v0.8 OpenAPI](schemas/v0.8/openapi.yaml) — contract for the local examples
- [Historical v0.8 JSON Schemas](schemas/v0.8/) — validate the examples in this skill
- [Current v0.9 JSON Schemas](schemas/) — new consumers and version selection
- [Optional Agent Access Profile](profiles/agent-access/v0.1/README.md) — verified initiator, owner review and explicit execution
- [Reference Implementations](implementations/reference-service/) — Express 5, Hono, Next.js, FastAPI
- [MCP Server Demo](implementations/mcp-server/) — HITL via MCP URL mode elicitation
- [Review Page Templates](templates/) — HTML templates for all 5 review types
- [Examples](examples/) — 16 end-to-end flows (incl. inline confirmation, escalation, hybrid approval, proof-of-human)
- [Agent Implementation Checklist](agents/checklist.md) — detailed agent guide with pseudocode
- [Interactive Playground](playground/)
- [SDK Design Guide](docs/sdk-guide.md) — build a community SDK

Found this useful? Star and contribute at [github.com/rotorstar/hitl-protocol](https://github.com/rotorstar/hitl-protocol) — implementation reports get listed in the README.
