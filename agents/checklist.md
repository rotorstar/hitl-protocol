# Agent Implementation Checklist

This document provides a step-by-step guide for implementing HITL Protocol support in an autonomous agent.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Your Agent                         │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   HTTP       │  │   HITL       │  │   Message     │  │
│  │   Client     │──│   Handler    │──│   Delivery    │  │
│  │             │  │              │  │               │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
│                          │                              │
│                   ┌──────┴───────┐                      │
│                   │   Poll       │                      │
│                   │   Manager    │                      │
│                   └──────────────┘                      │
└─────────────────────────────────────────────────────────┘
         │                  │                    │
    API calls          Poll/SSE            Telegram/Slack
         │                  │              WhatsApp/CLI
         ▼                  ▼                    ▼
    ┌─────────┐      ┌─────────┐          ┌─────────┐
    │ Service │      │ Service │          │  Human  │
    │  API    │      │  Poll   │          │         │
    └─────────┘      └─────────┘          └─────────┘
```

## Decision Tree

```
Agent receives HTTP response from service
│
├── Status 200
│   └── Use result directly, continue workflow
│
├── Status 202 + "hitl" in body
│   ├── Extract hitl.review_url and hitl.prompt
│   ├── Send URL + prompt to human via messaging channel
│   │
│   ├── Transport: choose one
│   │   ├── Polling (default): GET hitl.poll_url every 30s-5min
│   │   ├── SSE: connect to hitl.events_url, listen for events
│   │   └── Callback: register hitl_callback_url, wait for POST
│   │
│   ├── On status "pending"
│   │   └── Continue waiting
│   │
│   ├── On status "opened"
│   │   └── (Optional) Inform human "Review page opened"
│   │
│   ├── On status "in_progress"
│   │   └── (Optional) Inform human "Reviewer is working on it"
│   │
│   ├── On status "completed"
│   │   ├── Extract result.action and result.data
│   │   ├── Check for next_case_id (multi-round)
│   │   └── Continue workflow with structured result
│   │
│   ├── On status "expired"
│   │   ├── Read default_action from hitl object
│   │   ├── Execute default_action (skip/approve/reject/abort)
│   │   └── Inform human "Review expired, using default: {action}"
│   │
│   └── On status "cancelled"
│       ├── Read reason
│       └── Inform human "Review cancelled: {reason}"
│
├── Status 4xx
│   └── Handle client error (bad request, auth, etc.)
│
└── Status 5xx
    └── Handle server error (retry with backoff)
```

## Minimum Implementation (Polling)

The simplest HITL-compliant agent needs only these capabilities:

### Checklist

- [ ] **Detect HTTP 202** — Check response status code for 202
- [ ] **Parse HITL object** — Extract `hitl` from response body JSON
- [ ] **Validate required fields** — Ensure `review_url`, `poll_url`, `type`, `prompt`, `case_id` exist
- [ ] **Forward review URL** — Send `hitl.review_url` to the human with `hitl.prompt` as context
- [ ] **Poll for result** — `GET hitl.poll_url` at 30-second to 5-minute intervals
- [ ] **Handle `completed`** — Extract `result.action` and `result.data`, continue workflow
- [ ] **Handle `expired`** — Execute `hitl.default_action` or inform user
- [ ] **Handle `cancelled`** — Inform user, abort or skip depending on workflow

### Pseudocode

```python
import time
import httpx

def handle_response(response, send_to_user):
    if response.status_code != 202:
        return response.json()  # Normal response

    body = response.json()
    hitl = body.get("hitl")
    if not hitl:
        return body  # 202 without HITL (standard async)

    # Forward URL to human
    message = body.get("message", hitl["prompt"])
    send_to_user(f"{message}\n\n{hitl['review_url']}")

    # Poll for result
    while True:
        time.sleep(30)
        poll = httpx.get(
            hitl["poll_url"],
            headers={"Authorization": "Bearer <token>"}
        ).json()

        status = poll["status"]

        if status == "completed":
            return poll["result"]

        if status == "expired":
            return {
                "action": hitl.get("default_action", "skip"),
                "data": {},
                "expired": True
            }

        if status == "cancelled":
            return {
                "action": "cancelled",
                "data": {"reason": poll.get("reason")},
                "cancelled": True
            }

        # pending, opened, in_progress → keep polling
