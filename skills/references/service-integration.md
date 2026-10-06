# HITL Protocol — Service Integration Guide

This guide is for **service and website builders** who want to make their service accessible to autonomous agents via HITL Protocol.

It describes the historical **v0.8** review flow used by the local reference services. For the v0.9 operation-bound agent access profile, use the [current specification](../../spec/v0.9/hitl-protocol.md). The local v0.8 demos do not implement production identity verification, durable storage or authorized business execution.

## When to Return HTTP 202

Return HTTP 202 (not 200) when:
- The operation requires human judgment (approve a draft, select from options)
- Sensitive data needs human review before proceeding
- An irreversible action needs human confirmation
- The service needs structured input the agent cannot provide

Return HTTP 200 when the operation completes without human input.

## Applying Service Policy

Treat `prefer_hitl` and `skip_hitl` as optional application-specific preferences. Neither flag authorizes an action or bypasses a required review. Server-derived authorization and policy determine whether execution is allowed and whether review is required. Prepare an immutable operation before requesting review; do not execute the side effect first.

### Decision Matrix

| `prefer_hitl` | `skip_hitl` | Result |
|:-:|:-:|--------|
| `true` | — | HTTP 202 if the caller is authorized; otherwise HTTP 403 |
| — | `true` | Direct execution only if current authorization and policy permit it; otherwise HTTP 202 |
| — | — | Service policy chooses execution or review; unauthorized callers receive HTTP 403 |
| `true` | `true` | HTTP 400 validation error (mutually exclusive) |

### Validation Gate (JavaScript)

Application-specific pseudocode: `prepareAction` must have no business side effects; `evaluateServicePolicy` must use trusted authorization and service policy.

```javascript
app.post('/api/action', async (req, res) => {
  const { prefer_hitl = false, skip_hitl = false, ...params } = req.body;

  // Reject ambiguous requests
  if (typeof prefer_hitl !== 'boolean' || typeof skip_hitl !== 'boolean' || (prefer_hitl && skip_hitl)) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Preferences must be booleans and cannot both be true.',
    });
  }

  const operation = await prepareAction(params);
  const policy = await evaluateServicePolicy(operation, req);
  if (!policy.allowed) return res.status(403).json({ error: 'FORBIDDEN' });
  if (!prefer_hitl && !policy.requires_review) {
    const result = await executeAction(operation);
    return res.status(201).json({ ...result, hitl_skipped: skip_hitl });
  }

  // Persist the operation binding; execution follows a separate authorized commit.
  const hitl = await createReviewCase(operation);
  return res.status(202).json({
    status: 'human_input_required',
    message: hitl.prompt,
    hitl,
  });
});
```

### Validation Gate (Python)

The same application-specific policy boundary applies; the named preparation/policy functions are illustrative, not repository APIs.

```python
@app.post("/api/action")
async def action(request: Request):
    body = await request.json()
    prefer_hitl = body.get("prefer_hitl", False)
    skip_hitl = body.get("skip_hitl", False)

    if not isinstance(prefer_hitl, bool) or not isinstance(skip_hitl, bool) or (prefer_hitl and skip_hitl):
        return JSONResponse(status_code=400, content={
            "error": "VALIDATION_ERROR",
            "message": "Preferences must be booleans and cannot both be true.",
        })

    params = {key: value for key, value in body.items() if key not in ("prefer_hitl", "skip_hitl")}
    operation = await prepare_action(params)
    policy = await evaluate_service_policy(operation, request)
    if not policy.allowed:
        return JSONResponse(status_code=403, content={"error": "FORBIDDEN"})
    if not prefer_hitl and not policy.requires_review:
        result = await execute_action(operation)
        return JSONResponse(status_code=201, content={**result, "hitl_skipped": skip_hitl})

    hitl = await create_review_case(operation)
    return JSONResponse(status_code=202, content={
        "status": "human_input_required",
        "message": hitl["prompt"],
        "hitl": hitl,
    })
```

