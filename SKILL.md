---
name: hitl-protocol
description: "HITL Protocol — the open standard for human decisions in agent workflows. Learn how services return HTTP 202 with a review URL when human input is needed, how agents detect and handle HITL responses (forward URL, poll for result), and how humans make structured decisions via rich browser UI. Covers: approval, selection, input, confirmation, escalation review types. Three transport modes: polling, SSE, callbacks. Use when building HITL-compliant services or HITL-aware agents."
license: Apache-2.0
compatibility:
  - claude
  - codex
  - gemini
  - openclaw
  - goose
  - copilot
metadata:
  version: "0.5"
  spec_url: "https://github.com/rotorstar/hitl-protocol/blob/main/spec/v0.5/hitl-protocol.md"
  hitl:
    supported: true
    types: [approval, selection, input, confirmation, escalation]
    info: "Teaches the HITL Protocol itself — for building HITL services and HITL-aware agents."
---

# HITL Protocol

HITL Protocol is to human decisions what OAuth is to authentication — an open standard connecting **Services**, **Agents**, and **Humans**. When a service needs human input, it returns HTTP 202 with a review URL. The agent forwards the URL to the human. The human opens it in a browser, gets a rich UI, and makes an informed decision. The agent polls for the structured result and continues.

**No SDK required. No UI framework mandated. Just HTTP + URL + polling.**

## Who Are You?

| Your role | You want to... | Read |
|-----------|----------------|------|
| Service/website builder | Add HITL endpoints to your API so agents can request human input | [Service Integration Guide](skills/references/service-integration.md) |
| Agent developer | Handle HTTP 202 + HITL responses from services | [Agent Integration Guide](skills/references/agent-integration.md) |
| Both / Learning | Understand the full protocol | Continue reading below |

## The Flow

```
1. Human → Agent:    "Find me jobs in Berlin"
2. Agent → Service:  POST /api/search {query: "Senior Dev Berlin"}
3. Service → Agent:  HTTP 202 + hitl object (review_url, poll_url, type, prompt)
4. Agent → Human:    "Found 5 jobs. Review here: {review_url}"
5. Human → Browser:  Opens review_url → rich UI (cards, forms, buttons)
6. Human → Service:  Makes selection, clicks Submit
7. Agent → Service:  GET {poll_url} → {status: "completed", result: {action, data}}
8. Agent → Human:    "Applied to 2 selected jobs."
```

The agent never renders UI. The service hosts the review page. Sensitive data stays in the browser — never passes through the agent.

## Feature Matrix

| Feature | Details |
|---------|---------|
| **Review types** | `approval`, `selection`, `input`, `confirmation`, `escalation` |
| **Form field types** | `text`, `textarea`, `number`, `date`, `email`, `url`, `boolean`, `select`, `multiselect`, `range`, custom `x-*` |
| **Transport** | Polling (required), SSE (optional), Callback/Webhook (optional) |
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

## HITL Object (HTTP 202 Response Body)

When a service needs human input, it returns HTTP 202 with this structure:

```json
{
  "status": "human_input_required",
  "message": "5 matching jobs found. Please select which ones to apply for.",
  "hitl": {
    "spec_version": "0.5",
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

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `spec_version` | `"0.5"` | Protocol version |
| `case_id` | string | Unique, URL-safe identifier (pattern: `review_{random}`) |
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
| `context` | object | Arbitrary data for the review page (not processed by agent) |
| `reminder_at` | datetime / datetime[] | When to re-send the review URL |
| `previous_case_id` | string | Links to prior case in multi-round chain |
| `surface` | object | UI format declaration (`format`, `version`) |

## Poll Response (Completed)

```json
{
  "status": "completed",
  "case_id": "review_abc123",
  "completed_at": "2026-02-22T10:15:00Z",
  "result": {
    "action": "select",
    "data": {
      "selected_jobs": ["job-123", "job-456"],
      "note": "Only remote positions"
    }
  }
}
```

The `result` object is present only when `status` is `"completed"`. It always contains `action` (string) and `data` (object with type-dependent content).

### Poll Response Statuses

| Status | Terminal | Description | Key fields |
|--------|:--------:|-------------|------------|
| `pending` | No | Case created, human hasn't opened URL | `expires_at` |
| `opened` | No | Human opened the review URL | `opened_at` |
| `in_progress` | No | Human is interacting with the form | `progress` (optional) |
| `completed` | Yes | Human submitted response | `result`, `completed_at`, `responded_by` |
| `expired` | Yes | Timeout reached | `expired_at`, `default_action` |
| `cancelled` | Yes | Human clicked cancel | `cancelled_at`, `reason` |

## State Machine

```
            ┌─────────────────────────────────────────┐
            │                                         ▼