```

## Enhanced: SSE Transport

Add real-time status updates without a public endpoint.

### Additional Checklist

- [ ] **Connect to SSE** — If `hitl.events_url` exists, open SSE connection
- [ ] **Handle events** — Process `review.opened`, `review.in_progress`, `review.completed`, `review.expired`, `review.cancelled`, `review.reminder`
- [ ] **Reconnection** — Track `Last-Event-ID`, reconnect on disconnect
- [ ] **Fallback to polling** — If SSE connection fails, fall back to polling

### Pseudocode

```python
import httpx_sse

def handle_hitl_sse(hitl, send_to_user):
    events_url = hitl.get("events_url")
    if not events_url:
        return handle_hitl_polling(hitl, send_to_user)  # Fallback

    try:
        with httpx_sse.connect(events_url, headers=auth) as sse:
            for event in sse:
                if event.event == "review.opened":
                    send_to_user("Review page opened")

                elif event.event == "review.completed":
                    data = json.loads(event.data)
                    return data["result"]

                elif event.event == "review.expired":
                    data = json.loads(event.data)
                    return {"action": data["default_action"], "expired": True}

                elif event.event == "review.cancelled":
                    data = json.loads(event.data)
                    return {"action": "cancelled", "reason": data.get("reason")}

                elif event.event == "review.reminder":
                    send_to_user(f"Reminder: {hitl['review_url']}")

    except ConnectionError:
        return handle_hitl_polling(hitl, send_to_user)  # Fallback
```

## Enhanced: Callback Transport

For agents with publicly reachable endpoints.

### Additional Checklist

- [ ] **Expose webhook endpoint** — `POST /webhooks/hitl` on agent's server
- [ ] **Include callback URL** — Add `hitl_callback_url` in original API requests
- [ ] **Verify signatures** — Check `X-HITL-Signature: sha256=<hmac>` header
- [ ] **Handle callback events** — Process `review.completed`, `review.expired`, `review.cancelled`
- [ ] **Fallback to polling** — If callback delivery fails, poll endpoint remains source of truth

### Signature Verification

```python
import hmac
import hashlib