### HITL Continuation Chains

When a HITL flow triggers a follow-up request (e.g. `next_case_id`), the agent is already in a HITL context. In this case, neither flag is needed — derive `prefer_hitl` after authenticating the caller and checking ownership of the stored previous case. A caller-supplied ID alone grants no rights:

```javascript
// Only a persisted, caller-owned previous case establishes a continuation.
const previousCase = await findOwnedCase(req.body.previous_case_id, authenticatedCaller);
const isHitlContinuation = Boolean(previousCase);
const effectivePreferHitl = prefer_hitl || isHitlContinuation;
```

### Documenting in Your SKILL.md

An application-specific metadata example makes the service policy explicit:

```yaml
metadata:
  hitl:
    supported: true
    types: [selection, confirmation]
    info: "Service policy determines whether review is required. Optional preferences never bypass authorization or required review."
```

## Implementation Checklist

- [ ] Return HTTP 202 with `hitl` object when human input is needed
- [ ] Generate opaque bearer token (43 chars, base64url, 256-bit entropy)
- [ ] Store only SHA-256 hash of token (never store raw token)
- [ ] Host a review page at `review_url`
- [ ] Implement poll endpoint at `poll_url` (GET, returns status + result)
- [ ] Implement response endpoint (POST, accepts human's decision)
- [ ] Enforce one-response per case (409 Conflict on duplicate)
- [ ] Implement state machine with valid transitions only
- [ ] Set appropriate timeout and default_action
- [ ] Return `Retry-After` header on rate limit (429)

## Versioned Data Contracts

Use the canonical [v0.8 HITL object schema](../../schemas/v0.8/hitl-object.schema.json), [submit schema](../../schemas/v0.8/submit-request.schema.json) and [poll schema](../../schemas/v0.8/poll-response.schema.json), with explicit `@hitl-protocol/schemas/v0.8` imports. The emitted `spec_version` is `"0.8"`. Field constraints, defaults and optional extensions come from those schemas rather than a second table in this guide. New v0.9 consumers use the separate [v0.9 schemas](../../schemas/README.md); do not mix their contracts.

## Security: Token Generation

```javascript
import crypto from 'crypto';

// Generate opaque bearer token (43 chars, 256-bit entropy)
const token = crypto.randomBytes(32).toString('base64url');

// Store ONLY the hash — never persist the raw token
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

// Build review URL
const reviewUrl = `https://yourservice.com/review/${caseId}?token=${token}`;

// Verify token on review page access
function verifyToken(incomingToken, storedHash) {
  const incomingHash = crypto.createHash('sha256').update(incomingToken).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(incomingHash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}
```

**Properties of the local opaque token model:**
- 32 random bytes produce a 43-character base64url token
- Possession model — sharing the URL shares its capability; it does not authenticate a human or establish approval authority
- SHA-256 hash storage — compromised DB doesn't leak tokens

## State Machine

All valid transitions:

| From | To | Trigger |
|------|----|---------|
| *(created)* | `pending` | Service creates case |
| `pending` | `opened` | Review URL is loaded; this is not evidence of human presence |
| `pending` | `completed` | A validated response completes the case, including inline submission |
| `pending` | `expired` | Timeout reached |
| `pending` | `cancelled` | Service cancels the case |
| `opened` | `in_progress` | Human starts interacting with form |
| `opened` | `completed` | Human submits response |
| `opened` | `expired` | Timeout reached |
| `opened` | `cancelled` | Service cancels the case |
| `in_progress` | `completed` | Human submits response |
| `in_progress` | `expired` | Timeout reached |
| `in_progress` | `cancelled` | Service cancels the case |

**Terminal states** (`completed`, `expired`, `cancelled`) are **immutable** — no transitions out.

For confirmation reviews, a submitted `cancel` is a completed decision with `result.action: "cancel"`; it is distinct from cancelling the review case itself.

**Optional intermediate states:** `opened` and `in_progress` are optional. Services that don't track page views may transition directly from `pending` to terminal states.

## Poll Endpoint Implementation

The local route is `GET /api/reviews/{caseId}/status`. Use the tested [Express implementation](../../implementations/reference-service/express/server.js), [Hono implementation](../../implementations/reference-service/hono/server.js), [Next.js route](../../implementations/reference-service/nextjs/app/api/reviews/[caseId]/status/route.ts) or [FastAPI implementation](../../implementations/reference-service/python/server.py) as the v0.8 producer example.

Resolve request-time expiry before checking the ETag and serialize only fields guaranteed by the canonical poll schema. Node consumers share [`pollCase`](../../packages/core/src/review.ts). `submission_context` contains claimed channel metadata; populate `responded_by` only from a trusted identity verifier.

The local demos deliberately leave polling unauthenticated. A production service must authenticate the caller and enforce case ownership before returning status or result data. A case ID alone is not authorization.

### Rate Limiting

- Recommend 60 requests/min per case
- Return HTTP 429 with `Retry-After` header when exceeded
- Support `ETag` / `If-None-Match` for efficient polling (304 Not Modified)

## Review Page

The review page is hosted by your service. Use any web framework. Requirements:

1. **Verify token** — check opaque token against stored SHA-256 hash
2. **Display context** — render the review UI based on `type` and `context`
3. **Collect response** — submit human's decision to response endpoint
4. **One response only** — return 409 Conflict on duplicate submission

The service renders the canonical review page. Agents can also load URLs, so a page view alone is not human verification. Include only data that the initiating caller is authorized to read in the HITL object and poll result.

HTML templates for all 5 review types are available in [templates/](../../templates/).

## Response Endpoint

```
POST /reviews/{caseId}/respond?token=<review-token>
Content-Type: application/json
```

```json
{
  "action": "select",
  "data": {
    "selected": ["job_001", "job_003"]
  }
}
```

Valid `action` values per type:

| Type | Valid actions |
|------|-------------|
| Approval | `approve`, `edit`, `reject` |
| Selection | `select` |
| Input | `submit` |
| Confirmation | `confirm`, `cancel` |
| Escalation | `retry`, `skip`, `abort` |

## Form Field Definitions (Input Type)

For `input`-type reviews, include a `form` object in `context`:

### Single-Step Form

```json
{
  "context": {
    "form": {
      "fields": [
        {
          "key": "salary",
          "label": "Salary Expectation (EUR)",
          "type": "number",
          "required": true,
          "sensitive": true,
          "validation": { "min": 0, "max": 1000000 }
        },
        {
          "key": "start_date",
          "label": "Earliest Start Date",
          "type": "date",
          "required": true
        }
      ]
    }
  }
}
```

### Multi-Step Wizard

```json
{
  "context": {
    "form": {
      "session_id": "form_sess_x7k9m2",
      "steps": [
        {
          "title": "Personal Information",
          "description": "Basic contact details",
          "fields": [
            { "key": "full_name", "label": "Full Name", "type": "text", "required": true },
            { "key": "email", "label": "Email", "type": "email", "required": true }
          ]
        },
        {
          "title": "Preferences",
          "fields": [
            {
              "key": "employment_type",
              "label": "Employment Type",
              "type": "select",
              "required": true,
              "options": [
                { "value": "fulltime", "label": "Full-time" },
                { "value": "parttime", "label": "Part-time" }
              ]
            },
            {
              "key": "salary_range",
              "label": "Expected Salary (EUR)",
              "type": "range",
              "sensitive": true,
              "validation": { "min": 40000, "max": 200000 },
              "conditional": {
                "field": "employment_type",
                "operator": "eq",
                "value": "fulltime"
              }
            }
          ]
        }
      ]
    }
  }
}
```

Use `fields` (single-step) **or** `steps` (multi-step), never both.

### Form Contract and Local Consumer Limits

Use the canonical [v0.8 form field schema](../../schemas/v0.8/form-field.schema.json) for field types, names, constraints and optional properties. These form examples illustrate protocol capabilities; the local reference services create the single-step salary/date/work-authorization demo form.

The input template has wizard rendering code, but the local FastAPI validator covers its demo form rather than arbitrary wizard definitions. The template does not fetch `default_ref`; `sensitive` currently adds a CSS class without masking. Production consumers must implement privacy controls and verify their supported form flows rather than infer them from an optional schema field.

### Progress Tracking (Optional)

When a human is working on a multi-step form, include `progress` in `in_progress` poll responses:

```json
{
  "status": "in_progress",
  "progress": {
    "current_step": 2,
    "total_steps": 3,
    "completed_fields": 4,
    "total_fields": 8
  }
}
```

## SSE Event Stream (Optional)

If you implement real-time events, expose an `events_url`:

```
GET /v1/reviews/{caseId}/events
Accept: text/event-stream
```

Event types:

| Event | When | Data |
|-------|------|------|
| `review.opened` | Review URL loads | `{case_id, status}` |
| `review.in_progress` | Service tracks interaction | `{case_id, status}` |
| `review.completed` | Validated submission completes the case | `{case_id, status, result}` for the transition event |
| `review.expired` | Timeout reached | `{case_id, status}` |
| `review.cancelled` | Service cancels the case | `{case_id, status}` |

Local demos emit the current state on connection and include event IDs, but do not persist an event replay buffer or honor `Last-Event-ID` for historical replay. Use the poll endpoint for the authoritative full result and timestamps after reconnection. Reminder events are not implemented by these demos.

## Callback/Webhook (Optional)

The local demos do not implement callback delivery. Keep the historical v0.8 payload contract when integrating with them, and apply the current [callback authentication, replay and destination-security requirements](../../spec/v0.9/hitl-protocol.md#callback-destination-security) to any production callback implementation. An untrusted callback can only wake bounded authenticated polling; it cannot supply an authoritative decision or polling URL.

When the agent includes `hitl_callback_url` in the original request:

1. Echo it in `hitl.callback_url`
2. POST to the callback URL when the case reaches a terminal state
3. Sign with `X-HITL-Signature: sha256=<hmac>` (HMAC-SHA256 of request body)
4. Retry with exponential backoff (up to 3 attempts)

```json
POST {callback_url}
X-HITL-Signature: sha256=abc123...
Content-Type: application/json

{
  "event": "review.completed",
  "case_id": "review_abc123",
  "completed_at": "2026-02-22T10:15:00Z",
  "result": {
    "action": "select",
    "data": { "selected": ["job_001"] }
  }
}
```

## Service Discovery (Optional)

Expose a `.well-known/hitl.json` endpoint:

```json
{
  "hitl_protocol": {
    "spec_version": "0.8",
    "service": { "name": "JobBoard Pro", "url": "https://jobboard.example.com" },
    "capabilities": {
      "review_types": ["selection", "confirmation"],
      "transports": ["polling", "sse"],
      "default_timeout": "PT24H",
      "supports_signatures": false,
      "supports_agent_binding": false
    },
    "endpoints": {
      "review_page_base": "https://jobboard.example.com/review",
      "reviews_base": "https://api.jobboard.example.com/v1/reviews"
    }
  }
}
```

## Multi-Round Reviews (Approval Type)

For iterative edit cycles:

1. Service creates case with `type: "approval"`
2. Human responds with `action: "edit"` + feedback in `data`
3. Service creates new case with `previous_case_id` linking to the original
4. Poll response of original case includes `next_case_id`
5. Repeat until human responds with `action: "approve"` or `"reject"`

## SKILL.md Extension

Declare HITL support in your service's SKILL.md frontmatter (see the [v0.8 specification](../../spec/v0.8/hitl-protocol.md)):

```yaml
metadata:
  hitl:
    supported: true
    types: [selection, confirmation]
    review_base_url: "https://yourservice.com/review"
    timeout_default: "24h"
    info: "May ask user to select jobs or confirm applications."
```

| Field | Required | Description |
|-------|----------|-------------|
| `metadata.hitl.supported` | REQUIRED | `true` if service may return HITL responses |
| `metadata.hitl.types` | RECOMMENDED | Which review types the service may trigger |
| `metadata.hitl.review_base_url` | OPTIONAL | Base URL for review pages |
| `metadata.hitl.timeout_default` | OPTIONAL | Typical timeout duration |
| `metadata.hitl.info` | RECOMMENDED | When/why HITL is triggered (max 200 chars) |

## Reference Implementations

Working implementations in 4 frameworks:

| Framework | Path | Language |
|-----------|------|----------|
| Express 5 | [implementations/reference-service/express/](../../implementations/reference-service/express/) | Node.js |
| Hono | [implementations/reference-service/hono/](../../implementations/reference-service/hono/) | Node.js in this example |
| Next.js | [implementations/reference-service/nextjs/](../../implementations/reference-service/nextjs/) | TypeScript |
| FastAPI | [implementations/reference-service/python/](../../implementations/reference-service/python/) | Python |

## Common Implementation Mistakes

The local runtime tests check these integration mistakes:

### Mistake 1: Accepting Both Tokens Interchangeably (Security Critical)

**Wrong:**
```javascript
function verifyToken(token, hitlCase) {
  if (matchesHash(token, hitlCase.review_token_hash)) return true
  if (matchesHash(token, hitlCase.submit_token_hash)) return true  // ← WRONG
  return false
}
```

**Why it's dangerous:** If the `review_url` leaks (shared in chat, bookmarked, forwarded), an attacker can use the review token to make inline submissions — defeating the entire dual-token security model.

**Right:** Add a `purpose` parameter:
```javascript
function verifyToken(token, hitlCase, purpose) {
  if (purpose === 'review') return matchesHash(token, hitlCase.review_token_hash)
  if (purpose === 'submit') return matchesHash(token, hitlCase.submit_token_hash)
  return false
}
```

See [Spec Section 7.5](../../spec/v0.7/hitl-protocol.md) — `submit_token` MUST be different from the review URL token.

### Mistake 2: Wrong Body Format for Inline Submit

**Wrong:** Expecting `{ result: { action, data } }` for Bearer-authenticated inline submissions.

**Right:** Two distinct formats depending on the auth path:
- **Inline submit (Bearer header):** `{ action, data, submitted_via, submitted_by }` — flat
- **Review page (URL token):** `{ action, data }`

See [Spec Section 7.5.1](../../spec/v0.7/hitl-protocol.md) for the inline submit request body.

### Mistake 3: HTTP 422 Instead of 403 for Invalid Inline Actions

**Wrong:** Returning `422 Unprocessable Entity` when an action is not in `inline_actions`.

**Right:** Return **403 Forbidden** and direct the consumer to the original `hitl.review_url`. An error may also include a `review_url` hint; the local demos do not return that hint:
```json
{
  "error": "action_not_inline",
  "message": "Use the original HITL review URL for this action.",
  "case_id": "review_abc123"
}
```

This lets the agent fall back to the browser flow gracefully. The human can complete the action on the full review page.

## JSON Schema Validation

Validate your HITL objects and poll responses:

- [v0.8 HITL object schema](../../schemas/v0.8/hitl-object.schema.json)
- [v0.8 poll schema](../../schemas/v0.8/poll-response.schema.json)
- [v0.8 form schema](../../schemas/v0.8/form-field.schema.json)
- [v0.8 OpenAPI document](../../schemas/v0.8/openapi.yaml)

## Compliance Tests

Run the test suites against your implementation:

- Node.js (Vitest): [tests/node/](../../tests/node/)
- Python (pytest): [tests/python/](../../tests/python/)