[created] → pending → opened → in_progress → completed [terminal]
               │         │          │
               │         │          └──────→ cancelled  [terminal]
               │         │
               │         └──→ completed     [terminal]
               │         └──→ expired       [terminal]
               │         └──→ cancelled     [terminal]
               │
               └─────────→ expired          [terminal]
               └─────────→ cancelled        [terminal]
```

Terminal states (`completed`, `expired`, `cancelled`) are immutable — no further transitions.

## For Services: Quick Start

Return HTTP 202 when human input is needed:

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
      spec_version: '0.5',
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

Handle HTTP 202 responses — ~15 lines:

```python
import time, httpx

response = httpx.post("https://api.jobboard.com/search", json=query)

if response.status_code == 202:
    hitl = response.json()["hitl"]

    # 1. Forward URL to human
    send_to_user(f"{hitl['prompt']}\n{hitl['review_url']}")

    # 2. Poll for result
    while True:
        time.sleep(30)
        poll = httpx.get(hitl["poll_url"], headers=auth).json()

        if poll["status"] == "completed":
            result = poll["result"]  # {action: "select", data: {...}}
            break
        if poll["status"] in ("expired", "cancelled"):
            break
```

No SDK. No UI rendering. Just HTTP + URL forwarding + polling. See [Agent Integration Guide](skills/references/agent-integration.md) for SSE, callbacks, multi-round, and edge cases.

## Three Transport Modes

| Transport | Agent needs public endpoint? | Real-time? | Complexity |
|-----------|:---------------------------:|:----------:|:----------:|
| **Polling** (default) | No | No | Minimal |
| **SSE** (optional) | No | Yes | Low |
| **Callback** (optional) | Yes | Yes | Medium |

Polling is the baseline — every HITL-compliant service MUST support it. SSE and callbacks are optional enhancements.

## Non-Goals

- **Does NOT render review UI** — the service hosts and renders the review page. The agent is a messenger.
- **Does NOT define the review page framework** — any web technology works (React, plain HTML, etc.).
- **Does NOT replace OAuth** — HITL is for decisions, not authentication.
- **Does NOT submit on behalf of the human** — unless explicitly delegated.

## SKILL.md Extension for Services

Services that use HITL can declare support in their own SKILL.md frontmatter:

```yaml
metadata:
  hitl:
    supported: true
    types: [selection, confirmation]
    review_base_url: "https://yourservice.com/review"
    timeout_default: "24h"
    info: "May ask user to select preferred jobs or confirm applications."
```

See [spec Section 12](spec/v0.5/hitl-protocol.md) for the full field reference.

## Resources

- [Full Specification (v0.5)](spec/v0.5/hitl-protocol.md)
- [OpenAPI 3.1 Spec](schemas/openapi.yaml) — all endpoints documented
- [JSON Schemas](schemas/) — HITL object, poll response, form field definitions
- [Reference Implementations](implementations/reference-service/) — Express 5, Hono, Next.js, FastAPI
- [Review Page Templates](templates/) — HTML templates for all 5 review types
- [Examples](examples/) — 8 end-to-end flows
- [Agent Implementation Checklist](agents/checklist.md) — detailed agent guide with pseudocode
- [Interactive Playground](playground/)
- [SDK Design Guide](docs/sdk-guide.md) — build a community SDK
