# HITL Protocol — Reference Service Implementations

Four framework variants implementing the exact same HITL Protocol endpoints. Choose the one that matches your stack.

## Variants

| Variant | Framework | Port | Lines | Best For |
|---------|-----------|------|-------|----------|
| [`express/`](express/) | Express 5 | 3456 | ~300 | Maximum familiarity, any Node.js project |
| [`hono/`](hono/) | Hono | 3457 | ~280 | Edge/serverless (Deno, Bun, Cloudflare Workers) |
| [`nextjs/`](nextjs/) | Next.js 16 (App Router) | 3459 | ~360 | Full-stack React, server-rendered review pages |
| [`python/`](python/) | FastAPI | 3458 | ~250 | Python ecosystem |

## Quick Start

### Express 5

```bash
cd express && npm install && npm start
curl -X POST http://localhost:3456/api/demo?type=selection
```

### Hono

```bash
cd hono && npm install && npm start
curl -X POST http://localhost:3457/api/demo?type=selection
```

### Next.js

```bash
cd nextjs && npm install && npm run dev
curl -X POST http://localhost:3459/api/demo?type=selection
```

### FastAPI

```bash
cd python && pip install -r requirements.txt && uvicorn server:app --port 3458
curl -X POST http://localhost:3458/api/demo?type=selection
```

## Shared Endpoints

All variants implement the same routes:

| Method | Path | Status Codes | Description |
|--------|------|:------------:|-------------|
| POST | `/api/demo?type={type}` | 202 | Create a demo review case |
| GET | `/review/{caseId}?token={token}` | 200, 401, 404 | Serve review page (HTML template) |
| POST | `/reviews/{caseId}/respond?token={token}` | 200, 401, 409, 410 | Submit via review page (query token) |
| POST | `/reviews/{caseId}/respond` + Bearer | 200, 401, 403, 409, 410 | Submit via agent inline (Bearer token) |
| GET | `/api/reviews/{caseId}/status` | 200, 304, 429 | Poll status (ETag, Retry-After) |
| GET | `/api/reviews/{caseId}/events` | 200 (SSE) | Server-Sent Events stream |
| GET | `/.well-known/hitl.json` | 200 | Discovery endpoint |

## Review Types

Use the `?type=` query parameter with `/api/demo`:

| Type | Description | Actions |
|------|-------------|---------|
| `selection` | Job search — select from 3 positions | select |
| `approval` | Deployment — approve, edit, or reject | approve, edit, reject |
| `input` | Application — salary, date, work auth form | submit |
| `confirmation` | Email — confirm sending 2 emails | confirm, cancel |
| `escalation` | Deploy failed — retry, skip, or abort | retry, skip, abort |

## Full Flow (curl)

### Standard Flow (review page)

```bash
# 1. Create a review case
RESPONSE=$(curl -s -X POST http://localhost:3456/api/demo?type=selection)
echo "$RESPONSE" | jq .

# 2. Extract URLs
REVIEW_URL=$(echo "$RESPONSE" | jq -r '.hitl.review_url')
POLL_URL=$(echo "$RESPONSE" | jq -r '.hitl.poll_url')
TOKEN=$(echo "$REVIEW_URL" | grep -oP 'token=\K[^&]+')
CASE_ID=$(echo "$RESPONSE" | jq -r '.hitl.case_id')

# 3. Open review page in browser
open "$REVIEW_URL"  # macOS
# xdg-open "$REVIEW_URL"  # Linux

# 4. Poll for status
curl -s "$POLL_URL" | jq .

# 5. Submit response (or use browser)
curl -s -X POST "http://localhost:3456/reviews/${CASE_ID}/respond?token=${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"action":"select","data":{"selected":["job_001","job_003"]}}'

# 6. Poll again — should be completed
curl -s "$POLL_URL" | jq .
```

### Inline Flow (agent submit via Bearer token)

For confirmation/escalation/approval types, agents can submit directly without a browser:

```bash
# 1. Create a confirmation case
RESPONSE=$(curl -s -X POST http://localhost:3456/api/demo?type=confirmation)
CASE_ID=$(echo "$RESPONSE" | jq -r '.hitl.case_id')
SUBMIT_TOKEN=$(echo "$RESPONSE" | jq -r '.hitl.submit_token')
SUBMIT_URL=$(echo "$RESPONSE" | jq -r '.hitl.submit_url')

# 2. Submit inline via Bearer token (flat body format)
curl -s -X POST "$SUBMIT_URL" \
  -H "Authorization: Bearer ${SUBMIT_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"action":"confirm","submitted_via":"cli"}'
```

Note: The `submit_token` is separate from the review URL token — each is scope-restricted and validated independently. See [spec Section 7.5](../../spec/v0.6/hitl-protocol.md) for security details.

## Features Demonstrated

- **Dual Token Security** — Separate `review_token` (browser) and `submit_token` (agent), each SHA-256 hashed, scope-validated via `verifyTokenForPurpose()`
- **Inline Submit (v0.6)** — `submit_url` + `submit_token` + `inline_actions` in HITL response; Bearer auth for agent-driven submissions
- **State Machine** — 6 states with validated transitions
- **ETag / If-None-Match** — Efficient polling (304 Not Modified)
- **Rate Limiting** — 60 req/min per case, 429 with Retry-After
- **One-Time Response** — 409 Conflict on duplicate submission
- **403 + review_url** — Invalid inline action returns 403 with fallback URL
- **SSE** — Real-time event stream with heartbeat
- **Discovery** — `/.well-known/hitl.json` with `supports_inline_submit: true`
- **All 5 Review Types** — With type-specific sample data and inline actions

## Differences Between Variants

| Aspect | Express 5 | Hono | Next.js | FastAPI |
|--------|-----------|------|---------|---------|
| SSE | `res.write()` | `streamSSE()` | `ReadableStream` | `StreamingResponse` |
| Templates | `readFileSync` + replace | `readFileSync` + replace | `dangerouslySetInnerHTML` | `readFileSync` + replace |
| TypeScript | JavaScript (ES modules) | JavaScript (ES modules) | Native TypeScript | Python (type hints) |
| Edge ready | No | Yes (Deno/Bun/CF) | Yes (Vercel Edge) | No |
| Auto-reload | No | No | Yes (Fast Refresh) | Yes (uvicorn --reload) |

## Inline Actions by Review Type

| Type | `inline_actions` | Inline possible? |
|------|-----------------|:----------------:|
| `confirmation` | `["confirm", "cancel"]` | Yes |
| `escalation` | `["retry", "skip", "abort"]` | Yes |
| `approval` | `["approve", "reject"]` | Yes |
| `selection` | — | No (needs list UI) |
| `input` | — | No (needs form fields) |

Types without inline support omit `submit_url`, `submit_token`, and `inline_actions` from the HITL response. Agents fall back to the standard review URL flow.

## Production Notes

These are **reference implementations** for learning and testing. For production:

- Replace in-memory `Map` with a database (Postgres, Redis, etc.)
- Add proper authentication (OAuth, API keys)
- Add HTTPS (required by spec)
- Add request body validation (Zod, Pydantic, etc.)
- Implement `responded_by` from actual user identity
- Add proper logging and monitoring