def verify_hitl_signature(body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(),
        body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

## Enhanced: Multi-Round Reviews

Support approval cycles with edit requests.

### Additional Checklist

- [ ] **Track `previous_case_id`** — When present, link to prior review case
- [ ] **Display chain context** — Show user which round they're in
- [ ] **Follow `next_case_id`** — After completion, check if service created a follow-up case
- [ ] **Handle `edit` action** — When `result.action` is `"edit"`, revise the artifact and expect a new case

### Flow

```
Round 1: Service creates case_id="review_draft1"
  → Human responds: action="edit", data={feedback: "Fix intro"}
  → Poll response includes next_case_id="review_draft2"

Round 2: Service creates case_id="review_draft2", previous_case_id="review_draft1"
  → Agent revises artifact based on edit feedback
  → Human responds: action="approve"
  → Workflow continues
```

## Enhanced: Input Forms

Handle structured form data in Input-type reviews.

### Additional Checklist

- [ ] **Parse `context.form`** — Detect single-step (`fields` array) vs multi-step (`steps` array)
- [ ] **Forward form metadata** — Include field count or step titles in message to human (e.g., "Please fill 6 fields" or "3-step form: Personal Info → Preferences → Review")
- [ ] **Handle `progress` in poll** — If `progress` object is present in `in_progress` response, relay to human (e.g., "Step 2 of 3, 4/8 fields completed")
- [ ] **Handle `submit` action** — `result.data` contains key-value pairs matching `context.form` field keys
- [ ] **Validate result keys** — Ensure expected required fields from `context.form` are present in `result.data`
- [ ] **Handle `sensitive` fields** — Do NOT log or display values for fields marked `sensitive: true`

### Flow

```
Input-type HITL response received
│
├── context.form.fields exists (single-step)
│   └── Forward review_url: "Please fill {N} fields: [URL]"
│
├── context.form.steps exists (multi-step wizard)
│   └── Forward review_url: "{N}-step form: [step titles]: [URL]"
│
├── Poll returns in_progress + progress
│   └── (Optional) "Step {current}/{total}, {completed}/{total_fields} fields done"
│
└── Poll returns completed
    ├── result.action = "submit"
    ├── result.data = { field_key: value, ... }
    └── Continue workflow with structured form data
```

## Enhanced: Reminders

Re-send URLs when humans haven't responded.

### Additional Checklist

- [ ] **Parse `reminder_at`** — Can be a single timestamp or array of timestamps
- [ ] **Schedule re-sends** — At each `reminder_at` timestamp, check if case is still pending/opened
- [ ] **Handle `review.reminder` SSE event** — If using SSE, listen for reminder events
- [ ] **Respect terminal states** — Do NOT send reminders for completed/expired/cancelled cases

## Enhanced: Quality Improvement Loop

For services that return `improvement_suggestions` alongside a successful (non-202) result, agents can offer targeted improvement cycles without restarting a HITL flow.

### Additional Checklist

- [ ] **Detect `improvement_suggestions`** — Check for this array in non-202 (success) responses
- [ ] **Share primary result first** — Always deliver the main result (URL, ID, summary) to the human before offering improvements
- [ ] **Offer improvement cycle** — If `improvement_suggestions` non-empty AND `attempt < maxAttempts` (default: 2): ask the human the question from `agent_action`
- [ ] **Re-request with enriched data** — Collect answers, re-POST with enriched data
- [ ] **Share updated result** — After each re-request, share the new result immediately
- [ ] **Exit cleanly** — Stop when `improvement_suggestions` is empty OR `attempt >= maxAttempts`
- [ ] **Do not loop indefinitely** — Always cap at `maxAttempts`, even if suggestions remain

### Suggestion Object Schema

```json
{
  "field": "experience",
  "issue": "No work experience — low matching score",
  "agent_action": "Ask: 'What positions have you held? Part-time and internships count.'",
  "impact": "+25 quality points",
  "priority": "high"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `field` | string | Which data field can be improved |
| `issue` | string | What is missing or suboptimal |
| `agent_action` | string | Exact question or action for the agent to take |
| `impact` | string | Human-readable benefit description |
| `priority` | enum | `"high"` / `"medium"` / `"low"` — order of importance |

### Pseudocode

```python
MAX_IMPROVEMENT_CYCLES = 2

def handle_success_with_improvements(result_json, send_to_human, re_request_fn):
    # Always share primary result first — never skip this step
    send_to_human(format_result(result_json))

    suggestions = result_json.get("improvement_suggestions", [])
    attempt = 0

    while suggestions and attempt < MAX_IMPROVEMENT_CYCLES:
        # Ask questions from suggestions
        answers = {}
        for s in suggestions:
            answer = ask_human(s["agent_action"])  # e.g. "What positions have you held?"
            if answer:
                answers[s["field"]] = answer

        if not answers:
            break  # Human skipped all questions — stop

        # Re-request with enriched data
        attempt += 1
        result_json = re_request_fn(answers)
        send_to_human(format_result(result_json))  # Share updated result immediately
        suggestions = result_json.get("improvement_suggestions", [])

    # Done — primary result was already shared after every cycle
```

### Flow

```
Service returns 201/200 with improvement_suggestions
│
├── Share primary result to human (ALWAYS FIRST)
│
├── improvement_suggestions non-empty AND attempt < 2?
│   ├── Yes → ask agent_action questions → collect answers
│   │         re-request with enriched data
│   │         share new result
│   │         increment attempt
│   │         repeat
│   │
│   └── No (empty OR max reached) → Done
```

See [Example 13](../examples/13-quality-improvement-loop.json) for a complete end-to-end flow.

## Agent Communication

Clear, consistent messaging keeps humans informed without overwhelming them.

### What to say at each step

| Moment | What the agent says |
|--------|---------------------|
| 202 received | `"{prompt}\n\nPlease review here: {review_url}"` |
| Status `opened` | (Optional) "Review page opened — waiting for your decision." |
| Status `in_progress` | (Optional) "Working on it." |
| Status `completed` | Share result immediately. Do not delay. |
| Status `expired`, `default_action=skip` | "Review timed out — proceeding with the default. {result summary}" |
| Status `expired`, `default_action=abort` | "Review timed out. Let me know if you'd like to try again." |
| Status `cancelled` | "Review was cancelled. {reason if available}" |
| `improvement_suggestions` present | "Done! {result summary}. Want me to improve it? I can ask a few questions." |
| After improvement cycle | "Updated — here's your new result: {url or summary}" |
| After maxAttempts reached | "We've completed {N} improvement cycles. Here's the final result: {url}" |

### Principles

- **Result first.** Always share the primary result before offering improvements or next steps.
- **Never expose internals.** Don't say "polling for HITL status" — say "waiting for your decision."
- **One question at a time.** For improvement suggestions, ask one question per conversation turn.
- **Exit gracefully.** After `maxAttempts`, stop suggesting improvements even if suggestions remain.
- **Inline submit:** After the human taps a button, update or replace the message — don't leave buttons dangling.

## Delivery Modes

Choose URL delivery based on agent environment:

| Mode | When | How |
|------|------|-----|
| **Messaging** (default) | Agent is a bot (Telegram, Slack, Discord, WhatsApp) | Send URL as clickable link in chat message |
| **Messaging + Inline** (v0.7) | Bot + Service provides `submit_url` | Native buttons in chat + URL fallback |
| **Desktop CLI** | Agent runs on user's own machine | `webbrowser.open(url)` |
| **Remote CLI** | Agent on remote server (SSH) | Print URL (optionally QR code) |

In most real deployments, the agent is a bot on a server — not on the human's device. The agent sends messages to the human via the messaging platform's API. The human taps the URL link, and the browser opens on **their** device.

```python
from urllib.parse import urlparse

def handle_hitl(hitl: dict, send_to_user) -> None:
    """Forward a HITL review to the human."""
    review_url = hitl["review_url"]

    # Validate URL
    parsed = urlparse(review_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Invalid review URL: must be HTTPS with a valid host")

    # v0.7: Inline buttons for simple decisions (messaging platforms)
    if "submit_url" in hitl and "submit_token" in hitl:
        send_inline_buttons(
            prompt=hitl["prompt"],
            actions=hitl.get("inline_actions", []),
            review_url=review_url,       # Always include URL fallback
        )
    else:
        # Standard: send URL as clickable link
        send_to_user(f"{hitl['prompt']}\n{review_url}")
```

> **Desktop CLI agents** (running on the user's machine, e.g. Claude Code): Use `webbrowser.open(review_url)` to open the URL directly in the user's browser. This only applies when agent and human share the same device.

> **Remote CLI agents** (SSH): Print the URL for manual opening. Optionally render a QR code with `qrencode -t ANSI <url>` if installed.

## What NOT to Do

- **Do NOT render the review UI.** The service hosts and renders the review page. The agent is a messenger.
- **Do NOT submit responses on behalf of the human.** Unless explicitly delegated.
- **Do NOT ignore HTTP 202 + HITL.** Proceeding without human input violates the protocol.
- **Do NOT poll too frequently.** Respect rate limits (max 60/min recommended). Check `Retry-After` header.
- **Do NOT store review URLs long-term.** URLs contain time-limited opaque tokens. They expire.
- **Do NOT loop indefinitely on improvement suggestions.** Cap at `maxAttempts` (2 recommended). Each re-request may create a new resource (new URL, new ID) — share it with the human each time.
